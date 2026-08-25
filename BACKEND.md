# Backend

The app was a browser-only build: seed data from `data/*.json`, working set in
`localStorage`, one device, no sharing. This is what replaced that — a Supabase
project holding a PostgreSQL database and the authentication server.

Read this once before running anything. The deploy steps are in
[DEPLOY.md](DEPLOY.md).

---

## What is where

```
supabase/
  migrations/
    0001_schema.sql       tables, indexes, constraints
    0002_rls.sql          row-level security: who can see and change what
    0003_functions.sql    duplicate lookup, lead-code allocation
  seed.mjs                loads data/*.json into a project, creates accounts
  tests/
    00_supabase_stub.sql  enough of Supabase to run the migrations locally
    rls_test.sql          55 assertions against the security rules
    run.sh                applies the migrations to a scratch database and runs them

js/
  config.js               reads config.json at boot, picks server or demo mode
  api.js                  the only module that talks to Supabase
  field-map.js            camelCase ↔ snake_case, shared with seed.mjs
  store.js                unchanged interface, Supabase underneath
vendor/
  supabase-js.esm.js      the client, bundled and committed
```

## Setting up a project

**1. Create it.** [supabase.com/dashboard](https://supabase.com/dashboard) →
New project. Choose a region near your users — `ap-south-1` (Mumbai) for an
India-based team. Save the database password it gives you.

**2. Run the migrations.** SQL Editor → New query, then paste and run each file
in order: `0001_schema.sql`, `0002_rls.sql`, `0003_functions.sql`. Each is
idempotent, so re-running one is safe.

With the Supabase CLI instead:

```sh
supabase link --project-ref YOUR-PROJECT-REF
supabase db push
```

**3. Load the data and create the accounts.**

```sh
export SUPABASE_URL=https://YOUR-PROJECT.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=eyJ...        # Project Settings → API

node supabase/seed.mjs --dry-run               # check first
node supabase/seed.mjs
```

It creates one sign-in account per row in `data/users.json`, prints a generated
password for each, and loads every collection. **The passwords are shown once.**
Hand them over privately and have everyone change theirs on first sign-in.

Useful flags: `--password <pw>` to set the same password for all of them (fine
for a pilot, not for production), `--reset` to clear the data first — it asks
before deleting, and never touches the sign-in accounts.

**4. Point the app at it.** See [DEPLOY.md](DEPLOY.md).

## The two keys

Supabase gives you two, and the difference matters more than anything else in
this document.

| | Where it belongs | What it can do |
| --- | --- | --- |
| **anon** / publishable | `config.json`, shipped to every browser | Nothing on its own. Every request is still filtered by row-level security, and an unauthenticated caller gets zero rows. |
| **service_role** | The shell you run `seed.mjs` from. Nowhere else. | Everything. It bypasses row-level security completely. |

Publishing the anon key is the intended design. Publishing the service_role key
hands over every lead in the database. `deploy/docker-entrypoint.sh` refuses to
start if it finds one where the anon key belongs.

## The security rules

`visibleLeads()` used to filter a sales user down to their own book in
JavaScript. That is a convenience, not a control — anyone could open the
console and read the rest. The rules now live in the database:

| Role | Leads | Contacts | Companies | Audit log |
| --- | --- | --- | --- | --- |
| **admin** | all, read and write | all | all | read |
| **sales** | only their own | only those under their own leads, plus ones they captured | all, read | no |
| **management** | all, read only | all, read only | all, read | no |

Two deliberate decisions worth knowing about:

**Companies are readable by everyone signed in.** Capture reuses an existing
company when the name matches, so a sales user who could only see their own
accounts would create a second "Vertex Microsystems" every time a colleague had
already captured it, and the Account 360 would fragment. A company row holds
firm-level facts — name, industry, city, website — not another rep's pipeline.
Personal data lives in `contacts`, which is scoped.

**Duplicate detection reaches across owners, narrowly.** Two people working the
same stand cannot see each other's leads, so neither would be warned about the
duplicate that costs the most: the same visitor written down twice. The
`find_duplicate_lead` function answers across every book, but only for an exact
email or exact ten-digit phone match the caller already typed, and returns only
the code, stage, company, contact name and who owns it. No value, no notes, no
contact details, and no way to page through a colleague's pipeline.

**The audit log cannot be rewritten by anyone**, administrators included. There
is no update or delete policy on it. A log that can be edited proves nothing.

### Checking the rules yourself

```sh
supabase/tests/run.sh
```

Needs a local PostgreSQL 15+ you can create databases on. It stubs the parts of
Supabase the policies depend on, applies all three migrations to a scratch
database, and runs 55 assertions — that a sales user cannot read, claim,
reassign or delete a colleague's lead or promote themselves to admin; that
management can read everything and write nothing; that a deactivated account
resolves to no profile and sees nothing. It drops the database afterwards.

One thing worth understanding if you add tests: an `UPDATE` with no policy
granting it does not raise an error. `using()` filters the row out and the
statement reports zero rows affected. Only a `with_check()` violation raises. A
test written to expect an exception therefore passes whether or not the rule
holds — assert on the value afterwards instead.

## How the app talks to it

Every view reads `store.db` synchronously, in 59 places, and expects
`createLead` to hand back the finished record immediately. Making all of that
`await` would have put a spinner between a visitor answering a question and the
answer appearing on screen, on venue wifi. So the network went underneath that
interface rather than through it:

- **Reads** are served from an in-memory cache, filled once at sign-in and
  mirrored to `localStorage` so a reload with no connection still opens on real
  data.
- **Writes** are applied to the cache and returned synchronously, then appended
  to a durable outbox that drains in the background, in dependency order —
  company, then contact, then lead — and survives a reload or a flat battery.

The cost is that a write can fail after the interface has accepted it. That is
why the topbar reports how many operations are still waiting rather than
showing a green tick. A rejected write (row-level security, a broken reference)
is dropped and surfaced; a network failure is retried indefinitely, because the
connection really will come back.

Two things moved to the server because a device cannot do them correctly:

- **Lead codes.** Generated per device, two tablets at one booth both issue
  `TEAL-PROD26-00042`. `next_lead_code()` allocates from the highest already
  issued. The unique index is the guarantee; if a collision happens anyway the
  outbox takes a fresh number and retries rather than showing a failed save.
- **Duplicate detection**, as above.

## Changing the schema

Add a numbered file to `supabase/migrations/` — never edit one that has run.
Then:

1. `supabase/tests/run.sh` — the migrations still apply and the rules still hold.
2. `node tools/server-mode.js` — the app still talks to the shape.
3. If you added a column the browser writes, add it to `WRITABLE` in
   `js/field-map.js`. Anything not listed there is dropped before it is sent,
   which is deliberate: a stray key fails where the message is readable rather
   than as a schema-cache error three layers down.

Column names follow camelCase → snake_case exactly (`nextFollowUp` →
`next_follow_up`). The only exceptions are `exhibitions.start` and
`exhibitions.end`, which are reserved words in SQL and are `start_date` and
`end_date`; both are listed in `RENAMES`.

## Backups

Supabase takes daily backups on paid plans, with point-in-time recovery on Pro.
On the free plan you have neither, so before an exhibition either upgrade for
the month or take your own:

```sh
supabase db dump --file "teal-$(date +%F).sql"
```

Settings → Data in the app also exports the working set as JSON, which is a
convenience for a person rather than a restore path.
