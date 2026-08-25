# Tooling

Not needed to run or deploy the app — these regenerate the demo data, vendor
the one dependency, and verify the build.

| File | Purpose |
| --- | --- |
| `gendata.py` | Regenerates `data/*.json`. Fixed seed, so output is stable. |
| `vendor-supabase.sh` | Re-bundles `@supabase/supabase-js` into `vendor/`. Needs npm. |
| `smoke.js` | 67 checks: boot, routes, deep links, palette, theme, roles. |
| `a11y.js` | 1570 checks: 13 routes × 6 widths × 2 themes, plus keyboard journeys. |
| `server-mode.js` | 30 checks: the app against a stub Supabase — auth, hydration, the outbox. |

```sh
python3 tools/gendata.py
npm install --no-save playwright   # test-only, not committed

node tools/smoke.js
node tools/a11y.js
node tools/server-mode.js
supabase/tests/run.sh              # 55 checks — needs a local PostgreSQL 15+
```

All four exit non-zero on failure and none of them needs network access or a
Supabase project, so they can run in CI as they are.

`smoke.js` and `a11y.js` serve the app under a `/Lead-2/` subpath so a
base-path regression fails the run rather than reaching production. They
exercise **demo mode** — the path that does not touch a backend.

`server-mode.js` covers the path that does. It stands up a stub speaking just
enough PostgREST and GoTrue for the real vendored client to talk to, then
drives the real app on top of it: that `config.json` selects server mode, that
sign-in rejects a bad password and accepts a good one, that every collection
hydrates through the camelCase mapping, that an optimistic write returns
synchronously and drains in dependency order, that a capture made offline
survives a reload and syncs on reconnect, and that signing out clears the
device.

It deliberately does not check whether the security rules are correct — a stub
would only tell you what you told it. That is `supabase/tests/run.sh`, which
runs the real policies against a real PostgreSQL.
