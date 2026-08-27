/* ==========================================================================
   Boot: load data, register routes, render the shell, start the router.
   ========================================================================== */

import * as store from './store.js';
import * as router from './router.js';
import * as shell from './shell.js';
import { errorState } from './ui.js';

import * as dashboard from './views/dashboard.js';
import * as leads from './views/leads.js';
import * as leadDetail from './views/lead-detail.js';
import * as pipeline from './views/pipeline.js';
import * as accounts from './views/accounts.js';
import * as intel from './views/intelligence.js';
import * as capture from './views/capture.js';
import * as misc from './views/misc.js';

const ALL = ['admin', 'sales', 'management'];
const WRITE = ['admin', 'sales'];

function registerRoutes() {
  const r = router.register;

  r('/signin',        { view: misc.signinView, mount: misc.signinMount, public: true, bare: true });
  r('/dashboard',     { view: dashboard.view, roles: ALL, title: 'Command Center' });

  r('/leads',         { view: leads.view, mount: leads.mount, roles: ALL, title: 'Leads' });
  r('/leads/*',       { view: leadDetail.view, mount: leadDetail.mount, roles: ALL, title: 'Lead 360' });

  r('/pipeline',      { view: pipeline.view, mount: pipeline.mount, roles: ALL, title: 'Pipeline' });

  r('/companies',     { view: accounts.companiesView, mount: accounts.companiesMount, roles: ALL, title: 'Companies' });
  r('/companies/*',   { view: accounts.companyDetailView, roles: ALL, title: 'Account 360' });
  r('/contacts',      { view: accounts.contactsView, mount: accounts.contactsMount, roles: ALL, title: 'Contacts' });

  r('/products',      { view: intel.productsView, roles: ALL, title: 'Product Intelligence' });

  r('/exhibitions',   { view: intel.exhibitionsView, roles: ALL, title: 'Exhibition Intelligence' });
  r('/exhibitions/*', { view: intel.exhibitionDetailView, mount: intel.exhibitionDetailMount,
                        roles: ALL, title: 'Exhibition Report' });

  r('/followups',     { view: intel.followupsView, mount: intel.followupsMount, roles: ALL, title: 'Follow-ups' });
  r('/analytics',     { view: intel.analyticsView, mount: intel.analyticsMount,
                        roles: ['admin', 'management'], title: 'Analytics' });
  r('/team',          { view: intel.teamView, roles: ['admin', 'management'], title: 'Team' });

  r('/capture',       { view: capture.view, mount: capture.mount, roles: WRITE, title: 'Capture Lead' });
  r('/settings',      { view: misc.settingsView, mount: misc.settingsMount, roles: ['admin'], title: 'Settings' });
  r('/present',       { view: misc.presentView, mount: misc.presentMount, roles: ALL,
                        bare: true, title: 'Presentation Mode' });

  router.setNotFound(misc.notFoundView);
}

/* The shell is hidden on public and presentation screens so those read as
   their own surface rather than a page inside an admin tool. */
function onNavigate(route, def) {
  const app = document.getElementById('app');
  const bare = !!def.bare;
  app.dataset.bare = String(bare);
  document.getElementById('sidebar').hidden = bare;
  document.getElementById('topbar').hidden = bare;
  document.getElementById('tabbar').hidden = bare;
  document.body.dataset.drawer = 'closed';

  document.title = def.title
    ? `${def.title} · TEAL LeadConnect`
    : 'TEAL LeadConnect | Exhibition Lead Intelligence';

  if (!bare) shell.renderAll();
}

async function boot() {
  const outlet = document.getElementById('view');
  try {
    await store.init();
  } catch (err) {
    console.error('[boot]', err);
    // Three quite different failures land here and they need different
    // instructions: a misconfigured deployment, an unreachable database, and
    // the old file:// mistake. Telling someone to serve the folder over HTTP
    // when their Supabase project is down wastes their afternoon.
    const message = /config\.json|SUPABASE_/i.test(err.message)
      ? err.message
      : /Failed to fetch|NetworkError|ERR_/i.test(err.message)
        ? 'The server could not be reached. Check your connection — if you have signed in on '
          + 'this device before, reload once you are back online and your saved work will still be here.'
        : 'The reference data could not be loaded. If you opened this file directly from disk, '
          + 'serve the folder over HTTP instead — browsers block local file reads.';

    outlet.innerHTML = errorState(message);
    document.getElementById('retry')?.addEventListener('click', () => location.reload());
    return;
  }

  shell.applyTheme(store.prefs().theme);
  document.getElementById('app').dataset.collapsed = String(store.prefs().collapsed);

  registerRoutes();
  router.onRouteChange(onNavigate);

  if (store.me()) shell.renderAll();
  router.start();

  // A service worker makes the app installable and keeps the shell available
  // with no connection. It is an enhancement — failure is silent by design.
  //
  // Skipped in the single-file build: there is no separate sw.js to register,
  // and import.meta.url is empty there, which would make the URL throw before
  // the catch could swallow it. That build needs no shell cache anyway — the
  // shell is the file the browser already has.
  if ('serviceWorker' in navigator
      && location.protocol.startsWith('http')
      && import.meta.url) {
    window.addEventListener('load', () => {
      try {
        navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});
      } catch { /* enhancement only */ }
    });
  }
}

boot();
