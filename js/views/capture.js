/* ==========================================================================
   Rapid Lead Capture (§26, §27) — mobile-first, chip-driven, under 30
   seconds. Two required fields; everything else is a tap.
   ========================================================================== */

import * as store from '../store.js';
import { score, money } from '../scoring.js';
import { esc, attr, icon, scoreDial, toast, openDialog, emptyState } from '../ui.js';
import { go } from '../router.js';

const DRAFT_KEY = 'teal.leadconnect.draft.v2';

const STEPS = ['Contact', 'Requirement', 'Qualify', 'Save'];

function blankDraft() {
  return {
    step: 0,
    contactName: '', companyName: '', designation: '', email: '', phone: '',
    city: '', industry: '', companySize: '', accountType: '',
    products: [], application: '', problem: '', quantity: '',
    budget: 'Not Defined', timeline: 'Not Defined', authority: 'Unknown',
    currentSolution: '', competitor: '', value: '',
    stage: 'NEW', source: 'Booth Conversation',
    engagement: { booth: true, meeting: false, demo: false, technical: false, commercial: false },
    tags: [], notes: '', nextFollowUp: '', consent: false,
  };
}

let draft = null;
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? { ...blankDraft(), ...JSON.parse(raw) } : null;
  } catch { return null; }
}
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* non-fatal */ }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* non-fatal */ }
}

/* The draft is scored live so the salesperson can see qualification improve
   as they tap. It needs a company shape to score against. */
function draftAsLead() {
  const known = store.db.companies.find(
    (c) => c.name.trim().toLowerCase() === draft.companyName.trim().toLowerCase());
  return {
    ...draft,
    company: known ?? { industry: draft.industry, size: draft.companySize,
                        accountType: draft.accountType, name: draft.companyName },
    designation: draft.designation,
  };
}

const chipRow = (name, options, selected, multi = false) =>
  `<div class="chips" data-chips="${attr(name)}" data-multi="${multi}">
    ${options.map((opt) => `<button type="button" class="chip" data-value="${attr(opt)}"
      aria-pressed="${multi ? selected.includes(opt) : selected === opt}">${esc(opt)}</button>`).join('')}
  </div>`;

function stepContact() {
  const ref = store.db.settings.reference;
  return `
    <label class="field"><span>Full name <b class="req">*</b></span>
      <input class="input" id="d-contactName" value="${attr(draft.contactName)}"
        autocomplete="name" enterkeyhint="next" placeholder="Who did you meet?"></label>
    <label class="field"><span>Company <b class="req">*</b></span>
      <input class="input" id="d-companyName" value="${attr(draft.companyName)}"
        list="known-companies" autocomplete="organization" placeholder="Their organisation">
      <datalist id="known-companies">
        ${store.db.companies.slice(0, 60).map((c) => `<option value="${attr(c.name)}"></option>`).join('')}
      </datalist></label>
    <div class="field-row">
      <label class="field"><span>Designation</span>
        <input class="input" id="d-designation" value="${attr(draft.designation)}"
          placeholder="e.g. Head of Manufacturing"></label>
      <label class="field"><span>Mobile</span>
        <input class="input" id="d-phone" type="tel" value="${attr(draft.phone)}"
          autocomplete="tel" inputmode="tel" placeholder="+91 …"></label>
    </div>
    <label class="field"><span>Email</span>
      <input class="input" id="d-email" type="email" value="${attr(draft.email)}"
        autocomplete="email" inputmode="email" placeholder="name@company.com"></label>
    <div class="field-row">
      <label class="field"><span>City</span>
        <input class="input" id="d-city" value="${attr(draft.city)}" list="known-cities">
        <datalist id="known-cities">
          ${ref.cities.map((c) => `<option value="${attr(c)}"></option>`).join('')}
        </datalist></label>
      <label class="field"><span>Industry</span>
        <select class="select" id="d-industry">
          <option value="">Choose…</option>
          ${ref.industries.map((i) => `<option value="${attr(i)}"${i === draft.industry ? ' selected' : ''}>${esc(i)}</option>`).join('')}
        </select></label>
    </div>`;
}

function stepRequirement() {
  const laser = store.db.products.filter((p) => p.category === 'LASER').map((p) => p.name);
  const automation = store.db.products.filter((p) => p.category === 'AUTOMATION').map((p) => p.name);
  return `
    <p class="t-eyebrow">Laser</p>
    ${chipRow('products', laser, draft.products, true)}
    <p class="t-eyebrow mt-4">Automation</p>
    ${chipRow('products', automation, draft.products, true)}
    <label class="field mt-4"><span>Application</span>
      <input class="input" id="d-application" value="${attr(draft.application)}"
        placeholder="What are they trying to do?"></label>
    <label class="field"><span>Problem with the current process</span>
      <textarea class="textarea" id="d-problem" rows="3"
        placeholder="Why are they looking?">${esc(draft.problem)}</textarea></label>
    <div class="field-row">
      <label class="field"><span>Quantity</span>
        <input class="input" id="d-quantity" value="${attr(draft.quantity)}"
          placeholder="e.g. 2 machines"></label>
      <label class="field"><span>Estimated value (₹)</span>
        <input class="input" id="d-value" type="number" inputmode="numeric"
          value="${attr(draft.value)}" placeholder="e.g. 5000000"></label>
    </div>`;
}

