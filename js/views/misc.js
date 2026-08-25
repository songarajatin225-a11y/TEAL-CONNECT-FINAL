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

/* ---- sign in -------------------------------------------------------------
   Two shapes behind one route.

   With a Supabase project configured this is a real credential form: the
   password is checked by the auth server, the session is a JWT, and the roles
   below it are enforced by row-level security rather than by this screen.

   Without one — the public demo, or a checkout with no config.json — it stays
   the account picker it always was, and says plainly that there is no password
   because there is no authentication server. Showing a login box that accepts
   anything would be worse than showing none.
   -------------------------------------------------------------------------- */

function signinChrome(body) {
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
      ${body}
    </div>
  </div>`;
}

export function signinView() {
  return store.isServerMode() ? signinChrome(credentialForm()) : signinChrome(accountPicker());
}

function credentialForm() {
  return `<form class="card" id="signin-form" novalidate>
    <p class="t-eyebrow">Sign in</p>

    <!-- Empty but present from first render: an alert region inserted only
         when an error occurs is not announced by every screen reader. -->
    <div id="signin-error" class="alert" role="alert" hidden
         style="margin-top:var(--sp-3)"></div>

    <label class="field mt-3"><span>Work email</span>
      <input class="input" id="signin-email" type="email" name="email"
        autocomplete="username" inputmode="email" enterkeyhint="next"
        autocapitalize="off" spellcheck="false" required
        aria-describedby="signin-error" placeholder="name@teal.example"></label>

    <label class="field mt-3"><span>Password</span>
      <input class="input" id="signin-password" type="password" name="password"
        autocomplete="current-password" enterkeyhint="go" required
        aria-describedby="signin-error"></label>

    <button class="btn mt-4" id="signin-submit" style="width:100%" type="submit">
      Sign in</button>

    <p class="t-cap mt-4">
      <button type="button" class="linkbtn" id="signin-reset">Forgotten your password?</button>
    </p>
  </form>`;
}

function accountPicker() {
  return `<div class="card">
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
  </div>`;
}

export function signinMount({ outlet }) {
  return store.isServerMode()
    ? mountCredentialForm(outlet)
    : mountAccountPicker(outlet);
}

function mountAccountPicker(outlet) {
  outlet.querySelectorAll('[data-user]').forEach((btn) => btn.addEventListener('click', () => {
    store.signInAsUser(btn.dataset.user);
    import('../shell.js').then((s) => s.renderAll());
    go('/dashboard');
    toast(`Signed in as ${store.me().name}`);
  }));
}

function mountCredentialForm(outlet) {
  const form = outlet.querySelector('#signin-form');
  const email = outlet.querySelector('#signin-email');
  const password = outlet.querySelector('#signin-password');
  const submit = outlet.querySelector('#signin-submit');
  const errorBox = outlet.querySelector('#signin-error');

  email?.focus();

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.hidden = false;
    // Move focus to the field most likely at fault so a keyboard user is not
    // left at the bottom of the form hunting for what changed.
    (/password/i.test(message) ? password : email)?.focus();
  };
  const clearError = () => { errorBox.hidden = true; errorBox.textContent = ''; };

  const busy = (on) => {
    submit.disabled = on;
    submit.setAttribute('aria-busy', String(on));
    submit.textContent = on ? 'Signing in…' : 'Sign in';
  };

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();

    const address = email.value.trim();
    if (!address || !password.value) {
      showError('Enter your email address and password.');
      return;
    }

    busy(true);
    // The whole working set is fetched before this resolves, so on a slow
    // connection this button sits disabled for a moment rather than dropping
    // the user into an empty dashboard that fills in underneath them.
    const result = await store.signIn(address, password.value);
    busy(false);

    if (!result.ok) { showError(result.message); return; }

    password.value = '';
    const shell = await import('../shell.js');
    shell.renderAll();
    go('/dashboard');
    toast(`Signed in as ${store.me().name}`);
  });

  outlet.querySelector('#signin-reset')?.addEventListener('click', async () => {
    const address = email.value.trim();
    if (!address) { showError('Enter your email address first, then choose this again.'); return; }

    try {
      await store.sendPasswordReset(address);
      clearError();
      // Deliberately the same message whether or not the address exists:
      // saying "no such account" tells anyone who asks which addresses are
      // real ones.
      toast('If that address has an account, a reset link is on its way.');
    } catch (err) {
      showError(err.message);
    }
  });
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
      const sync = store.syncState();
      const server = store.isServerMode();

      const counts = `
        <dl class="kv mt-3">
          <dt>Browser storage</dt><dd>${works
            ? '<span class="statusdot" data-state="synced">Working</span>'
            : '<span class="statusdot" data-state="error">Blocked by this browser</span>'}</dd>
          <dt>Leads</dt><dd class="t-num">${store.db.leads.length}</dd>
          <dt>Companies</dt><dd class="t-num">${store.db.companies.length}</dd>
          <dt>Contacts</dt><dd class="t-num">${store.db.contacts.length}</dd>
          <dt>Activities</dt><dd class="t-num">${store.db.activities.length}</dd>
          <dt>Waiting to sync</dt><dd class="t-num">${q.length}</dd>
        </dl>`;

      return `
      ${server ? card('Where this data lives', `
        <p class="t-sm dim">Records live in a PostgreSQL database behind Supabase. What you
          see here is a working copy held in this browser so the app keeps responding — and
          keeps accepting leads — when the connection at a venue does not.</p>
        ${counts}
        <p class="t-cap mt-3">Anything captured while offline is queued on this device and
          sent when the connection returns. The count above is the honest number: it is what
          has <em>not</em> reached the server yet.
          ${sync.error ? `<br><br><b>Last error:</b> ${esc(sync.error)}` : ''}</p>
        <div class="row gap-2 mt-3" style="flex-wrap:wrap">
          <button class="btn btn-sec btn-sm" id="sync-now">${icon('refresh')} Sync now</button>
          <span class="statusdot" data-state="${attr(sync.state)}" id="settings-sync"></span>
        </div>`)
      : card('Where this data lives', `
        <p class="t-sm dim">Seed records load from <code>data/*.json</code>. Anything you
          capture or edit is written to this browser's local storage on this device.</p>
        ${counts}
        <p class="t-cap mt-3">This build is running without a backend, so nothing is uploaded
          and nothing is shared between devices. The queue records what a hosted backend
          would receive — it is shown so the status is honest rather than a green "Synced"
          badge that means nothing. To connect one, see <code>DEPLOY.md</code>.</p>`)}
      ${server ? card('Backup', `
        <div class="row gap-2" style="flex-wrap:wrap">
          <button class="btn btn-sec btn-sm" id="dl-json">${icon('download')} Download JSON backup</button>
          <button class="btn btn-sec btn-sm" id="clear-local"
            style="color:var(--danger);border-color:var(--danger)">Clear local copy</button>
        </div>
        <p class="t-cap mt-3">The database is the record of truth and is backed up by your
          Supabase project, so a download here is a point-in-time export for your own records
          rather than the only copy.</p>
        <p class="t-cap mt-2">Restoring a file over the top is deliberately not offered: it
          would only rewrite this browser's copy, which the next sync would discard. To roll
          the database back, use point-in-time recovery in the Supabase dashboard.</p>
        <p class="t-cap mt-2"><b>Clear local copy</b> discards the cached working set and
          anything still queued on this device, then reloads from the server. Use it on a
          shared tablet, or if this browser's copy looks wrong. Anything not yet synced is
          lost — check the count above first.</p>`)
      : card('Backup and restore', `
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
  const syncBtn = outlet.querySelector('#sync-now');
  syncBtn?.addEventListener('click', async () => {
    syncBtn.disabled = true;
    syncBtn.setAttribute('aria-busy', 'true');
    const original = syncBtn.innerHTML;
    syncBtn.textContent = 'Syncing…';
    try {
      await store.refresh();
      toast('Up to date');
      import('../router.js').then((r) => r.render());
    } catch (err) {
      toast(err.message, 'danger');
    } finally {
      syncBtn.disabled = false;
      syncBtn.removeAttribute('aria-busy');
      syncBtn.innerHTML = original;
    }
  });

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

  outlet.querySelector('#clear-local')?.addEventListener('click', () => {
    const waiting = store.queue().length;
    confirmAction({
      title: 'Clear this device\u2019s copy?',
      body: waiting
        ? `${waiting} change${waiting === 1 ? '' : 's'} on this device ${waiting === 1 ? 'has' : 'have'}
           not reached the server yet and will be lost. Everything already synced is safe in the
           database and will load again.`
        : `Everything on this device is already synced, so nothing will be lost. The working set
           is discarded and reloaded from the server.`,
      confirmLabel: 'Clear and reload',
      onConfirm() {
        localStorage.removeItem('teal.leadconnect.v2');
        localStorage.removeItem('teal.leadconnect.queue.v2');
        localStorage.removeItem('teal.leadconnect.draft.v2');
        location.reload();
      },
    });
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
