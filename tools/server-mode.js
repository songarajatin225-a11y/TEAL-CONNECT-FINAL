/* ==========================================================================
   Server-mode integration test.

   The smoke and accessibility suites run the app in demo mode, which is the
   path that does not touch the backend. This one drives the path that does:
   a stub speaking just enough PostgREST and GoTrue for the real client to
   talk to, and the real app on top of it.

   It is a stub rather than a live project on purpose — the test has to run in
   CI, offline, without credentials, and without anyone's production data. What
   it proves is the wiring: that config.json selects server mode, that the
   vendored client signs in, that loadAll hydrates every collection through the
   camelCase mapping, that an optimistic write returns synchronously and then
   drains through the outbox in dependency order, and that a capture made
   offline survives a reload and syncs when the connection returns.

   What it cannot prove is that the row-level policies are right. That is what
   supabase/tests/run.sh does, against a real PostgreSQL.

     node tools/server-mode.js
   ========================================================================== */

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE_PATH = '/Lead-2/';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css' };

let pass = 0, fail = 0; const fails = [];

/* Polled from Node rather than through page.waitForFunction. That helper takes
   a predicate evaluated in the page, and an async one that dynamic-imports a
   module resolves on the promise object rather than on what it settles to —
   which reports success the moment it is called. */
async function waitFor(page, label, predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await page.evaluate(predicate);
    if (last) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`  (timed out waiting for ${label}; last value ${JSON.stringify(last)})`);
  return false;
}

