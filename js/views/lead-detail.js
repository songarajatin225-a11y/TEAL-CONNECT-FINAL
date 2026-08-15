/* ==========================================================================
   Lead 360 (§13) — everything known about one opportunity, with the score
   explained (§14) and the recommended action made prominent (§15).
   ========================================================================== */

import * as store from '../store.js';
import { score, scoreReasons, nextBestAction, money } from '../scoring.js';
import { esc, attr, icon, card, tempPill, stagePill, scoreDial, fmtDate, fmtDateTime,
         dueInfo, emptyState, toast, openDialog, confirmAction } from '../ui.js';
import { go } from '../router.js';

const STAGES = ['NEW', 'QUALIFIED', 'ENGAGED', 'DEMO', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];

const ACT_ICON = {
  lead_captured: 'plus', call: 'phone', meeting: 'contacts', technical: 'gear',
  demo: 'spark', quotation: 'mail', stage_change: 'pipeline', won: 'check',
  lost: 'close', note: 'leads', owner_change: 'team', tag_change: 'leads',
};

function scoreBreakdown(scored) {
  return `<div class="scorebar">${scored.rows.map((row) => `
    <div class="scoreline" data-hit="${row.hit}">
      <span>
        <b style="display:block;font-size:var(--fs-caption);color:var(--text-primary)">${esc(row.label)}</b>
        <span class="t-cap">${esc(row.note)}</span>
      </span>
      <span class="scoreline-track">
        <span class="scoreline-fill" style="width:${Math.round(row.ratio * 100)}%"></span>
      </span>
      <span class="t-num t-cap" style="text-align:right">${row.points}/${row.max}</span>
    </div>`).join('')}</div>`;
}

