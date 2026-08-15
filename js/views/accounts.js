/* ==========================================================================
   Companies list, Account 360 (§21) and Contacts (§13 contact side).
   ========================================================================== */

import * as store from '../store.js';
import { score, money } from '../scoring.js';
import { esc, attr, icon, card, tempPill, stagePill, scoreDial, fmtDateTime, fmtShort,
         tally, sumBy, emptyState, initials } from '../ui.js';
import { hbars, donut, dataTable } from '../charts.js';

const companyState = { q: '', industry: '', sort: 'value' };
const contactState = { q: '', authority: '' };

/* An account is the roll-up of every lead pointing at that company. */
function accountRoll(companyId) {
  const leads = store.visibleLeads().filter((l) => l.companyId === companyId)
    .map((l) => { const s = score(l); return { ...l, score: s.total, band: s.band, bandLabel: s.label }; });
  const open = leads.filter((l) => !['WON', 'LOST'].includes(l.stage));
  const won = leads.filter((l) => l.stage === 'WON');
  return {
    leads, open, won,
    pipeline: sumBy(open, (l) => l.value),
    wonValue: sumBy(won, (l) => l.value),
    accountScore: leads.length ? Math.round(sumBy(leads, (l) => l.score) / leads.length) : 0,
    products: tally(leads, (l) => l.products),
    contacts: store.db.contacts.filter((c) => c.companyId === companyId),
  };
}

/* ---- companies list ------------------------------------------------------ */
export function companiesView() {
  const rolls = store.db.companies.map((c) => ({ company: c, ...accountRoll(c.id) }))
    .filter((r) => r.leads.length);

  if (!rolls.length) {
    return `<div class="page-head"><div><h1>Companies</h1>
      <p>Every account TEAL has met, rolled up from its leads.</p></div></div>
      ${emptyState({ title: 'No accounts yet',
        body: 'Accounts are created automatically the first time you capture a lead against a company.',
        actionLabel: 'Capture Lead', actionHref: '#/capture', iconName: 'building' })}`;
  }

  const q = companyState.q.trim().toLowerCase();
  let rows = rolls.filter((r) => {
    if (companyState.industry && r.company.industry !== companyState.industry) return false;
    if (!q) return true;
    return `${r.company.name} ${r.company.industry} ${r.company.city}`.toLowerCase().includes(q);
  });
  rows.sort((a, b) => (companyState.sort === 'value'
    ? b.pipeline - a.pipeline
    : companyState.sort === 'leads'
      ? b.leads.length - a.leads.length
      : a.company.name.localeCompare(b.company.name)));

  const industries = [...new Set(rolls.map((r) => r.company.industry))].sort();

  return `
    <div class="page-head">
      <div><h1>Companies</h1>
        <p>${rows.length} accounts · ${money(sumBy(rows, (r) => r.pipeline))} open pipeline.</p></div>
    </div>

    <div class="filterbar">
      <label class="field grow" style="flex:2 1 240px"><span>Search</span>
        <input class="input" type="search" id="c-q" value="${attr(companyState.q)}"
          placeholder="Company, industry or city"></label>
      <label class="field"><span>Industry</span>
        <select class="select" id="c-industry"><option value="">All industries</option>
          ${industries.map((i) => `<option value="${attr(i)}"${i === companyState.industry ? ' selected' : ''}>${esc(i)}</option>`).join('')}
        </select></label>
      <label class="field"><span>Sort by</span>
        <select class="select" id="c-sort">
          ${[['value', 'Pipeline value'], ['leads', 'Lead count'], ['name', 'Name']].map(([v, l]) =>
            `<option value="${v}"${v === companyState.sort ? ' selected' : ''}>${l}</option>`).join('')}
        </select></label>
    </div>

    <div class="grid grid-3">${rows.map((r) => `
      <a class="card" href="#/companies/${attr(r.company.id)}" style="text-decoration:none;color:inherit">
        <div class="row gap-3">
          <span class="avatar" aria-hidden="true">${esc(initials(r.company.name))}</span>
          <span class="grow" style="min-width:0">
            <b class="truncate" style="display:block">${esc(r.company.name)}</b>
            <span class="t-cap truncate" style="display:block">${esc(r.company.industry)} · ${esc(r.company.city)}</span>
          </span>
        </div>
        <dl class="kv mt-3" style="grid-template-columns:1fr auto">
          <dt>Open opportunities</dt><dd class="t-num">${r.open.length}</dd>
          <dt>Pipeline</dt><dd class="t-num">${esc(money(r.pipeline))}</dd>
          <dt>Contacts</dt><dd class="t-num">${r.contacts.length}</dd>
          <dt>Account score</dt><dd class="t-num">${r.accountScore}</dd>
        </dl>
      </a>`).join('')}</div>`;
}

