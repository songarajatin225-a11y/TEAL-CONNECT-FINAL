#!/usr/bin/env node
/* ==========================================================================
   Build the whole application into one .html file.

     node tools/build-single-file.js            # both modes, ~700 KB
     node tools/build-single-file.js --local    # drop Supabase, ~490 KB
     node tools/build-single-file.js --supabase-url URL --supabase-key KEY

   The output is a single file you upload anywhere that serves HTML — shared
   hosting, an S3 bucket, a network drive, an intranet IIS box, or straight
   into a browser from disk. Nothing to install, no Node on the server, no
   Docker, no build step at the far end.

   It is generated from the same source the multi-file build uses, so the two
   never drift. Do not edit the output by hand: change the source and rebuild.
   Only the CONFIG block at the top of the output is meant to be edited, and
   rebuilding overwrites that too.

   Requires esbuild, which is not committed:  npm install --no-save esbuild
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');

const args = process.argv.slice(2);
const LOCAL_ONLY = args.includes('--local');
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : '';
};
const SUPABASE_URL = flag('--supabase-url');
const SUPABASE_KEY = flag('--supabase-key');

let esbuild;
try {
  esbuild = require('esbuild');
} catch {
  console.error('\nesbuild is needed to bundle the modules and is not committed.\n');
  console.error('  npm install --no-save esbuild\n');
  process.exit(1);
}

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

/* ---- inlined resources --------------------------------------------------- */

const COLLECTIONS = ['users', 'exhibitions', 'products', 'companies', 'contacts',
                     'leads', 'activities', 'notifications', 'settings'];

const CSS = ['css/tokens.css', 'css/base.css', 'css/shell.css', 'css/components.css']
  .map((f) => `/* ===== ${f} ===== */\n${read(f)}`)
  .join('\n\n');

const SEED = Object.fromEntries(COLLECTIONS.map((n) => [n, readJson(`data/${n}.json`)]));

/* SVGs become data URIs. They are referenced as './assets/x.svg' string
   literals inside the view modules, so the replacement happens on the bundled
   output rather than by threading a parameter through every call site. */
const ASSETS = ['teal-logo.svg', 'teal-mark.svg', 'teal-mark-maskable.svg', 'teal-wordmark.svg'];
const assetUri = (name) =>
  `data:image/svg+xml;base64,${Buffer.from(read(`assets/${name}`)).toString('base64')}`;

function inlineAssets(source) {
  let out = source;
  for (const name of ASSETS) {
    // Both the './assets/x.svg' the views use and the bare 'assets/x.svg'.
    out = out.split(`./assets/${name}`).join(assetUri(name));
    out = out.split(`assets/${name}`).join(assetUri(name));
  }
  return out;
}

/* ---- bundle -------------------------------------------------------------- */

/* api.js pulls the Supabase client in with a dynamic import so the multi-file
   build keeps it off the critical path. There is no second file to fetch here,
   so it is bundled in — unless --local, where a stub takes its place and saves
   the reader ~210 KB they would never execute. */
