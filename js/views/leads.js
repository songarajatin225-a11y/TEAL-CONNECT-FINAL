/* ==========================================================================
   Leads — enterprise table (§17) with card view, filters, sorting, bulk
   actions and export.
   ========================================================================== */

import * as store from '../store.js';
import { score, nextBestAction, money } from '../scoring.js';
import { esc, attr, icon, tempPill, stagePill, scoreDial, fmtShort, dueInfo,
         emptyState, toast, confirmAction, initials } from '../ui.js';
import { go } from '../router.js';

const COLUMNS = [
  { key: 'contactName', label: 'Lead', always: true },
  { key: 'companyName', label: 'Company', always: true },
  { key: 'industry', label: 'Industry' },
  { key: 'products', label: 'Product' },
  { key: 'application', label: 'Application' },
  { key: 'score', label: 'Score', num: true, always: true },
  { key: 'band', label: 'Temperature' },
  { key: 'stage', label: 'Stage', always: true },
  { key: 'owner', label: 'Owner' },
  { key: 'lastContact', label: 'Last Contact' },
  { key: 'nextFollowUp', label: 'Next Follow-up' },
  { key: 'value', label: 'Potential Value', num: true },
];

const state = {
  q: '', stage: '', band: '', industry: '', product: '', owner: '', gap: '',
  sort: 'score', dir: 'desc', page: 1, perPage: 25,
  hidden: new Set(['application', 'lastContact']),
  selected: new Set(),
};

function enrich(leads) {
  const acts = store.db.activities;
  return leads.map((lead) => {
    const s = score(lead);
    const mine = acts.filter((a) => a.leadId === lead.id);
    const last = mine.length ? mine[mine.length - 1].at : lead.capturedAt;
    return { ...lead, score: s.total, band: s.band, bandLabel: s.label,
             scoreDetail: s, lastContact: last };
  });
}

function applyFilters(rows) {
  const q = state.q.trim().toLowerCase();
  return rows.filter((l) => {
    if (state.stage && l.stage !== state.stage) return false;
    if (state.band && l.band !== state.band
        && !(state.band === 'HOT' && l.band === 'STRATEGIC')) return false;
    if (state.industry && l.industry !== state.industry) return false;
    if (state.product && !l.products.includes(state.product)) return false;
    if (state.owner && l.ownerId !== state.owner) return false;
    if (state.gap && l.scoreDetail.rows.some((r) => r.key === state.gap && r.hit)) return false;
    if (!q) return true;
    return [l.contactName, l.companyName, l.email, l.phone, l.code, l.application,
            ...(l.products || [])].join(' ').toLowerCase().includes(q);
  });
}

function sortRows(rows) {
  const dir = state.dir === 'asc' ? 1 : -1;
  const key = state.sort;
  return [...rows].sort((a, b) => {
    let x = a[key], y = b[key];
    if (key === 'owner') { x = a.owner?.name ?? ''; y = b.owner?.name ?? ''; }
    if (key === 'products') { x = (a.products || [])[0] ?? ''; y = (b.products || [])[0] ?? ''; }
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x ?? '').localeCompare(String(y ?? '')) * dir;
  });
}

/* ---- CSV export ----------------------------------------------------------
   Quoted per RFC 4180 and prefixed with a BOM so Excel reads the ₹ and the
   CO₂ subscript correctly. */
export function exportLeads(leads) {
  const rows = enrich(leads);
  const head = ['Lead ID', 'Contact', 'Company', 'Industry', 'Designation', 'Email', 'Phone',
                'Products', 'Application', 'Score', 'Temperature', 'Stage', 'Owner',
                'Potential Value', 'Timeline', 'Budget', 'Next Follow-up', 'Exhibition',
                'Source', 'Captured'];
  const q = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.map(q).join(',')];
  for (const l of rows) {
    lines.push([l.code, l.contactName, l.companyName, l.industry, l.designation, l.email,
                l.phone, (l.products || []).join('; '), l.application, l.score, l.bandLabel,
                l.stage, l.owner?.name ?? '', l.value, l.timeline, l.budget,
                l.nextFollowUp, l.exhibition?.name ?? '', l.source,
                l.capturedAt.slice(0, 16).replace('T', ' ')].map(q).join(','));
  }
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TEAL-LeadConnect-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  store.logAudit('leads_exported', 'lead', '', `${rows.length} rows`);
  store.save();
  toast(`Exported ${rows.length} leads`);
}

