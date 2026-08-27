/* ==========================================================================
   Data layer.

   The old build read data/*.json into memory and wrote the working set to
   localStorage. Every view above this line reads `db` synchronously — 59 call
   sites — and calls createLead / updateLead / setStage expecting the updated
   record back immediately. That shape is worth keeping: it is what makes the
   app usable on a booth tablet on exhibition wifi.

   So the network went underneath it rather than through it:

     reads    served from an in-memory cache, hydrated once at sign-in and
              mirrored to localStorage so a reload with no connection still
              opens on real data
     writes   applied to the cache immediately and returned synchronously, then
              appended to a durable outbox that drains to Supabase in the
              background and survives a reload, a crash and a flat battery

   The alternative — making every view await — would have meant a spinner
   between a visitor answering a question and the answer appearing on screen.
   The cost is that a write can fail after the UI has accepted it, so failures
   are surfaced honestly through the sync indicator rather than swallowed.

   Row-level security is what actually enforces who sees what; visibleLeads()
   is now a convenience over data the server already filtered, not a control.
   ========================================================================== */

import * as config from './config.js';
import * as api from './api.js';

const DB_KEY      = 'teal.leadconnect.v2';
const SESSION_KEY = 'teal.leadconnect.session.v2';
const PREFS_KEY   = 'teal.leadconnect.prefs.v2';
const QUEUE_KEY   = 'teal.leadconnect.queue.v2';

const COLLECTIONS = ['users', 'exhibitions', 'products', 'companies',
                     'contacts', 'leads', 'activities', 'notifications'];

export const db = {
  users: [], exhibitions: [], products: [], companies: [],
  contacts: [], leads: [], activities: [], notifications: [],
  settings: null,
  audit: [],
};

let ready = false;
let mode = 'demo';          // 'demo' | 'server'
let profile = null;         // the signed-in user's profile row, in server mode

export const currentMode = () => mode;
export const isServerMode = () => mode === 'server';

/* Relative paths only: under a project subpath an absolute '/data/x.json'
   resolves to the domain root and 404s.

   Resolved on first use rather than at module load. A bundled build has no
   import.meta.url — it is empty under a non-module output format — and
   `new URL(path, undefined)` throws, which at module scope would take the
   whole application down before it rendered anything. The single-file build
   never reaches this: its data is already inlined. */
const dataBase = () => new URL('../data/', import.meta.url);

async function loadSeedFile(name) {
  // The single-file build carries data/*.json inside it, which is also what
  // lets that build run from a file:// URL with no server at all.
  const inlined = globalThis.TEAL_SEED?.[name];
  if (inlined) return inlined;

  const res = await fetch(new URL(`${name}.json`, dataBase()));
  if (!res.ok) throw new Error(`${name}.json — ${res.status}`);
  return res.json();
}

async function loadSeed() {
  const files = [...COLLECTIONS, 'settings'];
  const results = await Promise.all(files.map(async (n) => [n, await loadSeedFile(n)]));
  return Object.fromEntries(results);
}

/* ---- local cache --------------------------------------------------------- */

/* In server mode this is a cache of what the server last said, not the record
   of truth. It is keyed by profile id: a booth tablet gets handed around, and
   the next person to sign in must not open on the last person's book. */
function persist() {
  try {
    const snapshot = { v: 2, savedAt: new Date().toISOString(), owner: profile?.id ?? null };
    for (const key of COLLECTIONS) snapshot[key] = db[key];
    snapshot.audit = db.audit.slice(0, 500);
    localStorage.setItem(DB_KEY, JSON.stringify(snapshot));
    return true;
  } catch (err) {
    // Quota, or a browser with storage blocked. The caller decides how loud
    // to be about it.
    console.warn('[store] could not persist', err);
    return false;
  }
}

export function save() { return persist(); }

function readCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DB_KEY) || 'null');
    return parsed && parsed.v === 2 ? parsed : null;
  } catch {
    return null;   // corrupt: fall through and reseed
  }
}

function clearCache() {
  try {
    localStorage.removeItem(DB_KEY);
    localStorage.removeItem(QUEUE_KEY);
  } catch { /* non-fatal */ }
}