export function view({ id }) {
  const raw = store.getLead(id);
  if (!raw) {
    return emptyState({
      title: 'Lead not found',
      body: 'That lead may have been removed, or the link is out of date.',
      actionLabel: 'Back to Leads', actionHref: '#/leads', iconName: 'warn',
    });
  }

  const lead = store.hydrate(raw);
  const visible = store.visibleLeads().some((l) => l.id === id);
  if (!visible) {
    return emptyState({
      title: 'Not available to your role',
      body: 'Sales users see the leads they own. Ask an administrator if you need access.',
      actionLabel: 'Back to Leads', actionHref: '#/leads', iconName: 'warn',
    });
  }

  const scored = score(lead);
  const reasons = scoreReasons(scored);
  const nba = nextBestAction(lead, scored);
  const editable = store.canWrite();
  const acts = store.db.activities
    .filter((a) => a.leadId === id)
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const info = lead.nextFollowUp ? dueInfo(lead.nextFollowUp) : null;
  const e = lead.engagement ?? {};

  const waNumber = String(lead.phone || '').replace(/\D/g, '');

  return `
    <a class="t-cap row gap-1" href="#/leads" style="margin-bottom:var(--sp-3);display:inline-flex">
      ${icon('chevronL', 'ico')} All leads</a>

    <div class="page-head">
      <div class="row gap-4" style="align-items:center">
        ${scoreDial(scored.total, scored.band, 56)}
        <div>
          <h1>${esc(lead.contactName)}</h1>
          <p>${esc(lead.designation || 'Designation not captured')} ·
             <a href="#/companies/${attr(lead.companyId)}">${esc(lead.companyName)}</a></p>
          <div class="row gap-2 mt-2" style="flex-wrap:wrap">
            ${tempPill(scored.band, scored.label)}
            ${stagePill(lead.stage)}
            <span class="code">${esc(lead.code)}</span>
            <span class="t-cap">Owner: ${esc(lead.owner?.name ?? 'Unassigned')}</span>
          </div>
        </div>
      </div>
      <div class="page-actions">
        ${lead.phone ? `<a class="btn btn-sec btn-sm" href="tel:${attr(lead.phone)}">${icon('phone')} Call</a>` : ''}
        ${lead.email ? `<a class="btn btn-sec btn-sm" href="mailto:${attr(lead.email)}">${icon('mail')} Email</a>` : ''}
        ${waNumber ? `<a class="btn btn-sec btn-sm" target="_blank" rel="noopener"
           href="https://wa.me/${attr(waNumber)}">WhatsApp</a>` : ''}
        ${editable ? `<button class="btn btn-sm" id="log-activity">${icon('plus')} Log Activity</button>` : ''}
      </div>
    </div>

    <div class="nba" style="margin-bottom:var(--sp-5)">
      ${icon('target')}
      <span class="nba-text">
        <b>Next best action — ${esc(nba.title)}</b>
        <span>${esc(nba.why)}</span>
      </span>
      ${editable ? `<button class="btn btn-sm" id="nba-done">Mark done</button>` : ''}
    </div>

    <div class="grid grid-2">
      ${card('Lead Intelligence Score', `
        <div class="row gap-4" style="align-items:flex-start;flex-wrap:wrap">
          <div style="text-align:center;min-width:96px">
            ${scoreDial(scored.total, scored.band, 84)}
            <p class="t-cap mt-2">${esc(scored.label)}</p>
          </div>
          <div class="grow" style="min-width:220px">
            <p class="t-eyebrow">Why this lead scored ${scored.total}</p>
            <ul class="stack gap-1 mt-2">
              ${reasons.strong.length
                ? reasons.strong.map((r) => `<li class="t-sm row gap-2">
                    <span style="color:var(--success)">✓</span><span>${esc(r)}</span></li>`).join('')
                : '<li class="t-cap">No strong signals captured yet.</li>'}
              ${reasons.gaps.map((g) => `<li class="t-sm row gap-2">
                <span style="color:var(--text-muted)">○</span>
                <span class="dim">${esc(g)}</span></li>`).join('')}
            </ul>
          </div>
        </div>
        <p class="t-eyebrow mt-6">Score breakdown</p>
        <div class="mt-2">${scoreBreakdown(scored)}</div>
        <p class="t-cap mt-3">Rule-based scoring. Weights are published in Settings and applied
          identically to every lead — no model, no hidden inputs.</p>`, { cls: 'span-2' })}

      ${card('Contact', `<dl class="kv">
        <dt>Name</dt><dd>${esc(lead.contactName)}</dd>
        <dt>Designation</dt><dd>${esc(lead.designation || '—')}</dd>
        <dt>Authority</dt><dd>${esc(lead.authority || 'Unknown')}</dd>
        <dt>Email</dt><dd>${lead.email ? `<a href="mailto:${attr(lead.email)}">${esc(lead.email)}</a>` : '—'}</dd>
        <dt>Phone</dt><dd>${lead.phone ? `<a href="tel:${attr(lead.phone)}">${esc(lead.phone)}</a>` : '—'}</dd>
        <dt>Location</dt><dd>${esc(lead.city || '—')}</dd>
        <dt>LinkedIn</dt><dd>${esc(lead.contact?.linkedin || '—')}</dd>
      </dl>`)}

      ${card('Company', `<dl class="kv">
        <dt>Company</dt><dd><a href="#/companies/${attr(lead.companyId)}">${esc(lead.companyName)}</a></dd>
        <dt>Industry</dt><dd>${esc(lead.industry || '—')}</dd>
        <dt>Size</dt><dd>${esc(lead.company?.size || '—')} employees</dd>
        <dt>Location</dt><dd>${esc([lead.company?.city, lead.company?.state].filter(Boolean).join(', ') || '—')}</dd>
        <dt>Website</dt><dd>${esc(lead.company?.website || '—')}</dd>
        <dt>Account type</dt><dd>${esc(lead.company?.accountType || '—')}</dd>
      </dl>`)}

      ${card('Requirement', `<dl class="kv">
        <dt>Products</dt><dd>${(lead.products || []).length
          ? lead.products.map((p) => `<span class="tag">${esc(p)}</span>`).join(' ') : '—'}</dd>
        <dt>Application</dt><dd>${esc(lead.application || '—')}</dd>
        <dt>Problem</dt><dd>${esc(lead.problem || '—')}</dd>
        <dt>Quantity</dt><dd>${esc(lead.quantity || '—')}</dd>
        <dt>Budget</dt><dd>${esc(lead.budget || 'Not Defined')}</dd>
        <dt>Timeline</dt><dd>${esc(lead.timeline || 'Not Defined')}</dd>
        <dt>Potential value</dt><dd class="t-num">${esc(money(lead.value))}</dd>
        <dt>Current solution</dt><dd>${esc(lead.currentSolution || '—')}</dd>
        <dt>Competitor</dt><dd>${esc(lead.competitor || 'None identified')}</dd>
      </dl>`)}

      ${card('Engagement', `<dl class="kv">
        <dt>Exhibition</dt><dd>${esc(lead.exhibition?.name ?? '—')}</dd>
        <dt>Source</dt><dd>${esc(lead.source || '—')}</dd>
        <dt>Captured</dt><dd>${esc(fmtDateTime(lead.capturedAt))}</dd>
        <dt>Next follow-up</dt><dd>${lead.nextFollowUp
          ? `${esc(fmtDate(lead.nextFollowUp))} <span class="pill" data-tone="${attr(info.tone)}">${esc(info.label)}</span>`
          : '—'}</dd>
        <dt>Consent</dt><dd>${lead.consent ? 'Given' : 'Not recorded'}</dd>
      </dl>
      <p class="t-eyebrow mt-4">Booth interaction</p>
      <div class="chips mt-2">
        ${[['booth', 'Booth conversation'], ['meeting', 'Meeting'], ['demo', 'Demo'],
           ['technical', 'Technical discussion'], ['commercial', 'Commercial discussion']]
          .map(([k, label]) => `<span class="chip" aria-pressed="${!!e[k]}"
            style="pointer-events:none">${esc(label)}</span>`).join('')}
      </div>`)}

      ${card('Pipeline', `
        <label class="field"><span>Stage</span>
          <select class="select" id="stage-sel" ${editable ? '' : 'disabled'}>
            ${STAGES.map((s) => `<option value="${attr(s)}"${s === lead.stage ? ' selected' : ''}>${esc(s)}</option>`).join('')}
          </select></label>
        <label class="field"><span>Owner</span>
          <select class="select" id="owner-sel" ${store.isAdmin() ? '' : 'disabled'}>
            ${store.db.users.filter((u) => u.role !== 'management').map((u) =>
              `<option value="${attr(u.id)}"${u.id === lead.ownerId ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}
          </select></label>
        ${!store.isAdmin() ? '<p class="t-cap">Only administrators can reassign leads.</p>' : ''}
        <p class="t-eyebrow mt-4">Tags</p>
        <div class="chips mt-2" id="tag-edit">
          ${['Demo requested', 'RFQ expected', 'Technical deep-dive', 'Pricing discussed',
             'Urgent', 'Repeat customer', 'Competitor displacement'].map((t) => `
            <button class="chip" data-tag="${attr(t)}" ${editable ? '' : 'disabled'}
              aria-pressed="${(lead.tags || []).includes(t)}">${esc(t)}</button>`).join('')}
        </div>`)}

      ${card('Notes', `<p class="t-sm" style="white-space:pre-wrap">${
        esc(lead.notes) || '<span class="t-cap">No notes yet.</span>'}</p>
        ${editable ? '<button class="btn btn-sec btn-sm mt-3" id="edit-notes">Edit notes</button>' : ''}`)}

      ${card('Activity Timeline', acts.length ? `<ol class="timeline">${acts.map((a) => `
        <li class="tl-item">
          <b>${esc(a.title)}</b>
          ${a.body ? `<p>${esc(a.body)}</p>` : ''}
          <time datetime="${attr(a.at)}">${esc(fmtDateTime(a.at))} · ${
            esc(store.getUser(a.actorId)?.name ?? 'System')}</time>
        </li>`).join('')}</ol>` : '<p class="t-cap">No activity recorded yet.</p>', { cls: 'span-2' })}
    </div>

    ${store.isAdmin() ? `<div class="mt-6">
      <button class="btn btn-sec btn-sm" id="delete-lead"
        style="color:var(--danger);border-color:var(--danger)">Delete lead</button>
    </div>` : ''}`;
}

export function mount({ id, outlet }) {
  const lead = store.getLead(id);
  if (!lead) return;
  const rerender = () => import('../router.js').then((r) => r.render());
  const bind = (sel, ev, fn) => outlet.querySelector(sel)?.addEventListener(ev, fn);

  bind('#stage-sel', 'change', (e) => {
    store.setStage(id, e.target.value);
    toast(`Stage set to ${e.target.value}`);
    rerender();
  });

  bind('#owner-sel', 'change', (e) => {
    const name = store.getUser(e.target.value)?.name;
    store.updateLead(id, { ownerId: e.target.value }, `reassigned to ${name}`);
    store.logActivity(id, 'owner_change', 'Owner changed', `Reassigned to ${name}`);
    toast(`Reassigned to ${name}`);
    rerender();
  });

  outlet.querySelectorAll('#tag-edit [data-tag]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      const tags = [...(lead.tags || [])];
      const i = tags.indexOf(tag);
      if (i > -1) tags.splice(i, 1); else tags.push(tag);
      store.updateLead(id, { tags }, `tags: ${tags.join(', ') || 'none'}`);
      store.logActivity(id, 'tag_change', i > -1 ? 'Tag removed' : 'Tag added', tag);
      rerender();
    }));

  bind('#nba-done', 'click', () => {
    const nba = nextBestAction(store.hydrate(lead), score(store.hydrate(lead)));
    store.logActivity(id, 'note', 'Next best action completed', nba.title);
    store.save();
    toast('Logged against the timeline');
    rerender();
  });

  bind('#log-activity', 'click', () => {
    openDialog({
      title: 'Log activity',
      body: `
        <label class="field"><span>Type</span>
          <select class="select" id="a-type">
            ${[['call', 'Call'], ['meeting', 'Meeting'], ['technical', 'Technical discussion'],
               ['demo', 'Demo'], ['quotation', 'Quotation'], ['note', 'Note']]
              .map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select></label>
        <label class="field"><span>What happened</span>
          <textarea class="textarea" id="a-body"
            placeholder="What changed since the last contact?"></textarea></label>
        <label class="field"><span>Next follow-up date</span>
          <input class="input" type="date" id="a-due" value="${attr(lead.nextFollowUp || '')}"></label>`,
      footer: `<button class="btn btn-sec" data-close>Cancel</button>
               <button class="btn" id="a-save">Save</button>`,
      onMount(host, close) {
        host.querySelector('#a-save').addEventListener('click', () => {
          const type = host.querySelector('#a-type').value;
          const body = host.querySelector('#a-body').value.trim();
          const due = host.querySelector('#a-due').value;
          const label = host.querySelector('#a-type').selectedOptions[0].textContent;
          store.logActivity(id, type, label, body);
          if (due && due !== lead.nextFollowUp) {
            store.updateLead(id, { nextFollowUp: due }, `follow-up ${due}`);
          } else {
            store.save();
          }
          close();
          toast('Activity logged');
          rerender();
        });
      },
    });
  });

  bind('#edit-notes', 'click', () => {
    openDialog({
      title: 'Edit notes',
      body: `<label class="field"><span>Notes</span>
        <textarea class="textarea" id="n-body" rows="6">${esc(lead.notes || '')}</textarea></label>`,
      footer: `<button class="btn btn-sec" data-close>Cancel</button>
               <button class="btn" id="n-save">Save</button>`,
      onMount(host, close) {
        host.querySelector('#n-save').addEventListener('click', () => {
          store.updateLead(id, { notes: host.querySelector('#n-body').value }, 'notes edited');
          close();
          toast('Notes saved');
          rerender();
        });
      },
    });
  });

  // Deletion is confirmed, audited and never silent (§29 / data safety).
  bind('#delete-lead', 'click', () => {
    confirmAction({
      title: `Delete ${lead.code}?`,
      body: 'This removes the lead and its timeline from this device. The action is recorded in the audit log and cannot be undone.',
      confirmLabel: 'Delete lead',
      onConfirm() {
        const i = store.db.leads.findIndex((l) => l.id === id);
        if (i > -1) store.db.leads.splice(i, 1);
        store.db.activities = store.db.activities.filter((a) => a.leadId !== id);
        store.logAudit('lead_deleted', 'lead', id, lead.code);
        store.save();
        toast('Lead deleted');
        go('/leads');
      },
    });
  });
}
