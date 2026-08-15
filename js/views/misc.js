/* ==========================================================================
   Sign-in, Settings, Presentation Mode (§45) and the not-found screen.
   ========================================================================== */

import * as store from '../store.js';
import { score, money } from '../scoring.js';
import { esc, attr, icon, card, kpi, tempPill, scoreDial, fmtDateTime, fmtDate,
         tally, sumBy, toast, confirmAction, initials, emptyState } from '../ui.js';
import { funnel, hbars, donut } from '../charts.js';
import { go } from '../router.js';
import { analyse } from './dashboard.js';

/* ---- sign in ------------------------------------------------------------- */
export function signinView() {
  const p = store.db.settings.product;
  return `<div style="display:grid;place-items:center;min-height:80dvh;padding:var(--sp-4)">
    <div style="width:min(460px,100%)">
      <div style="text-align:center;margin-bottom:var(--sp-6)">
        <img src="./assets/teal-logo.svg" alt="TEAL — A TATA Enterprise"
          style="width:190px;margin-bottom:var(--sp-5)">
        <h1 class="t-h1">${esc(p.productName)}</h1>
        <p class="t-sm dim mt-2">${esc(p.descriptor)}</p>
        <p class="t-cap mt-2" style="color:var(--brand-600);font-weight:600">${esc(p.promise)}</p>
      </div>

      <div class="card">
        <p class="t-eyebrow">Choose an account</p>
        <div class="stack gap-2 mt-3">
          ${store.db.users.filter((u) => u.active).map((u) => `
            <button class="chip row gap-3" style="width:100%" data-user="${attr(u.id)}">
              <span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span>
              <span class="grow" style="min-width:0;text-align:left">
                <b style="display:block">${esc(u.name)}</b>
                <span class="t-cap">${esc(u.title)}</span>
              </span>
              <span class="pill" data-tone="${
                u.role === 'admin' ? 'info' : u.role === 'management' ? 'neutral' : 'success'}">
                ${esc(u.role)}</span>
            </button>`).join('')}
        </div>
        <p class="t-cap mt-4">There is no password because this build has no authentication
          server. Roles still govern what each account can see and do.</p>
      </div>
    </div>
  </div>`;
}

export function signinMount({ outlet }) {
  outlet.querySelectorAll('[data-user]').forEach((btn) => btn.addEventListener('click', () => {
    store.signIn(btn.dataset.user);
    import('../shell.js').then((s) => s.renderAll());
    go('/dashboard');
    toast(`Signed in as ${store.me().name}`);
  }));
}

