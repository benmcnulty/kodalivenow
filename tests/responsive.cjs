#!/usr/bin/env node
/**
 * Responsive checkpoint suite for kodalivenow.com.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:8901 node tests/responsive.cjs          # local
 *   BASE_URL=https://kodalivenow.com node tests/responsive.cjs        # production
 *   SHOT_PREFIX=prod node tests/responsive.cjs                        # prefix screenshots
 *
 * Exit 0 only when every assertion passes. Prints per-viewport pass/fail.
 */
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8901';
const SHOT_PREFIX = process.env.SHOT_PREFIX || '';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

// file:// mode: this box's Chromium blocks localhost HTTP (Local Network Access
// checks), so local runs use file URLs. Map clean page paths to files.
const FILE_MODE = BASE.startsWith('file://');
const SITE_ROOT = FILE_MODE ? BASE.replace(/^file:\/\//, '') : null;
const PAGES = ['/', '/about/', '/now/', '/code/'];
function pageUrl(p) {
  if (!FILE_MODE) return BASE + p;
  const rel = p === '/' ? '/index.html' : p + 'index.html';
  return 'file://' + path.join(SITE_ROOT, rel);
}
const CHECKPOINTS = [
  { w: 320, h: 568 }, { w: 360, h: 740 }, { w: 375, h: 667 },
  { w: 390, h: 844 }, { w: 414, h: 896 }, { w: 768, h: 1024 },
  { w: 820, h: 1180 }, { w: 1024, h: 768 }, { w: 1280, h: 800 },
  { w: 1440, h: 900 }, { w: 1920, h: 1080 },
];
const PROBES = [500, 600, 700, 900, 1100, 1600].map(w => ({ w, h: 800 }));

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; }
  else { fail++; failures.push(`${name}: ${detail}`); console.log(`  FAIL ${name} — ${detail}`); }
}

async function pageChecks(page, pagePath, vp, full) {
  const tag = `${pagePath} @ ${vp.w}x${vp.h}`;
  await page.goto(pageUrl(pagePath), { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(600); // let reveal animations / canvas settle

  // 1. No horizontal page overflow
  const overflow = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
  }));
  check(`${tag} no-h-overflow`, overflow.sw <= overflow.iw + 1,
    `scrollWidth=${overflow.sw} innerWidth=${overflow.iw}`);

  if (!full) return;

  // 2. Hero portrait (index only): never clipped above viewport, stays behind text
  if (pagePath === '/') {
    const peek = await page.evaluate(() => {
      const el = document.querySelector('.hero-peek');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const h1 = document.querySelector('.hero h1');
      const hr = h1 ? h1.getBoundingClientRect() : null;
      return { top: r.top, bottom: r.bottom, z: cs.zIndex, h1Top: hr ? hr.top : null };
    });
    check(`${tag} peek-present`, !!peek, 'missing .hero-peek');
    if (peek) {
      check(`${tag} peek-top>=0`, peek.top >= -1, `top=${peek.top.toFixed(1)}`);
      check(`${tag} peek-behind-text`, peek.z === '-1', `z-index=${peek.z}`);
      // portrait should peek OVER the text block top on narrow layouts
      // (wide layout centers it behind the headline — different accepted design)
      if (peek.h1Top !== null && vp.w < 900) {
        check(`${tag} peek-above-headline`, peek.top < peek.h1Top,
          `peekTop=${peek.top.toFixed(1)} h1Top=${peek.h1Top.toFixed(1)}`);
      }
    }
  }

  // 3. Nav: page-level overflow already asserted; at >=360px all links must fit without internal scroll
  const nav = await page.evaluate(() => {
    const ul = document.querySelector('.nav-links');
    const r = ul.getBoundingClientRect();
    return { scrollW: ul.scrollWidth, clientW: ul.clientWidth, right: r.right, iw: window.innerWidth };
  });
  if (vp.w >= 360) {
    check(`${tag} nav-fits`, nav.scrollW <= nav.clientW + 1 && nav.right <= nav.iw + 1,
      `scrollW=${nav.scrollW} clientW=${nav.clientW} right=${nav.right.toFixed(1)}`);
  }

  // 4. Primary tap targets >= 44px tall
  const targets = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.nav-links a, .social-chip, .stack-btn, .btn')];
    return els.filter(e => e.offsetParent !== null).map(e => {
      const r = e.getBoundingClientRect();
      return { tag: e.tagName, cls: e.className.toString().slice(0, 40), h: r.height, w: r.width };
    });
  });
  for (const t of targets) {
    check(`${tag} tap-${t.cls || t.tag}`, t.h >= 43, `h=${t.h.toFixed(1)} w=${t.w.toFixed(1)}`);
  }

  // 5. Semantic landmarks + meta (once per page, at first checkpoint)
  if (vp.w === 390) {
    const sem = await page.evaluate(() => ({
      header: !!document.querySelector('header.site-header'),
      nav: !!document.querySelector('nav[aria-label]'),
      main: !!document.querySelector('main'),
      footer: !!document.querySelector('footer'),
      desc: (document.querySelector('meta[name="description"]') || {}).content || '',
      og: (document.querySelector('meta[property="og:title"]') || {}).content || '',
      h1: (document.querySelector('h1') || { textContent: '' }).textContent.trim().slice(0, 40),
    }));
    check(`${tag} landmarks`, sem.header && sem.nav && sem.main && sem.footer, JSON.stringify(sem));
    check(`${tag} meta`, sem.desc.length > 20 && sem.og.length > 0 && sem.h1.length > 0,
      `desc=${sem.desc.length} og=${!!sem.og} h1="${sem.h1}"`);
  }

  // Screenshot per checkpoint for /
  if (pagePath === '/') {
    const name = `${SHOT_PREFIX ? SHOT_PREFIX + '-' : ''}${vp.w}x${vp.h}.png`;
    await page.screenshot({ path: path.join(SHOTS, name) });
  }
}