function stepQualify() {
  const ref = store.db.settings.reference;
  return `
    <p class="t-eyebrow">Purchase timeline</p>
    ${chipRow('timeline', ref.timelines, draft.timeline)}
    <p class="t-eyebrow mt-4">Budget</p>
    ${chipRow('budget', ref.budgets, draft.budget)}
    <p class="t-eyebrow mt-4">Decision authority</p>
    ${chipRow('authority', ref.authorities, draft.authority)}
    <p class="t-eyebrow mt-4">What happened at the stand</p>
    <div class="chips" data-engagement>
      ${[['meeting', 'Meeting'], ['demo', 'Demo given'], ['technical', 'Technical discussion'],
         ['commercial', 'Commercial discussion']].map(([k, label]) =>
        `<button type="button" class="chip" data-eng="${k}"
          aria-pressed="${!!draft.engagement[k]}">${esc(label)}</button>`).join('')}
    </div>
    <p class="t-eyebrow mt-4">Tags</p>
    ${chipRow('tags', ['Demo requested', 'RFQ expected', 'Technical deep-dive',
                       'Pricing discussed', 'Urgent', 'Repeat customer',
                       'Competitor displacement'], draft.tags, true)}`;
}

function stepSave() {
  const scored = score(draftAsLead());
  return `
    <div class="row gap-4" style="align-items:center;flex-wrap:wrap">
      ${scoreDial(scored.total, scored.band, 72)}
      <div class="grow" style="min-width:200px">
        <p class="t-eyebrow">Lead Intelligence Score</p>
        <p class="t-h2">${scored.total} / 100 · ${esc(scored.label)}</p>
        <p class="t-cap">${scored.rows.filter((r) => r.hit).length} of ${scored.rows.length}
          qualification factors captured.</p>
      </div>
    </div>
    <label class="field mt-4"><span>Next follow-up</span>
      <input class="input" type="date" id="d-nextFollowUp" value="${attr(draft.nextFollowUp)}"></label>
    <label class="field"><span>Notes</span>
      <textarea class="textarea" id="d-notes" rows="3"
        placeholder="Anything worth remembering next week">${esc(draft.notes)}</textarea></label>
    <label class="checkbox">
      <input type="checkbox" id="d-consent" ${draft.consent ? 'checked' : ''}>
      <span>The visitor agreed to be contacted by TEAL about the products and solutions
        discussed at the stand.</span>
    </label>
    <div id="save-error" role="alert"></div>`;
}

export function view() {
  if (!store.canWrite()) {
    return emptyState({ title: 'Capture is not available to your role',
      body: 'Management accounts are read-only. Sales and administrator accounts can capture leads.',
      actionLabel: 'Back to Command Center', actionHref: '#/dashboard', iconName: 'warn' });
  }

  if (!draft) draft = loadDraft() || blankDraft();
  const ex = store.activeExhibition();
  const scored = score(draftAsLead());
  const body = [stepContact, stepRequirement, stepQualify, stepSave][draft.step]();

  return `
    <div class="page-head">
      <div><h1>Capture Lead</h1>
        <p>${esc(ex?.name ?? 'No active exhibition')} — two required fields, everything else is a tap.</p></div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" id="discard">Discard draft</button>
      </div>
    </div>

    <ol class="row gap-2" style="margin-bottom:var(--sp-5)" aria-label="Capture progress">
      ${STEPS.map((label, i) => `<li class="grow">
        <button class="btn ${i === draft.step ? '' : 'btn-sec'} btn-sm btn-block"
          data-step="${i}" aria-current="${i === draft.step ? 'step' : 'false'}">
          ${i + 1}. ${esc(label)}</button></li>`).join('')}
    </ol>

    <div class="card">${body}</div>

    <div class="row gap-2 mt-4" style="flex-wrap:wrap">
      <button class="btn btn-sec" id="prev" ${draft.step === 0 ? 'disabled' : ''}>Back</button>
      <span class="row gap-2 grow">
        ${scoreDial(scored.total, scored.band, 36)}
        <span class="t-cap truncate">${esc(draft.contactName || 'New lead')}${
          draft.companyName ? ` · ${esc(draft.companyName)}` : ''}</span>
      </span>
      ${draft.step < STEPS.length - 1
        ? '<button class="btn btn-sec" id="next">Next</button>' : ''}
      <button class="btn" id="save">Save Lead</button>
    </div>`;
}

