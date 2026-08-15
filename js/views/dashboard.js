/* ==========================================================================
   Command Center (§11) — the answer to "what needs attention right now?"
   ========================================================================== */

import * as store from '../store.js';
import { score, nextBestAction, money } from '../scoring.js';
import { esc, attr, icon, kpi, card, tempPill, fmtShort, dueInfo, tally,
         sumBy, emptyState, scoreDial } from '../ui.js';
import { funnel, hbars, columns, dataTable, donut } from '../charts.js';

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

/* Everything the Command Center shows is derived here once, so the KPIs, the
   funnel and the insight panel can never disagree with each other. */
export function analyse(leads) {
  const scored = leads.map((lead) => {
    const s = score(lead);
    return { ...lead, score: s.total, band: s.band, scoreDetail: s };
  });

  const open = scored.filter((l) => !['WON', 'LOST'].includes(l.stage));
  const qualified = scored.filter((l) => l.stage !== 'NEW' && l.stage !== 'LOST');
  const hot = scored.filter((l) => l.band === 'HOT' || l.band === 'STRATEGIC');
  const won = scored.filter((l) => l.stage === 'WON');
  const decided = scored.filter((l) => ['WON', 'LOST'].includes(l.stage));

  const today = new Date().toISOString().slice(0, 10);
  const due = open.filter((l) => l.nextFollowUp && l.nextFollowUp <= today);
  const overdue = due.filter((l) => l.nextFollowUp < today);

  /* Funnel stages nest — each is a subset of the one above — so the
     conversion percentages are real rates. */
  const fQualified = scored.filter((l) => l.stage !== 'NEW' && l.stage !== 'LOST');
  const fEngaged = fQualified.filter((l) =>
    ['ENGAGED', 'DEMO', 'PROPOSAL', 'NEGOTIATION', 'WON'].includes(l.stage));
  const fDemo = fEngaged.filter((l) => ['DEMO', 'PROPOSAL', 'NEGOTIATION', 'WON'].includes(l.stage));
  const fProposal = fDemo.filter((l) => ['PROPOSAL', 'NEGOTIATION', 'WON'].includes(l.stage));
  const fWon = fProposal.filter((l) => l.stage === 'WON');

  return {
    scored, open, qualified, hot, won, decided, due, overdue,
    pipelineValue: sumBy(open, (l) => l.value),
    wonValue: sumBy(won, (l) => l.value),
    avgScore: scored.length ? Math.round(sumBy(scored, (l) => l.score) / scored.length) : 0,
    conversion: pct(won.length, decided.length),
    qualificationRate: pct(qualified.length, scored.length),
    funnelStages: [
      { k: 'Captured', v: scored.length },
      { k: 'Qualified', v: fQualified.length },
      { k: 'Engaged', v: fEngaged.length },
      { k: 'Demo', v: fDemo.length },
      { k: 'Proposal', v: fProposal.length },
      { k: 'Won', v: fWon.length },
    ],
  };
}

/* §12 — every headline chart has to answer "so what?". These are computed
   from the same numbers on screen, never hand-written. */
function insights(a) {
  const out = [];
  const highIntent = a.hot.length;

  if (a.scored.length) {
    out.push({
      key: 'Lead quality',
      insight: `${pct(highIntent, a.scored.length)}% of captured leads are high-intent opportunities.`,
      why: `${highIntent} of ${a.scored.length} leads score 70 or above, which is where TEAL historically converts.`,
      action: highIntent
        ? { label: 'Review hot leads', href: '#/leads?band=HOT' }
        : { label: 'Review all leads', href: '#/leads' },
    });
  }

  const products = tally(a.scored, (l) => l.products);
  if (products.length) {
    const top = products[0];
    const topValue = sumBy(a.scored.filter((l) => l.products.includes(top.k)), (l) => l.value);
    out.push({
      key: 'Product demand',
      insight: `${top.k} generated the highest commercial interest.`,
      why: `Named by ${top.v} ${top.v === 1 ? 'visitor' : 'visitors'}, carrying ${money(topValue)} of open opportunity.`,
      action: { label: 'Open Product Intelligence', href: '#/products' },
    });
  }

  if (a.due.length) {
    const value = sumBy(a.due, (l) => l.value);
    out.push({
      key: 'Follow-up risk',
      insight: `${a.due.length} ${a.due.length === 1 ? 'opportunity requires' : 'opportunities require'} follow-up today.`,
      why: a.overdue.length
        ? `${a.overdue.length} already overdue, together worth ${money(value)}.`
        : `Together worth ${money(value)}. Nothing is overdue yet.`,
      action: { label: 'Open Follow-up Center', href: '#/followups' },
    });
  }

  const gaps = a.open.filter((l) => l.scoreDetail.rows.some((r) => r.key === 'authority' && !r.hit));
  if (gaps.length) {
    out.push({
      key: 'Qualification gap',
      insight: `${gaps.length} open ${gaps.length === 1 ? 'lead has' : 'leads have'} no decision maker attached.`,
      why: 'Opportunities without a named authority stall at proposal stage and cannot be forecast.',
      action: { label: 'Review those leads', href: '#/leads?gap=authority' },
    });
  }

  return out;
}