function applySnapshot(snapshot, seedSettings) {
  for (const key of COLLECTIONS) db[key] = snapshot[key] ?? [];
  db.audit = snapshot.audit ?? [];
  if (seedSettings) db.settings = snapshot.settings ?? seedSettings;
}

/* ---- sync state ---------------------------------------------------------- */

/* What the topbar indicator reports. The old build always said "saved on this
   device", which was honest then. Now the honest answer varies, so it is
   computed rather than asserted. */
const listeners = new Set();
let syncing = false;
let lastError = null;

export function syncState() {
  if (mode === 'demo') return { state: 'local', pending: 0, error: null };
  if (!navigator.onLine)  return { state: 'offline', pending: queue().length, error: null };
  if (syncing)            return { state: 'syncing', pending: queue().length, error: null };

  const pending = queue().length;
  if (lastError) return { state: 'error', pending, error: lastError };
  return { state: pending ? 'pending' : 'synced', pending, error: null };
}

export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emitSync() {
  const snapshot = syncState();
  for (const fn of listeners) {
    try { fn(snapshot); } catch (err) { console.warn('[store] sync listener failed', err); }
  }
}

/* ---- outbox -------------------------------------------------------------- */

/* Durable, ordered, and drained one operation at a time. Order is not a
   nicety: a lead references a contact that references a company, and replaying
   them out of order fails the foreign keys. One at a time for the same reason
   — a parallel flush would race the lead ahead of its company. */
export function queue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
  catch { return []; }
}

function writeQueue(ops) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(ops)); return true; }
  catch (err) { console.warn('[store] could not persist the outbox', err); return false; }
}

export function enqueue(op, payload) {
  const ops = queue();
  ops.push({
    id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    op, payload, at: new Date().toISOString(), tries: 0,
  });
  writeQueue(ops);
  emitSync();

  // Demo mode keeps the queue purely as a record of what a backend would have
  // received, which is what Settings → Data displays.
  if (mode === 'server') scheduleFlush();
  return ops.length;
}

export const pendingCount = () => queue().length;

let flushTimer = null;
function scheduleFlush(delay = 250) {
  if (flushTimer || mode !== 'server') return;
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, delay);
}

/* How each queued operation is actually sent. Everything is keyed on an id the
   client generated, so replaying an operation that already landed is a no-op
   rather than a duplicate. */
const HANDLERS = {
  create_company: (p) => api.insertCompany(p.company),
  create_contact: (p) => api.insertContact(p.contact),
  create_lead:    (p) => api.insertLead(p.lead),
  update_lead:    (p) => api.updateLead(p.id, p.patch),
  set_stage:      (p) => api.updateLead(p.id, { stage: p.to }),
  create_activity:(p) => api.insertActivity(p.activity),
  audit:          (p) => api.insertAudit(p.entry),
  read_notifications: (p) => api.markNotificationsRead(p.ids, p.profileId),
};

/* A failure that will never succeed on retry must not wedge the queue behind
   it forever. A rejected write is dropped after being surfaced; a network
   failure is retried indefinitely, because the connection really will come
   back and the lead really does need to arrive. */
function isPermanent(err) {
  const code = err?.code ?? '';
  return code === '42501'          // row-level security said no
      || code === '23503'          // references a row that no longer exists
      || code === '22P02'          // malformed value
      || code === '23514';         // failed a check constraint
}

export async function flush() {
  if (mode !== 'server' || syncing || !navigator.onLine) return;

  let ops = queue();
  if (!ops.length) { lastError = null; emitSync(); return; }

  syncing = true;
  emitSync();

  try {
    while (ops.length) {
      const op = ops[0];
      const handler = HANDLERS[op.op];

      if (!handler) {
        // An operation queued by an older version of the app. Dropping it is
        // better than blocking every write behind something unrecognised.
        console.warn('[store] dropping unknown queued operation', op.op);
        ops.shift(); writeQueue(ops);
        continue;
      }

      try {
        await handler(op.payload);
        ops.shift();
        writeQueue(ops);
        lastError = null;
      } catch (err) {
        // Two tablets at one booth can allocate the same lead code. The unique
        // index catches it; rather than surfacing a failed save to someone
        // standing with a visitor, take a server-allocated number and retry.
        if (op.op === 'create_lead' && err?.code === '23505') {
          const renumbered = await renumberLead(op.payload.lead);
          if (renumbered) {
            op.payload.lead = renumbered;
            writeQueue(ops);
            continue;
          }
        }

        op.tries = (op.tries ?? 0) + 1;
        op.lastError = err?.message ?? String(err);

        if (isPermanent(err)) {
          console.error('[store] dropping a rejected operation', op.op, err);
          lastError = err?.message ?? String(err);
          ops.shift();
          writeQueue(ops);
          continue;
        }

        // Transient. Leave it at the head of the queue and try again later.
        writeQueue(ops);
        lastError = err?.message ?? String(err);
        scheduleFlush(Math.min(30000, 1000 * 2 ** Math.min(op.tries, 5)));
        return;
      }

      ops = queue();
    }
  } finally {
    syncing = false;
    emitSync();
  }
}