export function companiesMount({ outlet }) {
  const rerender = () => import('../router.js').then((r) => r.render());
  let timer;
  const q = outlet.querySelector('#c-q');
  q?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      companyState.q = q.value;
      rerender().then(() => document.querySelector('#c-q')?.focus());
    }, 220);
  });
  outlet.querySelector('#c-industry')?.addEventListener('change', (e) => {
    companyState.industry = e.target.value; rerender();
  });
  outlet.querySelector('#c-sort')?.addEventListener('change', (e) => {
    companyState.sort = e.target.value; rerender();
  });
}

/* ---- Account 360 --------------------------------------------------------- */
export function companyDetailView({ id }) {
  const company = store.getCompany(id);
  if (!company) {
    return emptyState({ title: 'Account not found',
      body: 'That company may have been merged or removed.',
      actionLabel: 'All companies', actionHref: '#/companies', iconName: 'warn' });
  }

  const r = accountRoll(id);
  const activities = store.db.activities
    .filter((a) => a.companyId === id)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 12);
  const stageMix = ['NEW', 'QUALIFIED', 'ENGAGED', 'DEMO', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST']
    .map((s) => ({ k: s.charAt(0) + s.slice(1).toLowerCase(),
                   v: r.leads.filter((l) => l.stage === s).length }))
    .filter((x) => x.v);

  return `
    <a class="t-cap row gap-1" href="#/companies" style="margin-bottom:var(--sp-3);display:inline-flex">
      ${icon('chevronL', 'ico')} All companies</a>

    <div class="page-head">
      <div class="row gap-4" style="align-items:center">
        <span class="avatar" style="width:48px;height:48px;font-size:var(--fs-body)"
          aria-hidden="true">${esc(initials(company.name))}</span>
        <div>
          <h1>${esc(company.name)}</h1>
          <p>${esc(company.industry)} · ${esc(company.accountType)} ·
             ${esc([company.city, company.state].filter(Boolean).join(', '))}</p>
        </div>
      </div>
    </div>

    <div class="grid grid-4" style="margin-bottom:var(--sp-5)">
      <div class="kpi"><span class="kpi-label">Open Pipeline</span>
        <span class="kpi-value">${esc(money(r.pipeline))}</span>
        <span class="kpi-foot"><span class="kpi-hint">${r.open.length} live opportunities</span></span></div>
      <div class="kpi"><span class="kpi-label">Won Business</span>
        <span class="kpi-value">${esc(money(r.wonValue))}</span>
        <span class="kpi-foot"><span class="kpi-hint">${r.won.length} closed won</span></span></div>
      <div class="kpi"><span class="kpi-label">Account Score</span>
        <span class="kpi-value">${r.accountScore}</span>
        <span class="kpi-foot"><span class="kpi-hint">Mean of ${r.leads.length} leads</span></span></div>
      <div class="kpi"><span class="kpi-label">Contacts</span>
        <span class="kpi-value">${r.contacts.length}</span>
        <span class="kpi-foot"><span class="kpi-hint">Known people</span></span></div>
    </div>

    <div class="grid grid-2">
      ${card('Company profile', `<dl class="kv">
        <dt>Industry</dt><dd>${esc(company.industry)}</dd>
        <dt>Account type</dt><dd>${esc(company.accountType)}</dd>
        <dt>Segment</dt><dd>${esc(company.segment)}</dd>
        <dt>Size</dt><dd>${esc(company.size)} employees</dd>
        <dt>Location</dt><dd>${esc([company.city, company.state, company.country].filter(Boolean).join(', '))}</dd>
        <dt>Website</dt><dd>${esc(company.website || '—')}</dd>
      </dl>`)}

      ${card('Opportunities by stage', stageMix.length
        ? donut(stageMix) : '<p class="t-cap">No opportunities yet.</p>')}

      ${card('Products of interest', r.products.length
        ? hbars(r.products, { limit: 8 }) + dataTable(r.products,
            { keyLabel: 'Product', valueLabel: 'Leads' })
        : '<p class="t-cap">No products named yet.</p>')}

      ${card('Contacts', r.contacts.length ? `<div class="stack gap-2">${r.contacts.map((c) => `
        <div class="row gap-3" style="padding:var(--sp-2) 0;border-bottom:1px solid var(--border-subtle)">
          <span class="avatar" aria-hidden="true">${esc(initials(c.name))}</span>
          <span class="grow" style="min-width:0">
            <b class="truncate" style="display:block;font-size:var(--fs-sm)">${esc(c.name)}</b>
            <span class="t-cap truncate" style="display:block">${esc(c.designation)}</span>
          </span>
          <span class="pill" data-tone="${c.authority === 'Decision Maker' ? 'success' : 'neutral'}">${esc(c.authority)}</span>
        </div>`).join('')}</div>` : '<p class="t-cap">No contacts recorded.</p>')}

      ${card('Opportunities', r.leads.length ? `<div class="stack gap-2">${r.leads.map((l) => `
        <a class="row gap-3" href="#/leads/${attr(l.id)}"
           style="padding:var(--sp-2);border-radius:var(--r-md);text-decoration:none;color:inherit">
          ${scoreDial(l.score, l.band, 36)}
          <span class="grow" style="min-width:0">
            <b class="truncate" style="display:block;font-size:var(--fs-sm)">${esc(l.contactName)}</b>
            <span class="t-cap truncate" style="display:block">${esc((l.products || []).join(', ') || 'No product named')}</span>
          </span>
          ${stagePill(l.stage)}
          <span class="t-num t-cap">${esc(money(l.value))}</span>
        </a>`).join('')}</div>` : '<p class="t-cap">No opportunities yet.</p>', { cls: 'span-2' })}

      ${card('Recent activity', activities.length ? `<ol class="timeline">${activities.map((a) => `
        <li class="tl-item"><b>${esc(a.title)}</b>
          ${a.body ? `<p>${esc(a.body)}</p>` : ''}
          <time datetime="${attr(a.at)}">${esc(fmtDateTime(a.at))} ·
            ${esc(store.getUser(a.actorId)?.name ?? 'System')}</time></li>`).join('')}</ol>`
        : '<p class="t-cap">Nothing logged yet.</p>', { cls: 'span-2' })}
    </div>`;
}

