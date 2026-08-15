/* ==========================================================================
   Chart primitives.

   Hand-rolled SVG rather than a charting library: the whole set of forms this
   product needs is five, and a library would cost more bytes than the app
   (§41). Colour comes from the validated palette in tokens.css and is
   assigned by fixed slot order, never cycled (see the data-viz rules).
   ========================================================================== */

import { esc, attr } from './ui.js';

export const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)',
                       'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
const OTHER = 'var(--chart-other)';

/* Past six slots, the tail folds into a single "Other" band rather than
   inventing a seventh hue. */
export function foldSeries(rows, limit = 6) {
  if (rows.length <= limit) return rows;
  const head = rows.slice(0, limit - 1);
  const tail = rows.slice(limit - 1);
  return [...head, { k: 'Other', v: tail.reduce((n, r) => n + r.v, 0), other: true }];
}

export function seriesColor(index, row) {
  if (row?.other) return OTHER;
  return SERIES[index % SERIES.length];
}

/* ---- ranked horizontal bars ---------------------------------------------
   The default for "which categories are biggest". Values are direct-labelled
   so the chart never depends on reading a colour. */
export function hbars(rows, { max, unit = '', colored = false, limit = 10 } = {}) {
  if (!rows.length) return '<p class="t-cap">No data for this selection.</p>';
  const shown = rows.slice(0, limit);
  const top = max ?? Math.max(...shown.map((r) => r.v), 1);
  return `<div class="hbars">${shown.map((row, i) => {
    const pct = Math.max(2, Math.round((row.v / top) * 100));
    const fill = colored ? seriesColor(i, row) : 'var(--chart-1)';
    return `<div class="hbar">
      <span class="hbar-label" title="${attr(row.k)}">${esc(row.k)}</span>
      <span class="hbar-track"><span class="hbar-fill"
        style="width:${pct}%;background:${fill}"></span></span>
      <span class="hbar-val">${esc(row.v)}${esc(unit)}</span>
    </div>`;
  }).join('')}</div>`;
}

/* ---- funnel --------------------------------------------------------------
   Stages must nest — each is a subset of the one above — so "% of previous"
   is a real conversion rate rather than an artefact of two unrelated counts. */
export function funnel(stages) {
  const top = stages[0]?.v ?? 0;
  if (!top) return '<p class="t-cap">No leads in this selection yet.</p>';
  return `<div class="funnel">${stages.map((stage, i) => {
    const share = Math.round((stage.v / top) * 100);
    const prev = i ? stages[i - 1].v : null;
    const conv = prev ? Math.round((stage.v / prev) * 100) : null;
    return `<div class="fstep">
      <span class="fstep-label">${esc(stage.k)}</span>
      <span class="fstep-track">
        <span class="fstep-fill" style="width:${Math.max(3, share)}%"></span>
        <b class="fstep-num">${esc(stage.v)}</b>
      </span>
      <span class="fstep-conv"><b>${share}%</b>${
        conv === null ? '<span>of total</span>' : `<span>${conv}% of prev</span>`}</span>
    </div>`;
  }).join('')}</div>`;
}

/* ---- time series ---------------------------------------------------------
   A single-series column chart. One series needs no legend — the card title
   names it. Every column carries a hover tooltip via <title>. */
export function columns(rows, { height = 150, unit = '' } = {}) {
  if (!rows.length) return '<p class="t-cap">No data for this period.</p>';
  const max = Math.max(...rows.map((r) => r.v), 1);
  const w = 100 / rows.length;
  const barW = Math.min(w * 0.62, 9);
  const plot = height - 26;

  return `<div class="chart"><svg viewBox="0 0 100 ${height}" preserveAspectRatio="none"
      role="img" aria-label="${attr(rows.map((r) => `${r.k}: ${r.v}${unit}`).join(', '))}">
    ${[0.25, 0.5, 0.75, 1].map((f) => `<line class="grid-line" x1="0" x2="100"
        y1="${(plot * f).toFixed(1)}" y2="${(plot * f).toFixed(1)}"
        vector-effect="non-scaling-stroke"/>`).join('')}
    ${rows.map((row, i) => {
      const h = Math.max(2, (row.v / max) * (plot - 6));
      const x = i * w + (w - barW) / 2;
      return `<g class="bar"><title>${esc(row.k)}: ${esc(row.v)}${esc(unit)}</title>
        <rect x="${x.toFixed(2)}" y="${(plot - h).toFixed(2)}" width="${barW.toFixed(2)}"
          height="${h.toFixed(2)}" rx="1.6" fill="var(--chart-1)"/></g>`;
    }).join('')}
    <line class="axis-line" x1="0" x2="100" y1="${plot}" y2="${plot}" vector-effect="non-scaling-stroke"/>
  </svg>
  <div class="row" style="justify-content:space-between;margin-top:6px">
    <span class="t-cap">${esc(rows[0].k)}</span>
    <span class="t-cap">${esc(rows[rows.length - 1].k)}</span>
  </div></div>`;
}

