/* ==========================================================================
   Application shell — sidebar, topbar, notifications, quick add, theme,
   command palette. Rendered once and updated on navigation.
   ========================================================================== */

import * as store from './store.js';
import { go, currentRoute, parseHash } from './router.js';
import { esc, attr, icon, initials, toast, openDialog, fmtDateTime } from './ui.js';
import { money } from './scoring.js';

/* §09 — eleven destinations, grouped so the list reads as three jobs rather
   than one long column. */
export const NAV = [
  { group: 'Sell', items: [
    { path: '/dashboard',   label: 'Command Center', ico: 'grid',     roles: ['admin', 'sales', 'management'] },
    { path: '/leads',       label: 'Leads',          ico: 'leads',    roles: ['admin', 'sales', 'management'] },
    { path: '/pipeline',    label: 'Pipeline',       ico: 'pipeline', roles: ['admin', 'sales', 'management'] },
    { path: '/followups',   label: 'Follow-ups',     ico: 'clock',    roles: ['admin', 'sales', 'management'], count: 'followups' },
  ]},
  { group: 'Accounts', items: [
    { path: '/companies',   label: 'Companies',      ico: 'building', roles: ['admin', 'sales', 'management'] },
    { path: '/contacts',    label: 'Contacts',       ico: 'contacts', roles: ['admin', 'sales', 'management'] },
    { path: '/products',    label: 'Products',       ico: 'box',      roles: ['admin', 'sales', 'management'] },
  ]},
  { group: 'Intelligence', items: [
    { path: '/exhibitions', label: 'Exhibitions',    ico: 'calendar', roles: ['admin', 'sales', 'management'] },
    { path: '/analytics',   label: 'Analytics',      ico: 'chart',    roles: ['admin', 'management'] },
    { path: '/team',        label: 'Team',           ico: 'team',     roles: ['admin', 'management'] },
    { path: '/settings',    label: 'Settings',       ico: 'gear',     roles: ['admin'] },
  ]},
];

/* The five that fit a phone tab bar. */
const TABS = ['/dashboard', '/leads', '/pipeline', '/followups', '/analytics'];

const allNavItems = () => NAV.flatMap((g) => g.items);

function counts() {
  const leads = store.visibleLeads();
  const today = new Date().toISOString().slice(0, 10);
  return {
    followups: leads.filter((l) => l.nextFollowUp && l.nextFollowUp <= today
      && !['WON', 'LOST'].includes(l.stage)).length,
  };
}

/* ---- theme (§36) ---------------------------------------------------------
   Three states. "System" stamps nothing and lets prefers-color-scheme decide;
   the other two stamp data-theme so the choice beats the OS in both
   directions. */
export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const dark = mode === 'dark'
      || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    meta.setAttribute('content', dark ? '#070b12' : '#f4f6f9');
  }
}

function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(store.prefs().theme) + 1) % order.length];
  store.setPref('theme', next);
  applyTheme(next);
  renderTopbar();
  toast(`Theme: ${next}`);
}

const themeIcon = (mode) => ({ light: 'sun', dark: 'moon', system: 'monitor' }[mode] || 'monitor');

