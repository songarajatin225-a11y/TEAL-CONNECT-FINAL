# TEAL LeadConnect

**Exhibition Lead Intelligence & Sales Conversion OS**
*Turn Every Exhibition Lead Into a Sales Opportunity.*

A browser application for capturing exhibition leads, scoring them against
published rules, and driving each one to a next action. No build step and no
framework — HTML, CSS and vanilla ES modules, with a PostgreSQL database behind
it.

It runs in one of two modes, decided at boot by `config.json`:

| | **Server** | **Demo** |
| --- | --- | --- |
| Data | PostgreSQL, via Supabase | `data/*.json` |
| Sign-in | Email and password | Pick an account |
| Sharing | Every device, every user | One browser, one device |
| Needs | A Supabase project | Nothing |

Demo mode is what a fresh checkout does, with no setup. Server mode is the real
deployment — see **[BACKEND.md](BACKEND.md)** to set up the database and
**[DEPLOY.md](DEPLOY.md)** to put it on a server.

There is also a **[single-file build](SINGLE-FILE.md)**: the entire application
as one `.html` file you copy onto any web server, or open straight from disk.
Same screens, same code, and it runs in either mode — edit the config block at
the top of the file to point it at Supabase. Use it when you do not control the
server: shared hosting, an intranet, a laptop at a stand.

---

## Running it

The app loads files over HTTP, so it must be served. Opening `index.html` from
disk will not work: browsers block `fetch` on `file://` URLs.

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

That gives you demo mode. To run against a Supabase project locally, fill in
`config.json` — `config.example.json` documents the fields.

**GitHub Pages:** push this folder to a branch, then Settings → Pages → Deploy
from a branch. Every path in the app is relative, so it works under a project
subpath such as `/Lead-2/` with no configuration. Leave `config.json` empty and
it serves the demo.

`.nojekyll` must be present. It starts with a dot, so file managers hide it by
default — if you copy files by hand rather than cloning, reveal hidden files
first (macOS Finder `Cmd+Shift+.`, Windows Explorer → View → Show → Hidden
items).

## Signing in

In **server mode**, with an email and password. Accounts are created by
`supabase/seed.mjs`, which prints a generated password for each one; roles are
enforced by the database, not by the interface.

In **demo mode**, by picking an account. There is no password because there is
no authentication server. Roles still govern what each account can see, but
only in the interface.

| Account | Role | Sees |
| --- | --- | --- |
| Jatin Songara | Administrator | Everything, including Settings and the audit log |
| Priya Raman | Sales | Only the leads they own |
| Arun Menon | Sales | Only the leads they own |
| Sneha Kulkarni | Sales | Only the leads they own |
| Kavita Deshpande | Management | Everything, read-only |

## Layout

```
index.html            shell, meta, theme bootstrap
assets/               logo lockup, wordmark, app marks
css/
  tokens.css          design tokens; light and dark are both authored
  base.css            reset, type scale, accessibility primitives
  shell.css           sidebar, topbar, main region, mobile tab bar
  components.css      cards, KPIs, tables, charts, dialogs, states
js/
  config.js           reads config.json, picks server or demo mode
  api.js              Supabase: auth, reads, writes, name mapping
  field-map.js        camelCase <-> snake_case, shared with the seed script
  store.js            data access, cache, outbox, roles, duplicates
  scoring.js          Lead Intelligence Score and Next Best Action
  router.js           hash router
  shell.js            sidebar, topbar, command palette, theme
  ui.js               escaping, icons, formatting, shared components
  charts.js           SVG chart primitives
  views/              one module per screen
data/                 seed collections, one file per entity
vendor/               supabase-js, bundled and committed
supabase/             migrations, security policies, seed script, tests
deploy/               nginx config and the container entrypoint
sw.js                 service worker (offline shell)
```

`store.js` is still the only module the views touch, and its interface did not
change when the backend arrived — `api.js` went underneath it. Reads are served
from an in-memory cache; writes are applied immediately and drained to the
database by a durable outbox, which is what keeps capture working on venue
wifi.

## Lead Intelligence Score

Deterministic and published. **This is rule-based logic, not a machine-learning
model, and the product never claims otherwise.** Every lead is scored out of
100 on seven factors, and the Lead 360 shows the full breakdown with the input
that earned each point.

| Factor | Max | Measures |
| --- | --- | --- |
| Company Fit | 20 | Industry, size and account type against TEAL's served segments |
| Application Fit | 20 | Whether the stated application maps to a proven TEAL process |
| Product Interest | 15 | Capabilities the visitor actually named |
| Purchase Timeline | 15 | How soon the requirement lands |
| Budget | 10 | Whether a budget band was stated |
| Decision Authority | 10 | Seniority against the buying decision |
| Engagement | 10 | Meeting, demo, technical and commercial depth reached |