function insightPanel(rows) {
  if (!rows.length) return '';
  return `<div class="stack gap-3">${rows.map((row) => `
    <div class="insight">
      <p class="t-eyebrow">${esc(row.key)}</p>
      <p class="insight-head">${esc(row.insight)}</p>
      <dl class="insight-row">
        <dt>Why it matters</dt><dd>${esc(row.why)}</dd>
      </dl>
      <div><a class="btn btn-sec btn-sm" href="${attr(row.action.href)}">${esc(row.action.label)}</a></div>
    </div>`).join('')}</div>`;
}

function recentLeads(scored) {
  const rows = [...scored].sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1)).slice(0, 6);
  if (!rows.length) return '<p class="t-cap">No leads captured yet.</p>';
  return `<div class="stack gap-2">${rows.map((l) => `
    <a class="row gap-3" href="#/leads/${attr(l.id)}"
       style="padding:var(--sp-2);border-radius:var(--r-md);text-decoration:none;color:inherit">
      ${scoreDial(l.score, l.band, 38)}
      <span class="grow" style="min-width:0">
        <b class="truncate" style="display:block;font-size:var(--fs-sm)">${esc(l.contactName)}</b>
        <span class="truncate t-cap" style="display:block">${esc(l.companyName)}</span>
      </span>
      ${tempPill(l.band, l.scoreDetail.label)}
    </a>`).join('')}
    <a class="btn btn-sec btn-sm mt-2" href="#/leads">View all leads</a>`;
}

function todaysFollowUps(due) {
  if (!due.length) {
    return `<p class="t-cap">Nothing due today. Overdue and upcoming actions appear here.</p>`;
  }
  const rows = [...due].sort((a, b) => (a.nextFollowUp < b.nextFollowUp ? -1 : 1)).slice(0, 6);
  return `<div class="stack gap-2">${rows.map((l) => {
    const info = dueInfo(l.nextFollowUp);
    const nba = nextBestAction(l, l.scoreDetail);
    return `<a class="row gap-3" href="#/leads/${attr(l.id)}"
        style="padding:var(--sp-2);border-radius:var(--r-md);text-decoration:none;color:inherit">
      <span class="grow" style="min-width:0">
        <b class="truncate" style="display:block;font-size:var(--fs-sm)">${esc(l.companyName)}</b>
        <span class="truncate t-cap" style="display:block">${esc(nba.title)}</span>
      </span>
      <span class="pill" data-tone="${attr(info.tone)}">${esc(info.label)}</span>
    </a>`;
  }).join('')}
  <a class="btn btn-sec btn-sm mt-2" href="#/followups">Open Follow-up Center</a></div>`;
}

