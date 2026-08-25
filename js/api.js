/* ==========================================================================
   Supabase data access.

   The only module that knows the database exists. It has two jobs:

   1. Translate between the shapes. The browser works in camelCase objects
      ('companyId', 'nextFollowUp'); the database is snake_case. The mapping is
      mechanical in both directions, so it is derived rather than declared —
      but writes go through an explicit per-table column list, because a stray
      key in a patch should be dropped here rather than rejected by PostgREST
      three layers down with an error nobody can read.

   2. Keep the client off the critical path. The Supabase bundle is ~211 KB and
      demo mode never needs it, so it is pulled in with a dynamic import the
      first time a real connection is actually required.

   Everything here returns plain data or throws an Error with a message fit to
   show a user. store.js decides what to do about failures; this module does
   not touch the DOM and does not know what a toast is.
   ========================================================================== */

import * as config from './config.js';
import { toRow, fromRow } from './field-map.js';

let client = null;

/* The vendored bundle is a real ES module, so this is an ordinary dynamic
   import — no script injection, no global. */
async function getClient() {
  if (client) return client;

  const cfg = config.get();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    throw new Error('No Supabase project is configured.');
  }

  const { createClient } = await import('../vendor/supabase-js.esm.js');
  client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The app is a hash router. Detecting a session in the URL would have
      // Supabase try to parse '#/leads/ld-004' as an auth callback.
      detectSessionInUrl: false,
      storageKey: 'teal.leadconnect.auth.v2',
    },
    global: { headers: { 'x-application-name': 'teal-leadconnect' } },
  });
  return client;
}

export function isReady() { return client !== null; }

/* ---- name mapping -------------------------------------------------------- */

/* The camelCase-to-snake_case rules live in field-map.js because the seed
   script needs exactly the same ones. */
export { toRow, fromRow } from './field-map.js';

/* ---- errors -------------------------------------------------------------- */

/* Supabase errors carry a code and a Postgres message. Neither is something to
   put in front of a salesperson at a booth, so the ones we can anticipate get
   a plain sentence and the rest keep their detail for the console. */
export function describeError(error) {
  if (!error) return 'Something went wrong.';
  const code = error.code ?? '';
  const message = error.message ?? String(error);

  if (message === 'Failed to fetch' || message.includes('NetworkError')) {
    return 'Could not reach the server. Your work is saved on this device and will sync when the connection returns.';
  }
  if (code === '42501' || message.includes('row-level security')) {
    return 'You do not have permission to make that change.';
  }
  if (code === '23505') return 'That record already exists.';
  if (code === '23503') return 'That change refers to a record that no longer exists.';
  if (message.includes('Invalid login credentials')) return 'That email and password do not match an account.';
  if (message.includes('Email not confirmed')) return 'That account has not been confirmed yet. Check your email.';
  return message;
}

class ApiError extends Error {
  constructor(error, context) {
    super(describeError(error));
    this.name = 'ApiError';
    this.context = context;
    this.cause = error;
    this.code = error?.code ?? '';
  }
}

function unwrap({ data, error }, context) {
  if (error) throw new ApiError(error, context);
  return data;
}

/* ---- auth ---------------------------------------------------------------- */

export async function signIn(email, password) {
  const sb = await getClient();
  const data = unwrap(
    await sb.auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password }),
    'sign in');
  return data.session;
}

export async function signOut() {
  if (!client) return;
  await client.auth.signOut();
}

export async function currentSession() {
  const sb = await getClient();
  const { data } = await sb.auth.getSession();
  return data?.session ?? null;
}

/* The signed-in user's own profile row, which is what carries their role.
   auth.users holds the credential; profiles holds who they are here. */
export async function myProfile(session) {
  const sb = await getClient();
  const authUserId = session?.user?.id;
  if (!authUserId) return null;

  const rows = unwrap(
    await sb.from('profiles').select('*').eq('auth_user_id', authUserId).limit(1),
    'load your profile');

  if (!rows?.length) {
    throw new Error(
      'Your sign-in worked, but no LeadConnect profile is linked to it. An administrator needs to finish setting up your account.');
  }
  const profile = fromRow('profiles', rows[0]);
  if (!profile.active) {
    throw new Error('That account has been deactivated. Contact an administrator.');
  }
  return profile;
}

export async function onAuthChange(handler) {
  const sb = await getClient();
  sb.auth.onAuthStateChange((event, session) => handler(event, session));
}

export async function changePassword(newPassword) {
  const sb = await getClient();
  unwrap(await sb.auth.updateUser({ password: newPassword }), 'change your password');
}

export async function sendPasswordReset(email) {
  const sb = await getClient();
  unwrap(
    await sb.auth.resetPasswordForEmail(String(email).trim().toLowerCase()),
    'send a reset email');
}

/* ---- reads --------------------------------------------------------------- */

/* PostgREST caps a response at 1000 rows. Activities pass that after a couple
   of exhibitions, and a silently truncated timeline is worse than a slow one,
   so every collection read pages until the server stops filling the window. */
const PAGE = 1000;

async function selectAll(table, { orderBy, ascending = true } = {}) {
  const sb = await getClient();
  const out = [];

  for (let from = 0; ; from += PAGE) {
    let query = sb.from(table).select('*').range(from, from + PAGE - 1);
    if (orderBy) query = query.order(orderBy, { ascending });

    const rows = unwrap(await query, `load ${table}`);
    out.push(...rows.map((row) => fromRow(table, row)));
    if (rows.length < PAGE) break;
  }
  return out;
}