/* ---- sidebar ------------------------------------------------------------- */
export function renderSidebar() {
  const el = document.getElementById('sidebar');
  if (!el) return;
  const user = store.me();
  if (!user) { el.innerHTML = ''; return; }

  const active = currentRoute()?.base ?? '/dashboard';
  const c = counts();

  el.innerHTML = `
    <a class="brand" href="#/dashboard" aria-label="TEAL LeadConnect — go to Command Center">
      <img class="brand-logo" src="./assets/teal-mark.svg" alt="" width="34" height="34">
      <span class="brand-text">
        <span class="brand-parent">TEAL</span>
        <span class="brand-product">LeadConnect</span>
      </span>
    </a>

    <nav class="nav" aria-label="Main">
      ${NAV.map((group) => {
        const items = group.items.filter((i) => i.roles.includes(store.role()));
        if (!items.length) return '';
        return `<div class="nav-group">
          <p class="nav-label">${esc(group.group)}</p>
          ${items.map((item) => {
            const on = active === item.path;
            const count = item.count ? c[item.count] : 0;
            return `<a class="nav-item" href="#${attr(item.path)}"
              ${on ? 'aria-current="page"' : ''}>
              ${icon(item.ico)}<span class="lbl">${esc(item.label)}</span>
              ${count ? `<span class="nav-count" data-tone="urgent">${count}</span>` : ''}
            </a>`;
          }).join('')}
        </div>`;
      }).join('')}
    </nav>

    <div class="sidebar-foot">
      <button class="userchip" id="user-btn" aria-haspopup="dialog">
        <span class="avatar" aria-hidden="true">${esc(initials(user.name))}</span>
        <span class="userchip-text grow" style="min-width:0;text-align:left">
          <span class="truncate" style="display:block;font-size:var(--fs-sm);font-weight:600">${esc(user.name)}</span>
          <span class="truncate" style="display:block;font-size:var(--fs-micro);color:var(--text-muted)">${esc(user.title)}</span>
        </span>
      </button>
      <button class="collapse-btn" id="collapse-btn">
        ${icon('chevronL', 'ico')}<span class="lbl">Collapse</span>
      </button>
    </div>`;

  el.querySelector('#user-btn').addEventListener('click', openProfile);
  el.querySelector('#collapse-btn').addEventListener('click', () => {
    const app = document.getElementById('app');
    const next = app.dataset.collapsed !== 'true';
    app.dataset.collapsed = String(next);
    store.setPref('collapsed', next);
  });
  el.querySelectorAll('.nav-item').forEach((a) =>
    a.addEventListener('click', () => { document.body.dataset.drawer = 'closed'; }));
}

/* ---- topbar -------------------------------------------------------------- */
export function renderTopbar() {
  const el = document.getElementById('topbar');
  if (!el) return;
  const user = store.me();
  if (!user) { el.innerHTML = ''; return; }

  const ex = store.activeExhibition();
  const unread = store.unreadCount();
  const theme = store.prefs().theme;

  el.innerHTML = `
    <button class="iconbtn menu-btn" id="menu-btn" aria-label="Open navigation"
      aria-expanded="false">${icon('menu')}</button>

    <button class="searchbtn" id="search-btn" aria-label="Search — press Control or Command plus K">
      ${icon('search')}<span class="truncate">Search leads, companies, products…</span>
      <kbd>⌘K</kbd>
    </button>

    <button class="exsel" id="ex-btn" aria-label="Change active exhibition">
      ${icon('calendar')}<span class="truncate lbl">${esc(ex?.name ?? 'No exhibition')}</span>
      ${icon('chevronD')}
    </button>

    <span class="grow"></span>

    <span class="statusdot" id="netdot" data-state="online"
      title="Captured leads are stored on this device">Online</span>

    <button class="iconbtn" id="theme-btn"
      aria-label="Theme: ${attr(theme)}. Change theme">${icon(themeIcon(theme))}</button>

    <button class="iconbtn" id="notif-btn" aria-label="Notifications${unread ? `, ${unread} unread` : ''}">
      ${icon('bell')}${unread ? '<span class="dot"></span>' : ''}
    </button>

    ${store.canWrite() ? `<button class="btn" id="quickadd-btn">
      ${icon('plus')}<span class="lbl">Quick Add</span></button>` : ''}`;

  el.querySelector('#menu-btn').addEventListener('click', () => {
    const open = document.body.dataset.drawer === 'open';
    document.body.dataset.drawer = open ? 'closed' : 'open';
    el.querySelector('#menu-btn').setAttribute('aria-expanded', String(!open));
  });
  el.querySelector('#search-btn').addEventListener('click', () => openPalette());
  el.querySelector('#ex-btn').addEventListener('click', openExhibitionPicker);
  el.querySelector('#theme-btn').addEventListener('click', cycleTheme);
  el.querySelector('#notif-btn').addEventListener('click', openNotifications);
  el.querySelector('#quickadd-btn')?.addEventListener('click', openQuickAdd);

  updateNetStatus();
}

