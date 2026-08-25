/* ==========================================================================
   Shared UI primitives — escaping, icons, formatting, and the small set of
   components every view reuses. Kept dependency-free on purpose (§41).
   ========================================================================== */

/* Every value interpolated into markup goes through esc(). */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
export const attr = esc;

/* ---- icons ---------------------------------------------------------------
   A 20px stroked set drawn inline. No icon font, no sprite request. */
const PATHS = {
  grid:      'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  leads:     'M4 6h16M4 12h16M4 18h10',
  pipeline:  'M4 5h16l-6 7v6l-4 2v-8z',
  building:  'M5 21V4h9v17M14 9h5v12M8 8h2M8 12h2M8 16h2M17 13h1M17 17h1',
  contacts:  'M16 20v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M18 8v6M21 11h-6',
  box:       'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  calendar:  'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  clock:     'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
  chart:     'M4 20V10M10 20V4M16 20v-7M22 20H2',
  team:      'M14 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M22 20v-1a4 4 0 0 0-3-3.85M16 4.15A4 4 0 0 1 16 11.9',
  gear:      'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 2.6 15a1.7 1.7 0 0 0-1.6-1H1a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 2.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 7 4.6h.09A1.7 1.7 0 0 0 8 3V3a2 2 0 1 1 4 0v.09',
  search:    'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.35-4.35',
  bell:      'M18 9a6 6 0 1 0-12 0c0 6-3 7-3 7h18s-3-1-3-7M13.7 20a2 2 0 0 1-3.4 0',
  plus:      'M12 5v14M5 12h14',
  menu:      'M3 6h18M3 12h18M3 18h18',
  chevron:   'M9 6l6 6-6 6',
  chevronL:  'M15 6l-6 6 6 6',
  chevronD:  'M6 9l6 6 6-6',
  close:     'M18 6L6 18M6 6l12 12',
  check:     'M20 6L9 17l-5-5',
  spark:     'M12 3l2.2 5.9L20 11l-5.8 2.1L12 19l-2.2-5.9L4 11l5.8-2.1z',
  target:    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2',
  phone:     'M21 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.1 4.2 2 2 0 0 1 3.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
  mail:      'M3 5h18v14H3zM3 6l9 7 9-7',
  sun:       'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon:      'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  monitor:   'M3 4h18v12H3zM8 20h8M12 16v4',
  download:  'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  warn:      'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  flame:     'M12 22a7 7 0 0 0 7-7c0-5-4-6-4-11 0 0-3 1.5-3 6 0-1.5-1-3-2-3 0 3-3 4-3 8a7 7 0 0 0 5 7z',
  wifi:      'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M2 9a15 15 0 0 1 20 0',
  offline:   'M2 2l20 20M5 12.5a10 10 0 0 1 6-2.9M8.5 16a5 5 0 0 1 3-1.4M12 20h.01',
  refresh:   'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
};

export function icon(name, cls = 'ico') {
  const d = PATHS[name] ?? PATHS.grid;
  return `<svg class="${attr(cls)}" viewBox="0 0 24 24" width="20" height="20" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}

/* ---- formatting ---------------------------------------------------------- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function fmtShort(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
export function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${fmtShort(value)} · ${hh}:${mm}`;
}
export const today = () => new Date().toISOString().slice(0, 10);

export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

/* Relative due wording plus the tone the pill should wear. */
export function dueInfo(dueDate) {
  if (!dueDate) return { label: 'No date', tone: 'neutral', overdue: false };
  const diff = daysBetween(today(), dueDate);
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, tone: 'danger', overdue: true };
  if (diff === 0) return { label: 'Due today', tone: 'warning', overdue: false };
  if (diff === 1) return { label: 'Tomorrow', tone: 'info', overdue: false };
  return { label: `In ${diff}d`, tone: 'neutral', overdue: false };
}

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0]).join('').toUpperCase();
}

/* ---- small components ---------------------------------------------------- */
export function tempPill(band, label) {
  return `<span class="pill" data-temp="${attr(band)}">${esc(label ?? band)}</span>`;
}

export function stagePill(stage) {
  const tone = { WON: 'success', LOST: 'neutral', NEGOTIATION: 'warning',
                 PROPOSAL: 'info', NEW: 'neutral' }[stage] ?? 'info';
  return `<span class="pill" data-tone="${tone}">${esc(stage.charAt(0) + stage.slice(1).toLowerCase())}</span>`;
}

export function scoreDial(total, band, size = 44) {
  const r = (size - 7) / 2;
  const c = 2 * Math.PI * r;
  const filled = c * (Math.max(0, Math.min(100, total)) / 100);
  const mid = size / 2;
  return `<svg class="dial" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
     role="img" aria-label="Lead Intelligence Score ${total} out of 100, ${esc(band)}">
    <circle class="dial-track" cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke-width="4"/>
    <circle class="dial-fill" data-temp="${attr(band)}" cx="${mid}" cy="${mid}" r="${r}"
      fill="none" stroke-width="4" stroke-dasharray="${filled.toFixed(1)} ${c.toFixed(1)}"
      transform="rotate(-90 ${mid} ${mid})"/>
    <text class="dial-num" x="${mid}" y="${mid + 1}" text-anchor="middle"
      dominant-baseline="middle">${total}</text>
  </svg>`;
}

