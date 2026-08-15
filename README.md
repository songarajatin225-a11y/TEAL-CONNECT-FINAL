# TEAL LeadConnect

**Exhibition Lead Intelligence & Sales Conversion OS**
*Turn Every Exhibition Lead Into a Sales Opportunity.*

A browser application for capturing exhibition leads, scoring them against
published rules, and driving each one to a next action. No build step, no
framework, no dependencies — HTML, CSS, vanilla ES modules and JSON.

---

## Running it

The app loads its reference data from `data/*.json`, so it must be served over
HTTP. Opening `index.html` from disk will not work: browsers block `fetch` on
`file://` URLs.

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

**GitHub Pages:** push this folder to a branch, then Settings → Pages → Deploy
from a branch. Every path in the app is relative, so it works under a project
subpath such as `/Lead-2/` with no configuration.

`.nojekyll` must be present. It starts with a dot, so file managers hide it by
default — if you copy files by hand rather than cloning, reveal hidden files
first (macOS Finder `Cmd+Shift+.`, Windows Explorer → View → Show → Hidden
items).

## Signing in

Pick an account. There is no password because there is no authentication
server; roles still govern what each account can see and do.

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
  store.js            data access, persistence, roles, duplicates
  scoring.js          Lead Intelligence Score and Next Best Action
  router.js           hash router
  shell.js            sidebar, topbar, command palette, theme
  ui.js               escaping, icons, formatting, shared components
  charts.js           SVG chart primitives
  views/              one module per screen
data/                 seed collections, one file per entity
sw.js                 service worker (offline shell)
```

`store.js` is the only module that touches storage or the network. Replacing
its `loadSeed` with HTTP calls swaps in a real API without changing a single
view.

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

Weights live in `data/settings.json` and are visible in Settings → Lead
Intelligence, so the number is auditable by anyone who asks how it was reached.

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

Seed records load from `data/*.json`. Anything captured or edited afterwards is
written to that browser's local storage on that device.

There is no server in this build, so **nothing is uploaded and nothing is
shared between devices.** The status indicator says "saved on this device"
rather than "synced", and Settings → Data shows the queue of operations a
hosted backend would receive. Two phones do not combine their books; clearing
site data erases everything. Export CSV or the JSON backup before an event
ends.

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

Two suites run against a server that mounts the app under a `/Lead-2/`
subpath, so base-path regressions are caught rather than assumed:

- **Smoke** — 67 checks: boot, every route, deep links, the command palette,
  theme switching and role gating.
- **Responsive & accessibility** — 1570 checks: 13 routes × 6 widths (390 to
  1440) × 2 themes, asserting no horizontal scroll, nothing overflowing,
  24px tap targets, no sub-10.5px text, one `h1`, labelled inputs, scoped
  table headers and zero console errors — plus keyboard journeys through the
  palette, dialogs and the pipeline board.

## Limits worth knowing

- One browser, one device. There is no sync.
- No real authentication; accounts are a role switcher.
- Lead IDs are generated per device, so two devices at one booth will reuse
  numbers.
- Demo data is synthetic. Companies and contacts are invented.
