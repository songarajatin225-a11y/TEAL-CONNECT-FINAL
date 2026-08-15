/* ==========================================================================
   Lead Intelligence Score (§14).

   Deterministic, rule-based and fully transparent: every point is traceable
   to a stated input, and the UI shows the breakdown. This is NOT a machine
   learning model and the product must never imply that it is — hence the
   name "Rule-Based Lead Intelligence" wherever it is surfaced.

   Weights live in data/settings.json so they can be tuned without a code
   change. They sum to 100.
   ========================================================================== */

import { db } from './store.js';

/* Segments TEAL actually sells into, weighted by how well they fit. */
const INDUSTRY_FIT = {
  'Semiconductor': 1.0, 'Battery / EV': 1.0, 'EMS': 0.85, 'Electronics': 0.85,
  'Automotive': 0.8, 'Solar': 0.7, 'Medical Devices': 0.7, 'Aerospace': 0.65,
  'Precision Engineering': 0.65, 'Industrial Automation': 0.6,
};
const SIZE_FIT = { '5000+': 1.0, '1000-5000': 0.95, '200-1000': 0.8, '50-200': 0.6 };
const ACCOUNT_FIT = {
  'OEM': 1.0, 'Tier 1 Supplier': 0.95, 'Contract Manufacturer': 0.85,
  'EMS': 0.85, 'System Integrator': 0.7, 'Research Institute': 0.5,
};
const TIMELINE_FIT = {
  'Immediate': 1.0, '< 3 Months': 0.9, '3-6 Months': 0.65,
  '6-12 Months': 0.4, '> 12 Months': 0.2, 'Not Defined': 0,
};
const BUDGET_FIT = {
  '> ₹5 Cr': 1.0, '₹2 Cr – ₹5 Cr': 0.95, '₹75 L – ₹2 Cr': 0.8,
  '₹25 L – ₹75 L': 0.6, '< ₹25 L': 0.35, 'Not Defined': 0,
};
const AUTHORITY_FIT = {
  'Decision Maker': 1.0, 'Influencer': 0.7, 'End User': 0.4,
  'Gatekeeper': 0.3, 'Unknown': 0,
};

const clamp01 = (n) => Math.max(0, Math.min(1, n));

function weightsOf() {
  return db.settings?.scoring?.weights ?? [];
}
function bandsOf() {
  return db.settings?.scoring?.bands ?? [];
}

/* Each factor returns a 0..1 ratio plus the sentence shown in the breakdown. */
function factors(lead) {
  const company = lead.company ?? {};
  const products = lead.products ?? [];
  const engagement = lead.engagement ?? {};

  const industry = INDUSTRY_FIT[company.industry] ?? 0.4;
  const size = SIZE_FIT[company.size] ?? 0.5;
  const account = ACCOUNT_FIT[company.accountType] ?? 0.6;
  const companyFit = clamp01(industry * 0.6 + size * 0.2 + account * 0.2);

  const hasApplication = (lead.application || '').trim().length > 12;
  const hasProblem = (lead.problem || '').trim().length > 20;
  const applicationFit = clamp01((hasApplication ? 0.65 : 0) + (hasProblem ? 0.35 : 0));

  // Full marks need more than one capability named — a single product is a
  // passing interest, two or more is a scoped requirement.
  const productInterest = clamp01(products.length / 3);

  const timeline = TIMELINE_FIT[lead.timeline] ?? 0;
  const budget = BUDGET_FIT[lead.budget] ?? 0;
  const authority = AUTHORITY_FIT[lead.authority] ?? 0;

  const depth = ['demo', 'meeting', 'technical', 'commercial']
    .reduce((n, k) => n + (engagement[k] ? 1 : 0), 0);
  // All four interactions are what a fully worked booth conversation looks
  // like; three of four should not read as maximum engagement.
  const engagementFit = clamp01(depth / 4);

  return {
    companyFit: {
      ratio: companyFit,
      note: company.industry
        ? `${company.industry}, ${company.size || 'size unknown'}, ${company.accountType || 'type unknown'}`
        : 'Company profile incomplete',
    },
    applicationFit: {
      ratio: applicationFit,
      note: hasApplication ? lead.application : 'No specific application captured',
    },
    productInterest: {
      ratio: productInterest,
      note: products.length ? products.join(', ') : 'No product named',
    },
    timeline: {
      ratio: timeline,
      note: lead.timeline && lead.timeline !== 'Not Defined'
        ? `Requirement lands ${lead.timeline.toLowerCase()}` : 'Timeline not stated',
    },
    budget: {
      ratio: budget,
      note: lead.budget && lead.budget !== 'Not Defined'
        ? `Budget band ${lead.budget}` : 'No budget stated',
    },
    authority: {
      ratio: authority,
      note: lead.authority && lead.authority !== 'Unknown'
        ? `${lead.designation || 'Contact'} — ${lead.authority}` : 'Authority unknown',
    },
    engagement: {
      ratio: engagementFit,
      note: depth
        ? ['demo', 'meeting', 'technical', 'commercial']
            .filter((k) => engagement[k])
            .map((k) => ({ demo: 'Demo given', meeting: 'Meeting held',
                           technical: 'Technical discussion', commercial: 'Commercial discussion' }[k]))
            .join(', ')
        : 'Booth conversation only',
    },
  };
}

