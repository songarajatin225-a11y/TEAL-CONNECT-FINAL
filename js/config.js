/* ==========================================================================
   Runtime configuration.

   The app has no build step, so there is no bundler to inline an environment
   variable at compile time. Configuration is fetched instead: config.json sits
   next to index.html and is read once at boot, which means one set of files
   runs unchanged on a laptop, on staging and in production — the container
   writes config.json at start-up and nothing is rebuilt per environment.

   Missing or unfilled config is not an error. The app falls back to demo mode
   and behaves exactly as it did before there was a backend: seed data from
   data/*.json, working set in localStorage. That keeps the public demo alive
   and means a misconfigured deploy degrades to something usable rather than a
   blank screen.
   ========================================================================== */

const CONFIG_URL = new URL('../config.json', import.meta.url);

const DEFAULTS = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  mode: 'auto',
  environmentLabel: '',
};

let cached = null;

function normalise(raw) {
  const cfg = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (typeof raw?.[key] === 'string') cfg[key] = raw[key].trim();
  }

  // The example file ships with placeholders. Someone who copies it and
  // deploys without editing should land in demo mode, not watch every request
  // fail against a host that does not exist.
  if (cfg.supabaseUrl.includes('YOUR-PROJECT')) cfg.supabaseUrl = '';
  if (cfg.supabaseAnonKey.startsWith('YOUR-')) cfg.supabaseAnonKey = '';

  const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);

  if (cfg.mode === 'server' && !configured) {
    // Explicitly asked for the backend and it is not there. Say so loudly
    // rather than silently serving demo data that looks real.
    cfg.mode = 'misconfigured';
  } else if (cfg.mode !== 'demo') {
    cfg.mode = configured ? 'server' : 'demo';
  }

  return cfg;
}

export async function load() {
  if (cached) return cached;

  try {
    // no-store: a stale config.json cached by the service worker would point a
    // freshly reconfigured deployment at the previous project.
    const res = await fetch(CONFIG_URL, { cache: 'no-store' });
    cached = res.ok ? normalise(await res.json()) : normalise(null);
  } catch {
    // Absent file, offline boot, or invalid JSON. Demo mode is the safe floor.
    cached = normalise(null);
  }

  return cached;
}

/* Synchronous access for code that runs after boot. load() has already
   resolved by then; before that this reports demo mode, which is the
   conservative answer. */
export function get() { return cached ?? { ...DEFAULTS, mode: 'demo' }; }

export const isServerMode = () => get().mode === 'server';
export const isDemoMode   = () => get().mode === 'demo';