/* ---- donut ---------------------------------------------------------------
   Only for a part-to-whole split with few slices. A 2px surface-coloured gap
   separates adjacent arcs so they never bleed together. */
export function donut(rows, { size = 132, thickness = 18 } = {}) {
  const total = rows.reduce((n, r) => n + r.v, 0);
  if (!total) return '<p class="t-cap">No data for this selection.</p>';

  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const mid = size / 2;
  let offset = 0;

  const arcs = rows.map((row, i) => {
    const len = (row.v / total) * c;
    const seg = `<circle r="${r}" cx="${mid}" cy="${mid}" fill="none"
      stroke="${seriesColor(i, row)}" stroke-width="${thickness}"
      stroke-dasharray="${Math.max(0, len - 2).toFixed(2)} ${(c - len + 2).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 ${mid} ${mid})"><title>${esc(row.k)}: ${esc(row.v)}</title></circle>`;
    offset += len;
    return seg;
  }).join('');

  return `<div class="row gap-4" style="flex-wrap:wrap">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img"
      aria-label="${attr(rows.map((row) => `${row.k}: ${row.v}`).join(', '))}">
      ${arcs}
      <text x="${mid}" y="${mid - 2}" text-anchor="middle" dominant-baseline="middle"
        style="font-size:20px;font-weight:700;fill:var(--text-primary)">${total}</text>
      <text x="${mid}" y="${mid + 15}" text-anchor="middle"
        style="font-size:11px;fill:var(--text-muted)">total</text>
    </svg>
    <ul class="stack gap-2 grow">${rows.map((row, i) => `
      <li class="row gap-2 t-cap">
        <span class="legend-swatch" style="background:${seriesColor(i, row)}"></span>
        <span class="grow truncate">${esc(row.k)}</span>
        <b class="t-num" style="color:var(--text-primary)">${esc(row.v)}</b>
        <span style="min-width:38px;text-align:right">${Math.round((row.v / total) * 100)}%</span>
      </li>`).join('')}</ul>
  </div>`;
}

/* ---- legend --------------------------------------------------------------
   Present whenever two or more series share a plot, so identity is never
   carried by colour alone. */
export function legend(rows) {
  if (rows.length < 2) return '';
  return `<div class="legend">${rows.map((row, i) => `
    <span class="legend-item">
      <span class="legend-swatch" style="background:${seriesColor(i, row)}"></span>${esc(row.k)}
    </span>`).join('')}</div>`;
}

/* ---- grouped comparison --------------------------------------------------
   Used by exhibition comparison: several entities, the same measure. */
export function groupedBars(entities, measure, { unit = '' } = {}) {
  const max = Math.max(...entities.map((e) => e[measure] ?? 0), 1);
  return `<div class="hbars">${entities.map((entity, i) => {
    const value = entity[measure] ?? 0;
    const pct = Math.max(2, Math.round((value / max) * 100));
    return `<div class="hbar">
      <span class="hbar-label" title="${attr(entity.name)}">${esc(entity.name)}</span>
      <span class="hbar-track"><span class="hbar-fill"
        style="width:${pct}%;background:${seriesColor(i)}"></span></span>
      <span class="hbar-val">${esc(value)}${esc(unit)}</span>
    </div>`;
  }).join('')}</div>`;
}

/* ---- table fallback ------------------------------------------------------
   Any chart whose palette carries a contrast warning ships this alongside, so
   the numbers are always reachable without reading colour. */
export function dataTable(rows, { keyLabel = 'Item', valueLabel = 'Value' } = {}) {
  return `<details class="mt-3">
    <summary class="t-cap" style="cursor:pointer">View as table</summary>
    <div class="tablewrap mt-2">
      <table class="data" style="min-width:0">
        <thead><tr><th scope="col">${esc(keyLabel)}</th>
          <th scope="col" class="num">${esc(valueLabel)}</th></tr></thead>
        <tbody>${rows.map((row) => `<tr><td>${esc(row.k)}</td>
          <td class="num">${esc(row.v)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </details>`;
}
