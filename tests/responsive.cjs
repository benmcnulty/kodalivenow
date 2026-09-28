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

  // 2. Hero portrait (index only): Koda peeks OVER the headline —
  // the face sits just above the h1's top-right edge (never blocked
  // by the text) with the body hanging behind the headline text.
  // Animations are cancelled before measuring so placement asserts are
  // deterministic; the idle loop itself is asserted separately below.
  if (pagePath === '/') {
    const peek = await page.evaluate(() => {
      const el = document.querySelector('.hero-peek');
      if (!el) return null;
      const cs = getComputedStyle(el);
      const anim = { name: cs.animationName, dur: cs.animationDuration, iter: cs.animationIterationCount };
      el.getAnimations().forEach(a => a.cancel());
      const r = el.getBoundingClientRect();
      const h1 = document.querySelector('.hero h1');
      const hr = h1 ? h1.getBoundingClientRect() : null;
      // first wrapped line's right edge — the face's horizontal anchor
      let firstR = null;
      if (h1) {
        const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT);
        let first = null, last = null, node;
        while ((node = walker.nextNode())) {
          if (!node.nodeValue.trim()) continue;
          if (!first) first = node;
          last = node;
        }
        if (first) {
          const range = document.createRange();
          range.setStart(first, 0);
          range.setEnd(last, last.nodeValue.length);
          const rects = range.getClientRects();
          if (rects.length) firstR = rects[0].right;
        }
      }
      // eyebrow text's first line — the face must never cover it
      const eb = document.querySelector('.hero .eyebrow');
      let ebR = null, ebB = null;
      if (eb) {
        const erange = document.createRange();
        erange.selectNodeContents(eb);
        const erects = erange.getClientRects();
        if (erects.length) { ebR = erects[0].right; ebB = erects[0].bottom; }
      }
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, z: cs.zIndex,
               cx: r.left + r.width / 2, cy: r.top + r.height / 2,
               h1T: hr ? hr.top : null, h1R: hr ? hr.right : null,
               firstR, ebR, ebB, anim };
    });
    check(`${tag} peek-present`, !!peek, 'missing .hero-peek');
    if (peek) {
      check(`${tag} peek-top>=0`, peek.top >= -1, `top=${peek.top.toFixed(1)}`);
      check(`${tag} peek-behind-text`, peek.z === '-1', `z-index=${peek.z}`);
      // the composition: the FACE (violet-face centroid ~33% down the
      // koda-peek.webp cutout, measured from the asset) sits just above
      // the h1's top edge, just inside the FIRST LINE's right edge —
      // the text's visual top-right corner (the h1's box is wider than
      // its longest wrapped line, so the anchor is measured per
      // viewport by the placement script). Tolerance ±8px.
      const FACE_Y = 0.33;
      if (peek.h1T !== null && peek.firstR !== null) {
        const fx = peek.cx;
        const fy = peek.top + FACE_Y * (peek.bottom - peek.top);
        const h = peek.bottom - peek.top;
        const aboveBy = peek.h1T - fy;
        const dxR = Math.abs(fx - (peek.firstR - 12));
        check(`${tag} peek-face-above-heading`, aboveBy > 2 && aboveBy < 0.30 * h,
          `face=(${fx.toFixed(1)},${fy.toFixed(1)}) h1top=${peek.h1T.toFixed(1)} aboveBy=${aboveBy.toFixed(1)}`);
        check(`${tag} peek-face-top-right`, dxR < 8,
          `fx=${fx.toFixed(1)} target=${(peek.firstR - 12).toFixed(1)}`);
        check(`${tag} peek-body-behind-text`, peek.left < peek.h1R && peek.bottom > peek.h1T,
          `left=${peek.left.toFixed(1)} bottom=${peek.bottom.toFixed(1)}`);
        // the face never covers the eyebrow text: either it sits right
        // of the eyebrow's text end, or fully below it
        if (peek.ebR !== null) {
          const faceL = fx - 0.16 * h;
          const faceTop = fy - 0.125 * h;
          const clears = faceL > peek.ebR - 2 || faceTop > peek.ebB - 2;
          check(`${tag} peek-face-clears-eyebrow`, clears,
            `faceL=${faceL.toFixed(1)} faceTop=${faceTop.toFixed(1)} ebR=${peek.ebR.toFixed(1)} ebB=${peek.ebB.toFixed(1)}`);
        }
      }
      // idle peek-a-boo loop wired (not a static cutout); every keyframe
      // must carry the base 50%/-51% so the loop never drifts off its perch
      if (vp.w === 390) {
        check(`${tag} peek-idle-loop`, peek.anim.name === 'hero-peek-idle' &&
          parseFloat(peek.anim.dur) > 0 && peek.anim.iter === 'infinite',
          `name=${peek.anim.name} dur=${peek.anim.dur} iter=${peek.anim.iter}`);
        const kf = await page.evaluate(() => {
          for (const sh of document.styleSheets) {
            let rules; try { rules = sh.cssRules; } catch { continue; }
            for (const r of rules) {
              if (r.type === CSSRule.KEYFRAMES_RULE && r.name === 'hero-peek-idle') {
                return [...r.cssRules].map(k => k.cssText).join('\n');
              }
            }
          }
          return '';
        });
        const centered = (kf.match(/50%|-51%/g) || []).length;
        check(`${tag} peek-keyframes-centered`, kf.length > 0 && centered >= 10,
          `keyframes=${kf.length}chars base-translate markers=${centered}`);
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

async function reducedMotionChecks(browser) {
  // Visitors who ask for reduced motion get a static portrait: the idle
  // loop must be fully disabled, not just slowed.
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(pageUrl('/'), { waitUntil: 'networkidle', timeout: 30000 });
  const name = await page.evaluate(() => {
    const el = document.querySelector('.hero-peek');
    return el ? getComputedStyle(el).animationName : null;
  });
  check('reduced-motion peek-static', name === 'none', `animationName=${name}`);
  await ctx.close();
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
    check(`${tag} nav`, c.navLinks === 5, `links=${c.navLinks}`);
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
  console.log('-- reduced-motion checks --');
  await reducedMotionChecks(browser);

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