async function renumberLead(lead) {
  try {
    const code = await api.nextLeadCode(lead.exhibitionId);
    if (!code || code === lead.code) return null;

    // Keep the local record in step, or the screen shows a number that is not
    // the one the database holds.
    const local = getLead(lead.id);
    if (local) { local.code = code; persist(); }
    return { ...lead, code };
  } catch {
    return null;
  }
}

/* The connection coming back is the moment to drain, and the moment the
   indicator should stop saying "offline". */
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { emitSync(); scheduleFlush(); });
  window.addEventListener('offline', emitSync);
  // A tab left open through an exhibition day would otherwise sit on a failed
  // operation until the next write.
  setInterval(() => { if (queue().length) scheduleFlush(); }, 60000);
}

/* ---- init ---------------------------------------------------------------- */

export async function init() {
  if (ready) return db;

  const cfg = await config.load();
  mode = cfg.mode === 'server' ? 'server' : 'demo';

  if (cfg.mode === 'misconfigured') {
    throw new Error(
      'This deployment is set to use a Supabase backend, but config.json has no '
    + 'project URL or key. Check the SUPABASE_URL and SUPABASE_ANON_KEY values '
    + 'the container was started with.');
  }

  // Settings ship with the build, so the sign-in screen can render before
  // anyone has authenticated and the app has sane defaults if the server copy
  // cannot be read. The server's copy replaces this once signed in.
  db.settings = await loadSeedFile('settings');

  if (mode === 'server') await initServer();
  else await initDemo();

  ready = true;
  emitSync();
  return db;
}

async function initDemo() {
  const seed = await loadSeed();
  db.settings = seed.settings;

  const cached = readCache();
  if (cached) {
    // `?? seed[key]` rather than a truthiness test: a user who has genuinely
    // deleted every notification should keep an empty list, not have the demo
    // set handed back to them on reload.
    for (const key of COLLECTIONS) db[key] = cached[key] ?? seed[key];
    db.audit = cached.audit ?? [];
  } else {
    for (const key of COLLECTIONS) db[key] = seed[key];
    db.audit = [];
    persist();
  }

  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
  catch { session = null; }
}

async function initServer() {
  let authSession = null;
  try {
    authSession = await api.currentSession();
  } catch (err) {
    // Offline, or the project is unreachable. If there is a cached book from
    // last time, opening on it beats an error screen at a booth.
    console.warn('[store] could not reach Supabase at boot', err);
  }

  if (!authSession) return;               // router sends them to /signin

  try {
    profile = await api.myProfile(authSession);
  } catch (err) {
    // Authenticated but no usable profile: treat as signed out rather than
    // stranding them in a shell with no identity.
    console.error('[store] profile lookup failed', err);
    await api.signOut();
    profile = null;
    return;
  }

  await hydrateFromServer({ allowCache: true });
}

/* Pull the whole working set. It is a few hundred rows for one exhibition, so
   one round trip per collection at sign-in is cheaper than paging on every
   screen — and it is what lets every view stay synchronous. */
async function hydrateFromServer({ allowCache = false } = {}) {
  try {
    const data = await api.loadAll(profile.id);
    for (const key of COLLECTIONS) db[key] = data[key] ?? [];
    db.settings = data.settings ?? db.settings;
    db.audit = data.audit ?? [];
    lastError = null;
    persist();
  } catch (err) {
    const cached = readCache();
    // Only reuse the cache if it belongs to the person signing in.
    if (allowCache && cached && cached.owner === profile.id) {
      console.warn('[store] serving the cached book; the server was unreachable', err);
      applySnapshot(cached);
      lastError = api.describeError(err);
    } else {
      throw err;
    }
  }
  // Anything captured before the connection dropped goes out now.
  scheduleFlush();
}

