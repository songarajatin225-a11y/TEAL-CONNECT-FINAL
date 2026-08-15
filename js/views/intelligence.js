/* ==========================================================================
   Exhibition Intelligence (§19), Product Intelligence (§20), Analytics (§23),
   Team Performance (§24), Follow-up Center (§18).
   ========================================================================== */

import * as store from '../store.js';
import { score, money } from '../scoring.js';
import { esc, attr, icon, card, kpi, tempPill, stagePill, scoreDial, fmtDate, fmtShort,
         dueInfo, tally, sumBy, emptyState, toast, initials } from '../ui.js';
import { hbars, funnel, columns, donut, groupedBars, dataTable, legend } from '../charts.js';
import { analyse } from './dashboard.js';

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

function enrich(leads) {
  return leads.map((l) => {
    const s = score(l);
    return { ...l, score: s.total, band: s.band, bandLabel: s.label, scoreDetail: s };
  });
}

/* ---- Follow-up Center (§18) ---------------------------------------------- */
export function followupsView() {
  const today = new Date().toISOString().slice(0, 10);
  const all = enrich(store.visibleLeads()).filter((l) => !['WON', 'LOST'].includes(l.stage));
  const dated = all.filter((l) => l.nextFollowUp);

  const overdue = dated.filter((l) => l.nextFollowUp < today);
  const dueToday = dated.filter((l) => l.nextFollowUp === today);
  const upcoming = dated.filter((l) => l.nextFollowUp > today)
    .sort((a, b) => (a.nextFollowUp < b.nextFollowUp ? -1 : 1)).slice(0, 20);
  const highValue = [...all].sort((a, b) => b.value - a.value)
    .filter((l) => l.value > 0).slice(0, 8);

  if (!dated.length && !all.length) {
    return `<div class="page-head"><div><h1>Follow-up Center</h1>
      <p>Everything owed, ordered by urgency.</p></div></div>
      ${emptyState({ title: 'Nothing to follow up',
        body: 'Follow-ups appear here as soon as leads are captured.',
        actionLabel: 'Capture Lead', actionHref: '#/capture', iconName: 'clock' })}`;
  }

  const row = (l) => {
    const info = dueInfo(l.nextFollowUp);
    return `<div class="row gap-3" style="padding:var(--sp-3) 0;border-bottom:1px solid var(--border-subtle);flex-wrap:wrap">
      ${scoreDial(l.score, l.band, 38)}
      <a class="grow" href="#/leads/${attr(l.id)}" style="min-width:160px;text-decoration:none;color:inherit">
        <b class="truncate" style="display:block;font-size:var(--fs-sm)">${esc(l.companyName)}</b>
        <span class="truncate t-cap" style="display:block">${esc(l.contactName)} · ${esc(l.nextBestAction || 'Follow up')}</span>
      </a>
      <span class="t-num t-cap">${esc(money(l.value))}</span>
      ${stagePill(l.stage)}
      <span class="pill" data-tone="${attr(info.tone)}">${esc(info.label)}</span>
      ${store.canWrite() ? `<span class="row gap-1">
        <button class="btn btn-sec btn-sm" data-complete="${attr(l.id)}">Complete</button>
        <button class="btn btn-ghost btn-sm" data-snooze="${attr(l.id)}">+3d</button>
      </span>` : ''}
      ${l.phone ? `<a class="btn btn-ghost btn-sm" href="tel:${attr(l.phone)}" aria-label="Call ${attr(l.contactName)}">${icon('phone')}</a>` : ''}
      ${l.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${attr(l.email)}" aria-label="Email ${attr(l.contactName)}">${icon('mail')}</a>` : ''}
    </div>`;
  };

  const section = (title, rows, tone, note) => card(title,
    rows.length ? rows.map(row).join('') : `<p class="t-cap">${esc(note)}</p>`,
    { sub: `${rows.length} ${rows.length === 1 ? 'action' : 'actions'}`, cls: 'span-2' });

  return `
    <div class="page-head">
      <div><h1>Follow-up Center</h1>
        <p>${overdue.length} overdue · ${dueToday.length} due today ·
           ${money(sumBy([...overdue, ...dueToday], (l) => l.value))} at risk.</p></div>
    </div>

    <div class="grid grid-4" style="margin-bottom:var(--sp-5)">
      ${kpi({ label: 'Overdue', value: overdue.length,
              tone: overdue.length ? 'var(--danger)' : undefined,
              hint: money(sumBy(overdue, (l) => l.value)) })}
      ${kpi({ label: 'Due Today', value: dueToday.length,
              hint: money(sumBy(dueToday, (l) => l.value)) })}
      ${kpi({ label: 'Upcoming', value: upcoming.length, hint: 'Next 20 scheduled' })}
      ${kpi({ label: 'High Value', value: highValue.length,
              hint: money(sumBy(highValue, (l) => l.value)) })}
    </div>

    <div class="grid grid-2">
      ${section('Overdue', overdue, 'danger', 'Nothing overdue. Good.')}
      ${section('Today', dueToday, 'warning', 'Nothing due today.')}
      ${section('Upcoming', upcoming, 'info', 'Nothing scheduled ahead.')}
      ${section('High value', highValue, 'info', 'No valued opportunities open.')}
    </div>`;
}

export function followupsMount({ outlet }) {
  const rerender = () => import('../router.js').then((r) => r.render());
  outlet.querySelectorAll('[data-complete]').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.dataset.complete;
    store.logActivity(id, 'call', 'Follow-up completed', '');
    const next = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    store.updateLead(id, { nextFollowUp: next }, 'follow-up completed, next in 7d');
    toast('Marked complete — next follow-up in 7 days');
    rerender();
  }));
  outlet.querySelectorAll('[data-snooze]').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.dataset.snooze;
    const lead = store.getLead(id);
    const base = lead.nextFollowUp ? new Date(lead.nextFollowUp) : new Date();
    const next = new Date(base.getTime() + 3 * 86400000).toISOString().slice(0, 10);
    store.updateLead(id, { nextFollowUp: next }, `rescheduled to ${next}`);
    toast(`Rescheduled to ${fmtDate(next)}`);
    rerender();
  }));
}

/* ---- Exhibition Intelligence (§19) --------------------------------------- */
const exState = { compare: false };

function exhibitionRoll(ex) {
  const leads = enrich(store.visibleLeads().filter((l) => l.exhibitionId === ex.id));
  const a = analyse(leads);
  const demos = leads.filter((l) => l.engagement?.demo).length;
  const meetings = leads.filter((l) => l.engagement?.meeting).length;
  return {
    ...ex, leads, name: ex.name,
    leadCount: leads.length,
    qualified: a.qualified.length,
    hot: a.hot.length,
    demos, meetings,
    opportunities: a.open.length,
    pipeline: a.pipelineValue,
    conversion: a.conversion,
    costPerLead: leads.length ? Math.round(ex.boothCost / leads.length) : 0,
    roi: ex.boothCost ? Math.round((a.pipelineValue / ex.boothCost) * 100) : 0,
    analysis: a,
  };
}

export function exhibitionsView({ params }) {
  const rolls = store.db.exhibitions.map(exhibitionRoll);
  const compare = params.compare === '1' || exState.compare;

  if (!rolls.some((r) => r.leadCount)) {
    return `<div class="page-head"><div><h1>Exhibition Intelligence</h1>
      <p>What each event actually produced.</p></div></div>
      ${emptyState({ title: 'No exhibition data yet',
        body: 'Capture leads at an event and its performance appears here.',
        actionLabel: 'Capture Lead', actionHref: '#/capture', iconName: 'calendar' })}`;
  }

  if (compare) {
    const withLeads = rolls.filter((r) => r.leadCount);
    return `
      <div class="page-head">
        <div><h1>Exhibition Comparison</h1>
          <p>${withLeads.length} events side by side.</p></div>
        <div class="page-actions">
          <a class="btn btn-sec btn-sm" href="#/exhibitions">Back to overview</a>
        </div>
      </div>

      <div class="tablewrap" style="margin-bottom:var(--sp-5)">
        <table class="data">
          <caption>Every measure, per exhibition</caption>
          <thead><tr>
            <th scope="col">Exhibition</th><th scope="col">Dates</th>
            <th scope="col" class="num">Visitors</th><th scope="col" class="num">Leads</th>
            <th scope="col" class="num">Qualified</th><th scope="col" class="num">Hot</th>
            <th scope="col" class="num">Demos</th><th scope="col" class="num">Meetings</th>
            <th scope="col" class="num">Pipeline</th><th scope="col" class="num">Conversion</th>
            <th scope="col" class="num">Cost / lead</th>
          </tr></thead>
          <tbody>${withLeads.map((r) => `<tr>
            <td><a href="#/exhibitions/${attr(r.id)}"><b>${esc(r.name)}</b></a>
              <span class="t-cap" style="display:block">${esc(r.city)}</span></td>
            <td class="nowrap">${esc(fmtShort(r.start))} – ${esc(fmtShort(r.end))}</td>
            <td class="num">${r.visitors.toLocaleString('en-IN')}</td>
            <td class="num">${r.leadCount}</td>
            <td class="num">${r.qualified}</td>
            <td class="num">${r.hot}</td>
            <td class="num">${r.demos}</td>
            <td class="num">${r.meetings}</td>
            <td class="num">${esc(money(r.pipeline))}</td>
            <td class="num">${r.conversion}%</td>
            <td class="num">${esc(money(r.costPerLead))}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>

      <div class="grid grid-2">
        ${card('Leads captured', groupedBars(withLeads, 'leadCount'))}
        ${card('Qualified leads', groupedBars(withLeads, 'qualified'))}
        ${card('Pipeline generated', `<div class="hbars">${withLeads.map((r, i) => {
          const max = Math.max(...withLeads.map((x) => x.pipeline), 1);
          return `<div class="hbar">
            <span class="hbar-label">${esc(r.name)}</span>
            <span class="hbar-track"><span class="hbar-fill"
              style="width:${Math.max(2, Math.round((r.pipeline / max) * 100))}%;background:var(--chart-${i + 1})"></span></span>
            <span class="hbar-val">${esc(money(r.pipeline))}</span></div>`;
        }).join('')}</div>`)}
        ${card('Cost per lead', `<div class="hbars">${withLeads.map((r, i) => {
          const max = Math.max(...withLeads.map((x) => x.costPerLead), 1);
          return `<div class="hbar">
            <span class="hbar-label">${esc(r.name)}</span>
            <span class="hbar-track"><span class="hbar-fill"
              style="width:${Math.max(2, Math.round((r.costPerLead / max) * 100))}%;background:var(--chart-${i + 1})"></span></span>
            <span class="hbar-val">${esc(money(r.costPerLead))}</span></div>`;
        }).join('')}</div>`, { sub: 'Lower is better' })}
      </div>`;
  }

  return `
    <div class="page-head">
      <div><h1>Exhibition Intelligence</h1>
        <p>What each event actually produced, not just how many badges were scanned.</p></div>
      <div class="page-actions">
        <a class="btn btn-sec btn-sm" href="#/exhibitions?compare=1">Compare exhibitions</a>
      </div>
    </div>

    <div class="grid grid-2">${rolls.map((r) => `
      <section class="card">
        <div class="card-head">
          <div>
            <h3>${esc(r.name)}</h3>
            <p class="card-sub">${esc(r.venue)} · ${esc(fmtDate(r.start))} – ${esc(fmtDate(r.end))}</p>
          </div>
          ${r.active ? '<span class="pill" data-tone="success">Active</span>' : ''}
        </div>
        ${r.leadCount ? `
          <div class="grid grid-4" style="gap:var(--sp-2);margin-bottom:var(--sp-3)">
            ${[['Leads', r.leadCount], ['Qualified', r.qualified], ['Hot', r.hot],
               ['Demos', r.demos], ['Meetings', r.meetings], ['Opportunities', r.opportunities],
               ['Pipeline', money(r.pipeline)], ['Cost / lead', money(r.costPerLead)]]
              .map(([label, value]) => `<div>
                <span class="t-eyebrow" style="display:block">${esc(label)}</span>
                <b class="t-num" style="font-size:var(--fs-h2)">${esc(value)}</b></div>`).join('')}
          </div>
          ${funnel(r.analysis.funnelStages)}
          <p class="t-cap mt-3">${r.visitors.toLocaleString('en-IN')} visitors ·
            ${pct(r.leadCount, r.visitors)}% capture rate ·
            ${r.roi}% of booth cost returned as pipeline</p>
          <a class="btn btn-sec btn-sm mt-3" href="#/exhibitions/${attr(r.id)}">Full report</a>
        ` : '<p class="t-cap">No leads captured at this event.</p>'}
      </section>`).join('')}</div>`;
}

export function exhibitionDetailView({ id }) {
  const ex = store.getExhibition(id);
  if (!ex) {
    return emptyState({ title: 'Exhibition not found', body: 'That event is not in the record.',
      actionLabel: 'All exhibitions', actionHref: '#/exhibitions', iconName: 'warn' });
  }
  const r = exhibitionRoll(ex);
  const products = tally(r.leads, (l) => l.products);
  const industries = tally(r.leads, (l) => l.industry);
  const cities = tally(r.leads, (l) => l.city);
  const owners = tally(r.leads, (l) => l.owner?.name);
  const byDay = tally(r.leads, (l) => l.capturedAt.slice(0, 10))
    .sort((a, b) => (a.k < b.k ? -1 : 1)).map((x) => ({ k: fmtShort(x.k), v: x.v }));

  return `
    <a class="t-cap row gap-1" href="#/exhibitions" style="margin-bottom:var(--sp-3);display:inline-flex">
      ${icon('chevronL', 'ico')} All exhibitions</a>

    <div class="page-head">
      <div><h1>${esc(ex.name)}</h1>
        <p>${esc(ex.venue)} · ${esc(fmtDate(ex.start))} – ${esc(fmtDate(ex.end))}</p></div>
      <div class="page-actions">
        <button class="btn btn-sec btn-sm" id="print-report">${icon('download')} Print / PDF</button>
      </div>
    </div>

    <div class="grid grid-4" style="margin-bottom:var(--sp-5)">
      ${kpi({ label: 'Visitors', value: r.visitors.toLocaleString('en-IN'), hint: 'Event footfall' })}
      ${kpi({ label: 'Leads Captured', value: r.leadCount, hint: `${pct(r.leadCount, r.visitors)}% of visitors` })}
      ${kpi({ label: 'Qualified', value: r.qualified, hint: `${pct(r.qualified, r.leadCount)}% of leads` })}
      ${kpi({ label: 'Hot Leads', value: r.hot, tone: 'var(--temp-hot)', hint: 'Score 70+' })}
      ${kpi({ label: 'Demos Given', value: r.demos })}
      ${kpi({ label: 'Meetings Held', value: r.meetings })}
      ${kpi({ label: 'Pipeline Generated', value: money(r.pipeline), hint: `${r.roi}% of booth cost` })}
      ${kpi({ label: 'Cost per Lead', value: money(r.costPerLead), hint: `Booth ${money(ex.boothCost)}` })}
    </div>

    <div class="grid grid-2">
      ${card('Lead funnel', funnel(r.analysis.funnelStages))}
      ${card('Lead volume by day', columns(byDay))}
      ${card('Product demand', hbars(products, { limit: 10 }) +
             dataTable(products, { keyLabel: 'Product', valueLabel: 'Leads' }))}
      ${card('Industry mix', hbars(industries, { colored: true, limit: 8 }) +
             dataTable(industries, { keyLabel: 'Industry', valueLabel: 'Leads' }))}
      ${card('Geography', hbars(cities, { limit: 8 }))}
      ${card('Capture by salesperson', hbars(owners, { limit: 8 }))}
    </div>`;
}

export function exhibitionDetailMount({ outlet }) {
  outlet.querySelector('#print-report')?.addEventListener('click', () => window.print());
}

/* ---- Product Intelligence (§20) ------------------------------------------ */
export function productsView() {
  const leads = enrich(store.visibleLeads());
  const rows = store.db.products.map((p) => {
    const mine = leads.filter((l) => (l.products || []).includes(p.name));
    const open = mine.filter((l) => !['WON', 'LOST'].includes(l.stage));
    const won = mine.filter((l) => l.stage === 'WON');
    const decided = mine.filter((l) => ['WON', 'LOST'].includes(l.stage));
    return {
      ...p, leads: mine,
      count: mine.length,
      qualified: mine.filter((l) => l.stage !== 'NEW' && l.stage !== 'LOST').length,
      demos: mine.filter((l) => l.engagement?.demo).length,
      opportunities: open.length,
      pipeline: sumBy(open, (l) => l.value),
      conversion: pct(won.length, decided.length),
      industries: tally(mine, (l) => l.industry).slice(0, 3),
      cities: tally(mine, (l) => l.city).slice(0, 3),
    };
  }).sort((a, b) => b.pipeline - a.pipeline || b.count - a.count);

  const withDemand = rows.filter((r) => r.count);
  if (!withDemand.length) {
    return `<div class="page-head"><div><h1>Product Intelligence</h1>
      <p>Which capabilities the market actually asked for.</p></div></div>
      ${emptyState({ title: 'No product demand recorded',
        body: 'Product interest is captured with each lead.',
        actionLabel: 'Capture Lead', actionHref: '#/capture', iconName: 'box' })}`;
  }

  const byOpportunity = withDemand.slice(0, 8).map((r) => ({ k: r.name, v: r.opportunities }));
  const byCategory = tally(leads.flatMap((l) => (l.productIds || [])
    .map((id) => store.getProduct(id)?.category).filter(Boolean)), (x) => x);

  return `
    <div class="page-head">
      <div><h1>Product Intelligence</h1>
        <p>${withDemand.length} of ${rows.length} products drew interest ·
           ${money(sumBy(withDemand, (r) => r.pipeline))} total pipeline.</p></div>
    </div>

    <div class="grid grid-2" style="margin-bottom:var(--sp-5)">
      ${card('Top products by commercial opportunity',
        hbars(byOpportunity, { limit: 8 }) +
        dataTable(byOpportunity, { keyLabel: 'Product', valueLabel: 'Opportunities' }),
        { sub: 'Open opportunities, not raw lead count' })}
      ${card('Demand by category', byCategory.length ? donut(byCategory) : '<p class="t-cap">No data.</p>')}
    </div>

    <div class="tablewrap">
      <table class="data">
        <caption>Every product, with the demand it generated</caption>
        <thead><tr>
          <th scope="col">Product</th><th scope="col">Category</th>
          <th scope="col" class="num">Leads</th><th scope="col" class="num">Qualified</th>
          <th scope="col" class="num">Demos</th><th scope="col" class="num">Opportunities</th>
          <th scope="col" class="num">Pipeline</th><th scope="col" class="num">Conversion</th>
          <th scope="col">Top industries</th>
        </tr></thead>
        <tbody>${rows.map((r) => `<tr${r.count ? '' : ' style="opacity:.55"'}>
          <td><b>${esc(r.name)}</b><span class="t-cap" style="display:block">${esc(r.family)}</span></td>
          <td><span class="pill" data-tone="neutral">${esc(r.category)}</span></td>
          <td class="num">${r.count}</td>
          <td class="num">${r.qualified}</td>
          <td class="num">${r.demos}</td>
          <td class="num">${r.opportunities}</td>
          <td class="num">${esc(money(r.pipeline))}</td>
          <td class="num">${r.count ? `${r.conversion}%` : '—'}</td>
          <td>${r.industries.map((i) => `<span class="tag">${esc(i.k)}</span>`).join(' ') || '—'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

/* ---- Analytics (§23) ----------------------------------------------------- */
const RANGES = [['all', 'All time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'],
                ['90', 'Quarter'], ['365', 'Year']];
const anState = { range: 'all', exhibition: '', owner: '', product: '', band: '' };

export function analyticsView({ params }) {
  for (const key of ['range', 'exhibition', 'owner', 'product', 'band']) {
    if (params[key] !== undefined) anState[key] = params[key];
  }

  const all = enrich(store.visibleLeads());
  const cutoff = anState.range === 'all'
    ? null
    : new Date(Date.now() - Number(anState.range) * 86400000).toISOString();

  const rows = all.filter((l) => {
    if (cutoff && l.capturedAt < cutoff) return false;
    if (anState.exhibition && l.exhibitionId !== anState.exhibition) return false;
    if (anState.owner && l.ownerId !== anState.owner) return false;
    if (anState.product && !(l.products || []).includes(anState.product)) return false;
    if (anState.band && l.band !== anState.band) return false;
    return true;
  });

  const a = analyse(rows);
  const filtered = Object.entries(anState).some(([k, v]) => v && v !== 'all');
  const products = [...new Set(all.flatMap((l) => l.products || []))].sort();
  const owners = store.db.users.filter((u) => all.some((l) => l.ownerId === u.id));
  const sel = (v, cur) => (v === cur ? ' selected' : '');

  const byDay = tally(rows, (l) => l.capturedAt.slice(0, 10))
    .sort((x, y) => (x.k < y.k ? -1 : 1)).map((x) => ({ k: fmtShort(x.k), v: x.v }));
  const industries = tally(rows, (l) => l.industry);
  const productDemand = tally(rows, (l) => l.products);
  const teamRows = tally(rows, (l) => l.owner?.name);
  const velocity = rows.filter((l) => ['WON', 'LOST'].includes(l.stage));
  const avgVelocity = velocity.length
    ? Math.round(velocity.reduce((n, l) => {
        const acts = store.db.activities.filter((x) => x.leadId === l.id);
        if (acts.length < 2) return n;
        return n + Math.max(0, Math.round(
          (new Date(acts[acts.length - 1].at) - new Date(l.capturedAt)) / 86400000));
      }, 0) / velocity.length)
    : 0;

  return `
    <div class="page-head">
      <div><h1>Business Intelligence</h1>
        <p>${rows.length} of ${all.length} leads in view${filtered ? ' after filters' : ''}.</p></div>
      <div class="page-actions">
        <button class="btn btn-sec btn-sm" id="an-print">${icon('download')} Print / PDF</button>
      </div>
    </div>

    <div class="filterbar">
      <label class="field"><span>Period</span>
        <select class="select" id="an-range">${RANGES.map(([v, l]) =>
          `<option value="${v}"${sel(v, anState.range)}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Exhibition</span>
        <select class="select" id="an-exhibition"><option value="">All exhibitions</option>
          ${store.db.exhibitions.map((e) =>
            `<option value="${attr(e.id)}"${sel(e.id, anState.exhibition)}>${esc(e.name)}</option>`).join('')}
        </select></label>
      <label class="field"><span>Product</span>
        <select class="select" id="an-product"><option value="">All products</option>
          ${products.map((p) => `<option value="${attr(p)}"${sel(p, anState.product)}>${esc(p)}</option>`).join('')}
        </select></label>
      ${owners.length > 1 ? `<label class="field"><span>Salesperson</span>
        <select class="select" id="an-owner"><option value="">All salespeople</option>
          ${owners.map((u) => `<option value="${attr(u.id)}"${sel(u.id, anState.owner)}>${esc(u.name)}</option>`).join('')}
        </select></label>` : ''}
      <label class="field"><span>Temperature</span>
        <select class="select" id="an-band"><option value="">All</option>
          ${['STRATEGIC', 'HOT', 'WARM', 'COLD'].map((b) =>
            `<option value="${attr(b)}"${sel(b, anState.band)}>${esc(b.charAt(0) + b.slice(1).toLowerCase())}</option>`).join('')}
        </select></label>
      ${filtered ? '<button class="btn btn-sec btn-sm" id="an-clear">Clear filters</button>' : ''}
    </div>

    ${!rows.length ? emptyState({
      title: 'No leads match these filters',
      body: 'Widen the period or clear a filter.', actionLabel: 'Clear filters', actionHref: '#/analytics',
    }) : `
    <div class="grid grid-4" style="margin-bottom:var(--sp-5)">
      ${kpi({ label: 'Lead Acquisition', value: rows.length, hint: `${byDay.length} active days` })}
      ${kpi({ label: 'Qualification Rate', value: `${a.qualificationRate}%`,
              hint: `${a.qualified.length} qualified` })}
      ${kpi({ label: 'Conversion Rate', value: `${a.conversion}%`,
              hint: `${a.won.length} of ${a.decided.length} decided` })}
      ${kpi({ label: 'Pipeline Value', value: money(a.pipelineValue), hint: `${a.open.length} open` })}
      ${kpi({ label: 'Won Business', value: money(a.wonValue), hint: `${a.won.length} closed won` })}
      ${kpi({ label: 'Average Lead Score', value: a.avgScore, hint: 'Out of 100' })}
      ${kpi({ label: 'Opportunity Velocity', value: `${avgVelocity}d`,
              hint: 'Capture to decision' })}
      ${kpi({ label: 'Hot Leads', value: a.hot.length, tone: 'var(--temp-hot)',
              hint: `${pct(a.hot.length, rows.length)}% of captured` })}
    </div>

    <div class="grid grid-2">
      ${card('Lead funnel', funnel(a.funnelStages))}
      ${card('Lead acquisition over time', columns(byDay))}
      ${card('Product demand', hbars(productDemand, { limit: 10 }) +
             dataTable(productDemand, { keyLabel: 'Product', valueLabel: 'Leads' }))}
      ${card('Industry demand', hbars(industries, { colored: true, limit: 8 }) +
             dataTable(industries, { keyLabel: 'Industry', valueLabel: 'Leads' }))}
      ${card('Team performance', hbars(teamRows, { limit: 8 }))}
      ${card('Quality mix', donut(['STRATEGIC', 'HOT', 'WARM', 'COLD']
        .map((b) => ({ k: b.charAt(0) + b.slice(1).toLowerCase(),
                       v: rows.filter((l) => l.band === b).length }))
        .filter((x) => x.v)))}
    </div>`}`;
}

export function analyticsMount({ outlet }) {
  const rerender = () => import('../router.js').then((r) => r.render());
  for (const [id, key] of [['#an-range', 'range'], ['#an-exhibition', 'exhibition'],
                           ['#an-product', 'product'], ['#an-owner', 'owner'], ['#an-band', 'band']]) {
    outlet.querySelector(id)?.addEventListener('change', (e) => {
      anState[key] = e.target.value; rerender();
    });
  }
  outlet.querySelector('#an-clear')?.addEventListener('click', () => {
    Object.assign(anState, { range: 'all', exhibition: '', owner: '', product: '', band: '' });
    rerender();
  });
  outlet.querySelector('#an-print')?.addEventListener('click', () => window.print());
}

/* ---- Team Performance (§24) ---------------------------------------------- */
export function teamView() {
  const all = enrich(store.visibleLeads());
  const acts = store.db.activities;

  const rows = store.db.users.filter((u) => u.role !== 'management').map((u) => {
    const mine = all.filter((l) => l.ownerId === u.id);
    const open = mine.filter((l) => !['WON', 'LOST'].includes(l.stage));
    const won = mine.filter((l) => l.stage === 'WON');
    const decided = mine.filter((l) => ['WON', 'LOST'].includes(l.stage));
    const contacted = mine.filter((l) => acts.some((a) => a.leadId === l.id && a.type !== 'lead_captured'));
    const today = new Date().toISOString().slice(0, 10);
    const overdue = open.filter((l) => l.nextFollowUp && l.nextFollowUp < today);

    // First touch after capture, averaged — the number that actually predicts
    // whether an exhibition lead converts.
    const responseTimes = mine.map((l) => {
      const first = acts.filter((a) => a.leadId === l.id && a.type !== 'lead_captured')
        .sort((a, b) => (a.at < b.at ? -1 : 1))[0];
      if (!first) return null;
      return Math.max(0, Math.round((new Date(first.at) - new Date(l.capturedAt)) / 86400000));
    }).filter((n) => n !== null);

    return {
      user: u, assigned: mine.length, contacted: contacted.length,
      qualified: mine.filter((l) => l.stage !== 'NEW' && l.stage !== 'LOST').length,
      opportunities: open.length,
      pipeline: sumBy(open, (l) => l.value),
      conversion: pct(won.length, decided.length),
      overdue: overdue.length,
      responseDays: responseTimes.length
        ? Math.round((responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) * 10) / 10
        : null,
      avgScore: mine.length ? Math.round(sumBy(mine, (l) => l.score) / mine.length) : 0,
    };
  }).filter((r) => r.assigned).sort((a, b) => b.pipeline - a.pipeline);

  if (!rows.length) {
    return `<div class="page-head"><div><h1>Team</h1>
      <p>How the booth team is converting what it captures.</p></div></div>
      ${emptyState({ title: 'No assigned leads yet', body: 'Assign leads to see performance.',
        actionLabel: 'Open Leads', actionHref: '#/leads', iconName: 'team' })}`;
  }

  const totalOverdue = sumBy(rows, (r) => r.overdue);

  return `
    <div class="page-head">
      <div><h1>Team</h1>
        <p>${rows.length} people · ${money(sumBy(rows, (r) => r.pipeline))} open pipeline${
          totalOverdue ? ` · ${totalOverdue} overdue actions` : ''}.</p></div>
    </div>

    ${totalOverdue ? `<div class="insight" style="margin-bottom:var(--sp-5)">
      <p class="t-eyebrow">Response risk</p>
      <p class="insight-head">${totalOverdue} follow-ups are past their date across the team.</p>
      <dl class="insight-row"><dt>Why it matters</dt>
        <dd>Exhibition leads decay quickly; the first touch is what separates a captured badge from an opportunity.</dd></dl>
      <div><a class="btn btn-sec btn-sm" href="#/followups">Open Follow-up Center</a></div>
    </div>` : ''}

    <div class="grid grid-2">${rows.map((r) => `
      <section class="card">
        <div class="row gap-3">
          <span class="avatar" style="width:40px;height:40px" aria-hidden="true">${esc(initials(r.user.name))}</span>
          <span class="grow" style="min-width:0">
            <b class="truncate" style="display:block">${esc(r.user.name)}</b>
            <span class="t-cap truncate" style="display:block">${esc(r.user.title)}</span>
          </span>
          ${r.overdue ? `<span class="pill" data-tone="danger">${r.overdue} overdue</span>` : ''}
        </div>
        <div class="grid grid-4" style="gap:var(--sp-2);margin-top:var(--sp-4)">
          ${[['Assigned', r.assigned], ['Contacted', r.contacted], ['Qualified', r.qualified],
             ['Opportunities', r.opportunities], ['Pipeline', money(r.pipeline)],
             ['Conversion', `${r.conversion}%`], ['Avg score', r.avgScore],
             ['Response', r.responseDays === null ? '—' : `${r.responseDays}d`]]
            .map(([label, value]) => `<div>
              <span class="t-eyebrow" style="display:block">${esc(label)}</span>
              <b class="t-num" style="font-size:var(--fs-h3)">${esc(value)}</b></div>`).join('')}
        </div>
        <div class="mt-4">
          ${hbars([{ k: 'Contacted', v: r.contacted }, { k: 'Qualified', v: r.qualified },
                   { k: 'Opportunities', v: r.opportunities }], { max: r.assigned })}
          <p class="t-cap mt-2">Out of ${r.assigned} assigned</p>
        </div>
      </section>`).join('')}</div>`;
}