async function noJsChecks(browser) {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  for (const p of ['/', '/about/']) {
    const tag = `nojs ${p}`;
    await page.goto(pageUrl(p), { waitUntil: 'domcontentloaded', timeout: 30000 });
    const c = await page.evaluate(() => ({
      h1: (document.querySelector('h1') || { textContent: '' }).textContent.trim().length,
      navLinks: document.querySelectorAll('.nav-links a').length,
      paras: document.querySelectorAll('main p').length,
      polaroids: document.querySelectorAll('.polaroid').length,
    }));
    check(`${tag} h1`, c.h1 > 0, `h1len=${c.h1}`);
    check(`${tag} nav`, c.navLinks === 4, `links=${c.navLinks}`);
    check(`${tag} copy`, c.paras > 2, `paras=${c.paras}`);
    if (p === '/') check(`${tag} polaroids-static`, c.polaroids === 4, `polaroids=${c.polaroids}`);
  }
  await ctx.close();
}

(async () => {
  // Route external traffic through the box's egress proxy when testing https.
  const launchOpts = {};
  if (BASE.startsWith('https://')) {
    try {
      const pu = new URL(process.env.https_proxy || process.env.HTTPS_PROXY || '');
      if (pu.host) {
        launchOpts.proxy = { server: `${pu.protocol}//${pu.host}` };
        if (pu.username) launchOpts.proxy.username = decodeURIComponent(pu.username);
        if (pu.password) launchOpts.proxy.password = decodeURIComponent(pu.password);
      }
    } catch { /* no proxy */ }
  }
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  console.log(`BASE=${BASE}`);
  for (const vp of CHECKPOINTS) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    for (const p of PAGES) {
      try { await pageChecks(page, p, vp, true); }
      catch (e) { check(`${p} @ ${vp.w}`, false, `threw: ${e.message.split('\n')[0]}`); }
    }
  }
  console.log('-- in-between probes (overflow only) --');
  for (const vp of PROBES) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    for (const p of PAGES) {
      try { await pageChecks(page, p, vp, false); }
      catch (e) { check(`${p} @ ${vp.w}`, false, `threw: ${e.message.split('\n')[0]}`); }
    }
  }
  console.log('-- no-JS agent-guest checks --');
  await noJsChecks(browser);

  // llms.txt reachable (production) or present on disk (file:// local)
  try {
    if (FILE_MODE) {
      const p = path.join(SITE_ROOT, 'llms.txt');
      const body = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
      check('llms.txt', body.includes('kodalivenow.com'), `disk len=${body.length}`);
    } else {
      const r = await page.goto(BASE + '/llms.txt', { waitUntil: 'domcontentloaded', timeout: 15000 });
      const body = r ? await r.text() : '';
      check('llms.txt', r && r.status() === 200 && body.includes('kodalivenow.com'),
        `status=${r && r.status()} len=${body.length}`);
    }
  } catch (e) { check('llms.txt', false, e.message.split('\n')[0]); }

  await browser.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (failures.length) { console.log('Failures:'); failures.slice(0, 40).forEach(f => console.log(' -', f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR', e); process.exit(2); });
