#!/usr/bin/env node
/* ==========================================================================
   Load data/*.json into a Supabase project.

     SUPABASE_URL=https://xxx.supabase.co \
     SUPABASE_SERVICE_ROLE_KEY=eyJ... \
     node supabase/seed.mjs

   Run the migrations first. This only moves data.

   No dependencies, by design. The application ships no node_modules and this
   script should run on a laptop that has just cloned the repository, so it
   talks to PostgREST and GoTrue over plain fetch rather than pulling in the
   client library. Node 18 or newer.

   Flags:
     --dry-run          show what would be written, write nothing
     --reset            delete existing rows first (asks for confirmation)
     --password <pw>    one password for every seeded account
                        (default: a different random one per account, printed
                         once at the end)

   The service-role key bypasses row-level security completely. It belongs in
   a shell that is about to run this and nowhere else — never in config.json,
   never in the repository, never anywhere a browser can reach it.
   ========================================================================== */

import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toRow } from '../js/field-map.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const URL_BASE = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RESET = args.includes('--reset');
const FIXED_PASSWORD = (() => {
  const i = args.indexOf('--password');
  return i >= 0 ? args[i + 1] : null;
})();

/* Seed timestamps are naive local strings ('2026-08-12T14:15:00') because that
   is how they were written down. The events happened in India, so they are
   anchored to IST rather than left for Postgres to read as UTC — otherwise
   every timeline in the app shifts by five and a half hours. */
const IST_OFFSET = '+05:30';

const say = (...a) => console.log(...a);
const fail = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

if (!URL_BASE || !SERVICE_KEY) {
  fail('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n'
     + '  Both are in your Supabase dashboard under Project Settings → API.\n'
     + '  Use the service_role key, not the anon key: seeding writes past\n'
     + '  row-level security, which the anon key cannot do.');
}