const ok = (n, c, extra) => {
  if (c) { pass++; console.log(`  ok  ${n}`); }
  else { fail++; fails.push(n + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${n}${extra ? ` — ${extra}` : ''}`); }
};

/* ---- the stub backend ---------------------------------------------------- */

const AUTH_UID = '11111111-1111-1111-1111-111111111111';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/* supabase-js decodes the access token to find its expiry. It does not verify
   the signature client-side — that is the server's job — so a well-formed
   token with a real payload is enough to exercise the client. */
function makeToken() {
  const now = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({ sub: AUTH_UID, aud: 'authenticated', role: 'authenticated',
          email: 'admin@teal.test', iat: now, exp: now + 3600 }),
    'stub-signature',
  ].join('.');
}

function loadSeed(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', `${name}.json`), 'utf8'));
}

/* The seed files are camelCase; the database is snake_case, and the mapping is
   exactly what is under test. So the stub converts on the way out — if the
   client's fromRow disagrees, the app renders empty fields and the assertions
   below catch it. */
const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const RENAMES = { exhibitions: { start: 'start_date', end: 'end_date' } };

function toRows(table, records) {
  return records.map((r) => {
    const row = {};
    for (const [k, v] of Object.entries(r)) {
      row[RENAMES[table]?.[k] ?? snake(k)] = v;
    }
    return row;
  });
}

const received = [];          // every write the app sent

function backend() {
  const users = loadSeed('users');
  const admin = users.find((u) => u.role === 'admin');

  const tables = {
    profiles: toRows('profiles', users.map((u) => ({
      ...u, authUserId: u.id === admin.id ? AUTH_UID : null,
    }))),
    exhibitions:   toRows('exhibitions',   loadSeed('exhibitions')),
    products:      toRows('products',      loadSeed('products')),
    companies:     toRows('companies',     loadSeed('companies')),
    contacts:      toRows('contacts',      loadSeed('contacts')),
    leads:         toRows('leads',         loadSeed('leads')),
    activities:    toRows('activities',    loadSeed('activities')),
    notifications: toRows('notifications', loadSeed('notifications')),
    notifications_for_me: toRows('notifications', loadSeed('notifications'))
      .map((n) => ({ ...n, read_by_me: n.read })),
    app_settings:  [{ id: 'singleton', payload: loadSeed('settings') }],
    audit_log:     [],
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://stub');
    const send = (code, body) => {
      res.writeHead(code, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'access-control-expose-headers': 'content-range',
      });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };

    if (req.method === 'OPTIONS') return send(200, {});

    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      // --- GoTrue ---
      if (url.pathname === '/auth/v1/token') {
        const creds = JSON.parse(body || '{}');
        if (creds.password !== 'correct-horse') {
          return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        }
        const token = makeToken();
        return send(200, {
          access_token: token, refresh_token: 'stub-refresh', token_type: 'bearer',
          expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: AUTH_UID, email: creds.email, aud: 'authenticated', role: 'authenticated',
                  app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
        });
      }
      if (url.pathname === '/auth/v1/logout') return send(204);
      if (url.pathname === '/auth/v1/user')   return send(200, { id: AUTH_UID, email: 'admin@teal.test' });

      // --- PostgREST ---
      const rest = url.pathname.match(/^\/rest\/v1\/(.+)$/);
      if (rest) {
        const name = rest[1];

        if (name.startsWith('rpc/')) {
          const fn = name.slice(4);
          if (fn === 'next_lead_code') return send(200, 'TEAL-PROD26-09999');
          if (fn === 'find_duplicate_lead') return send(200, []);
          return send(404, { message: `no function ${fn}` });
        }

        if (req.method === 'GET') {
          let rows = tables[name] ?? [];
          // Only the filter the app actually uses: eq on a single column.
          for (const [key, raw] of url.searchParams) {
            if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
            if (raw.startsWith('eq.')) {
              const want = raw.slice(3);
              rows = rows.filter((r) => String(r[key]) === want);
            }
          }
          return send(200, rows);
        }

        if (req.method === 'POST' || req.method === 'PATCH') {
          received.push({ table: name, method: req.method, body: JSON.parse(body || 'null'),
                          query: url.search });
          return send(201);
        }
      }

      send(404, { message: 'stub: no route' });
    });
  });
  return server;
}

/* ---- static host --------------------------------------------------------- */

function serveApp(supabaseUrl) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (!url.startsWith(BASE_PATH)) { res.writeHead(404); res.end(); return; }
      const rel = url.slice(BASE_PATH.length) || 'index.html';

      // Served rather than read from disk: this is exactly what the container
      // entrypoint does in production.
      if (rel === 'config.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          supabaseUrl, supabaseAnonKey: 'stub-anon-key', mode: 'server',
          environmentLabel: 'Test',
        }));
        return;
      }

      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(buf);
      });
    }).listen(0, () => resolve(server));
  });
}

/* ---- the run ------------------------------------------------------------- */

(async () => {
  const api = backend();
  await new Promise((r) => api.listen(0, r));
  const supabaseUrl = `http://127.0.0.1:${api.address().port}`;

  const web = await serveApp(supabaseUrl);
  const base = `http://127.0.0.1:${web.address().port}${BASE_PATH}`;

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  console.log('\n== boot ==');
  await page.goto(base, { waitUntil: 'networkidle' });

  ok('server mode is selected from config.json',
    await page.evaluate(async () => (await import('./js/store.js')).isServerMode()));

  const signinText = await page.textContent('#view');
  ok('sign-in asks for credentials, not an account to pick',
    /Work email/i.test(signinText) && !/Choose an account/i.test(signinText),
    signinText.slice(0, 80));

  console.log('\n== rejects bad credentials ==');
  await page.fill('#signin-email', 'admin@teal.test');
  await page.fill('#signin-password', 'wrong');
  await page.click('#signin-submit');
  await page.waitForSelector('#signin-error:not([hidden])', { timeout: 5000 });

  ok('a wrong password is reported in plain language',
    /do not match/i.test(await page.textContent('#signin-error')),
    await page.textContent('#signin-error'));
  ok('a failed sign-in does not enter the app',
    (await page.evaluate(() => location.hash)) !== '#/dashboard');

  console.log('\n== signs in ==');
  // The rejected sign-in above is a 400 by design; clear it before asserting
  // that the successful path is clean.
  errors.length = 0;
  await page.fill('#signin-password', 'correct-horse');
  await page.click('#signin-submit');
  await page.waitForFunction(() => location.hash === '#/dashboard', { timeout: 10000 });
  await page.waitForTimeout(500);

  const loaded = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    return {
      me: s.me()?.name, role: s.role(),
      leads: s.db.leads.length, companies: s.db.companies.length,
      contacts: s.db.contacts.length, activities: s.db.activities.length,
      products: s.db.products.length, exhibitions: s.db.exhibitions.length,
    };
  });

  ok('the signed-in profile resolves', loaded.me === 'Jatin Songara', JSON.stringify(loaded));
  ok('the role comes from the profile row', loaded.role === 'admin', loaded.role);
  ok('every collection hydrated from the server',
    loaded.leads === 64 && loaded.companies === 30 && loaded.contacts === 64
    && loaded.activities === 246 && loaded.products === 18 && loaded.exhibitions === 3,
    JSON.stringify(loaded));

  console.log('\n== snake_case maps back to what the views read ==');
  const mapped = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const lead = s.hydrate(s.db.leads.find((l) => l.id === 'ld-001'));
    return {
      companyId: lead.companyId, exhibitionId: lead.exhibitionId, ownerId: lead.ownerId,
      nextFollowUp: lead.nextFollowUp, nextBestAction: lead.nextBestAction,
      capturedAt: lead.capturedAt, companyName: lead.companyName,
      valueType: typeof lead.value,
      exhibitionStart: s.db.exhibitions[0].start, boothCostType: typeof s.db.exhibitions[0].boothCost,
    };
  });

  ok('foreign keys map back to camelCase',
    mapped.companyId === 'co-001' && mapped.exhibitionId === 'ex-prod26'
    && mapped.ownerId === 'u-priya', JSON.stringify(mapped));
  ok('multi-word columns map back',
    mapped.nextFollowUp === '2026-08-13' && typeof mapped.nextBestAction === 'string',
    JSON.stringify(mapped));
  ok('the company join still resolves', mapped.companyName === 'Vertex Microsystems Pvt Ltd',
    mapped.companyName);
  ok('start_date maps back to start, not startDate', !!mapped.exhibitionStart, mapped.exhibitionStart);
  ok('numerics arrive as numbers',
    mapped.valueType === 'number' && mapped.boothCostType === 'number', JSON.stringify(mapped));

  console.log('\n== the dashboard renders real server data ==');
  const dash = await page.textContent('#view');
  ok('the dashboard is not empty', dash.length > 400, `${dash.length} chars`);
  ok('no page errors through sign-in and first render', errors.length === 0,
    errors.slice(0, 2).join(' | '));

  console.log('\n== an optimistic write drains in dependency order ==');
  received.length = 0;

  const created = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const lead = s.createLead({
      contactName: 'Test Visitor', companyName: 'Brand New Metalworks Ltd',
      email: 'test.visitor@brandnew.test', phone: '+91 90000 11111',
      city: 'Pune', industry: 'Automotive', application: 'Laser cutting',
      timeline: 'Immediate', budget: '< ₹25 L', authority: 'Decision Maker',
      consent: true,
    });
    return { code: lead.code, id: lead.id, company: lead.companyName, owner: lead.ownerId };
  });

  ok('createLead still returns the joined record synchronously',
    created.company === 'Brand New Metalworks Ltd' && !!created.code, JSON.stringify(created));

  const drained = await waitFor(page, 'the outbox to drain',
    async () => (await import('./js/store.js')).pendingCount() === 0);

  const order = received.filter((r) => r.method === 'POST').map((r) => r.table);
  ok('the outbox drained by itself, with no manual flush', drained);
  ok('company is sent before contact before lead',
    order.indexOf('companies') < order.indexOf('contacts')
    && order.indexOf('contacts') < order.indexOf('leads'),
    order.join(' → '));
  ok('the activity and the audit entry are sent too',
    order.includes('activities') && order.includes('audit_log'), order.join(' → '));

  const leadWrite = received.find((r) => r.table === 'leads');
  ok('the lead is written in snake_case',
    leadWrite && 'company_id' in leadWrite.body && 'next_follow_up' in leadWrite.body
    && 'owner_id' in leadWrite.body,
    leadWrite ? Object.keys(leadWrite.body).slice(0, 6).join(',') : 'nothing sent');
  ok('an empty follow-up date is sent as null, not an empty string',
    leadWrite && leadWrite.body.next_follow_up === null,
    leadWrite ? String(leadWrite.body.next_follow_up) : 'n/a');
  ok('joined display fields are not sent as columns',
    leadWrite && !('company_name' in leadWrite.body) && !('company' in leadWrite.body),
    leadWrite ? Object.keys(leadWrite.body).join(',') : 'n/a');

  console.log('\n== a capture made offline survives a reload ==');
  await ctx.setOffline(true);
  await page.evaluate(async () => {
    const s = await import('./js/store.js');
    s.createLead({
      contactName: 'Offline Visitor', companyName: 'Disconnected Systems Ltd',
      email: 'offline@disconnected.test', consent: true,
    });
  });

  const offlineState = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    return {
      pending: s.pendingCount(),
      // Durability is the property that matters: the queue has to be on disk,
      // not just in a variable that a reload would discard.
      stored: JSON.parse(localStorage.getItem('teal.leadconnect.queue.v2') || '[]').map((o) => o.op),
      label: (await import('./js/shell.js'), document.getElementById('netdot').textContent),
    };
  });

  ok('the write is queued while offline', offlineState.pending > 0, String(offlineState.pending));
  ok('the queue is written to disk, not just held in memory',
    offlineState.stored.includes('create_lead'), offlineState.stored.join(','));
  ok('the indicator says offline and how many are waiting',
    /offline/i.test(offlineState.label), offlineState.label);

  received.length = 0;
  await ctx.setOffline(false);

  // A full reload, now that the network is back. Playwright's offline mode
  // blocks the document request itself, so reloading while offline is not
  // something this harness can express — what it can prove is that the queue
  // written to disk before the reload is picked up after it and sent.
  await page.reload({ waitUntil: 'networkidle' });

  const recovered = await waitFor(page, 'the recovered queue to drain',
    async () => (await import('./js/store.js')).pendingCount() === 0);

  ok('the queue written before the reload is picked up after it', recovered);
  ok('and the offline capture reaches the server',
    received.some((r) => r.table === 'leads'),
    received.map((r) => r.table).join(',') || 'nothing sent');
  ok('the company created offline is sent before its lead',
    received.findIndex((r) => r.table === 'companies') <
    received.findIndex((r) => r.table === 'leads'),
    received.map((r) => r.table).join(','));

  await page.waitForTimeout(200);
  ok('the indicator returns to synced',
    /synced/i.test(await page.textContent('#netdot')), await page.textContent('#netdot'));

  console.log('\n== signing out clears the device ==');
  await page.evaluate(async () => {
    const s = await import('./js/store.js');
    await s.signOut();
  });
  await page.waitForTimeout(300);
  const afterSignOut = await page.evaluate(() => ({
    cache: localStorage.getItem('teal.leadconnect.v2'),
    queue: localStorage.getItem('teal.leadconnect.queue.v2'),
  }));
  ok('the cached book is removed on sign-out', afterSignOut.cache === null,
    String(afterSignOut.cache).slice(0, 40));
  ok('the outbox is removed too', afterSignOut.queue === null);

  await browser.close();
  web.close();
  api.close();

  console.log('\n' + '='.repeat(64));
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nFailures:');
    for (const f of fails) console.log('  ✗ ' + f);
  }
  process.exit(fail ? 1 : 0);
})();