/* One round trip per collection, in parallel. The row-level policies do the
   filtering, so a sales user's request comes back holding only their book —
   the client never asks for more than it is allowed and then trims. */
export async function loadAll(profileId) {
  const [users, exhibitions, products, companies, contacts,
         leads, activities, notifications, settings, audit] = await Promise.all([
    selectAll('profiles',      { orderBy: 'name' }),
    selectAll('exhibitions',   { orderBy: 'start_date', ascending: false }),
    selectAll('products',      { orderBy: 'name' }),
    selectAll('companies',     { orderBy: 'name' }),
    selectAll('contacts',      { orderBy: 'name' }),
    selectAll('leads',         { orderBy: 'captured_at', ascending: false }),
    selectAll('activities',    { orderBy: 'at' }),
    // The view resolves "have I read this" per caller; the flag on the
    // notification itself cannot, because several people share the row.
    selectAll('notifications_for_me', { orderBy: 'at', ascending: false }),
    loadSettings(),
    loadAudit(),
  ]);

  return {
    users, exhibitions, products, companies, contacts, leads, activities,
    // Collapse back to the single `read` flag the views already render.
    notifications: notifications.map(({ readByMe, ...n }) => ({ ...n, read: !!readByMe })),
    settings,
    audit,
  };
}

/* Lead codes are allocated by the database. Generating them per device meant
   two tablets at one booth handed out the same number and one lead overwrote
   the other; the unique index would now reject the second, which is a failed
   save in front of a visitor. Asking the server avoids the collision instead
   of catching it. */
export async function nextLeadCode(exhibitionId) {
  const sb = await getClient();
  const { data, error } = await sb.rpc('next_lead_code', { p_exhibition_id: exhibitionId });
  if (error) throw new ApiError(error, 'allocate a lead number');
  return data;
}

async function loadSettings() {
  const sb = await getClient();
  const rows = unwrap(
    await sb.from('app_settings').select('payload').eq('id', 'singleton').limit(1),
    'load settings');
  return rows?.[0]?.payload ?? null;
}

/* Administrator-only by policy. Everyone else gets an empty log rather than an
   error, because "you may not read this" is not a failure worth interrupting a
   sign-in over. */
async function loadAudit() {
  try {
    return await selectAll('audit_log', { orderBy: 'at', ascending: false });
  } catch {
    return [];
  }
}

/* ---- writes -------------------------------------------------------------- */

/* returning=minimal throughout. The client already has the row it just sent —
   it built it — and asking for it back means the insert also needs a select
   policy to pass, which is a second way for a write to fail for reasons that
   have nothing to do with the write. */
const MINIMAL = { returning: 'minimal' };

export async function insertCompany(company) {
  const sb = await getClient();
  unwrap(await sb.from('companies').insert(toRow('companies', company), MINIMAL), 'save the company');
}

export async function insertContact(contact) {
  const sb = await getClient();
  unwrap(await sb.from('contacts').insert(toRow('contacts', contact), MINIMAL), 'save the contact');
}

export async function insertLead(lead) {
  const sb = await getClient();
  unwrap(await sb.from('leads').insert(toRow('leads', lead), MINIMAL), 'save the lead');
}

export async function updateLead(id, patch) {
  const sb = await getClient();
  unwrap(
    await sb.from('leads').update(toRow('leads', patch), MINIMAL).eq('id', id),
    'update the lead');
}

export async function insertActivity(activity) {
  const sb = await getClient();
  unwrap(
    await sb.from('activities').insert(toRow('activities', activity), MINIMAL),
    'record the activity');
}

export async function insertAudit(entry) {
  const sb = await getClient();
  unwrap(await sb.from('audit_log').insert(toRow('audit_log', entry), MINIMAL), 'write the audit entry');
}

/* Read state is per person, so it is a row in notification_reads rather than a
   flag on the shared notification. */
export async function markNotificationsRead(notificationIds, profileId) {
  if (!notificationIds.length) return;
  const sb = await getClient();
  unwrap(
    await sb.from('notification_reads').upsert(
      notificationIds.map((id) => ({ notification_id: id, profile_id: profileId })),
      { onConflict: 'notification_id,profile_id', ...MINIMAL }),
    'mark notifications read');
}

export async function readNotificationIds(profileId) {
  const sb = await getClient();
  const rows = unwrap(
    await sb.from('notification_reads').select('notification_id').eq('profile_id', profileId),
    'load notification state');
  return new Set(rows.map((r) => r.notification_id));
}

/* Duplicate detection against the whole table rather than the rows already in
   memory. A sales user cannot see a colleague's contacts, so the local check
   would miss exactly the duplicate that matters: the same visitor captured at
   the same booth by two people at once. This runs through a security-definer
   function that reports only whether a match exists and who owns it. */
export async function findDuplicateRemote({ email, phone }) {
  const sb = await getClient();
  const digits = String(phone ?? '').replace(/\D/g, '');
  const { data, error } = await sb.rpc('find_duplicate_lead', {
    p_email: String(email ?? '').trim().toLowerCase(),
    p_phone_tail: digits.length >= 10 ? digits.slice(-10) : '',
  });
  // Never block a capture because the duplicate check could not run.
  if (error) return null;
  return data?.[0] ?? null;
}