/* Pull fresh data without a full reload — used after sign-in and by the
   manual refresh in Settings. */
export async function refresh() {
  if (mode !== 'server' || !profile) return false;
  await flush();
  await hydrateFromServer();
  emitSync();
  return true;
}

/* ---- lookups ------------------------------------------------------------- */
const byId = (list, id) => list.find((row) => row.id === id) || null;

export const getUser       = (id) => byId(db.users, id);
export const getCompany    = (id) => byId(db.companies, id);
export const getContact    = (id) => byId(db.contacts, id);
export const getLead       = (id) => byId(db.leads, id);
export const getExhibition = (id) => byId(db.exhibitions, id);
export const getProduct    = (id) => byId(db.products, id);

export function activeExhibition() {
  return db.exhibitions.find((e) => e.active) || db.exhibitions[0] || null;
}

/* A lead is only ever displayed joined to its company and contact, so do the
   join once here rather than in every view. */
export function hydrate(lead) {
  if (!lead) return null;
  const company = getCompany(lead.companyId);
  const contact = getContact(lead.contactId);
  return {
    ...lead,
    company, contact,
    companyName: company?.name ?? 'Unknown company',
    contactName: contact?.name ?? 'Unknown contact',
    industry: company?.industry ?? '',
    city: company?.city ?? contact?.city ?? '',
    designation: contact?.designation ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    owner: getUser(lead.ownerId),
    exhibition: getExhibition(lead.exhibitionId),
  };
}

/* ---- session & role visibility ------------------------------------------ */

/* Demo mode only: server mode carries identity in the Supabase session and the
   profile row, not here. */
let session = null;

/* Server mode. Returns { ok } or { ok: false, message } — the sign-in screen
   needs something to show, and 'Invalid login credentials' is not it. */
export async function signIn(email, password) {
  if (mode !== 'server') return { ok: false, message: 'This build has no authentication server.' };

  let authSession;
  try {
    authSession = await api.signIn(email, password);
  } catch (err) {
    return { ok: false, message: err.message };
  }

  try {
    const next = await api.myProfile(authSession);

    // A different person on a shared tablet must not inherit the last one's
    // cached book, or their queued writes.
    if (profile && next.id !== profile.id) clearCache();
    profile = next;

    await hydrateFromServer();
    return { ok: true };
  } catch (err) {
    await api.signOut();
    profile = null;
    return { ok: false, message: err.message };
  }
}

/* Demo mode: the account picker, unchanged. */
export function signInAsUser(userId) {
  const user = getUser(userId);
  if (!user || !user.active) return false;
  session = { userId };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* non-fatal */ }
  return true;
}

export async function signOut() {
  if (mode === 'server') {
    // Drain first: signing out at the end of a day should not discard leads
    // captured in the last minute. Best effort — never block the sign-out.
    try { await flush(); } catch { /* leaving anyway */ }
    try { await api.signOut(); } catch { /* leaving anyway */ }
    profile = null;
    // A shared booth tablet must not keep one person's book readable to the
    // next person who picks it up.
    clearCache();
    for (const key of COLLECTIONS) db[key] = [];
    db.audit = [];
  }

  session = null;
  try { localStorage.removeItem(SESSION_KEY); } catch { /* non-fatal */ }
}

export function me() {
  if (mode === 'server') return profile;
  return session ? getUser(session.userId) : null;
}

export function role() { return me()?.role ?? null; }
export const isAdmin      = () => role() === 'admin';
export const isManagement = () => role() === 'management';
export const canWrite     = () => role() === 'admin' || role() === 'sales';

/* Sales see their own book; admin and management see everything.

   In server mode the rows never left the database in the first place — this
   filter is what keeps the two modes behaving identically, and a second line
   of defence if a policy is ever loosened by mistake. It is not the control. */
export function visibleLeads() {
  const user = me();
  if (!user) return [];
  const all = db.leads.map(hydrate);
  if (user.role === 'sales') return all.filter((l) => l.ownerId === user.id);
  return all;
}