/* ---- transport ----------------------------------------------------------- */

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

  if (!res.ok) {
    const detail = payload?.message ?? payload?.msg ?? payload?.error_description ?? text;
    const err = new Error(`${method} ${path} → ${res.status}: ${detail}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

/* PostgREST upsert. Chunked because a single request carrying every activity
   is a large body and a partial failure in one is hard to reason about. */
async function upsert(table, rows, { chunk = 250 } = {}) {
  if (!rows.length) return 0;
  if (DRY_RUN) return rows.length;

  for (let i = 0; i < rows.length; i += chunk) {
    await call(`/rest/v1/${table}`, {
      method: 'POST',
      body: rows.slice(i, i + chunk),
      headers: {
        Prefer: 'resolution=merge-duplicates,return=minimal',
        'Content-Profile': 'public',
      },
    });
  }
  return rows.length;
}

const readJson = async (name) => JSON.parse(await readFile(join(DATA, `${name}.json`), 'utf8'));

/* ---- helpers ------------------------------------------------------------- */

/* '2026-08-12T14:15:00' has no zone. Attach IST. Values that already carry an
   offset, and empty values, are left exactly as they are. */
function stamp(value) {
  if (!value) return null;
  if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(value)) return value;
  return `${value}${IST_OFFSET}`;
}

function generatePassword() {
  // base64url of 12 bytes: 16 characters, no ambiguous punctuation to read out.
  return randomBytes(12).toString('base64url');
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

/* ---- auth accounts ------------------------------------------------------- */

/* One auth user per profile. Idempotent: an account that already exists is
   found and reused rather than failing the whole run, so the script can be
   re-run after a partial failure without cleaning up by hand. */
async function ensureAuthUser(user, password) {
  const email = user.email.trim().toLowerCase();

  try {
    const created = await call('/auth/v1/admin/users', {
      method: 'POST',
      body: {
        email,
        password,
        // No mail server is configured on a fresh project, so a confirmation
        // link would never arrive and nobody could sign in.
        email_confirm: true,
        user_metadata: { name: user.name, profile_id: user.id },
      },
    });
    return { id: created.id, created: true };
  } catch (err) {
    const alreadyExists = err.status === 422
      || /already (been )?registered|already exists/i.test(err.message);
    if (!alreadyExists) throw err;

    const found = await call(`/auth/v1/admin/users?page=1&per_page=200`);
    const list = Array.isArray(found) ? found : (found?.users ?? []);
    const match = list.find((u) => (u.email ?? '').toLowerCase() === email);
    if (!match) throw new Error(`${email} exists but could not be looked up.`);
    return { id: match.id, created: false };
  }
}

/* ---- reset --------------------------------------------------------------- */

/* Child tables first: the foreign keys are what make the order matter.
   Profiles and the auth accounts are deliberately left alone — dropping them
   would invalidate everyone's sign-in to re-import demo leads. */
const RESET_ORDER = ['notification_reads', 'notifications', 'activities', 'audit_log',
                     'leads', 'contacts', 'companies', 'exhibitions', 'products'];

async function resetTables() {
  say('\n  Deleting existing rows…');
  for (const table of RESET_ORDER) {
    if (DRY_RUN) { say(`    would clear ${table}`); continue; }
    // PostgREST requires a filter on delete; id is not null matches everything.
    await call(`/rest/v1/${table}?id=not.is.null`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    say(`    cleared ${table}`);
  }
}

/* ---- main ---------------------------------------------------------------- */

async function main() {
  say(`\nTEAL LeadConnect — seeding ${URL_BASE}`);
  if (DRY_RUN) say('DRY RUN — nothing will be written.\n');

  const [users, exhibitions, products, companies, contacts,
         leads, activities, notifications, settings] = await Promise.all(
    ['users', 'exhibitions', 'products', 'companies', 'contacts',
     'leads', 'activities', 'notifications', 'settings'].map(readJson));

  say(`  read ${leads.length} leads, ${companies.length} companies, `
    + `${contacts.length} contacts, ${activities.length} activities`);

  if (RESET) {
    const ok = DRY_RUN || await confirm(
      `\n  This deletes every lead, company, contact and activity in ${URL_BASE}.\n`
      + '  Sign-in accounts are kept. Continue?');
    if (!ok) fail('Cancelled. Nothing was written.');
    await resetTables();
  }

  /* -- accounts ---------------------------------------------------------- */
  say('\n  Accounts');
  const credentials = [];
  const profiles = [];

  for (const user of users) {
    const password = FIXED_PASSWORD ?? generatePassword();

    if (DRY_RUN) {
      say(`    would create ${user.email} (${user.role})`);
      profiles.push(toRow('profiles', { ...user, authUserId: null }));
      continue;
    }

    const { id: authUserId, created } = await ensureAuthUser(user, password);
    say(`    ${created ? 'created' : 'exists '} ${user.email.padEnd(32)} ${user.role}`);
    if (created) credentials.push({ email: user.email, password, role: user.role });

    profiles.push(toRow('profiles', { ...user, authUserId }));
  }
  await upsert('profiles', profiles);

  /* -- reference data ---------------------------------------------------- */
  say('\n  Data');

  await upsert('exhibitions', exhibitions.map((e) => toRow('exhibitions', e)));
  say(`    exhibitions   ${exhibitions.length}`);

  await upsert('products', products.map((p) => toRow('products', p)));
  say(`    products      ${products.length}`);

  await upsert('companies', companies.map((c) => toRow('companies', c)));
  say(`    companies     ${companies.length}`);

  /* A contact's created_by is the owner of the lead that references it, so the
     row-level policy that lets someone read back a contact they just captured
     lines up with the seeded data too. Contacts with no lead fall to the
     administrator rather than to nobody. */
  const adminId = users.find((u) => u.role === 'admin')?.id ?? users[0].id;
  const ownerByContact = new Map(leads.map((l) => [l.contactId, l.ownerId]));

  await upsert('contacts', contacts.map((c) => toRow('contacts', {
    ...c,
    createdBy: ownerByContact.get(c.id) ?? adminId,
  })));
  say(`    contacts      ${contacts.length}`);

  await upsert('leads', leads.map((l) => toRow('leads', {
    ...l,
    capturedAt: stamp(l.capturedAt),
    nextFollowUp: l.nextFollowUp || '',
  })));
  say(`    leads         ${leads.length}`);

  await upsert('activities', activities.map((a) => toRow('activities', {
    ...a, at: stamp(a.at),
  })));
  say(`    activities    ${activities.length}`);

  await upsert('notifications', notifications.map((n) => toRow('notifications', {
    ...n, at: stamp(n.at), recipientId: n.recipientId ?? null,
  })));
  say(`    notifications ${notifications.length}`);

  if (!DRY_RUN) {
    await call('/rest/v1/app_settings', {
      method: 'POST',
      body: [{ id: 'singleton', payload: settings }],
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
  }
  say('    settings      1');

  /* -- credentials ------------------------------------------------------- */
  if (credentials.length) {
    say('\n  ' + '─'.repeat(62));
    say('  Sign-in details. This is the only time they are shown.');
    say('  ' + '─'.repeat(62));
    for (const c of credentials) {
      say(`    ${c.email.padEnd(34)} ${c.password}   (${c.role})`);
    }
    say('  ' + '─'.repeat(62));
    say('  Hand these out over something private, and have everyone change');
    say('  their password on first sign-in. If you lose them, reset from the');
    say('  Supabase dashboard under Authentication → Users.');
  } else if (!DRY_RUN) {
    say('\n  All accounts already existed; no new passwords were set.');
  }

  say(DRY_RUN ? '\nDry run complete. Nothing was written.\n' : '\nDone.\n');
}

main().catch((err) => {
  console.error(`\n✗ Seeding failed: ${err.message}`);
  if (err.payload) console.error(JSON.stringify(err.payload, null, 2));
  console.error('\n  Nothing is left half-written that a re-run will not fix:'
              + '\n  every insert is an upsert keyed on id, so running the script'
              + '\n  again after fixing the cause is safe.\n');
  process.exit(1);
});