/* ---- contacts ------------------------------------------------------------ */
export function contactsView() {
  const visibleCompanyIds = new Set(store.visibleLeads().map((l) => l.companyId));
  const rows = store.db.contacts.filter((c) => visibleCompanyIds.has(c.companyId));

  if (!rows.length) {
    return `<div class="page-head"><div><h1>Contacts</h1>
      <p>People met across exhibitions.</p></div></div>
      ${emptyState({ title: 'No contacts yet',
        body: 'Contacts are created with each captured lead.',
        actionLabel: 'Capture Lead', actionHref: '#/capture', iconName: 'contacts' })}`;
  }

  const q = contactState.q.trim().toLowerCase();
  const filtered = rows.filter((c) => {
    if (contactState.authority && c.authority !== contactState.authority) return false;
    if (!q) return true;
    const company = store.getCompany(c.companyId);
    return `${c.name} ${c.designation} ${c.email} ${company?.name ?? ''}`.toLowerCase().includes(q);
  });

  return `
    <div class="page-head">
      <div><h1>Contacts</h1><p>${filtered.length} of ${rows.length} people.</p></div>
    </div>

    <div class="filterbar">
      <label class="field grow" style="flex:2 1 240px"><span>Search</span>
        <input class="input" type="search" id="ct-q" value="${attr(contactState.q)}"
          placeholder="Name, designation, email or company"></label>
      <label class="field"><span>Authority</span>
        <select class="select" id="ct-auth"><option value="">All</option>
          ${store.db.settings.reference.authorities.map((a) =>
            `<option value="${attr(a)}"${a === contactState.authority ? ' selected' : ''}>${esc(a)}</option>`).join('')}
        </select></label>
    </div>

    <div class="tablewrap">
      <table class="data">
        <caption>${filtered.length} contacts</caption>
        <thead><tr>
          <th scope="col">Name</th><th scope="col">Designation</th>
          <th scope="col">Authority</th><th scope="col">Company</th>
          <th scope="col">Email</th><th scope="col">Phone</th><th scope="col">City</th>
        </tr></thead>
        <tbody>${filtered.map((c) => {
          const company = store.getCompany(c.companyId);
          const lead = store.db.leads.find((l) => l.contactId === c.id);
          return `<tr>
            <td>${lead ? `<a href="#/leads/${attr(lead.id)}"><b>${esc(c.name)}</b></a>`
                       : `<b>${esc(c.name)}</b>`}</td>
            <td>${esc(c.designation)}</td>
            <td><span class="pill" data-tone="${c.authority === 'Decision Maker' ? 'success' : 'neutral'}">${esc(c.authority)}</span></td>
            <td><a href="#/companies/${attr(c.companyId)}">${esc(company?.name ?? '—')}</a></td>
            <td><a href="mailto:${attr(c.email)}">${esc(c.email)}</a></td>
            <td class="nowrap">${esc(c.phone)}</td>
            <td>${esc(c.city)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
}

export function contactsMount({ outlet }) {
  const rerender = () => import('../router.js').then((r) => r.render());
  let timer;
  const q = outlet.querySelector('#ct-q');
  q?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      contactState.q = q.value;
      rerender().then(() => document.querySelector('#ct-q')?.focus());
    }, 220);
  });
  outlet.querySelector('#ct-auth')?.addEventListener('change', (e) => {
    contactState.authority = e.target.value; rerender();
  });
}