/* ---- settings ------------------------------------------------------------ */
export function settingsView({ params }) {
  const tab = params.tab || 'scoring';
  const s = store.db.settings;
  const tabs = [['scoring', 'Lead Intelligence'], ['brand', 'Brand & product'],
                ['data', 'Data & storage'], ['audit', 'Audit log']];

  const body = {
    scoring: () => `
      ${card('Scoring weights', `
        <p class="t-sm dim">Every lead is scored out of 100 by the same published rules.
          This is deterministic logic, not a model — there is no hidden input and no
          external service involved.</p>
        <div class="tablewrap mt-4">
          <table class="data" style="min-width:0">
            <thead><tr><th scope="col">Factor</th><th scope="col">What it measures</th>
              <th scope="col" class="num">Max points</th></tr></thead>
            <tbody>${s.scoring.weights.map((w) => `<tr>
              <td><b>${esc(w.label)}</b></td><td class="t-sm dim">${esc(w.why)}</td>
              <td class="num t-num">${w.max}</td></tr>`).join('')}
              <tr><td colspan="2"><b>Total</b></td>
                <td class="num t-num"><b>${s.scoring.weights.reduce((n, w) => n + w.max, 0)}</b></td></tr>
            </tbody>
          </table>
        </div>`)}
      ${card('Temperature bands', `<div class="stack gap-2">
        ${s.scoring.bands.map((b) => `<div class="row gap-3">
          ${tempPill(b.key, b.label)}
          <span class="t-sm dim grow">${b.min}–${b.max} points</span>
        </div>`).join('')}</div>`)}`,

    brand: () => `
      ${card('Product identity', `<dl class="kv">
        <dt>Parent brand</dt><dd>${esc(s.product.parentBrand)}</dd>
        <dt>Product</dt><dd>${esc(s.product.productName)}</dd>
        <dt>Category</dt><dd>${esc(s.product.descriptor)}</dd>
        <dt>Promise</dt><dd>${esc(s.product.promise)}</dd>
      </dl>`)}
      ${card('Logo', `
        <div style="background:var(--surface-sunken);padding:var(--sp-5);border-radius:var(--r-md);text-align:center">
          <img src="./assets/teal-logo.svg" alt="TEAL — A TATA Enterprise" style="width:240px">
        </div>
        <p class="t-cap mt-3">The mark is a vector reconstruction drawn from the supplied brand
          artwork. Replacing <code>assets/teal-logo.svg</code> with the official file updates
          every screen — nothing references its internals.</p>`)}`,

    data: () => {
      const q = store.queue();
      const works = store.storageWorks();
      return `
      ${card('Where this data lives', `
        <p class="t-sm dim">Seed records load from <code>data/*.json</code>. Anything you
          capture or edit is written to this browser's local storage on this device.</p>
        <dl class="kv mt-3">
          <dt>Storage</dt><dd>${works
            ? '<span class="statusdot" data-state="online">Working</span>'
            : '<span class="statusdot" data-state="offline">Blocked by this browser</span>'}</dd>
          <dt>Leads</dt><dd class="t-num">${store.db.leads.length}</dd>
          <dt>Companies</dt><dd class="t-num">${store.db.companies.length}</dd>
          <dt>Contacts</dt><dd class="t-num">${store.db.contacts.length}</dd>
          <dt>Activities</dt><dd class="t-num">${store.db.activities.length}</dd>
          <dt>Pending sync operations</dt><dd class="t-num">${q.length}</dd>
        </dl>
        <p class="t-cap mt-3">There is no server in this build, so nothing is uploaded and
          nothing is shared between devices. The queue records what a hosted backend would
          receive — it is shown so the status is honest rather than a green "Synced" badge
          that means nothing.</p>`)}
      ${card('Backup and restore', `
        <div class="row gap-2" style="flex-wrap:wrap">
          <button class="btn btn-sec btn-sm" id="dl-json">${icon('download')} Download JSON backup</button>
          <label class="btn btn-sec btn-sm" style="cursor:pointer">
            Restore from backup
            <input type="file" id="up-json" accept="application/json" class="sr-only">
          </label>
          <button class="btn btn-sec btn-sm" id="reset-demo"
            style="color:var(--danger);border-color:var(--danger)">Reset to demo data</button>
        </div>
        <p class="t-cap mt-3">Clearing site data erases everything. Export before an event ends.</p>`)}`;
    },

    audit: () => card('Audit log', store.db.audit.length
      ? `<div class="tablewrap"><table class="data" style="min-width:0">
          <caption>${store.db.audit.length} recorded changes, newest first</caption>
          <thead><tr><th scope="col">When</th><th scope="col">Action</th>
            <th scope="col">Entity</th><th scope="col">Detail</th><th scope="col">Actor</th></tr></thead>
          <tbody>${store.db.audit.slice(0, 200).map((a) => `<tr>
            <td class="nowrap">${esc(fmtDateTime(a.at))}</td>
            <td><span class="pill" data-tone="neutral">${esc(a.action)}</span></td>
            <td>${esc(a.entity)}</td><td class="t-sm">${esc(a.detail)}</td>
            <td class="t-sm">${esc(a.actor)}</td></tr>`).join('')}</tbody>
        </table></div>`
      : '<p class="t-cap">No changes recorded yet. Edits, stage moves, reassignments, deletions and exports all land here.</p>'),
  }[tab]();

  return `
    <div class="page-head"><div><h1>Settings</h1>
      <p>How the platform is configured and where the data sits.</p></div></div>
    <div class="chips" style="margin-bottom:var(--sp-5)" role="tablist">
      ${tabs.map(([key, label]) => `<a class="chip" role="tab" href="#/settings?tab=${key}"
        aria-selected="${key === tab}" aria-pressed="${key === tab}">${esc(label)}</a>`).join('')}
    </div>
    <div class="grid grid-2">${body}</div>`;
}

export function settingsMount({ outlet }) {
  outlet.querySelector('#dl-json')?.addEventListener('click', () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      leads: store.db.leads, companies: store.db.companies, contacts: store.db.contacts,
      activities: store.db.activities, users: store.db.users,
      exhibitions: store.db.exhibitions, notifications: store.db.notifications,
      audit: store.db.audit,
    };
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TEAL-LeadConnect-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    store.logAudit('backup_exported', 'system', '', `${store.db.leads.length} leads`);
    store.save();
    toast('Backup downloaded');
  });

  outlet.querySelector('#up-json')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try { parsed = JSON.parse(reader.result); }
      catch { toast('That file is not a valid backup.', 'danger'); return; }
      if (!Array.isArray(parsed?.leads)) {
        toast('That backup has no leads in it.', 'danger');
        return;
      }
      confirmAction({
        title: 'Replace everything on this device?',
        body: `The backup holds ${parsed.leads.length} leads. Restoring replaces the current
               working set on this device. Download a backup first if you need it.`,
        confirmLabel: 'Restore',
        onConfirm() {
          for (const key of ['leads', 'companies', 'contacts', 'activities',
                             'users', 'exhibitions', 'notifications']) {
            if (Array.isArray(parsed[key])) store.db[key] = parsed[key];
          }
          store.db.audit = Array.isArray(parsed.audit) ? parsed.audit : [];
          store.logAudit('backup_restored', 'system', '', `${parsed.leads.length} leads`);
          store.save();
          toast('Backup restored');
          import('../router.js').then((r) => r.render());
        },
      });
    };
    reader.readAsText(file);
  });

  outlet.querySelector('#reset-demo')?.addEventListener('click', () => {
    confirmAction({
      title: 'Reset to demo data?',
      body: 'Every lead, edit and activity captured on this device is erased and the shipped demo set is reloaded. This cannot be undone.',
      confirmLabel: 'Reset everything',
      onConfirm() {
        localStorage.removeItem('teal.leadconnect.v2');
        localStorage.removeItem('teal.leadconnect.queue.v2');
        localStorage.removeItem('teal.leadconnect.draft.v2');
        location.reload();
      },
    });
  });
}

/* ---- Presentation Mode (§45) ---------------------------------------------
   Built for a room, not a desk: fewer numbers, larger type, no chrome. */
export function presentView() {
  const leads = store.visibleLeads().map((l) => {
    const s = score(l);
    return { ...l, score: s.total, band: s.band, bandLabel: s.label };
  });
  const a = analyse(store.visibleLeads());
  const ex = store.activeExhibition();
  const products = tally(leads, (l) => l.products).slice(0, 6);
  const industries = tally(leads, (l) => l.industry).slice(0, 5);
  const top = [...leads].filter((l) => !['WON', 'LOST'].includes(l.stage))
    .sort((x, y) => y.value - x.value).slice(0, 5);

  return `<div style="max-width:1180px;margin-inline:auto">
    <div class="row gap-4" style="justify-content:space-between;flex-wrap:wrap;margin-bottom:var(--sp-8)">
      <img src="./assets/teal-logo.svg" alt="TEAL — A TATA Enterprise" style="width:170px">
      <div style="text-align:right">
        <p class="t-eyebrow">${esc(store.db.settings.product.descriptor)}</p>
        <p class="t-h2">${esc(ex?.name ?? 'All exhibitions')}</p>
      </div>
    </div>

    <h1 class="t-display" style="max-width:20ch;margin-bottom:var(--sp-8)">
      ${esc(store.db.settings.product.promise)}</h1>

    <div class="grid grid-4" style="margin-bottom:var(--sp-8)">
      ${kpi({ label: 'Leads Captured', value: a.scored.length })}
      ${kpi({ label: 'Qualified', value: a.qualified.length, hint: `${a.qualificationRate}% of captured` })}
      ${kpi({ label: 'Hot Opportunities', value: a.hot.length, tone: 'var(--temp-hot)' })}
      ${kpi({ label: 'Pipeline Generated', value: money(a.pipelineValue) })}
    </div>

    <div class="grid grid-2">
      ${card('Lead funnel', funnel(a.funnelStages))}
      ${card('Where the demand is', hbars(products, { limit: 6 }))}
      ${card('Industry mix', industries.length ? donut(industries) : '<p class="t-cap">No data.</p>')}
      ${card('Largest open opportunities', top.length ? `<div class="stack gap-3">${top.map((l) => `
        <div class="row gap-3">
          ${scoreDial(l.score, l.band, 40)}
          <span class="grow" style="min-width:0">
            <b class="truncate" style="display:block">${esc(l.companyName)}</b>
            <span class="t-cap truncate" style="display:block">${esc((l.products || [])[0] ?? '')}</span>
          </span>
          <b class="t-num">${esc(money(l.value))}</b>
        </div>`).join('')}</div>` : '<p class="t-cap">No open opportunities.</p>')}
    </div>

    <p class="t-cap mt-8" style="text-align:center">
      TEAL LeadConnect · ${esc(fmtDate(new Date().toISOString()))}</p>

    <div class="row gap-2 mt-6 no-print" style="justify-content:center">
      <a class="btn btn-sec" href="#/dashboard">Exit Presentation Mode</a>
      <button class="btn btn-sec" id="present-print">${icon('download')} Print / PDF</button>
    </div>
  </div>`;
}

export function presentMount({ outlet }) {
  outlet.querySelector('#present-print')?.addEventListener('click', () => window.print());
}

/* ---- not found ----------------------------------------------------------- */
export function notFoundView() {
  return emptyState({
    title: 'That screen does not exist',
    body: 'The link may be out of date. Everything is reachable from the Command Center.',
    actionLabel: 'Go to Command Center', actionHref: '#/dashboard', iconName: 'warn',
  });
}