function filterBar(all) {
  const industries = [...new Set(all.map((l) => l.industry).filter(Boolean))].sort();
  const products = [...new Set(all.flatMap((l) => l.products || []))].sort();
  const owners = store.db.users.filter((u) => all.some((l) => l.ownerId === u.id));
  const sel = (v, cur) => (v === cur ? ' selected' : '');

  return `<div class="filterbar">
    <label class="field grow" style="flex:2 1 260px">
      <span>Search</span>
      <input class="input" type="search" id="f-q" value="${attr(state.q)}"
        placeholder="Name, company, email, phone or lead ID">
    </label>
    <label class="field"><span>Stage</span>
      <select class="select" id="f-stage"><option value="">All stages</option>
        ${store.db.settings.reference.stages.map((s) =>
          `<option value="${attr(s)}"${sel(s, state.stage)}>${esc(s)}</option>`).join('')}
      </select></label>
    <label class="field"><span>Temperature</span>
      <select class="select" id="f-band"><option value="">All</option>
        ${['STRATEGIC', 'HOT', 'WARM', 'COLD'].map((b) =>
          `<option value="${attr(b)}"${sel(b, state.band)}>${esc(b.charAt(0) + b.slice(1).toLowerCase())}</option>`).join('')}
      </select></label>
    <label class="field"><span>Industry</span>
      <select class="select" id="f-industry"><option value="">All industries</option>
        ${industries.map((i) => `<option value="${attr(i)}"${sel(i, state.industry)}>${esc(i)}</option>`).join('')}
      </select></label>
    <label class="field"><span>Product</span>
      <select class="select" id="f-product"><option value="">All products</option>
        ${products.map((p) => `<option value="${attr(p)}"${sel(p, state.product)}>${esc(p)}</option>`).join('')}
      </select></label>
    ${owners.length > 1 ? `<label class="field"><span>Owner</span>
      <select class="select" id="f-owner"><option value="">All owners</option>
        ${owners.map((u) => `<option value="${attr(u.id)}"${sel(u.id, state.owner)}>${esc(u.name)}</option>`).join('')}
      </select></label>` : ''}
    <button class="btn btn-sec btn-sm" id="f-clear">Clear</button>
  </div>`;
}