export function visibleActivities() {
  const ids = new Set(visibleLeads().map((l) => l.id));
  return db.activities.filter((a) => ids.has(a.leadId));
}

/* ---- preferences -------------------------------------------------------- */
const defaultPrefs = { theme: 'system', collapsed: false, leadView: 'table', exhibitionId: null };
export function prefs() {
  try { return { ...defaultPrefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; }
  catch { return { ...defaultPrefs }; }
}
export function setPref(key, value) {
  const next = { ...prefs(), [key]: value };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* non-fatal */ }
  return next;
}

/* ---- audit trail --------------------------------------------------------- */
export function logAudit(action, entity, entityId, detail) {
  const entry = {
    id: `au-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    action, entity, entityId, detail: detail || '',
    actor: me()?.email ?? 'system',
    actorId: me()?.id ?? null,
    at: new Date().toISOString(),
  };
  db.audit.unshift(entry);
  if (mode === 'server') enqueue('audit', { entry });
  return entry;
}

export function logActivity(leadId, type, title, body) {
  const lead = getLead(leadId);
  const entry = {
    id: `ac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    leadId, companyId: lead?.companyId ?? null,
    type, title, body: body || '',
    actorId: me()?.id ?? null, at: new Date().toISOString(),
  };
  db.activities.push(entry);
  if (mode === 'server') enqueue('create_activity', { activity: entry });
  return entry;
}

export function storageWorks() {
  try {
    localStorage.setItem('teal.probe', '1');
    localStorage.removeItem('teal.probe');
    return true;
  } catch { return false; }
}

/* ---- duplicate detection ------------------------------------------------
   Email, then the last ten digits of the phone, then company + contact name.
   Returns the matching lead rather than a boolean so the caller can offer
   merge / review / ignore — never a silent delete. */
const digits = (v) => String(v ?? '').replace(/\D/g, '');

export function findDuplicate({ email, phone, companyName, contactName, excludeId } = {}) {
  const mail = (email || '').trim().toLowerCase();
  const num = digits(phone);
  const co = (companyName || '').trim().toLowerCase();
  const person = (contactName || '').trim().toLowerCase();

  for (const lead of db.leads) {
    if (excludeId && lead.id === excludeId) continue;
    const c = getContact(lead.contactId);
    const company = getCompany(lead.companyId);
    if (!c) continue;
    if (mail && (c.email || '').trim().toLowerCase() === mail) return hydrate(lead);
    if (num.length >= 10 && digits(c.phone).slice(-10) === num.slice(-10)) return hydrate(lead);
    if (co && person
        && (company?.name || '').trim().toLowerCase() === co
        && (c.name || '').trim().toLowerCase() === person) return hydrate(lead);
  }
  return null;
}

/* The local check can only see the caller's own book, which means it misses
   the duplicate that costs the most: the same visitor written down twice by
   two people working the same stand. This asks the server, which can see
   across owners and answers with just enough to warn — who already has it and
   what stage it is at, not their pipeline.

   Returns null when there is no match, and also when the check could not run.
   A capture is never blocked because a lookup failed. */
export async function findDuplicateRemote({ email, phone } = {}) {
  if (mode !== 'server' || !navigator.onLine) return null;
  if (!email && digits(phone).length < 10) return null;
  try { return await api.findDuplicateRemote({ email, phone }); }
  catch { return null; }
}

/* ---- writes -------------------------------------------------------------- */