export function kpi({ label, value, hint, trend, href, tone }) {
  const trendHtml = trend
    ? `<span class="trend" data-dir="${attr(trend.dir)}">${
        trend.dir === 'up' ? '▲' : trend.dir === 'down' ? '▼' : '■'} ${esc(trend.text)}</span>`
    : '';
  const inner = `
    <span class="kpi-label">${esc(label)}</span>
    <span class="kpi-value"${tone ? ` style="color:${attr(tone)}"` : ''}>${esc(value)}</span>
    <span class="kpi-foot">${trendHtml}${hint ? `<span class="kpi-hint">${esc(hint)}</span>` : ''}</span>`;
  return href
    ? `<a class="kpi" href="${attr(href)}">${inner}</a>`
    : `<div class="kpi">${inner}</div>`;
}

export function card(title, body, { sub, action, cls = '' } = {}) {
  return `<section class="card ${attr(cls)}">
    <div class="card-head">
      <div><h3>${esc(title)}</h3>${sub ? `<p class="card-sub">${esc(sub)}</p>` : ''}</div>
      ${action || ''}
    </div>
    ${body}
  </section>`;
}

export function emptyState({ title, body, actionLabel, actionHref, iconName = 'spark' }) {
  return `<div class="empty">
    ${icon(iconName, 'ico')}
    <h3>${esc(title)}</h3>
    <p>${esc(body)}</p>
    ${actionLabel ? `<a class="btn" href="${attr(actionHref || '#/leads')}">${esc(actionLabel)}</a>` : ''}
  </div>`;
}

export function errorState(message, retryId = 'retry') {
  return `<div class="empty" role="alert">
    ${icon('warn', 'ico')}
    <h3>Something went wrong</h3>
    <p>${esc(message || "We couldn't load this information.")}</p>
    <div class="row gap-2">
      <button class="btn" id="${attr(retryId)}">Retry</button>
      <a class="btn btn-sec" href="#/dashboard">Go back</a>
    </div>
  </div>`;
}

export function skeleton(kind = 'page') {
  if (kind === 'kpis') {
    return `<div class="grid grid-4">${'<div class="skel skel-kpi"></div>'.repeat(4)}</div>`;
  }
  return `<div class="stack gap-4">
    <div class="skel skel-line" style="width:34%;height:22px"></div>
    <div class="grid grid-4">${'<div class="skel skel-kpi"></div>'.repeat(4)}</div>
    <div class="grid grid-2">
      <div class="skel" style="height:220px"></div>
      <div class="skel" style="height:220px"></div>
    </div>
  </div>`;
}

/* ---- toast --------------------------------------------------------------- */
let toastHost = null;
export function toast(message, tone = 'default') {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toasts';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.tone = tone;
  el.textContent = message;
  toastHost.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ---- dialog -------------------------------------------------------------- */
/* Focus is trapped while open and returned to the opener on close (§38). */
export function openDialog({ title, body, footer, onMount, labelledBy = 'dlg-title' }) {
  const opener = document.activeElement;
  const host = document.createElement('div');
  host.className = 'dlg';
  host.innerHTML = `
    <div class="dlg-scrim" data-close></div>
    <div class="dlg-panel" role="dialog" aria-modal="true" aria-labelledby="${attr(labelledBy)}">
      <h2 id="${attr(labelledBy)}">${esc(title)}</h2>
      <div class="dlg-body">${body}</div>
      ${footer ? `<div class="dlg-foot">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(host);

  const focusables = () => [...host.querySelectorAll(
    'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')];

  function close() {
    host.remove();
    document.removeEventListener('keydown', onKey, true);
    if (opener?.focus) opener.focus();
  }
  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  host.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
  document.addEventListener('keydown', onKey, true);
  focusables()[0]?.focus();
  onMount?.(host, close);
  return close;
}

/* ---- confirmation for destructive actions -------------------------------- */
export function confirmAction({ title, body, confirmLabel = 'Confirm', danger = true, onConfirm }) {
  openDialog({
    title,
    body: `<p class="t-sm dim">${esc(body)}</p>`,
    footer: `<button class="btn btn-sec" data-close>Cancel</button>
             <button class="btn ${danger ? 'btn-danger' : ''}" id="dlg-ok">${esc(confirmLabel)}</button>`,
    onMount(host, close) {
      host.querySelector('#dlg-ok').addEventListener('click', () => { onConfirm(); close(); });
    },
  });
}

/* ---- tally --------------------------------------------------------------- */
/* Count by a key, biggest first. `get` may return a value or an array. */
export function tally(rows, get) {
  const map = new Map();
  for (const row of rows) {
    const value = get(row);
    if (!value) continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v) map.set(v, (map.get(v) || 0) + 1);
    }
  }
  return [...map.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
}

export function sumBy(rows, get) {
  return rows.reduce((total, row) => total + (Number(get(row)) || 0), 0);
}
