/* ==========================================================================
   Data layer.

   Reads the seed collections from ./data/*.json, then keeps a working copy in
   localStorage so edits survive a reload and capture keeps working offline.
   Every read the UI does goes through here — no view touches storage or fetch
   directly, which is what makes swapping in a real API a one-file change
   (§30). Replace `loadSeed` with HTTP calls and nothing above this line moves.
   ========================================================================== */

const DB_KEY = 'teal.leadconnect.v2';
const SESSION_KEY = 'teal.leadconnect.session.v2';
const PREFS_KEY = 'teal.leadconnect.prefs.v2';
const QUEUE_KEY = 'teal.leadconnect.queue.v2';

const COLLECTIONS = ['users', 'exhibitions', 'products', 'companies',
                     'contacts', 'leads', 'activities', 'notifications'];

export const db = {
  users: [], exhibitions: [], products: [], companies: [],
  contacts: [], leads: [], activities: [], notifications: [],
  settings: null,
  audit: [],
};

let ready = false;

/* Relative paths only. Under GitHub Pages the app is served from /Lead-2/,
   so an absolute "/data/x.json" would resolve to the domain root and 404.
   `import.meta.url` gives the real base wherever it is deployed (§42). */
const DATA_BASE = new URL('../data/', import.meta.url);

async function loadSeed() {
  const files = [...COLLECTIONS, 'settings'];
  const results = await Promise.all(files.map(async (name) => {
    const res = await fetch(new URL(`${name}.json`, DATA_BASE));
    if (!res.ok) throw new Error(`${name}.json — ${res.status}`);
    return [name, await res.json()];
  }));
  const seed = {};
  for (const [name, payload] of results) seed[name] = payload;
  return seed;
}

function persist() {
  try {
    const snapshot = { v: 2, savedAt: new Date().toISOString() };
    for (const key of COLLECTIONS) snapshot[key] = db[key];
    snapshot.audit = db.audit.slice(0, 500);
    localStorage.setItem(DB_KEY, JSON.stringify(snapshot));
    return true;
  } catch (err) {
    // Quota or a blocked-storage browser. The caller decides how loud to be.
    console.warn('[store] could not persist', err);
    return false;
  }
}

export function save() { return persist(); }

export async function init() {
  if (ready) return db;

  let stored = null;
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.v === 2) stored = parsed;
    }
  } catch { /* corrupt — fall through and reseed */ }

  // settings is reference data, not user data: always take the shipped copy so
  // a scoring-weight change reaches devices that already have a working set.
  const seed = await loadSeed();
  db.settings = seed.settings;

  if (stored) {
    for (const key of COLLECTIONS) db[key] = stored[key] ?? seed[key];
    db.audit = stored.audit ?? [];
  } else {
    for (const key of COLLECTIONS) db[key] = seed[key];
    db.audit = [];
    persist();
  }

  ready = true;
  return db;
}

/* ---- lookups ------------------------------------------------------------ */
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
let session = null;
try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { session = null; }

export function signIn(userId) {
  const user = getUser(userId);
  if (!user || !user.active) return false;
  session = { userId };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return true;
}
export function signOut() {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}
export function me() { return session ? getUser(session.userId) : null; }
export function role() { return me()?.role ?? null; }
export const isAdmin      = () => role() === 'admin';
export const isManagement = () => role() === 'management';
export const canWrite     = () => role() === 'admin' || role() === 'sales';

/* Sales see their own book; admin and management see everything. This mirrors
   the row-level policies the hosted build enforces in the database. */
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

/* ---- audit trail (§ data safety) ---------------------------------------- */
export function logAudit(action, entity, entityId, detail) {
  db.audit.unshift({
    id: `au-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    action, entity, entityId, detail: detail || '',
    actor: me()?.email ?? 'system', at: new Date().toISOString(),
  });
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
  return entry;
}

/* ---- offline queue (§28) ------------------------------------------------
   Nothing here talks to a server yet, so the queue records what *would* be
   pushed. It is deliberately honest: the UI reports "saved on this device",
   never "synced". */
export function queue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
  catch { return []; }
}
export function enqueue(op, payload) {
  const q = queue();
  q.push({ id: `q-${Date.now().toString(36)}`, op, payload, at: new Date().toISOString() });
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* non-fatal */ }
  return q.length;
}

export function storageWorks() {
  try {
    localStorage.setItem('teal.probe', '1');
    localStorage.removeItem('teal.probe');
    return true;
  } catch { return false; }
}

/* ---- duplicate detection (§29) ------------------------------------------
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

/* ---- writes ------------------------------------------------------------- */
export function createLead(draft) {
  const user = me();
  const exhibition = getExhibition(draft.exhibitionId) || activeExhibition();

  // Company: reuse an existing record when the name matches, so the account
  // view stays whole instead of fragmenting into near-duplicates.
  let company = db.companies.find(
    (c) => c.name.trim().toLowerCase() === (draft.companyName || '').trim().toLowerCase());
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
  };
  db.contacts.push(contact);

  const seq = db.leads.filter((l) => l.exhibitionId === exhibition.id).length + 1;
  const lead = {
    id: `ld-${Date.now().toString(36)}`,
    code: `TEAL-${exhibition.code}-${String(seq).padStart(5, '0')}`,
    contactId: contact.id, companyId: company.id, exhibitionId: exhibition.id,
    // Whoever saves the lead owns it. A booth tablet gets passed around, and
    // filing a lead under whoever opened the form quietly corrupts the
    // salesperson report.
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

  logActivity(lead.id, 'lead_captured', 'Lead captured at booth',
              `${contact.name} — ${company.name}`);
  logAudit('lead_created', 'lead', lead.id, lead.code);
  enqueue('create_lead', { id: lead.id, code: lead.code });
  persist();
  return hydrate(lead);
}

export function updateLead(id, patch, auditDetail) {
  const lead = getLead(id);
  if (!lead) return null;
  Object.assign(lead, patch);
  logAudit('lead_updated', 'lead', id, auditDetail || Object.keys(patch).join(', '));
  enqueue('update_lead', { id, keys: Object.keys(patch) });
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
  db.notifications.forEach((n) => { n.read = true; });
  persist();
}

export function unreadCount() {
  return db.notifications.filter((n) => !n.read).length;
}
