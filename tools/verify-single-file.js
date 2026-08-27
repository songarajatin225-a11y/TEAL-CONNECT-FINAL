#!/usr/bin/env node
/* ==========================================================================
   Check that dist/leadconnect.html is genuinely self-contained and works.

     node tools/build-single-file.js && node tools/verify-single-file.js

   The thing most likely to go wrong in a single-file build is not a broken
   feature — it is a file that quietly did not get inlined. That fails only on
   the customer's server, where the missing request 404s and a screen renders
   empty. So this asserts on the network as hard as it asserts on the app: over
   HTTP, exactly one request may be made, for the page itself.

   It then loads the same file over file:// — no server at all — because that
   is the case the single-file build exists for.
   ========================================================================== */

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'dist', 'leadconnect.html');

let pass = 0, fail = 0; const fails = [];
const ok = (n, c, extra) => {
  if (c) { pass++; console.log(`  ok  ${n}`); }
  else { fail++; fails.push(n + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${n}${extra ? ` — ${extra}` : ''}`); }
};

const ROUTES = [
  ['/dashboard', 'Command Center'], ['/leads', 'Leads'], ['/pipeline', 'Pipeline'],
  ['/followups', 'Follow-up'], ['/companies', 'Companies'], ['/contacts', 'Contacts'],
  ['/products', 'Product Intelligence'], ['/exhibitions', 'Exhibition Intelligence'],
  ['/analytics', 'Business Intelligence'], ['/team', 'Team'], ['/settings', 'Settings'],
  ['/capture', 'Capture Lead'], ['/present', 'Presentation'],
];

(async () => {
  if (!fs.existsSync(FILE)) {
    console.error('\ndist/leadconnect.html not found. Run tools/build-single-file.js first.\n');
    process.exit(1);
  }

  const size = fs.statSync(FILE).size;
  const html = fs.readFileSync(FILE, 'utf8');

  console.log(`\n== the file itself (${(size / 1024).toFixed(0)} KB) ==`);

  ok('no stylesheet or script is loaded from another file',
    !/<link[^>]+rel=["']stylesheet/i.test(html) && !/<script[^>]+\bsrc=/i.test(html),
    (html.match(/<script[^>]+src=[^>]*>/i) || html.match(/<link[^>]+stylesheet[^>]*>/i) || [''])[0]);

  ok('artwork is inlined as data URIs',
    html.includes('data:image/svg+xml;base64,') && !/["'][^"']*assets\/[a-z-]+\.svg/.test(html));

  ok('the config block is present and editable',
    html.includes('CONFIG — EDIT THIS') && html.includes('window.TEAL_CONFIG'));

  ok('the reference data is carried inside the file',
    html.includes('window.TEAL_SEED') && html.includes('TEAL-PROD26-00001'));

  /* ---- over HTTP ------------------------------------------------------- */
  const server = http.createServer((req, res) => {
    if (req.url.split('?')[0] !== '/leadconnect.html') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/leadconnect.html`;

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--allow-file-access-from-files'],
  });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => requests.push(r.url()));

  console.log('\n== served over HTTP ==');
  await page.goto(url, { waitUntil: 'networkidle' });

  ok('the page makes exactly one request — itself',
    requests.length === 1, `${requests.length}: ${requests.slice(0, 4).join(' , ')}`);
  ok('boots with no errors', errors.length === 0, errors.slice(0, 2).join(' | '));

  const signin = await page.textContent('#view');
  ok('the sign-in screen renders', /Choose an account/i.test(signin), signin.slice(0, 60));

  await page.click('[data-user="u-admin"]');
  await page.waitForTimeout(400);
  ok('signing in reaches the dashboard',
    (await page.evaluate(() => location.hash)) === '#/dashboard',
    await page.evaluate(() => location.hash));

  console.log('\n== every route renders ==');
  for (const [route, expect] of ROUTES) {
    await page.evaluate((r) => { location.hash = `#${r}`; }, route);
    await page.waitForTimeout(220);
    const text = await page.textContent('#view');
    ok(`${route} renders`, new RegExp(expect, 'i').test(text), text.slice(0, 50).replace(/\s+/g, ' '));
  }

  console.log('\n== a lead captured through the form survives a reload ==');
  await page.evaluate(() => { location.hash = '#/capture'; });
  await page.waitForTimeout(350);

  const countLeads = () => page.evaluate(() => {
    const raw = localStorage.getItem('teal.leadconnect.v2');
    return raw ? JSON.parse(raw).leads.length : 0;
  });

  const before = await countLeads();

  // Name, company and the consent tick are what the form actually requires;
  // everything else is optional by design, because a booth conversation does
  // not pause for a form. Consent lives on the last step, so the form is
  // driven the way a person would drive it.
  await page.fill('#d-contactName', 'Single File Visitor');
  await page.fill('#d-companyName', 'One Page Industries Ltd');
  await page.fill('#d-email', 'visitor@onepage.test');

  await page.click('[data-step="3"]');
  await page.waitForTimeout(300);
  await page.check('#d-consent');
  await page.waitForTimeout(150);

  await page.click('#save');
  await page.waitForTimeout(700);

  // If the form rejected the save it says so in its own alert region; surface
  // that rather than reporting a bare count mismatch.
  const saveError = await page.evaluate(() =>
    document.getElementById('save-error')?.textContent?.trim() || '');
  ok('the form accepted the capture', saveError === '', saveError);

  const after = await countLeads();
  ok('the captured lead is saved', after === before + 1, `${before} -> ${after}`);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const survived = await page.evaluate(() => {
    const raw = localStorage.getItem('teal.leadconnect.v2');
    if (!raw) return null;
    const db = JSON.parse(raw);
    const company = db.companies.find((c) => c.name === 'One Page Industries Ltd');
    const contact = db.contacts.find((c) => c.name === 'Single File Visitor');
    return {
      leads: db.leads.length,
      linked: !!(company && contact
        && db.leads.some((l) => l.companyId === company.id && l.contactId === contact.id)),
    };
  });

  ok('it is still there after a reload', survived && survived.leads === after,
    JSON.stringify(survived));
  ok('and its company and contact came with it', survived && survived.linked);

  // Quick Add is the other way in, from any screen.
  await page.evaluate(() => { location.hash = '#/dashboard'; });
  await page.waitForTimeout(350);
  await page.click('#quickadd-btn');
  await page.waitForTimeout(300);
  ok('Quick Add opens from the topbar',
    await page.evaluate(() => !!document.querySelector('.dlg [role="dialog"]')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('and Escape closes it',
    await page.evaluate(() => !document.querySelector('.dlg [role="dialog"]')));

  console.log('\n== themes ==');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(150);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    ok(`${theme} theme paints a background`, bg && bg !== 'rgba(0, 0, 0, 0)', bg);
  }

  await ctx.close();

  /* ---- straight from disk ---------------------------------------------- */
  console.log('\n== opened from disk, no server ==');
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page2 = await ctx2.newPage();
  const diskErrors = [];
  page2.on('pageerror', (e) => diskErrors.push(e.message));
  page2.on('console', (m) => { if (m.type() === 'error') diskErrors.push(m.text()); });

  await page2.goto(`file://${FILE}`);
  await page2.waitForTimeout(900);

  ok('boots from file:// with no errors', diskErrors.length === 0, diskErrors.slice(0, 2).join(' | '));
  ok('the sign-in screen renders from disk',
    /Choose an account/i.test(await page2.textContent('#view')));

  await page2.click('[data-user="u-priya"]');
  await page2.waitForTimeout(400);
  const salesText = await page2.textContent('#view');
  ok('a sales user can sign in and see their dashboard from disk',
    /Command Center/i.test(salesText), salesText.slice(0, 50).replace(/\s+/g, ' '));

  await browser.close();
  server.close();

  console.log('\n' + '='.repeat(64));
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) { console.log('\nFailures:'); for (const f of fails) console.log('  ✗ ' + f); }
  process.exit(fail ? 1 : 0);
})();
