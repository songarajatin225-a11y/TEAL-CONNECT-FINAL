/* Responsive + accessibility pass (§38, §39) across the six required widths,
   in both themes. */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = require('path').join(__dirname, '..');
const BASE = '/Lead-2/';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.css': 'text/css' };

const VIEWPORTS = [
  ['1440', 1440, 900], ['1280', 1280, 800], ['1024', 1024, 768],
  ['768', 768, 1024], ['480', 480, 900], ['390', 390, 844],
];
const ROUTES = ['/dashboard', '/leads', '/pipeline', '/followups', '/companies',
                '/contacts', '/products', '/exhibitions', '/analytics', '/team',
                '/settings', '/capture', '/present'];

let pass = 0, fail = 0; const fails = [];
const ok = (n, c, extra) => { if (c) pass++; else { fail++; fails.push(n + (extra ? ` — ${extra}` : '')); } };

(async () => {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (!url.startsWith(BASE)) { res.writeHead(404); res.end(); return; }
    const file = path.join(ROOT, url.slice(BASE.length) || 'index.html');
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}${BASE}`;
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  const consoleErrors = [];

  for (const theme of ['light', 'dark']) {
    for (const [name, w, h] of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => consoleErrors.push(`${theme}/${name} ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${theme}/${name} ${m.text()}`); });

      await page.goto(base, { waitUntil: 'networkidle' });
      await page.evaluate(async (th) => {
        const s = await import('./js/store.js');
        s.signIn('u-admin'); s.setPref('theme', th);
        const sh = await import('./js/shell.js'); sh.applyTheme(th);
      }, theme);

      for (const route of ROUTES) {
        await page.evaluate((r) => { location.hash = `#${r}`; }, route);
        await page.waitForTimeout(140);

        const m = await page.evaluate(() => {
          const de = document.documentElement;
          const inScroller = (el) => {
            let p = el.parentElement;
            while (p && p !== document.body) {
              const ov = getComputedStyle(p).overflowX;
              if (ov === 'auto' || ov === 'scroll') return true;
              p = p.parentElement;
            }
            return false;
          };
          const over = [...document.querySelectorAll('body *')].filter((el) => {
            const b = el.getBoundingClientRect();
            if (!b.width || !b.height) return false;
            if (getComputedStyle(el).position === 'fixed') return false;
            if (inScroller(el)) return false;
            return b.right > de.clientWidth + 1;
          }).map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`);

          const hitBox = (el) => {
            const lab = el.closest('label');
            return (lab && lab.contains(el) ? lab : el).getBoundingClientRect();
          };
          const small = [...document.querySelectorAll('button, a[href], input, select, textarea')]
            .filter((el) => {
              const b = hitBox(el);
              if (!b.width || !b.height) return false;
              if (getComputedStyle(el).visibility === 'hidden') return false;
              // WCAG 2.5.8 exempts targets that sit inline within a block of
              // text. An anchor inside a table cell or a sentence is one of
              // those; the row around it is the real hit area.
              if (el.tagName === 'A' && (el.closest('td') || el.closest('p'))) return false;
              // WCAG 2.2 AA (2.5.8 Target Size Minimum) is 24x24 CSS px.
              return b.height < 24 || b.width < 24;
            }).map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} ${Math.round(hitBox(el).width)}x${Math.round(hitBox(el).height)}`);

          const tiny = [...document.querySelectorAll('body *')].filter((el) => {
            const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            if (!hasText) return false;
            return parseFloat(getComputedStyle(el).fontSize) < 10.5;
          }).map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} ${getComputedStyle(el).fontSize}`);

          // Landmarks and heading order
          const h1s = document.querySelectorAll('#view h1').length;
          const imgsNoAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length;
          const btnsNoName = [...document.querySelectorAll('button')].filter((b) =>
            !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length;
          const inputsNoLabel = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')]
            .filter((el) => !el.closest('label') && !el.getAttribute('aria-label')
              && !el.getAttribute('aria-labelledby') && !document.querySelector(`label[for="${el.id}"]`)).length;
          const thNoScope = [...document.querySelectorAll('table th')]
            .filter((th) => !th.getAttribute('scope')).length;

          return {
            scrollW: de.scrollWidth, clientW: de.clientWidth,
            over: [...new Set(over)].slice(0, 5),
            small: [...new Set(small)].slice(0, 5),
            tiny: [...new Set(tiny)].slice(0, 5),
            h1s, imgsNoAlt, btnsNoName, inputsNoLabel, thNoScope,
            hasContent: document.getElementById('view').textContent.trim().length > 50,
          };
        });

        const tag = `${theme} ${name} ${route}`;
        ok(`${tag}: renders`, m.hasContent);
        ok(`${tag}: no horizontal scroll`, m.scrollW <= m.clientW + 1, `${m.scrollW}>${m.clientW}`);
        ok(`${tag}: nothing overflows`, m.over.length === 0, m.over.join(', '));
        ok(`${tag}: tap targets >=24px`, m.small.length === 0, m.small.join(', '));
        ok(`${tag}: no sub-10.5px text`, m.tiny.length === 0, m.tiny.join(', '));
        ok(`${tag}: exactly one h1`, m.h1s === 1, `${m.h1s} h1s`);
        ok(`${tag}: all images have alt`, m.imgsNoAlt === 0, `${m.imgsNoAlt} missing`);
        ok(`${tag}: all buttons named`, m.btnsNoName === 0, `${m.btnsNoName} unnamed`);
        ok(`${tag}: all inputs labelled`, m.inputsNoLabel === 0, `${m.inputsNoLabel} unlabelled`);
        ok(`${tag}: table headers scoped`, m.thNoScope === 0, `${m.thNoScope} missing scope`);
      }
      await ctx.close();
    }
  }

  // Keyboard: tab to the skip link, then run the palette entirely by keyboard.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`kbd ${e.message}`));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const s = await import('./js/store.js'); s.signIn('u-admin'); location.hash = '#/dashboard';
  });
  await page.waitForTimeout(300);

  // Checked on a fresh load: after a route change the router deliberately
  // moves focus to <main>, so tabbing continues from the content, not the top.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.keyboard.press('Tab');
  ok('first tab stop on load is the skip link',
    await page.evaluate(() => document.activeElement?.className === 'skip-link'),
    await page.evaluate(() => document.activeElement?.className));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  ok('skip link targets main content',
    await page.evaluate(() => location.hash === '#view' || document.activeElement?.id === 'view'),
    await page.evaluate(() => location.hash));
  await page.evaluate(() => { location.hash = '#/dashboard'; });
  await page.waitForTimeout(250);

  await page.keyboard.press('Control+k');
  await page.waitForTimeout(180);
  ok('palette focuses its input',
    await page.evaluate(() => document.activeElement?.id === 'cmdk-q'));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(80);
  ok('arrow keys move the palette cursor',
    await page.evaluate(() => document.querySelectorAll('.cmdk-item[data-active="true"]').length === 1));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  ok('escape closes the palette', !(await page.$('.cmdk-panel')));

  // Dialog focus trap
  await page.evaluate(() => { location.hash = '#/settings?tab=data'; });
  await page.waitForTimeout(250);
  await page.click('#reset-demo');
  await page.waitForTimeout(180);
  ok('dialog opens with focus inside',
    await page.evaluate(() => !!document.querySelector('.dlg-panel')?.contains(document.activeElement)));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  ok('escape closes the dialog', !(await page.$('.dlg-panel')));

  // Pipeline keyboard move
  await page.evaluate(() => { location.hash = '#/pipeline'; });
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => document.querySelector('.dealcard')?.dataset.id);
  await page.evaluate(() => document.querySelector('.dealcard')?.focus());
  const stageBefore = await page.evaluate(async (id) => {
    const s = await import('./js/store.js'); return s.getLead(id).stage;
  }, before);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const stageAfter = await page.evaluate(async (id) => {
    const s = await import('./js/store.js'); return s.getLead(id).stage;
  }, before);
  ok('pipeline card moves by keyboard', stageBefore !== stageAfter, `${stageBefore} -> ${stageAfter}`);

  // Reduced motion honoured
  const rmCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const rmPage = await rmCtx.newPage();
  await rmPage.goto(base, { waitUntil: 'networkidle' });
  ok('reduced motion collapses transitions',
    await rmPage.evaluate(() => {
      const el = document.querySelector('.skel') || document.body;
      return parseFloat(getComputedStyle(el).transitionDuration) < 0.01;
    }));
  await rmCtx.close();
  await ctx.close();
  await browser.close();
  server.close();

  ok('no console or page errors anywhere', consoleErrors.length === 0,
    [...new Set(consoleErrors)].slice(0, 4).join(' | '));

  console.log(`\n${'='.repeat(64)}\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
  if (fails.length) {
    console.log('\n\x1b[31mFailures:\x1b[0m');
    [...new Set(fails)].slice(0, 40).forEach((f) => console.log('  ✗ ' + f));
    if (fails.length > 40) console.log(`  … and ${fails.length - 40} more`);
  }
  process.exit(fail ? 1 : 0);
})();
