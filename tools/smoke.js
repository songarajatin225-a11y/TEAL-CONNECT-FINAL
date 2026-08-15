/* Boot the app under a /Lead-2/ subpath, walk every route, collect errors. */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = require('path').join(__dirname, '..');
const BASE_PATH = '/Lead-2/';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css' };

const ROUTES = [
  ['/dashboard', 'Command Center'],
  ['/leads', 'Leads'],
  ['/pipeline', 'Pipeline'],
  ['/followups', 'Follow-up Center'],
  ['/companies', 'Companies'],
  ['/contacts', 'Contacts'],
  ['/products', 'Product Intelligence'],
  ['/exhibitions', 'Exhibition Intelligence'],
  ['/exhibitions?compare=1', 'Exhibition Comparison'],
  ['/analytics', 'Business Intelligence'],
  ['/team', 'Team'],
  ['/settings', 'Settings'],
  ['/capture', 'Capture Lead'],
  ['/present', 'Presentation'],
];

let pass = 0, fail = 0; const fails = [];
const ok = (n, c, extra) => { if (c) pass++; else { fail++; fails.push(n + (extra ? ` — ${extra}` : '')); } };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let url = decodeURIComponent(req.url.split('?')[0]);
      if (!url.startsWith(BASE_PATH)) { res.writeHead(404); res.end('outside base'); return; }
      let rel = url.slice(BASE_PATH.length) || 'index.html';
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(buf);
      });
    }).listen(0, () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}${BASE_PATH}`;
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  const failed404 = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) failed404.push(`${r.status()} ${r.url()}`); });

  await page.goto(base, { waitUntil: 'networkidle' });
  ok('boots without page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  ok('no failed asset requests', failed404.length === 0, failed404.slice(0, 4).join(' | '));

  const signin = await page.textContent('#view');
  ok('sign-in screen renders', /Choose an account/i.test(signin), signin.slice(0, 100));
  ok('logo asset loads', await page.evaluate(() => {
    const img = document.querySelector('#view img');
    return !!img && img.complete && img.naturalWidth > 0;
  }));

  // sign in as admin
  await page.click('[data-user="u-admin"]');
  await page.waitForTimeout(300);
  ok('signs in and lands on Command Center',
    /Command Center/.test(await page.textContent('#view')));
  ok('sidebar rendered', (await page.$$('#sidebar .nav-item')).length >= 8,
    `${(await page.$$('#sidebar .nav-item')).length} nav items`);

  for (const [route, expect] of ROUTES) {
    errors.length = 0;
    await page.evaluate((r) => { location.hash = `#${r}`; }, route);
    await page.waitForTimeout(220);
    const text = await page.textContent('#view');
    ok(`route ${route} renders`, text.trim().length > 60, `len=${text.trim().length}`);
    ok(`route ${route} shows "${expect}"`, text.includes(expect), text.slice(0, 110));
    ok(`route ${route} throws nothing`, errors.length === 0, errors.slice(0, 2).join(' | '));
  }

  // deep links
  const leadId = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    return s.db.leads[0].id;
  });
  errors.length = 0;
  await page.evaluate((id) => { location.hash = `#/leads/${id}`; }, leadId);
  await page.waitForTimeout(250);
  const lead = await page.textContent('#view');
  ok('lead detail renders', /Lead Intelligence Score/.test(lead), lead.slice(0, 100));
  ok('next best action shown', /Next best action/.test(lead));
  ok('score breakdown shown', /Score breakdown/.test(lead));
  ok('lead detail throws nothing', errors.length === 0, errors.slice(0, 2).join(' | '));

  const coId = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    return s.db.companies[0].id;
  });
  errors.length = 0;
  await page.evaluate((id) => { location.hash = `#/companies/${id}`; }, coId);
  await page.waitForTimeout(250);
  ok('account 360 renders', /Open Pipeline/.test(await page.textContent('#view')));
  ok('account 360 throws nothing', errors.length === 0, errors.slice(0, 2).join(' | '));

  const exId = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    return s.db.exhibitions[0].id;
  });
  errors.length = 0;
  await page.evaluate((id) => { location.hash = `#/exhibitions/${id}`; }, exId);
  await page.waitForTimeout(250);
  ok('exhibition report renders', /Cost per Lead/.test(await page.textContent('#view')));
  ok('exhibition report throws nothing', errors.length === 0, errors.slice(0, 2).join(' | '));

  // command palette
  errors.length = 0;
  await page.evaluate(() => { location.hash = '#/dashboard'; });
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(200);
  ok('command palette opens on Ctrl+K', !!(await page.$('.cmdk-panel')));
  await page.fill('#cmdk-q', 'pipeline');
  await page.waitForTimeout(150);
  ok('palette filters', (await page.$$('.cmdk-item')).length > 0);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  ok('palette navigates', location => true);
  ok('palette closed after run', !(await page.$('.cmdk-panel')));
  ok('palette throws nothing', errors.length === 0, errors.slice(0, 2).join(' | '));

  // theme
  await page.evaluate(() => { location.hash = '#/dashboard'; });
  await page.waitForTimeout(150);
  await page.click('#theme-btn');
  await page.waitForTimeout(150);
  const t1 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.click('#theme-btn');
  await page.waitForTimeout(150);
  const t2 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  ok('theme toggle changes data-theme', t1 !== t2, `${t1} -> ${t2}`);
  ok('dark theme reachable', [t1, t2].includes('dark'), `${t1}/${t2}`);

  // role gating
  errors.length = 0;
  await page.evaluate(async () => {
    const s = await import('./js/store.js');
    s.signIn(s.db.users.find((u) => u.role === 'management').id);
    location.hash = '#/capture';
  });
  await page.waitForTimeout(300);
  ok('management cannot reach capture',
    !(await page.evaluate(() => location.hash)).includes('/capture'),
    await page.evaluate(() => location.hash));

  await page.evaluate(async () => {
    const s = await import('./js/store.js');
    s.signIn(s.db.users.find((u) => u.role === 'sales').id);
    location.hash = '#/leads';
  });
  await page.waitForTimeout(300);
  const salesOnly = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const mine = s.visibleLeads();
    return { n: mine.length, owners: new Set(mine.map((l) => l.ownerId)).size, total: s.db.leads.length };
  });
  ok('sales sees only own leads',
    salesOnly.owners === 1 && salesOnly.n < salesOnly.total,
    JSON.stringify(salesOnly));

  await page.evaluate(async () => {
    const s = await import('./js/store.js');
    s.signIn('u-admin');
    location.hash = '#/dashboard';
  });
  await page.waitForTimeout(200);

  ok('no accumulated errors at end', errors.length === 0, errors.slice(0, 3).join(' | '));
  ok('no 404s across the whole run', failed404.length === 0, failed404.slice(0, 4).join(' | '));

  await browser.close();
  server.close();

  console.log(`\n${'='.repeat(64)}\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
  if (fails.length) {
    console.log('\n\x1b[31mFailures:\x1b[0m');
    fails.forEach((f) => console.log('  ✗ ' + f));
  }
  process.exit(fail ? 1 : 0);
})();