const localOnlyPlugin = {
  name: 'local-only',
  setup(build) {
    build.onResolve({ filter: /supabase-js\.esm\.js$/ }, () => ({
      path: 'teal-supabase-stub', namespace: 'stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: `export function createClient() {
        throw new Error('This build was made with --local and has no Supabase client.');
      }`,
      loader: 'js',
    }));
  },
};

async function bundle() {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, 'js/app.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    // import.meta.url is empty outside a module format, and esbuild warns
    // about all three uses of it. Each one is deliberately guarded — the two
    // URL builders are only called when nothing was inlined, and the service
    // worker registration checks for it before using it — so the warning is
    // noise that makes a clean build look broken.
    logOverride: { 'empty-import-meta': 'silent' },
    plugins: LOCAL_ONLY ? [localOnlyPlugin] : [],
  });

  if (result.outputFiles.length !== 1) {
    // A dynamic import that esbuild decided to split would be a second file
    // with no way to load it. Fail loudly rather than ship a broken page.
    throw new Error(
      `expected one output file, got ${result.outputFiles.length}: `
      + result.outputFiles.map((f) => path.basename(f.path)).join(', '));
  }
  return result.outputFiles[0].text;
}

/* ---- assemble ------------------------------------------------------------ */

function page(js) {
  const mode = LOCAL_ONLY ? 'demo' : 'auto';
  const built = new Date().toISOString().slice(0, 10);

  const configBlock = LOCAL_ONLY
    ? `  /* This build stores everything in this browser, on this device.
     Nothing is uploaded and nothing is shared between devices. */
  supabaseUrl: '',
  supabaseAnonKey: '',`
    : `  /* ------------------------------------------------------------------
     WHERE THE DATA GOES.

     Leave both blank and everything is stored in this browser, on this
     device only — nothing is uploaded, and two people do not see each
     other's leads. Good for a demo; not how you run an exhibition.

     Fill both in and every lead goes to your Supabase database instead,
     shared across every device and every person, with sign-in by email
     and password. Both values are on your Supabase dashboard under
     Project Settings -> API. Setting the project up takes about ten
     minutes and is described in BACKEND.md.

     The "anon" key is the one to use here. It is a public credential and
     is meant to be readable — the database's row-level security is what
     protects the data. Never paste the "service_role" key into this file:
     it bypasses that protection entirely and this file is downloaded by
     every browser that opens the page.
     ------------------------------------------------------------------ */
  supabaseUrl:     ${JSON.stringify(SUPABASE_URL)},
  supabaseAnonKey: ${JSON.stringify(SUPABASE_KEY)},`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>TEAL LeadConnect | Exhibition Lead Intelligence</title>
<meta name="description" content="TEAL LeadConnect — Exhibition Lead Intelligence &amp; Sales Conversion OS. Capture, qualify and convert exhibition leads into a measurable sales pipeline.">
<meta name="theme-color" content="#f4f6f9">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${assetUri('teal-mark.svg')}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${assetUri('teal-mark.svg')}">

<!--
  TEAL LeadConnect — single-file build, ${built}

  Everything is in this one file: styles, application, reference data and
  artwork. Upload it to any web server, or open it straight from disk.

  GENERATED FILE. Rebuilt with tools/build-single-file.js from the sources in
  this repository — edits made here are lost on the next build. The one part
  meant to be edited is the CONFIG block at the top of the script below.
-->

<script>
  /* Applied before first paint so a dark-mode user never sees a light flash. */
  try {
    var p = JSON.parse(localStorage.getItem('teal.leadconnect.prefs.v2') || '{}');
    if (p.theme === 'light' || p.theme === 'dark') {
      document.documentElement.setAttribute('data-theme', p.theme);
    }
  } catch (e) { /* first visit */ }
</script>

<style>
${CSS}
</style>
</head>
<body data-drawer="closed">

<a class="skip-link" href="#view">Skip to main content</a>

<div class="app" id="app" data-collapsed="false">
  <aside class="sidebar" id="sidebar" aria-label="Primary"></aside>
  <div class="scrim" id="scrim" aria-hidden="true"></div>

  <div class="main">
    <header class="topbar" id="topbar"></header>
    <main class="view" id="view" tabindex="-1">
      <div class="stack gap-4">
        <div class="skel skel-line" style="width:30%;height:24px"></div>
        <div class="grid grid-4">
          <div class="skel skel-kpi"></div><div class="skel skel-kpi"></div>
          <div class="skel skel-kpi"></div><div class="skel skel-kpi"></div>
        </div>
      </div>
    </main>
  </div>
</div>

<nav class="tabbar" id="tabbar" aria-label="Primary mobile"></nav>

<noscript>
  <div style="padding:2rem;max-width:60ch;margin:0 auto">
    <h1>TEAL LeadConnect</h1>
    <p>This application needs JavaScript enabled. Please turn it on and reload.</p>
  </div>
</noscript>

<script>
/* ========================= CONFIG — EDIT THIS ============================ */
window.TEAL_CONFIG = {
${configBlock}

  /* 'auto' uses Supabase when the two values above are filled in, and falls
     back to this-device-only storage when they are not. */
  mode: ${JSON.stringify(mode)},

  /* Shown in the topbar, e.g. 'Staging'. Leave blank in normal use. */
  environmentLabel: ''
};
/* ======================= END CONFIG — EDIT THIS ========================== */

/* The reference data that shipped with the build. Carried inside the file so
   there is nothing to fetch, which is what lets this run from disk. */
window.TEAL_SEED = ${JSON.stringify(SEED)};
</script>

<script>
${js}
</script>
</body>
</html>
`;
}

/* ---- run ----------------------------------------------------------------- */

(async () => {
  console.log(`\nBuilding single-file LeadConnect${LOCAL_ONLY ? ' (--local)' : ''}`);

  let js = await bundle();
  js = inlineAssets(js);

  // A leftover reference means something is still expecting a second file.
  const stray = js.match(/["'`][^"'`]*\/(?:data|css|assets)\/[a-z-]+\.(?:json|css|svg)["'`]/);
  if (stray) {
    throw new Error(`bundle still references a separate file: ${stray[0]}`);
  }

  let html = page(js);
  html = inlineAssets(html);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, 'leadconnect.html');
  fs.writeFileSync(out, html);

  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`  styles      ${kb(CSS.length)}`);
  console.log(`  application ${kb(js.length)}`);
  console.log(`  data        ${kb(JSON.stringify(SEED).length)}`);
  console.log(`  -> dist/leadconnect.html  ${kb(html.length)}`);
  console.log(LOCAL_ONLY
    ? '\nStores data in the browser only. Open it, or upload it anywhere.\n'
    : '\nFill in the CONFIG block at the top to store data in Supabase,\n'
      + 'or leave it blank to keep everything on the device.\n');
})().catch((err) => {
  console.error(`\nBuild failed: ${err.message}\n`);
  process.exit(1);
});