export function renderTabbar() {
  const el = document.getElementById('tabbar');
  if (!el) return;
  if (!store.me()) { el.innerHTML = ''; return; }
  const active = currentRoute()?.base ?? '/dashboard';
  const items = allNavItems().filter((i) => TABS.includes(i.path) && i.roles.includes(store.role()));
  el.innerHTML = items.map((item) => `
    <a href="#${attr(item.path)}" ${active === item.path ? 'aria-current="page"' : ''}>
      ${icon(item.ico)}<span>${esc(item.label.replace('Command Center', 'Home'))}</span>
    </a>`).join('');
}

/* ---- network status (§28) ------------------------------------------------ */
function updateNetStatus() {
  const dot = document.getElementById('netdot');
  if (!dot) return;
  const online = navigator.onLine;
  dot.dataset.state = online ? 'online' : 'offline';
  dot.textContent = online ? 'Online' : 'Offline — saved locally';
  dot.title = online
    ? 'Captured leads are stored on this device.'
    : 'No connection. Capture still works; everything is written to this device.';
}
window.addEventListener('online', updateNetStatus);
window.addEventListener('offline', updateNetStatus);

/* ---- exhibition picker --------------------------------------------------- */
function openExhibitionPicker() {
  const active = store.activeExhibition();
  openDialog({
    title: 'Active exhibition',
    body: `<p class="t-sm dim">Capture and the Command Center follow this selection.</p>
      <div class="stack gap-2 mt-3">
        ${store.db.exhibitions.map((ex) => `
          <button class="chip" style="width:100%" data-ex="${attr(ex.id)}"
            aria-pressed="${ex.id === active?.id}">
            <b style="display:block">${esc(ex.name)}</b>
            <span class="t-cap">${esc(ex.city)} · ${esc(ex.start)} → ${esc(ex.end)}</span>
          </button>`).join('')}
      </div>`,
    onMount(host, close) {
      host.querySelectorAll('[data-ex]').forEach((btn) => btn.addEventListener('click', () => {
        store.db.exhibitions.forEach((e) => { e.active = e.id === btn.dataset.ex; });
        store.save();
        close();
        renderTopbar();
        import('./router.js').then((r) => r.render());
        toast('Active exhibition changed');
      }));
    },
  });
}

/* ---- notifications (§25) ------------------------------------------------- */
const SEVERITY_TONE = { critical: 'danger', high: 'warning', medium: 'info',
                        low: 'neutral', info: 'neutral' };

function openNotifications() {
  const rows = [...store.db.notifications].sort((a, b) => (a.at < b.at ? 1 : -1));
  openDialog({
    title: 'Notifications',
    body: rows.length ? `<div class="stack gap-2 mt-2">${rows.map((n) => `
      <div class="card" style="padding:var(--sp-3)${n.read ? ';opacity:.62' : ''}">
        <div class="row gap-2" style="justify-content:space-between">
          <span class="pill" data-tone="${SEVERITY_TONE[n.severity] ?? 'neutral'}">${esc(n.severity)}</span>
          <span class="t-cap">${esc(fmtDateTime(n.at))}</span>
        </div>
        <b style="display:block;margin-top:6px;font-size:var(--fs-sm)">${esc(n.title)}</b>
        <p class="t-cap" style="margin-top:2px">${esc(n.body)}</p>
        ${n.leadId ? `<a class="btn btn-sec btn-sm mt-2" href="#/leads/${attr(n.leadId)}"
          data-close>Open lead</a>` : ''}
      </div>`).join('')}</div>`
      : '<p class="t-sm dim">Nothing needs your attention right now.</p>',
    footer: `<button class="btn btn-sec" data-close>Close</button>
             <button class="btn" id="mark-read">Mark all read</button>`,
    onMount(host, close) {
      host.querySelector('#mark-read').addEventListener('click', () => {
        store.markNotificationsRead();
        close();
        renderTopbar();
        toast('All notifications marked read');
      });
    },
  });
}