function tableView(rows) {
  const cols = COLUMNS.filter((c) => !state.hidden.has(c.key));
  const start = (state.page - 1) * state.perPage;
  const page = rows.slice(start, start + state.perPage);

  const cell = (l, key) => {
    switch (key) {
      case 'contactName': return `<a href="#/leads/${attr(l.id)}"><b>${esc(l.contactName)}</b></a>
        <span class="code" style="display:block">${esc(l.code)}</span>`;
      case 'companyName': return `<a href="#/companies/${attr(l.companyId)}">${esc(l.companyName)}</a>`;
      case 'products': return esc((l.products || []).join(', ')) || '—';
      case 'score': return `<span class="t-num">${l.score}</span>`;
      case 'band': return tempPill(l.band, l.bandLabel);
      case 'stage': return stagePill(l.stage);
      case 'owner': return esc(l.owner?.name ?? 'Unassigned');
      case 'lastContact': return esc(fmtShort(l.lastContact));
      case 'nextFollowUp': {
        if (!l.nextFollowUp) return '—';
        const info = dueInfo(l.nextFollowUp);
        return `<span class="pill" data-tone="${attr(info.tone)}">${esc(info.label)}</span>`;
      }
      case 'value': return `<span class="t-num">${esc(money(l.value))}</span>`;
      default: return esc(l[key] ?? '—') || '—';
    }
  };

  return `<div class="tablewrap">
    <table class="data">
      <caption>${rows.length} leads. Use the column headers to sort.</caption>
      <thead><tr>
        <th scope="col" style="width:34px">
          <input type="checkbox" id="sel-all" aria-label="Select all leads on this page"></th>
        ${cols.map((c) => {
          const sorted = state.sort === c.key;
          return `<th scope="col"${sorted ? ` aria-sort="${state.dir === 'asc' ? 'ascending' : 'descending'}"` : ''}
            ${c.num ? 'class="num"' : ''}>
            <button data-sort="${attr(c.key)}">${esc(c.label)}${sorted ? (state.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button>
          </th>`;
        }).join('')}
      </tr></thead>
      <tbody>${page.map((l) => `<tr data-selected="${state.selected.has(l.id)}">
        <td><input type="checkbox" class="row-sel" data-id="${attr(l.id)}"
          ${state.selected.has(l.id) ? 'checked' : ''}
          aria-label="Select ${attr(l.contactName)}"></td>
        ${cols.map((c) => `<td${c.num ? ' class="num"' : ''}>${cell(l, c.key)}</td>`).join('')}
      </tr>`).join('')}</tbody>
    </table>
  </div>
  ${pager(rows.length)}`;
}

function cardView(rows) {
  const start = (state.page - 1) * state.perPage;
  const page = rows.slice(start, start + state.perPage);
  return `<div class="grid grid-3">${page.map((l) => {
    const nba = nextBestAction(l, l.scoreDetail);
    const info = l.nextFollowUp ? dueInfo(l.nextFollowUp) : null;
    return `<a class="card" href="#/leads/${attr(l.id)}" style="text-decoration:none;color:inherit">
      <div class="row gap-3">
        ${scoreDial(l.score, l.band, 46)}
        <span class="grow" style="min-width:0">
          <b class="truncate" style="display:block">${esc(l.contactName)}</b>
          <span class="truncate t-cap" style="display:block">${esc(l.designation)}</span>
        </span>
        ${tempPill(l.band, l.bandLabel)}
      </div>
      <p class="truncate mt-3" style="font-weight:600;font-size:var(--fs-sm)">${esc(l.companyName)}</p>
      <p class="t-cap truncate">${esc(l.industry)} · ${esc((l.products || [])[0] ?? 'No product named')}</p>
      <div class="row gap-2 mt-3" style="justify-content:space-between">
        ${stagePill(l.stage)}
        <span class="t-num t-cap">${esc(money(l.value))}</span>
      </div>
      <div class="row gap-2 mt-3" style="border-top:1px solid var(--border-subtle);padding-top:var(--sp-2)">
        ${icon('target')}<span class="truncate t-cap grow">${esc(nba.title)}</span>
        ${info ? `<span class="pill" data-tone="${attr(info.tone)}">${esc(info.label)}</span>` : ''}
      </div>
    </a>`;
  }).join('')}</div>
  ${pager(rows.length)}`;
}

function pager(total) {
  const pages = Math.max(1, Math.ceil(total / state.perPage));
  if (pages === 1) return '';
  return `<nav class="row gap-2 mt-4" aria-label="Pagination" style="justify-content:center">
    <button class="btn btn-sec btn-sm" id="pg-prev" ${state.page === 1 ? 'disabled' : ''}>Previous</button>
    <span class="t-cap">Page ${state.page} of ${pages}</span>
    <button class="btn btn-sec btn-sm" id="pg-next" ${state.page >= pages ? 'disabled' : ''}>Next</button>
  </nav>`;
}

function bulkBar(rows) {
  const n = state.selected.size;
  if (!n) return '';
  const owners = store.db.users.filter((u) => u.role === 'sales' || u.role === 'admin');
  return `<div class="card row gap-3" style="margin-bottom:var(--sp-3);flex-wrap:wrap">
    <b>${n} selected</b>
    ${store.canWrite() ? `
      <label class="row gap-2 t-cap">Assign to
        <select class="select" id="bulk-owner" style="width:auto;min-height:32px">
          <option value="">Choose…</option>
          ${owners.map((u) => `<option value="${attr(u.id)}">${esc(u.name)}</option>`).join('')}
        </select></label>
      <label class="row gap-2 t-cap">Set stage
        <select class="select" id="bulk-stage" style="width:auto;min-height:32px">
          <option value="">Choose…</option>
          ${store.db.settings.reference.stages.map((s) => `<option value="${attr(s)}">${esc(s)}</option>`).join('')}
        </select></label>` : ''}
    <button class="btn btn-sec btn-sm" id="bulk-export">Export selected</button>
    <button class="btn btn-ghost btn-sm" id="bulk-clear">Clear selection</button>
  </div>`;
}

export function view({ params }) {
  // Deep links from the dashboard land here pre-filtered.
  if (params.band) state.band = params.band;
  if (params.stage) state.stage = params.stage;
  if (params.gap) state.gap = params.gap;
  if (params.q) state.q = params.q;

  const all = enrich(store.visibleLeads());
  const filtered = sortRows(applyFilters(all));
  const mode = store.prefs().leadView;
  const pages = Math.max(1, Math.ceil(filtered.length / state.perPage));
  if (state.page > pages) state.page = pages;

  return `
    <div class="page-head">
      <div>
        <h1>Leads</h1>
        <p>${filtered.length} of ${all.length} leads${
          state.q || state.stage || state.band || state.industry || state.product || state.owner || state.gap
            ? ' matching your filters' : ''}.</p>
      </div>
      <div class="page-actions">
        <div class="row gap-1" role="group" aria-label="View mode">
          <button class="btn btn-sec btn-sm" id="view-table"
            aria-pressed="${mode === 'table'}">Table</button>
          <button class="btn btn-sec btn-sm" id="view-cards"
            aria-pressed="${mode === 'cards'}">Cards</button>
        </div>
        <button class="btn btn-sec btn-sm" id="export">${icon('download')} Export CSV</button>
        ${store.canWrite() ? `<a class="btn btn-sm" href="#/capture">${icon('plus')} Capture Lead</a>` : ''}
      </div>
    </div>

    ${filterBar(all)}
    ${bulkBar(filtered)}
    ${filtered.length
      ? (mode === 'cards' ? cardView(filtered) : tableView(filtered))
      : emptyState({
          title: 'No leads match these filters',
          body: 'Widen the search or clear a filter to see more of the book.',
          actionLabel: 'Clear filters', actionHref: '#/leads',
        })}`;
}

export function mount({ outlet }) {
  const rerender = () => import('../router.js').then((r) => r.render());

  const bind = (id, event, fn) => outlet.querySelector(id)?.addEventListener(event, fn);

  // Search is debounced so a 60-lead filter does not run on every keystroke.
  let timer;
  const q = outlet.querySelector('#f-q');
  if (q) {
    q.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.q = q.value; state.page = 1;
        rerender().then(() => {
          const next = document.querySelector('#f-q');
          if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
        });
      }, 220);
    });
  }

  for (const [id, key] of [['#f-stage', 'stage'], ['#f-band', 'band'], ['#f-industry', 'industry'],
                           ['#f-product', 'product'], ['#f-owner', 'owner']]) {
    bind(id, 'change', (e) => { state[key] = e.target.value; state.page = 1; rerender(); });
  }
  bind('#f-clear', 'click', () => {
    Object.assign(state, { q: '', stage: '', band: '', industry: '', product: '', owner: '', gap: '', page: 1 });
    go('/leads');
    rerender();
  });

  bind('#view-table', 'click', () => { store.setPref('leadView', 'table'); rerender(); });
  bind('#view-cards', 'click', () => { store.setPref('leadView', 'cards'); rerender(); });
  bind('#export', 'click', () => exportLeads(store.visibleLeads()));

  outlet.querySelectorAll('[data-sort]').forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.sort;
    if (state.sort === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    else { state.sort = key; state.dir = key === 'score' || key === 'value' ? 'desc' : 'asc'; }
    rerender();
  }));

  bind('#pg-prev', 'click', () => { state.page = Math.max(1, state.page - 1); rerender(); });
  bind('#pg-next', 'click', () => { state.page += 1; rerender(); });

  bind('#sel-all', 'change', (e) => {
    outlet.querySelectorAll('.row-sel').forEach((cb) => {
      if (e.target.checked) state.selected.add(cb.dataset.id);
      else state.selected.delete(cb.dataset.id);
    });
    rerender();
  });
  outlet.querySelectorAll('.row-sel').forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) state.selected.add(cb.dataset.id);
    else state.selected.delete(cb.dataset.id);
    rerender();
  }));

  bind('#bulk-clear', 'click', () => { state.selected.clear(); rerender(); });
  bind('#bulk-export', 'click', () => {
    exportLeads(store.visibleLeads().filter((l) => state.selected.has(l.id)));
  });

  // Bulk edits touch many records at once, so they confirm first (§ data safety).
  bind('#bulk-owner', 'change', (e) => {
    const ownerId = e.target.value;
    if (!ownerId) return;
    const name = store.getUser(ownerId)?.name;
    const ids = [...state.selected];
    confirmAction({
      title: `Reassign ${ids.length} leads?`,
      body: `They will move to ${name}. Each change is written to the activity timeline and the audit log.`,
      confirmLabel: 'Reassign', danger: false,
      onConfirm() {
        ids.forEach((id) => {
          store.updateLead(id, { ownerId }, `reassigned to ${name}`);
          store.logActivity(id, 'owner_change', 'Owner changed', `Reassigned to ${name}`);
        });
        state.selected.clear();
        toast(`${ids.length} leads reassigned`);
        rerender();
      },
    });
    e.target.value = '';
  });

  bind('#bulk-stage', 'change', (e) => {
    const stage = e.target.value;
    if (!stage) return;
    const ids = [...state.selected];
    confirmAction({
      title: `Move ${ids.length} leads to ${stage}?`,
      body: 'Stage changes are recorded on each lead’s timeline.',
      confirmLabel: 'Move', danger: false,
      onConfirm() {
        ids.forEach((id) => store.setStage(id, stage));
        state.selected.clear();
        toast(`${ids.length} leads moved to ${stage}`);
        rerender();
      },
    });
    e.target.value = '';
  });
}
