/* ==========================================================================
   Hash router.

   Hash-based on purpose: GitHub Pages has no rewrite rules, so a path router
   would 404 on refresh and on any deep link (§42). Every route below renders
   something real — there are no placeholder screens (§43).
   ========================================================================== */

import { me, role } from './store.js';
import { errorState, skeleton, toast } from './ui.js';

const routes = new Map();
let notFound = null;
let onNavigate = null;
let current = null;
let firstRender = true;

export function register(path, def) { routes.set(path, def); }
export function setNotFound(fn) { notFound = fn; }
export function onRouteChange(fn) { onNavigate = fn; }

export function parseHash() {
  const raw = (location.hash || '#/dashboard').replace(/^#/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const params = {};
  for (const pair of queryPart.split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return { segments, params, path: `/${segments.join('/')}` };
}

/* /leads/:id matches the "/leads/*" definition and passes the id through. */
function resolve(segments) {
  const exact = `/${segments.join('/')}`;
  if (routes.has(exact)) return { def: routes.get(exact), id: null };
  if (segments.length >= 2) {
    const parent = `/${segments[0]}/*`;
    if (routes.has(parent)) return { def: routes.get(parent), id: segments[1] };
  }
  const root = `/${segments[0] ?? ''}`;
  if (routes.has(root)) return { def: routes.get(root), id: null };
  return null;
}

export function go(path) {
  location.hash = path.startsWith('#') ? path : `#${path}`;
}

export function currentRoute() { return current; }

export async function render() {
  const outlet = document.getElementById('view');
  if (!outlet) return;

  const { segments, params } = parseHash();
  const hit = resolve(segments.length ? segments : ['dashboard']);

  if (!hit) {
    outlet.innerHTML = notFound ? notFound() : '';
    return;
  }

  const { def, id } = hit;
  const user = me();

  if (!def.public && !user) { go('/signin'); return; }

  if (def.roles && user && !def.roles.includes(role())) {
    toast('That screen is not available for your role.');
    go('/dashboard');
    return;
  }

  current = { path: `/${segments.join('/')}`, base: `/${segments[0] ?? 'dashboard'}`, params, id };
  onNavigate?.(current, def);

  // Async views get a skeleton rather than a blank screen (§33).
  if (def.async) outlet.innerHTML = skeleton(def.skeleton || 'page');

  try {
    const html = await def.view({ params, id, outlet });
    if (typeof html === 'string') outlet.innerHTML = html;
    def.mount?.({ params, id, outlet });
  } catch (err) {
    console.error('[router]', err);
    // Never surface the raw exception to the user (§34).
    outlet.innerHTML = errorState("We couldn't load this screen.");
    document.getElementById('retry')?.addEventListener('click', () => render());
  }

  /* Move focus into the new screen so a keyboard or screen-reader user lands
     on the content rather than back at the top of the nav. Skipped on the
     very first render: stealing focus then would put the skip link out of
     reach for someone who has not navigated anywhere yet. */
  if (!firstRender) {
    document.getElementById('view')?.focus?.();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  firstRender = false;
}

export function start() {
  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = me() ? '#/dashboard' : '#/signin';
  render();
}