/* ---- profile ------------------------------------------------------------- */
function openProfile() {
  const user = store.me();
  const theme = store.prefs().theme;
  openDialog({
    title: user.name,
    body: `
      <p class="t-sm dim">${esc(user.title)} · ${esc(user.region)}</p>
      <dl class="kv mt-4">
        <dt>Email</dt><dd>${esc(user.email)}</dd>
        <dt>Role</dt><dd>${esc({ admin: 'Administrator', sales: 'Sales / Booth',
                                 management: 'Management (read-only)' }[user.role])}</dd>
      </dl>
      <p class="t-eyebrow mt-6">Theme</p>
      <div class="chips mt-2">
        ${['system', 'light', 'dark'].map((mode) => `<button class="chip" data-theme-set="${mode}"
          aria-pressed="${mode === theme}">${mode[0].toUpperCase() + mode.slice(1)}</button>`).join('')}
      </div>
      <p class="t-eyebrow mt-6">Switch account</p>
      <p class="t-cap">Roles change what is visible. There is no password because this build has no
        authentication server — see Settings.</p>
      <div class="stack gap-2 mt-2">
        ${store.db.users.filter((u) => u.active).map((u) => `
          <button class="chip" style="width:100%" data-user="${attr(u.id)}"
            aria-pressed="${u.id === user.id}">
            <b style="display:block">${esc(u.name)}</b>
            <span class="t-cap">${esc(u.title)}</span>
          </button>`).join('')}
      </div>`,
    footer: `<button class="btn btn-sec" data-close>Close</button>
             <button class="btn btn-danger" id="signout">Sign out</button>`,
    onMount(host, close) {
      host.querySelectorAll('[data-theme-set]').forEach((btn) =>
        btn.addEventListener('click', () => {
          store.setPref('theme', btn.dataset.themeSet);
          applyTheme(btn.dataset.themeSet);
          host.querySelectorAll('[data-theme-set]').forEach((b) =>
            b.setAttribute('aria-pressed', String(b === btn)));
          renderTopbar();
        }));
      host.querySelectorAll('[data-user]').forEach((btn) =>
        btn.addEventListener('click', () => {
          store.signIn(btn.dataset.user);
          close();
          go('/dashboard');
          renderAll();
          toast(`Signed in as ${store.me().name}`);
        }));
      host.querySelector('#signout').addEventListener('click', () => {
        store.signOut(); close(); go('/signin'); renderAll();
      });
    },
  });
}

/* ---- quick add (§26) ----------------------------------------------------- */
export function openQuickAdd() {
  openDialog({
    title: 'Quick Add',
    body: `<div class="stack gap-2 mt-2">
      ${[
        ['Capture Lead', 'Full booth capture — under 30 seconds', '#/capture', 'plus'],
        ['Add Company', 'Create an account record', '#/companies?new=1', 'building'],
        ['Add Contact', 'Attach a person to an account', '#/contacts?new=1', 'contacts'],
        ['Schedule Follow-up', 'Put an action on the calendar', '#/followups', 'clock'],
        ['Import Leads', 'Bring in a CSV from another device', '#/settings?tab=data', 'download'],
      ].map(([title, sub, href, ico]) => `
        <a class="chip row gap-3" style="width:100%;text-decoration:none" href="${attr(href)}" data-close>
          ${icon(ico)}
          <span class="grow"><b style="display:block">${esc(title)}</b>
            <span class="t-cap">${esc(sub)}</span></span>
        </a>`).join('')}
    </div>`,
  });
}

/* ---- command palette (§35) ------------------------------------------------ */
let paletteOpen = false;

function paletteCommands() {
  const leads = store.visibleLeads();
  const nav = allNavItems()
    .filter((i) => i.roles.includes(store.role()))
    .map((i) => ({ group: 'Go to', label: i.label, ico: i.ico, run: () => go(i.path) }));

  const actions = [
    { group: 'Actions', label: 'Capture Lead', ico: 'plus', run: () => go('/capture'),
      show: store.canWrite() },
    { group: 'Actions', label: "Today's Follow-ups", ico: 'clock', run: () => go('/followups') },
    { group: 'Actions', label: 'Hot Leads', ico: 'flame', run: () => go('/leads?band=HOT') },
    { group: 'Actions', label: 'Export Leads (CSV)', ico: 'download',
      run: () => import('./views/leads.js').then((m) => m.exportLeads(store.visibleLeads())) },
    { group: 'Actions', label: 'Presentation Mode', ico: 'spark', run: () => go('/present'),
      show: !!store.me() },
    { group: 'Actions', label: 'Toggle theme', ico: 'sun', run: cycleTheme },
  ].filter((a) => a.show !== false);

  const records = leads.slice(0, 200).map((l) => ({
    group: 'Leads',
    label: `${l.contactName} — ${l.companyName}`,
    sub: l.code, ico: 'leads',
    run: () => go(`/leads/${l.id}`),
  }));

  const companies = store.db.companies.map((c) => ({
    group: 'Companies', label: c.name, sub: c.industry, ico: 'building',
    run: () => go(`/companies/${c.id}`),
  }));

  return [...actions, ...nav, ...records, ...companies];
}

