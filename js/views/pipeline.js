/* ==========================================================================
   Sales Pipeline (§16) — a board with drag-and-drop, plus a keyboard path
   for the same move so the feature is not mouse-only (§38).
   ========================================================================== */

import * as store from '../store.js';
import { score, money } from '../scoring.js';
import { esc, attr, icon, tempPill, scoreDial, dueInfo, sumBy, toast,
         confirmAction, emptyState } from '../ui.js';

const STAGES = ['NEW', 'QUALIFIED', 'ENGAGED', 'DEMO', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];
const state = { q: '', owner: '', band: '' };

function enrich(leads) {
  return leads.map((l) => {
    const s = score(l);
    return { ...l, score: s.total, band: s.band, bandLabel: s.label };
  });
}

function ageDays(lead) {
  return Math.max(0, Math.round((Date.now() - new Date(lead.capturedAt)) / 86400000));
}

function dealCard(lead) {
  const info = lead.nextFollowUp ? dueInfo(lead.nextFollowUp) : null;
  return `<article class="dealcard" draggable="true" data-id="${attr(lead.id)}"
      tabindex="0" role="button"
      aria-label="${attr(`${lead.contactName}, ${lead.companyName}, ${lead.stage}. Press Enter to open, or use the move menu.`)}">
    <div class="row gap-2">
      <span class="grow" style="min-width:0">
        <b class="truncate">${esc(lead.contactName)}</b>
        <span class="co truncate">${esc(lead.companyName)}</span>
      </span>
      ${scoreDial(lead.score, lead.band, 34)}
    </div>
    <div class="row gap-2" style="flex-wrap:wrap">
      ${tempPill(lead.band, lead.bandLabel)}
      <span class="tag">${esc((lead.products || [])[0] ?? 'No product')}</span>
    </div>
    <div class="dealcard-foot">
      <span class="t-num" style="color:var(--text-primary);font-weight:600">${esc(money(lead.value))}</span>
      <span>${ageDays(lead)}d old</span>
    </div>
    <div class="dealcard-foot">
      <span class="truncate">${esc(lead.owner?.name ?? 'Unassigned')}</span>
      ${info ? `<span class="pill" data-tone="${attr(info.tone)}">${esc(info.label)}</span>` : ''}
    </div>
  </article>`;
}

