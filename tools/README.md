# Tooling

Not needed to run or deploy the app — these regenerate the demo data and verify
the build.

| File | Purpose |
| --- | --- |
| `gendata.py` | Regenerates `data/*.json`. Fixed seed, so output is stable. |
| `smoke.js` | 67 checks: boot, routes, deep links, palette, theme, roles. |
| `a11y.js` | 1570 checks: 13 routes × 6 widths × 2 themes, plus keyboard journeys. |

```sh
python3 tools/gendata.py
npm install --no-save playwright   # test-only, not committed
node tools/smoke.js
node tools/a11y.js
```

Both suites serve the app under a `/Lead-2/` subpath so a base-path regression
fails the run rather than reaching production.