export function openPalette() {
  if (paletteOpen) return;
  paletteOpen = true;

  const all = paletteCommands();
  const opener = document.activeElement;
  const host = document.createElement('div');
  host.className = 'cmdk';
  host.innerHTML = `
    <div class="dlg-scrim" data-close></div>
    <div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="Command palette">
      <input class="cmdk-input" id="cmdk-q" type="text" autocomplete="off" spellcheck="false"
        placeholder="Search leads, companies, or type a command…"
        role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-autocomplete="list">
      <div class="cmdk-list" id="cmdk-list" role="listbox" aria-label="Results"></div>
      <div class="cmdk-foot"><span>↑↓ navigate</span><span>↵ open</span><span>esc close</span></div>
    </div>`;
  document.body.appendChild(host);

  const input = host.querySelector('#cmdk-q');
  const list = host.querySelector('#cmdk-list');
  let matches = [];
  let cursor = 0;

  function filter(query) {
    const q = query.trim().toLowerCase();
    const pool = q
      ? all.filter((c) => `${c.label} ${c.sub ?? ''}`.toLowerCase().includes(q))
      : all.filter((c) => c.group === 'Actions' || c.group === 'Go to');
    return pool.slice(0, 40);
  }

  function draw() {
    if (!matches.length) {
      list.innerHTML = '<p class="t-cap" style="padding:var(--sp-4)">No matches.</p>';
      return;
    }
    let lastGroup = null;
    list.innerHTML = matches.map((cmd, i) => {
      const head = cmd.group !== lastGroup ? `<p class="cmdk-group">${esc(cmd.group)}</p>` : '';
      lastGroup = cmd.group;
      return `${head}<button class="cmdk-item" role="option" id="cmdk-opt-${i}"
        aria-selected="${i === cursor}" data-active="${i === cursor}" data-i="${i}">
        ${icon(cmd.ico)}<span class="truncate">${esc(cmd.label)}</span>
        ${cmd.sub ? `<span class="sub">${esc(cmd.sub)}</span>` : ''}
      </button>`;
    }).join('');
    input.setAttribute('aria-activedescendant', `cmdk-opt-${cursor}`);
    list.querySelectorAll('[data-i]').forEach((btn) =>
      btn.addEventListener('click', () => run(Number(btn.dataset.i))));
    list.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  function run(i) {
    const cmd = matches[i];
    close();
    cmd?.run();
  }

  function close() {
    paletteOpen = false;
    host.remove();
    document.removeEventListener('keydown', onKey, true);
    if (opener?.focus) opener.focus();
  }

  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowDown') {
      event.preventDefault(); cursor = Math.min(cursor + 1, matches.length - 1); draw();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault(); cursor = Math.max(cursor - 1, 0); draw();
    } else if (event.key === 'Enter') { event.preventDefault(); run(cursor); }
  }

  input.addEventListener('input', () => { matches = filter(input.value); cursor = 0; draw(); });
  host.querySelector('[data-close]').addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);

  matches = filter('');
  draw();
  input.focus();
}

/* ⌘K / Ctrl-K from anywhere except while typing in a field. */
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (store.me()) openPalette();
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
  if (event.key === '/' && !typing && store.me()) { event.preventDefault(); openPalette(); }
});

export function renderAll() {
  renderSidebar();
  renderTopbar();
  renderTabbar();
}