export function createLead(draft) {
  const user = me();
  const exhibition = getExhibition(draft.exhibitionId) || activeExhibition();

  // Company: reuse an existing record when the name matches, so the account
  // view stays whole instead of fragmenting into near-duplicates.
  let company = db.companies.find(
    (c) => c.name.trim().toLowerCase() === (draft.companyName || '').trim().toLowerCase());
  const newCompany = !company;

  if (!company) {
    company = {
      id: `co-${Date.now().toString(36)}`,
      name: draft.companyName.trim(),
      industry: draft.industry || '', size: draft.companySize || '',
      city: draft.city || '', state: '', country: draft.country || 'India',
      website: draft.website || '', accountType: draft.accountType || 'OEM',
      segment: 'Growth',
    };
    db.companies.push(company);
  }

  const contact = {
    id: `ct-${Date.now().toString(36)}`,
    companyId: company.id,
    name: draft.contactName.trim(), designation: draft.designation || '',
    authority: draft.authority || 'Unknown',
    email: (draft.email || '').trim().toLowerCase(), phone: draft.phone || '',
    linkedin: draft.linkedin || '', city: draft.city || '', country: 'India',
    createdBy: user?.id ?? null,
  };
  db.contacts.push(contact);

  const seq = db.leads.filter((l) => l.exhibitionId === exhibition.id).length + 1;
  const lead = {
    id: `ld-${Date.now().toString(36)}`,
    code: `TEAL-${exhibition.code}-${String(seq).padStart(5, '0')}`,
    contactId: contact.id, companyId: company.id, exhibitionId: exhibition.id,
    // Whoever saves the lead owns it. A booth tablet gets passed around, and
    // filing a lead under whoever opened the form quietly corrupts the
    // salesperson report. The insert policy enforces the same thing.
    ownerId: user.id,
    stage: draft.stage || 'NEW',
    products: draft.products || [], productIds: draft.productIds || [],
    application: draft.application || '', problem: draft.problem || '',
    quantity: draft.quantity || '', budget: draft.budget || 'Not Defined',
    timeline: draft.timeline || 'Not Defined', authority: draft.authority || 'Unknown',
    currentSolution: draft.currentSolution || '', competitor: draft.competitor || '',
    value: Number(draft.value) || 0, source: draft.source || 'Booth Conversation',
    engagement: draft.engagement || { booth: true, demo: false, meeting: false,
                                      technical: false, commercial: false },
    capturedAt: new Date().toISOString(),
    nextFollowUp: draft.nextFollowUp || '',
    nextBestAction: '', nextBestActionWhy: '',
    consent: !!draft.consent,
    tags: draft.tags || [], notes: draft.notes || '',
  };
  db.leads.unshift(lead);

  // Order matters on replay: the lead's foreign keys need its company and
  // contact to have landed first.
  if (mode === 'server') {
    if (newCompany) enqueue('create_company', { company });
    enqueue('create_contact', { contact });
    enqueue('create_lead', { lead });
  }

  logActivity(lead.id, 'lead_captured', 'Lead captured at booth',
              `${contact.name} — ${company.name}`);
  logAudit('lead_created', 'lead', lead.id, lead.code);
  if (mode !== 'server') {
    // Demo mode has nothing to send. The queue is kept anyway because
    // Settings → Data shows it: it is the honest answer to "what would a
    // backend have received", rather than a green Synced badge that means
    // nothing.
    enqueue('create_lead', { lead, id: lead.id, code: lead.code });
  }
  persist();
  return hydrate(lead);
}

export function updateLead(id, patch, auditDetail) {
  const lead = getLead(id);
  if (!lead) return null;
  Object.assign(lead, patch);
  logAudit('lead_updated', 'lead', id, auditDetail || Object.keys(patch).join(', '));
  enqueue('update_lead', { id, patch, keys: Object.keys(patch) });
  persist();
  return hydrate(lead);
}

export function setStage(id, stage) {
  const lead = getLead(id);
  if (!lead || lead.stage === stage) return null;
  const from = lead.stage;
  lead.stage = stage;
  logActivity(id, 'stage_change', 'Pipeline stage changed', `${from} → ${stage}`);
  logAudit('stage_changed', 'lead', id, `${lead.code}: ${from} → ${stage}`);
  enqueue('set_stage', { id, from, to: stage });
  persist();
  return hydrate(lead);
}

export function markNotificationsRead() {
  const unread = db.notifications.filter((n) => !n.read).map((n) => n.id);
  db.notifications.forEach((n) => { n.read = true; });
  if (mode === 'server' && unread.length && profile) {
    enqueue('read_notifications', { ids: unread, profileId: profile.id });
  }
  persist();
}

export function unreadCount() {
  return db.notifications.filter((n) => !n.read).length;
}

/* ---- account ------------------------------------------------------------- */

export async function changePassword(newPassword) {
  if (mode !== 'server') throw new Error('This build has no authentication server.');
  await api.changePassword(newPassword);
  logAudit('password_changed', 'user', profile?.id ?? '', profile?.email ?? '');
}

export async function sendPasswordReset(email) {
  if (mode !== 'server') throw new Error('This build has no authentication server.');
  await api.sendPasswordReset(email);
}