export function mount({ outlet }) {
  if (!store.canWrite()) return;
  const rerender = () => import('../router.js').then((r) => r.render());

  // Text inputs write straight into the draft so nothing is lost on a step change.
  outlet.querySelectorAll('input[id^="d-"], textarea[id^="d-"], select[id^="d-"]').forEach((el) => {
    const key = el.id.slice(2);
    const handler = () => {
      draft[key] = el.type === 'checkbox' ? el.checked : el.value;
      saveDraft();
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });

  outlet.querySelectorAll('[data-chips]').forEach((group) => {
    const key = group.dataset.chips;
    const multi = group.dataset.multi === 'true';
    group.querySelectorAll('[data-value]').forEach((btn) => btn.addEventListener('click', () => {
      const value = btn.dataset.value;
      if (multi) {
        const list = [...(draft[key] || [])];
        const i = list.indexOf(value);
        if (i > -1) list.splice(i, 1); else list.push(value);
        draft[key] = list;
      } else {
        draft[key] = draft[key] === value ? '' : value;
      }
      saveDraft();
      rerender();
    }));
  });

  outlet.querySelectorAll('[data-eng]').forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.eng;
    draft.engagement = { ...draft.engagement, [key]: !draft.engagement[key] };
    saveDraft();
    rerender();
  }));

  outlet.querySelectorAll('[data-step]').forEach((btn) => btn.addEventListener('click', () => {
    draft.step = Number(btn.dataset.step); saveDraft(); rerender();
  }));
  outlet.querySelector('#prev')?.addEventListener('click', () => {
    draft.step = Math.max(0, draft.step - 1); saveDraft(); rerender();
  });
  outlet.querySelector('#next')?.addEventListener('click', () => {
    draft.step = Math.min(STEPS.length - 1, draft.step + 1); saveDraft(); rerender();
  });

  outlet.querySelector('#discard')?.addEventListener('click', () => {
    import('../ui.js').then(({ confirmAction }) => confirmAction({
      title: 'Discard this draft?',
      body: 'Anything typed on this form will be lost. Nothing already saved is affected.',
      confirmLabel: 'Discard',
      onConfirm() { clearDraft(); draft = blankDraft(); toast('Draft discarded'); rerender(); },
    }));
  });

  outlet.querySelector('#save')?.addEventListener('click', save);

  function save() {
    const missing = [];
    if (!draft.contactName.trim()) missing.push('a contact name');
    if (!draft.companyName.trim()) missing.push('a company');
    if (draft.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email.trim())) {
      missing.push('a valid email address');
    }
    if (!draft.consent) missing.push('the consent tick');

    if (missing.length) {
      draft.step = (!draft.consent && missing.length === 1) ? 3 : 0;
      saveDraft();
      rerender().then(() => {
        const box = document.getElementById('save-error');
        const message = `Still needed: ${missing.join(', ')}.`;
        if (box) box.innerHTML = `<p class="t-sm" style="color:var(--danger);margin-top:var(--sp-3)">${esc(message)}</p>`;
        else toast(message, 'danger');
      });
      return;
    }

    // §29 — an exact match is surfaced, never silently merged or dropped.
    const dupe = store.findDuplicate({
      email: draft.email, phone: draft.phone,
      companyName: draft.companyName, contactName: draft.contactName,
    });
    if (dupe && !draft.forceNew) {
      openDialog({
        title: 'This looks like an existing lead',
        body: `<p class="t-sm dim">A record already matches this contact.</p>
          <div class="card mt-3">
            <b>${esc(dupe.contactName)}</b>
            <p class="t-cap">${esc(dupe.companyName)} · ${esc(dupe.code)}</p>
            <p class="t-cap mt-2">Captured ${esc(dupe.capturedAt.slice(0, 10))} ·
              owner ${esc(dupe.owner?.name ?? 'unassigned')}</p>
          </div>
          <p class="t-cap mt-3">Opening the existing lead keeps the follow-up history in one place.
            Creating a second record splits it.</p>`,
        footer: `<button class="btn btn-sec" data-close>Cancel</button>
                 <button class="btn btn-sec" id="dupe-new">Create anyway</button>
                 <button class="btn" id="dupe-open">Open existing</button>`,
        onMount(host, close) {
          host.querySelector('#dupe-open').addEventListener('click', () => {
            close(); go(`/leads/${dupe.id}`);
          });
          host.querySelector('#dupe-new').addEventListener('click', () => {
            draft.forceNew = true; close(); save();
          });
        },
      });
      return;
    }

    const created = store.createLead({ ...draft, exhibitionId: store.activeExhibition()?.id });
    clearDraft();
    draft = blankDraft();
    toast(`Saved as ${created.code}`);
    go(`/leads/${created.id}`);
  }
}