export function view() {
  const user = store.me();
  const leads = store.visibleLeads();
  const ex = store.activeExhibition();

  if (!leads.length) {
    return `<div class="page-head"><div>
        <h1>Command Center</h1>
        <p>Real-time view of exhibition performance, lead quality and sales opportunities.</p>
      </div></div>
      ${emptyState({
        title: 'No leads yet',
        body: 'Your next opportunity starts here. Capture a lead at the booth and the Command Center fills in.',
        actionLabel: 'Capture Lead', actionHref: '#/capture',
      })}`;
  }

  const a = analyse(leads);
  const byDay = tally(a.scored, (l) => l.capturedAt.slice(0, 10))
    .sort((x, y) => (x.k < y.k ? -1 : 1))
    .map((r) => ({ k: fmtShort(r.k), v: r.v }));
  const industries = tally(a.scored, (l) => l.industry).slice(0, 6);
  const products = tally(a.scored, (l) => l.products);
  const bands = ['STRATEGIC', 'HOT', 'WARM', 'COLD']
    .map((b) => ({ k: b.charAt(0) + b.slice(1).toLowerCase(),
                   v: a.scored.filter((l) => l.band === b).length }))
    .filter((r) => r.v);

  return `
    <div class="page-head">
      <div>
        <h1>Command Center</h1>
        <p>Real-time view of exhibition performance, lead quality and sales opportunities.</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-sec btn-sm" href="#/present">${icon('spark')} Presentation Mode</a>
        ${store.canWrite() ? `<a class="btn btn-sm" href="#/capture">${icon('plus')} Capture Lead</a>` : ''}
      </div>
    </div>

    <p class="t-cap" style="margin-bottom:var(--sp-4)">
      ${esc(user.name.split(' ')[0])} · ${esc(ex?.name ?? 'All exhibitions')} ·
      ${a.scored.length} ${a.scored.length === 1 ? 'lead' : 'leads'} visible to you
    </p>

    <div class="grid grid-4" style="margin-bottom:var(--sp-5)">
      ${kpi({ label: 'Total Leads', value: a.scored.length, href: '#/leads',
              hint: `${byDay.length} capture ${byDay.length === 1 ? 'day' : 'days'}` })}
      ${kpi({ label: 'Qualified Leads', value: a.qualified.length,
              hint: `${a.qualificationRate}% of captured`, href: '#/leads?stage=QUALIFIED' })}
      ${kpi({ label: 'Hot Leads', value: a.hot.length, href: '#/leads?band=HOT',
              hint: 'Score 70 or above', tone: 'var(--temp-hot)' })}
      ${kpi({ label: 'Follow-ups Due', value: a.due.length, href: '#/followups',
              hint: a.overdue.length ? `${a.overdue.length} overdue` : 'None overdue',
              tone: a.overdue.length ? 'var(--danger)' : undefined })}
      ${kpi({ label: 'Active Opportunities', value: a.open.length, href: '#/pipeline',
              hint: 'Open pipeline records' })}
      ${kpi({ label: 'Pipeline Value', value: money(a.pipelineValue), href: '#/pipeline',
              hint: 'Open opportunities' })}
      ${kpi({ label: 'Conversion Rate', value: `${a.conversion}%`,
              hint: `${a.won.length} won of ${a.decided.length} decided` })}
      ${kpi({ label: 'Average Lead Score', value: a.avgScore, hint: 'Out of 100' })}
    </div>

    <h2 class="t-h2" style="margin-bottom:var(--sp-3)">What this means</h2>
    ${insightPanel(insights(a))}

    <div class="grid grid-2 mt-6">
      ${card('Lead Funnel', funnel(a.funnelStages),
             { sub: 'Each stage is a subset of the one above it' })}
      ${card('Lead Quality Mix', donut(bands), { sub: 'By Lead Intelligence Score band' })}
      ${card('Leads Captured by Day', columns(byDay))}
      ${card('Product Interest', hbars(products, { limit: 8 }) + dataTable(products,
             { keyLabel: 'Product', valueLabel: 'Leads' }),
             { sub: 'Products named by visitors' })}
      ${card('Industry Mix', hbars(industries, { colored: true, limit: 6 }) +
             dataTable(industries, { keyLabel: 'Industry', valueLabel: 'Leads' }))}
      ${card('Recent Leads', recentLeads(a.scored))}
      ${card("Today's Follow-ups", todaysFollowUps(a.due))}
    </div>

    <h2 class="t-h2 mt-6" style="margin-bottom:var(--sp-3)">Quick actions</h2>
    <div class="grid grid-4">
      ${[
        ['Capture Lead', 'plus', '#/capture', store.canWrite()],
        ['Hot Leads', 'flame', '#/leads?band=HOT', true],
        ['Follow-ups', 'clock', '#/followups', true],
        ['Exhibition Report', 'chart', '#/exhibitions', true],
      ].filter(([, , , show]) => show).map(([label, ico, href]) => `
        <a class="kpi row gap-3" href="${attr(href)}" style="flex-direction:row;align-items:center">
          ${icon(ico)}<span style="font-weight:600">${esc(label)}</span>
        </a>`).join('')}
    </div>`;
}