export function bandFor(total) {
  const bands = bandsOf();
  const hit = bands.find((b) => total >= b.min && total <= b.max);
  return hit ? hit.key : 'COLD';
}

export function bandLabel(key) {
  return bandsOf().find((b) => b.key === key)?.label ?? 'Cold';
}

/* The single entry point. Returns the total, the band and a per-factor
   breakdown the Lead 360 renders verbatim. */
export function score(lead) {
  const f = factors(lead);
  const rows = weightsOf().map((w) => {
    const factor = f[w.key] ?? { ratio: 0, note: '' };
    const points = Math.round(factor.ratio * w.max);
    return {
      key: w.key, label: w.label, max: w.max, points,
      ratio: factor.ratio, note: factor.note, why: w.why,
      hit: points > 0,
    };
  });
  const total = Math.max(0, Math.min(100, rows.reduce((sum, r) => sum + r.points, 0)));
  return { total, band: bandFor(total), label: bandLabel(bandFor(total)), rows };
}

/* The two or three lines shown under "Why this lead scored as it did". */
export function scoreReasons(scored) {
  const strong = scored.rows
    .filter((r) => r.ratio >= 0.65)
    .sort((a, b) => b.points - a.points)
    .slice(0, 4)
    .map((r) => r.note);
  const gaps = scored.rows
    .filter((r) => r.ratio === 0)
    .map((r) => r.note);
  return { strong, gaps };
}

/* ---- Next Best Action (§15) ---------------------------------------------
   Derived from stage and the gaps the score exposes, so the recommendation
   moves when the lead moves. */
const BY_STAGE = {
  NEW:         ['Qualify the requirement', 'Confirm application, volume and timeline while the conversation is fresh.'],
  QUALIFIED:   ['Schedule technical discussion', 'Bring an application engineer in to scope the process window.'],
  ENGAGED:     ['Arrange machine demo', 'Run their sample part on the target platform.'],
  DEMO:        ['Send capability deck and demo report', 'Turn the demo result into something they can circulate internally.'],
  PROPOSAL:    ['Follow up on proposal', 'Confirm receipt, walk the commercials and agree the next step.'],
  NEGOTIATION: ['Close commercial terms', 'Align on price, delivery and payment milestones.'],
  WON:         ['Hand over to project execution', 'Brief the delivery team and confirm the kickoff date.'],
  LOST:        ['Record the loss reason', 'Capture why it went elsewhere and set a re-engagement date.'],
};

export function nextBestAction(lead, scored) {
  const [title, why] = BY_STAGE[lead.stage] ?? BY_STAGE.NEW;

  // A blocking gap outranks the stage default: there is no point sending a
  // proposal to someone whose authority or budget is still unknown.
  if (lead.stage !== 'WON' && lead.stage !== 'LOST') {
    const gap = scored.rows.find((r) => r.ratio === 0);
    if (gap?.key === 'authority') {
      return { title: 'Identify the decision maker',
               why: 'Nobody with budget authority is attached to this opportunity yet.' };
    }
    if (gap?.key === 'timeline' && lead.stage !== 'NEW') {
      return { title: 'Pin down the timeline',
               why: 'Without a date this cannot be forecast or resourced.' };
    }
  }
  return { title, why };
}

/* Money formatting used across KPIs, pipeline and reports. Indian
   crore/lakh convention — a ₹1.8 Cr opportunity should not read 18000000. */
export function money(value) {
  const n = Number(value) || 0;
  if (n === 0) return '₹0';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(n >= 100000000 ? 0 : 2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(n >= 10000000 ? 0 : 1)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}