export function view() {
  const all = enrich(store.visibleLeads());
  if (!all.length) {
    return `<div class="page-head"><div><h1>Pipeline</h1>
      <p>Every open opportunity by stage.</p></div></div>
      ${emptyState({ title: 'Nothing in the pipeline yet',
        body: 'Captured leads appear here the moment they are qualified.',
        actionLabel: 'Capture Lead', actionHref: '#/capture' })}`;
  }

  const q = state.q.trim().toLowerCase();
  const rows = all.filter((l) => {
    if (state.owner && l.ownerId !== state.owner) return false;
    if (state.band && l.band !== state.band) return false;
    if (!q) return true;
    return `${l.contactName} ${l.companyName} ${(l.products || []).join(' ')}`.toLowerCase().includes(q);
  });

  const owners = store.db.users.filter((u) => all.some((l) => l.ownerId === u.id));
  const open = rows.filter((l) => !['WON', 'LOST'].includes(l.stage));

  return `
    <div class="page-head">
      <div>
        <h1>Pipeline</h1>
        <p>${open.length} open opportunities worth ${money(sumBy(open, (l) => l.value))}.
           Drag a card to move it, or open a card and use the stage menu.</p>
      </div>
    </div>

    <div class="filterbar">
      <label class="field grow" style="flex:2 1 240px"><span>Search</span>
        <input class="input" type="search" id="p-q" value="${attr(state.q)}"
          placeholder="Lead, company or product"></label>
      ${owners.length > 1 ? `<label class="field"><span>Owner</span>
        <select class="select" id="p-owner"><option value="">All owners</option>
          ${owners.map((u) => `<option value="${attr(u.id)}"${u.id === state.owner ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}
        </select></label>` : ''}
      <label class="field"><span>Temperature</span>
        <select class="select" id="p-band"><option value="">All</option>
          ${['STRATEGIC', 'HOT', 'WARM', 'COLD'].map((b) =>
            `<option value="${attr(b)}"${b === state.band ? ' selected' : ''}>${esc(b.charAt(0) + b.slice(1).toLowerCase())}</option>`).join('')}
        </select></label>
      <button class="btn btn-sec btn-sm" id="p-clear">Clear</button>
    </div>

    <div class="board" role="list" aria-label="Pipeline stages">
      ${STAGES.map((stage) => {
        const inStage = rows.filter((l) => l.stage === stage);
        const value = sumBy(inStage, (l) => l.value);
        return `<section class="col" role="listitem" data-stage="${attr(stage)}"
            aria-label="${attr(`${stage}, ${inStage.length} leads`)}">
          <header class="col-head">
            <h3>${esc(stage)}</h3>
            <span class="col-sum">${inStage.length}</span>
          </header>
          <p class="col-sum">${esc(money(value))}</p>
          <div class="stack gap-2" data-drop="${attr(stage)}">
            ${inStage.map(dealCard).join('') ||
              '<p class="t-cap" style="padding:var(--sp-3) 0">Nothing here.</p>'}
          </div>
        </section>`;
      }).join('')}
    </div>`;
}

export function mount({ outlet }) {
  const rerender = () => import('../router.js').then((r) => r.render());
  const bind = (sel, ev, fn) => outlet.querySelector(sel)?.addEventListener(ev, fn);

  let timer;
  const q = outlet.querySelector('#p-q');
  q?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = q.value;
      rerender().then(() => document.querySelector('#p-q')?.focus());
    }, 220);
  });
  bind('#p-owner', 'change', (e) => { state.owner = e.target.value; rerender(); });
  bind('#p-band', 'change', (e) => { state.band = e.target.value; rerender(); });
  bind('#p-clear', 'click', () => { Object.assign(state, { q: '', owner: '', band: '' }); rerender(); });

  const writable = store.canWrite();

  function move(id, stage) {
    const lead = store.getLead(id);
    if (!lead || lead.stage === stage) return;
    // Won and Lost end the opportunity, so those two confirm before landing.
    if (stage === 'WON' || stage === 'LOST') {
      confirmAction({
        title: `Mark ${lead.code} as ${stage}?`,
        body: stage === 'WON'
          ? 'This closes the opportunity and adds it to won business.'
          : 'This closes the opportunity as lost. It stays in the record for reporting.',
        confirmLabel: `Mark ${stage}`, danger: stage === 'LOST',
        onConfirm() { store.setStage(id, stage); toast(`Moved to ${stage}`); rerender(); },
      });
      return;
    }
    store.setStage(id, stage);
    toast(`Moved to ${stage}`);
    rerender();
  }

  if (writable) {
    let dragId = null;
    outlet.querySelectorAll('.dealcard').forEach((cardEl) => {
      cardEl.addEventListener('dragstart', (e) => {
        dragId = cardEl.dataset.id;
        cardEl.dataset.dragging = 'true';
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragId);
      });
      cardEl.addEventListener('dragend', () => {
        cardEl.dataset.dragging = 'false';
        dragId = null;
        outlet.querySelectorAll('.col').forEach((c) => { c.dataset.over = 'false'; });
      });
    });

    outlet.querySelectorAll('.col').forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.dataset.over = 'true'; });
      col.addEventListener('dragleave', () => { col.dataset.over = 'false'; });
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.dataset.over = 'false';
        const id = dragId || e.dataTransfer.getData('text/plain');
        if (id) move(id, col.dataset.stage);
      });
    });
  }

  /* Keyboard equivalent: Enter opens the lead, and ← / → move it a stage.
     Drag-and-drop alone would put the whole feature out of reach of anyone
     not using a mouse. */
  outlet.querySelectorAll('.dealcard').forEach((cardEl) => {
    cardEl.addEventListener('keydown', (e) => {
      const id = cardEl.dataset.id;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        location.hash = `#/leads/${id}`;
        return;
      }
      if (!writable) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const lead = store.getLead(id);
      const i = STAGES.indexOf(lead.stage);
      const next = STAGES[e.key === 'ArrowRight' ? Math.min(i + 1, STAGES.length - 1) : Math.max(i - 1, 0)];
      move(id, next);
    });
    cardEl.addEventListener('dblclick', () => { location.hash = `#/leads/${cardEl.dataset.id}`; });
  });
}