Bands: **Cold** 0–39 · **Warm** 40–69 · **Hot** 70–84 · **Strategic** 85–100.

Weights live in `app_settings` in the database (`data/settings.json` in demo
mode) and are visible in Settings → Lead Intelligence, so the number is
auditable by anyone who asks how it was reached.

## What each screen does

- **Command Center** — KPIs, a nesting funnel, and an insight panel that states
  what the numbers mean and what to do about it.
- **Leads** — table and card views, nine filters, sorting, bulk assign and
  bulk stage change, CSV export.
- **Lead 360** — contact, company, requirement and engagement, the score
  explained, the recommended next action, and a full activity timeline.
- **Pipeline** — eight stages, drag-and-drop, plus arrow-key moves so the board
  is usable without a mouse.
- **Follow-up Center** — overdue, today, upcoming and high-value, with
  one-tap complete and reschedule.
- **Companies / Account 360** — every lead, contact, product and activity
  rolled up per account.
- **Product Intelligence** — demand, demos, opportunities and pipeline by
  product.
- **Exhibition Intelligence** — per-event performance, cost per lead, and a
  side-by-side comparison across events.
- **Analytics** — the same measures filtered by period, exhibition, product,
  salesperson and temperature.
- **Team** — assigned, contacted, qualified, converted and response time.
- **Presentation Mode** — a chrome-free board-level summary.

## Data and storage

In **server mode**, records live in PostgreSQL. The browser keeps a working
copy so the app stays responsive — and keeps accepting leads — when the
connection at a venue does not. Anything captured offline is queued on the
device and sent when the connection returns; the topbar reports how many
operations are still waiting rather than showing a green tick that means
nothing.

Who can see what is enforced by the database, not by the interface. A sales
user's request comes back holding only their own book: the rest never leaves
the server. See [BACKEND.md](BACKEND.md).

In **demo mode**, seed records load from `data/*.json` and edits go to that
browser's local storage. Nothing is uploaded and nothing is shared between
devices; two phones do not combine their books, and clearing site data erases
everything.

## Accessibility

Targets WCAG 2.2 AA. Semantic landmarks, a skip link, visible focus, keyboard
paths for every mouse interaction (including the pipeline board), labelled
inputs, scoped table headers, dialogs with focus trapping and Escape, live
regions for toasts, and `prefers-reduced-motion` honoured.

Status is never carried by colour alone: temperature pills ship a dot and a
word, the active nav item has a bar as well as a tint, trends carry an arrow,
and every chart whose palette falls below 3:1 against the surface also offers a
table view.

The chart palette is validated for both themes — lightness band, chroma floor,
colour-vision-deficiency separation, normal-vision separation and contrast.

## Verification

Four suites, all of which run offline and exit non-zero on failure.

```sh
node tools/smoke.js          # 67 checks
node tools/a11y.js           # 1570 checks
node tools/server-mode.js    # 30 checks
supabase/tests/run.sh        # 55 checks — needs a local PostgreSQL 15+
```

The first two mount the app under a `/Lead-2/` subpath, so base-path
regressions are caught rather than assumed.

- **Smoke** — boot, every route, deep links, the command palette, theme
  switching and role gating.
- **Responsive & accessibility** — 13 routes × 6 widths (390 to 1440) × 2
  themes, asserting no horizontal scroll, nothing overflowing, 24px tap
  targets, no sub-10.5px text, one `h1`, labelled inputs, scoped table headers
  and zero console errors — plus keyboard journeys through the palette,
  dialogs and the pipeline board.
- **Server mode** — the real client against a stub speaking PostgREST and
  GoTrue: sign-in, credential rejection, every collection hydrating through the
  name mapping, an optimistic write draining in dependency order, an offline
  capture surviving a reload, and sign-out clearing the device.
- **Row-level security** — the policies against a real PostgreSQL: that a sales
  user cannot read, claim, reassign or delete a colleague's lead or promote
  themselves, that management can read everything and write nothing, and that
  the audit log cannot be rewritten by anyone.

## Limits worth knowing

- Demo data is synthetic. Companies and contacts are invented.
- The Lead Intelligence Score is rule-based logic, not a model. It is published
  in full and it never claims otherwise.
- There is no CI, no staging environment and no uptime alerting configured —
  the suites above are ready to wire in when you want them. See the end of
  [DEPLOY.md](DEPLOY.md).
- On Supabase's free plan there are no database backups. Take one before an
  exhibition; [BACKEND.md](BACKEND.md) says how.

In **demo mode** only:

- One browser, one device. There is no sync.
- No real authentication; accounts are a role switcher.
- Lead numbers are generated per device, so two devices at one booth will reuse
  them. In server mode the database allocates them.
