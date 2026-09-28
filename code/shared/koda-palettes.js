/* KodaPalettes — shared palette math + localStorage settings for Koda's
 * visualization apps. Vanilla JS, zero dependencies. Loads as a classic
 * script and exposes a single global, `KodaPalettes`.
 *
 * Contents:
 *   KodaPalettes.color    — hex/rgb/OKLCH conversions (gamut-safe)
 *   KodaPalettes.harmony  — "aligned hues" suggestion engine
 *   KodaPalettes.createSettingsStore(namespace, defaults)
 *                          — localStorage-only, versioned, debounced settings
 *   KodaPalettes.createPaletteLibrary(builtins)
 *                          — built-in + user palettes, persisted locally
 *
 * Storage contract (testers asked for local-only): settings and user
 * palettes live in window.localStorage under versioned, namespaced keys
 * (`koda.<namespace>.v1`, `koda.user-palettes.v1`). Never cookies, never
 * network. Corrupt or missing data falls back to defaults silently, and a
 * storage exception (private mode, quota) degrades to an in-memory shim
 * instead of breaking the app.
 *
 * Color math notes:
 * Harmonies are computed in OKLCH, a perceptual color space where equal
 * steps in hue read as equal steps to the eye — unlike HSL, whose "even"
 * 120° triads can look lopsided (HSL blue is far darker than HSL yellow
 * at the same "lightness"). We keep the base color's perceptual lightness
 * and chroma character, rotate hue by the classic harmony intervals, then
 * lay the hues across a lightness ramp so the 7-stop set has depth like
 * the hand-built palettes (saturated dark → luminous neutral).
 * sRGB gamut is irregular in OKLCH, so every generated stop is pulled
 * back into gamut with a binary search on chroma at fixed lightness/hue.
 * References: Björn Ottosson's OKLab (2020); OKLCH hue uniformity follows
 * from the space's perceptual design, not from an extra formula.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- color

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function isHexColor(value) {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
  }

  function hexToRgb(hex) {
    // Returns [r, g, b] in 0..1. Throws on invalid input (validate first).
    return [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255
    ];
  }

  function rgbToHex(r, g, b) {
    const to = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
    return ('#' + to(r) + to(g) + to(b)).toUpperCase();
  }

  function srgbToLinear(v) {
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(v) {
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }

  // sRGB (0..1) -> OKLCH { L (0..1), C (>=0), h (0..360) }.
  function rgbToOklch(r, g, b) {
    const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
    const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
    const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    let h = Math.atan2(bb, a) * 180 / Math.PI;
    if (h < 0) h += 360;
    return { L, C: Math.hypot(a, bb), h };
  }

  // OKLCH -> sRGB (0..1), possibly out of gamut; use oklchToHex for safety.
  function oklchToRgb(L, C, hDeg) {
    const hr = hDeg * Math.PI / 180;
    const a = C * Math.cos(hr), b = C * Math.sin(hr);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
  }

  function inSrgbGamut(rgb) {
    return rgb.every((v) => v >= -0.0006 && v <= 1.0006);
  }

  // Largest chroma at (L, h) that stays inside sRGB, via binary search.
  // Starts from the requested chroma so in-gamut colors pass through fast.
  function fitChroma(L, hDeg, wantC) {
    if (wantC <= 0) return 0;
    if (inSrgbGamut(oklchToRgb(L, wantC, hDeg))) return wantC;
    let lo = 0, hi = wantC;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (inSrgbGamut(oklchToRgb(L, mid, hDeg))) lo = mid; else hi = mid;
    }
    return lo;
  }

  function oklchToHex(L, C, hDeg) {
    const c = fitChroma(clamp01(L), ((hDeg % 360) + 360) % 360, Math.max(0, C));
    const linear = oklchToRgb(clamp01(L), c, hDeg);
    // oklchToRgb yields linear-light sRGB; encode back to sRGB for hex.
    return rgbToHex(linearToSrgb(linear[0]), linearToSrgb(linear[1]), linearToSrgb(linear[2]));
  }

  function hexToOklch(hex) {
    const rgb = hexToRgb(hex);
    return rgbToOklch(rgb[0], rgb[1], rgb[2]);
  }

  const color = {
    isHexColor, hexToRgb, rgbToHex, rgbToOklch, oklchToRgb, hexToOklch,
    oklchToHex, fitChroma
  };

  // -------------------------------------------------------------- harmony

  // Classic hue intervals (degrees). Analogous/split use the base hue too.
  const HARMONY_OFFSETS = {
    complementary: [0, 180],
    analogous: [-30, 0, 30],
    triadic: [0, 120, 240],
    square: [0, 90, 180, 270],
    split: [0, 150, 210]
  };

  const HARMONY_LABELS = {
    complementary: 'Complementary',
    analogous: 'Analogous',
    triadic: 'Triadic',
    square: 'Square',
    split: 'Split complementary'
  };

  const HARMONY_KINDS = Object.keys(HARMONY_OFFSETS);

  // A graceful 7-stop gray ramp when the base color has no hue to harmonize.
  function neutralRamp() {
    const colors = [];
    for (let i = 0; i < 7; i++) {
      const L = 0.26 + (i / 6) * 0.67;
      colors.push(oklchToHex(L, 0.004, 0));
    }
    return colors;
  }

  // Build a 7-stop palette from a base hex + harmony kind. Stops 0..5 cycle
  // the harmony hues across a lightness ramp (0.40 → 0.78) with chroma
  // tapering toward the light end; stop 6 is a luminous neutral tint of the
  // base hue, echoing the hand-built palettes' off-white finish.
  function harmonySet(baseHex, kind) {
    if (!isHexColor(baseHex)) throw new Error('harmonySet: invalid base color');
    const offsets = HARMONY_OFFSETS[kind];
    if (!offsets) throw new Error('harmonySet: unknown kind ' + kind);
    const { L: baseL, C: baseC, h: baseH } = hexToOklch(baseHex);
    if (baseC < 0.012) return { colors: neutralRamp(), achromatic: true };
    // Keep the base color's character but cap chroma so the ramp survives
    // gamut fitting without collapsing to gray at the dark end.
    const characterC = Math.min(baseC, 0.30);
    const colors = [];
    for (let i = 0; i < 6; i++) {
      const hue = (((baseH + offsets[i % offsets.length]) % 360) + 360) % 360;
      const t = i / 5;
      const L = 0.40 + t * 0.38;
      const C = characterC * (1 - t * 0.45);
      colors.push(oklchToHex(L, C, hue));
    }
    colors.push(oklchToHex(0.93, 0.018, baseH));
    return { colors, achromatic: false };
  }

  function makePaletteSet(baseHex, kind) {
    const { colors, achromatic } = harmonySet(baseHex, kind);
    const label = HARMONY_LABELS[kind] || kind;
    return {
      name: achromatic ? 'Neutral study' : label + ' · ' + baseHex.toUpperCase(),
      colors,
      kind,
      baseHex: baseHex.toUpperCase(),
      achromatic
    };
  }

  // A fresh harmonious set: random hue, random harmony, random character
  // (jewel-bright to soft pastel). `rand` is injectable for deterministic tests.
  function surprise(rand) {
    const r = typeof rand === 'function' ? rand : Math.random;
    const hue = r() * 360;
    const kind = HARMONY_KINDS[Math.floor(r() * HARMONY_KINDS.length)];
    const L = 0.45 + r() * 0.17;
    const C = 0.14 + r() * 0.14;
    const baseHex = oklchToHex(L, C, hue);
    const set = makePaletteSet(baseHex, kind);
    set.name = 'Surprise · ' + set.name;
    return set;
  }

  const harmony = {
    kinds: HARMONY_KINDS,
    labels: HARMONY_LABELS,
    harmonySet,
    makePaletteSet,
    surprise
  };

  // -------------------------------------------------------------- storage

  // localStorage access that can never throw: private-mode / quota /
  // disabled storage degrades to a per-page in-memory shim.
  function safeStorage() {
    const memory = new Map();
    const shim = {
      getItem: (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => { memory.set(k, String(v)); },
      removeItem: (k) => { memory.delete(k); }
    };
    try {
      const ls = global.localStorage;
      if (!ls || typeof ls.getItem !== 'function') return shim;
      const probe = '__koda_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return {
        getItem: (k) => { try { return ls.getItem(k); } catch (e) { return shim.getItem(k); } },
        setItem: (k, v) => { try { ls.setItem(k, v); } catch (e) { shim.setItem(k, v); } },
        removeItem: (k) => { try { ls.removeItem(k); } catch (e) { shim.removeItem(k); } }
      };
    } catch (e) {
      return shim;
    }
  }

  // Validate a stored values object against the defaults' shapes.
  // Unknown keys are dropped; wrong-typed or missing keys fall back.
  function sanitizeValues(defaults, raw) {
    const clean = {};
    for (const key of Object.keys(defaults)) {
      const def = defaults[key];
      const val = raw ? raw[key] : undefined;
      if (def === null) {
        clean[key] = (val === null || Array.isArray(val)) ? val : null;
      } else if (Array.isArray(def)) {
        clean[key] = Array.isArray(val) ? val : def.slice();
      } else if (typeof def === 'number') {
        clean[key] = (typeof val === 'number' && Number.isFinite(val)) ? val : def;
      } else if (typeof def === 'string') {
        clean[key] = typeof val === 'string' ? val : def;
      } else if (typeof def === 'boolean') {
        clean[key] = typeof val === 'boolean' ? val : def;
      } else {
        clean[key] = def;
      }
    }
    return clean;
  }

  // Versioned, debounced, localStorage-only settings store.
  function createSettingsStore(namespace, defaults, options) {
    const opts = options || {};
    const key = 'koda.' + namespace + '.v1';
    const storage = opts.storage || safeStorage();
    const debounceMs = typeof opts.debounceMs === 'number' ? opts.debounceMs : 200;
    let state = Object.assign({}, defaults);
    let timer = null;

    function read() {
      let raw = null;
      try {
        const text = storage.getItem(key);
        if (text) raw = JSON.parse(text);
      } catch (e) { raw = null; }
      const values = raw && typeof raw === 'object' && raw.v === 1 ? raw.values : null;
      state = sanitizeValues(defaults, values);
      return snapshot();
    }

    function writeNow() {
      timer = null;
      try {
        storage.setItem(key, JSON.stringify({ v: 1, values: state }));
      } catch (e) { /* never break the app for storage */ }
    }

    function scheduleWrite() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(writeNow, debounceMs);
    }

    function snapshot() { return Object.assign({}, state); }

    return {
      key,
      load: read,
      getState: snapshot,
      get(k) { return state[k]; },
      set(k, value) {
        if (!(k in defaults)) return;
        const clean = sanitizeValues(defaults, Object.assign({}, state, { [k]: value }));
        state[k] = clean[k];
        scheduleWrite();
      },
      setAll(patch) {
        const clean = sanitizeValues(defaults, Object.assign({}, state, patch));
        state = clean;
        scheduleWrite();
      },
      reset() {
        if (timer) { clearTimeout(timer); timer = null; }
        state = Object.assign({}, defaults);
        writeNow();
      },
      // Call on pagehide so the latest choices survive even if the
      // debounce timer never fires.
      flush() {
        if (timer) { clearTimeout(timer); }
        writeNow();
      }
    };
  }

  // ------------------------------------------------------ palette library

  const MAX_USER_PALETTES = 24;
  const MAX_NAME_LENGTH = 40;

  function validPaletteColors(colors) {
    return Array.isArray(colors) && colors.length === 7 && colors.every(isHexColor);
  }

  function cleanName(name, fallback) {
    const s = typeof name === 'string' ? name.trim().slice(0, MAX_NAME_LENGTH) : '';
    return s || fallback;
  }

  // conic-gradient for the swatch buttons (shared so every app renders
  // palette swatches identically).
  function swatchCSS(colors) {
    const stops = colors.map((c) => c.toUpperCase());
    return 'conic-gradient(' + stops.concat(stops[0]).join(',') + ')';
  }

  // Built-ins are registered once; user palettes persist under a shared
  // key so a palette built in one app is available in the others.
  function createPaletteLibrary(builtins, options) {
    const opts = options || {};
    const storage = opts.storage || safeStorage();
    const key = 'koda.user-palettes.v1';
    const frozen = {};
    for (const id of Object.keys(builtins)) {
      const b = builtins[id];
      if (!b || !validPaletteColors(b.colors)) throw new Error('builtin ' + id + ' invalid');
      frozen[id] = Object.freeze({
        id,
        name: cleanName(b.name, id),
        colors: Object.freeze(b.colors.map((c) => c.toUpperCase())),
        builtin: true
      });
    }
    let users = [];

    function readUsers() {
      users = [];
      try {
        const text = storage.getItem(key);
        if (!text) return;
        const raw = JSON.parse(text);
        if (!Array.isArray(raw)) return;
        for (const entry of raw.slice(0, MAX_USER_PALETTES)) {
          if (entry && typeof entry.id === 'string' && validPaletteColors(entry.colors) && !frozen[entry.id]) {
            users.push({
              id: entry.id,
              name: cleanName(entry.name, 'Custom'),
              colors: entry.colors.map((c) => c.toUpperCase()),
              builtin: false,
              createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0
            });
          }
        }
      } catch (e) { users = []; }
    }

    function writeUsers() {
      try {
        storage.setItem(key, JSON.stringify(users.map((u) => ({
          id: u.id, name: u.name, colors: u.colors, createdAt: u.createdAt
        }))));
      } catch (e) { /* never break the app for storage */ }
    }

    function makeId() {
      return 'user-' + Date.now().toString(36) + '-' +
        Math.floor(Math.random() * 0xffffff).toString(36);
    }

    readUsers();

    return {
      list() {
        return Object.values(frozen).concat(users).map((p) => ({
          id: p.id, name: p.name, colors: p.colors.slice(), builtin: !!p.builtin
        }));
      },
      get(id) {
        if (frozen[id]) return frozen[id];
        const u = users.find((p) => p.id === id);
        return u || null;
      },
      has(id) { return !!frozen[id] || users.some((p) => p.id === id); },
      isUser(id) { return users.some((p) => p.id === id); },
      addUser({ name, colors }) {
        if (!validPaletteColors(colors)) throw new Error('addUser: need 7 hex colors');
        if (users.length >= MAX_USER_PALETTES) throw new Error('addUser: library full');
        const entry = {
          id: makeId(),
          name: cleanName(name, 'Custom palette'),
          colors: colors.map((c) => c.toUpperCase()),
          builtin: false,
          createdAt: Date.now()
        };
        users.push(entry);
        writeUsers();
        return entry.id;
      },
      updateUser(id, { name, colors }) {
        const u = users.find((p) => p.id === id);
        if (!u) return false;
        if (colors !== undefined) {
          if (!validPaletteColors(colors)) throw new Error('updateUser: need 7 hex colors');
          u.colors = colors.map((c) => c.toUpperCase());
        }
        if (name !== undefined) u.name = cleanName(name, u.name);
        writeUsers();
        return true;
      },
      removeUser(id) {
        const at = users.findIndex((p) => p.id === id);
        if (at < 0) return false;
        users.splice(at, 1);
        writeUsers();
        return true;
      },
      swatchCSS
    };
  }

  // ---- Hold-to-delete (touch-native destructive-action pattern) ----
  // Fires `callback` after `holdMs` of uninterrupted press. Pointer
  // movement beyond `movePx`, pointerup, pointercancel, or pointerleave
  // cancels — scrolling a list never triggers it. The element gets a
  // `holding` class while the timer runs for a subtle press cue.
  // Returns a controller: `suppressIfHeld(event)` for the element's own
  // click handler (a hold that fired must not also count as a tap),
  // `cancel()`, and `destroy()`.
  function onHold(el, callback, options) {
    const opts = options || {};
    const holdMs = typeof opts.holdMs === 'number' ? opts.holdMs : 500;
    const movePx = typeof opts.movePx === 'number' ? opts.movePx : 10;
    let timer = null;
    let startX = 0, startY = 0;
    let fired = false;

    function clearTimer() {
      if (timer) { clearTimeout(timer); timer = null; }
    }
    function cancel() {
      clearTimer();
      el.classList.remove('holding');
    }
    function onDown(event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      fired = false;
      startX = event.clientX; startY = event.clientY;
      el.classList.add('holding');
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        el.classList.remove('holding');
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(10); } catch (e) { /* tactile feedback is best-effort */ }
        }
        callback(event);
      }, holdMs);
    }
    function onMove(event) {
      if (timer && Math.hypot(event.clientX - startX, event.clientY - startY) > movePx) cancel();
    }
    function onContextMenu(event) { event.preventDefault(); }
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('contextmenu', onContextMenu);

    function suppressIfHeld(event) {
      if (!fired) return false;
      fired = false;
      event.preventDefault();
      event.stopImmediatePropagation();
      return true;
    }
    function destroy() {
      cancel();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', cancel);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('pointerleave', cancel);
      el.removeEventListener('contextmenu', onContextMenu);
    }
    return { suppressIfHeld, cancel, destroy };
  }

  const TRASH_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>' +
    '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

  let activeDeletePrompt = null;

  // Dismisses any open delete prompt (safe to call when none is open).
  function dismissDeletePrompt() {
    if (activeDeletePrompt) activeDeletePrompt.dismiss();
  }

  // Positions the prompt anchored over the tile, clamped inside the sheet
  // card (falling back to the viewport) so the prompt — wider than a
  // narrow tile — can never be clipped by the sheet edge at 390px.
  // The prompt is absolutely positioned relative to the tile (which is
  // position: relative), so sheet-viewport math is converted back to
  // tile-local coordinates.
  function clampPromptInSheet(prompt, tile) {
    const host = tile.closest('.sheet-card') || document.documentElement;
    const PAD = 6;
    const tb = tile.getBoundingClientRect();
    const hb = host.getBoundingClientRect();
    const pw = prompt.offsetWidth;
    const ph = prompt.offsetHeight;
    if (!pw || !ph) return;
    // Anchor: centered over the tile (viewport coordinates)...
    let vx = tb.left + (tb.width - pw) / 2;
    let vy = tb.top + (tb.height - ph) / 2;
    // ...clamped fully inside the host bounds.
    const minX = hb.left + PAD, maxX = hb.right - PAD - pw;
    const minY = hb.top + PAD, maxY = hb.bottom - PAD - ph;
    vx = (maxX >= minX) ? Math.min(Math.max(vx, minX), maxX) : (hb.left + hb.right - pw) / 2;
    vy = (maxY >= minY) ? Math.min(Math.max(vy, minY), maxY) : (hb.top + hb.bottom - ph) / 2;
    prompt.style.left = (vx - tb.left) + 'px';
    prompt.style.top = (vy - tb.top) + 'px';
  }

  // ---- Trash-can delete confirmation ----
  // Builds a small family-styled confirmation prompt anchored inside
  // `tile` (which must be position: relative): trash icon + palette
  // name + Delete/Cancel. `handlers.onDelete` runs on confirm.
  // Dismisses on Cancel, Escape, or a tap outside the tile.
  // Returns a `dismiss()` function.
  function confirmDelete(tile, paletteName, handlers) {
    dismissDeletePrompt();
    const prompt = document.createElement('div');
    prompt.className = 'delete-prompt';
    prompt.setAttribute('role', 'alertdialog');
    prompt.setAttribute('aria-label', 'Delete palette ' + paletteName + '?');
    const name = document.createElement('span');
    name.className = 'delete-prompt-name';
    name.textContent = paletteName;
    const actions = document.createElement('div');
    actions.className = 'delete-prompt-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'sheet-btn ghost delete-prompt-cancel';
    cancelBtn.textContent = 'Cancel';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'sheet-btn danger delete-prompt-delete';
    delBtn.innerHTML = TRASH_SVG + '<span>Delete</span>';
    delBtn.setAttribute('aria-label', 'Delete palette ' + paletteName);
    actions.append(cancelBtn, delBtn);
    prompt.append(name, actions);
    tile.appendChild(prompt);
    // Geometry is JS-driven (intrinsic width anchored over the tile, not
    // stretched by app CSS): neutralize any `inset` the app stylesheet sets
    // and clamp the prompt inside the sheet bounds.
    prompt.style.inset = 'auto';
    clampPromptInSheet(prompt, tile);

    function onResize() { clampPromptInSheet(prompt, tile); }

    function teardown() {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
      if (prompt.parentNode) prompt.parentNode.removeChild(prompt);
      if (activeDeletePrompt && activeDeletePrompt.dismiss === dismiss) activeDeletePrompt = null;
    }
    function onDocDown(event) {
      if (!tile.contains(event.target)) {
        // Dismiss only the prompt; don't let the tap fall through to the
        // sheet's own outside-tap close handler.
        event.stopPropagation();
        dismiss();
      }
    }
    function onKey(event) {
      if (event.key === 'Escape') { event.stopPropagation(); dismiss(); }
    }
    function dismiss() {
      teardown();
      if (handlers.onCancel) handlers.onCancel();
    }
    cancelBtn.addEventListener('click', (event) => { event.stopPropagation(); dismiss(); });
    delBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      teardown();
      handlers.onDelete();
    });
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    activeDeletePrompt = { dismiss, tile };
    delBtn.focus({ preventScroll: true });
    return dismiss;
  }

  // ---- Sheet scroll snapshot / restore ----
  // lockScroll() snapshots window.scrollY and pins the body so the
  // background cannot scroll while a sheet is open (notably when the
  // iOS keyboard opens for the palette-name field). unlockScroll()
  // unpins and restores the exact pre-open position. Locking is
  // idempotent: nested locks keep the original snapshot.
  let lockedScrollY = null;
  function lockScroll() {
    if (lockedScrollY !== null) return;
    lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const body = document.body;
    body.style.position = 'fixed';
    body.style.top = (-lockedScrollY) + 'px';
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
  }
  function unlockScroll() {
    if (lockedScrollY === null) return;
    const y = lockedScrollY;
    lockedScrollY = null;
    const body = document.body;
    body.style.position = '';
    body.style.top = '';
    body.style.left = '';
    body.style.right = '';
    body.style.width = '';
    // Force a synchronous reflow so the document's scrollable area is
    // recomputed before restoring the scroll position.
    void document.documentElement.offsetHeight;
    window.scrollTo(0, y);
  }
  function isScrollLocked() { return lockedScrollY !== null; }

  const KodaPalettes = {
    version: '1.2.0',
    color,
    harmony,
    createSettingsStore,
    createPaletteLibrary,
    swatchCSS,
    onHold,
    confirmDelete,
    dismissDeletePrompt,
    lockScroll,
    unlockScroll,
    isScrollLocked,
    STORAGE_KEYS: {
      userPalettes: 'koda.user-palettes.v1',
      settingsFor: (namespace) => 'koda.' + namespace + '.v1'
    }
  };

  global.KodaPalettes = KodaPalettes;
  if (typeof module !== 'undefined' && module.exports) module.exports = KodaPalettes;
})(typeof globalThis !== 'undefined' ? globalThis : this);
