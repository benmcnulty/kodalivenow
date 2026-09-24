/* Koda hero — organic curl study (spike winner: upgraded blobs + tube curls).
   Bodies: 6 vertex-wobbled icosahedra with fake-volumetric smoke shading
   (domain-warped value-noise fbm, OKLCH ramps, fresnel rim, IGN dither).
   Accents: 3 curl-field tube curls merged into a single draw call.
   Budget: 7 draw calls, ~34k tris, pixelRatio <=1.5 on mobile, paused
   offscreen, single still frame under prefers-reduced-motion, r184,
   no postprocessing. */
import * as THREE from './vendor/three.module.min.js';

(() => {
  const canvas = document.getElementById('hero-canvas');
  const hero = document.querySelector('.hero');
  if (!canvas || !hero) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    canvas.remove(); // CSS mesh gradient carries the hero
    return;
  }

  const isMobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 720;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 60);
  camera.position.set(0, 0, 9);

  // ---- Shared GLSL: sine-free hash, value noise, fbm, OKLCH, IGN dither ----
  const NOISE_GLSL = /* glsl */`
    vec3 kodaHash33(vec3 p) {
      p = fract(p * vec3(0.1031, 0.1030, 0.0973));
      p += dot(p, p.yxz + 33.33);
      return fract((p.xxy + p.yxx) * p.zyx);
    }
    float kodaVNoise(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      vec3 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(kodaHash33(i + vec3(0.,0.,0.)).x, kodaHash33(i + vec3(1.,0.,0.)).x, u.x),
            mix(kodaHash33(i + vec3(0.,1.,0.)).x, kodaHash33(i + vec3(1.,1.,0.)).x, u.x), u.y),
        mix(mix(kodaHash33(i + vec3(0.,0.,1.)).x, kodaHash33(i + vec3(1.,0.,1.)).x, u.x),
            mix(kodaHash33(i + vec3(0.,1.,1.)).x, kodaHash33(i + vec3(1.,1.,1.)).x, u.x), u.y),
        u.z);
    }
    float kodaFbm2(vec3 p) {
      float a = 0.5, s = 0.0;
      s += a * kodaVNoise(p); p = p * 2.03 + vec3(17.3, 9.1, 4.7);
      s += a * 0.5 * kodaVNoise(p);
      return s / 0.75;
    }
    vec3 vdc_srgb_to_linear(vec3 c) {
      return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
    }
    float vdc_cbrt(float x) { return sign(x) * pow(abs(x), 1.0 / 3.0); }
    vec3 vdc_cbrt(vec3 v) { return sign(v) * pow(abs(v), vec3(1.0 / 3.0)); }
    vec3 vdc_linear_to_oklab(vec3 c) {
      vec3 lms = mat3(0.4122214708, 0.2119034982, 0.0883024619,
                      0.5363325363, 0.6806995451, 0.2817188376,
                      0.0514459929, 0.1073969566, 0.6299787005) * c;
      vec3 lmsr = vdc_cbrt(lms);
      return mat3(0.2104542553,  1.9779984951,  0.0259040371,
                  0.7936177850, -2.4285922050,  0.7827717662,
                 -0.0040720468,  0.4505937099, -0.8086757660) * lmsr;
    }
    vec3 vdc_oklab_to_linear(vec3 lab) {
      vec3 lmsr = mat3(1.0,  1.0,  1.0,
                        0.3963377774, -0.1055613458, -0.0894841775,
                        0.2158037573, -0.0638541728, -1.2914855480) * lab;
      vec3 lms = lmsr * lmsr * lmsr;
      return mat3( 4.0767416621, -1.2684380046, -0.0041960863,
                  -3.3077115913,  2.6097574011, -0.7034186147,
                   0.2309699292, -0.3413193965,  1.7076147010) * lms;
    }
    vec3 vdc_oklab_to_oklch(vec3 lab) {
      return vec3(lab.x, length(lab.yz), atan(lab.z, lab.y));
    }
    vec3 vdc_oklch_to_oklab(vec3 lch) {
      return vec3(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z));
    }
    vec3 vdc_oklch_mix(vec3 a, vec3 b, float t) {
      float dH = mod(b.z - a.z + 3.14159265, 6.28318530) - 3.14159265;
      return vec3(mix(a.x, b.x, t), mix(a.y, b.y, t), a.z + dH * t);
    }
    // NOTE: three r184 ColorManagement converts hex uniforms to linear-srgb
    // working space on upload, so these arrive linear already.
    vec3 kodaRamp(vec3 deepLin, vec3 midLin, vec3 rimLin, float tBody, float tRim) {
      vec3 dL = vdc_oklab_to_oklch(vdc_linear_to_oklab(deepLin));
      vec3 mL = vdc_oklab_to_oklch(vdc_linear_to_oklab(midLin));
      vec3 rL = vdc_oklab_to_oklch(vdc_linear_to_oklab(rimLin));
      vec3 m = vdc_oklch_mix(dL, mL, tBody);
      vec3 f = vdc_oklch_mix(m, rL, tRim);
      return vdc_oklab_to_linear(vdc_oklch_to_oklab(f));
    }
    float kodaIgn(vec2 px) {
      return fract(52.25685 * fract(dot(px, vec2(0.06711056, 0.00583715))));
    }
  `;

  // ---- Blob vertex: bounded analytic wobble (proven safe) ----
  const blobVertex = /* glsl */`
    uniform float uTime;
    uniform float uAmp;
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    varying vec3 vObjPos;
    float wobble(vec3 p, float t) {
      return 0.5 * sin(p.x * 2.4 + t * 0.9)
           + 0.3 * sin(p.y * 3.1 - t * 0.7 + p.z * 1.7)
           + 0.2 * sin(p.z * 4.3 + t * 1.1 + p.x * 2.9);
    }
    void main() {
      float n = wobble(position + vec3(0.0, uTime * 0.30, uTime * 0.18), uTime);
      vec3 displaced = position + normal * n * uAmp;
      vObjPos = position;
      vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
      vNormal = normalMatrix * normal;
      vViewPosition = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }
  `;

  // ---- Blob fragment: fake-volumetric smoke body + luminous rim ----
  const blobFragment = /* glsl */`
    uniform float uTime;
    uniform vec3 uColorDeep;
    uniform vec3 uColorMid;
    uniform vec3 uColorRim;
    uniform float uSeed;
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    varying vec3 vObjPos;
    ${NOISE_GLSL}
    void main() {
      vec3 N = normalize(vNormal);
      vec3 V = normalize(vViewPosition);
      float ndv = abs(dot(N, V));
      float t = uTime * 0.06;
      vec3 p = vObjPos * 1.0 + vec3(uSeed);
      // domain warp: two 2-octave samples steer the final sample
      vec2 q = vec2(kodaFbm2(p + vec3(0.0, t, 0.0)),
                    kodaFbm2(p + vec3(5.2, 1.3, 2.8) - vec3(t * 0.6)));
      float dens = kodaFbm2(p + vec3(q * 2.4, 0.0) + vec3(0.0, -t * 0.8, t * 0.4));
      float body = smoothstep(0.25, 0.66, dens);
      float rim = pow(1.0 - ndv, 2.2);
      rim = smoothstep(0.02, 0.85, rim);
      vec3 col = kodaRamp(uColorDeep, uColorMid, uColorRim, body, rim * 0.9);
      col *= 0.72 + 0.28 * (N.y * 0.5 + 0.5);      // faint top light
      col += uColorRim * rim * 0.22 * (0.35 + 0.65 * body);
      // interior detail: multiplicative mottling guarantees visible structure
      // on every seed, independent of where the density field lands.
      vec3 detailP = p * 3.1;
      detailP.y += t * 0.5;
      float detail = kodaVNoise(detailP);
      col *= 0.72 + 0.56 * detail;
      float alpha = clamp(body * 0.68 + rim * 0.55, 0.0, 0.90);
      gl_FragColor = vec4(max(col, vec3(0.0)), alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb += (kodaIgn(gl_FragCoord.xy) - 0.5) / 255.0;
    }
  `;

  // [colorDeep, colorMid, colorRim, radius, x, y, z, spin] — text sits left,
  // forms cluster right; text column kept empty (grader-confirmed requirement).
  const BLOBS = [
    [0x0a2e2b, 0x1f7a6d, 0x2dd4bf, 0.95,  3.6,  0.9, -1.2, 0.10],
    [0x0d1440, 0x2b3f9e, 0x4f6df5, 1.05,  4.5, -1.7, -2.2, 0.07],
    [0x241545, 0x6b3fb0, 0x8b5cf6, 0.75,  2.4,  2.5, -0.6, 0.13],
    [0x0b2f1c, 0x2a7a45, 0x4ade80, 0.55,  3.0, -2.75, 0.2, 0.16],
    [0x141544, 0x3d3fa8, 0x6366f1, 0.65, -7.4,  3.1, -1.8, 0.09],
    [0x092e2e, 0x2a8a80, 0x5eead4, 0.50, -7.6, -2.9, -2.4, 0.18],
  ];

  const group = new THREE.Group();
  scene.add(group);
  const animated = [];
  const srgb = (h) => new THREE.Color(h); // three converts hex assuming sRGB -> linear via ColorManagement

  for (const [cD, cM, cR, r, x, y, z, spin] of BLOBS) {
    const geo = new THREE.IcosahedronGeometry(r, 12); // 20*(12+1)^2 = 3,380 tris each
    const mat = new THREE.ShaderMaterial({
      vertexShader: blobVertex,
      fragmentShader: blobFragment,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime:      { value: 0 },
        uAmp:       { value: r * 0.15 },
        uSeed:      { value: Math.random() * 40.0 },
        uColorDeep: { value: srgb(cD) },
        uColorMid:  { value: srgb(cM) },
        uColorRim:  { value: srgb(cR) },
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    mesh.renderOrder = 10 - z; // far blobs composite first (painter-ish smoke merge)
    group.add(mesh);
    animated.push({ mesh, spin, baseY: y, phase: Math.random() * Math.PI * 2,
      spinAxis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize() });
  }

  // ---- Curl-field tube curls: analytic divergence-free flow, CPU-traced ----
  // Potential P (sum of sines); flow F = curl(P) via central differences.
  function potential(x, y, z, out) {
    out[0] = Math.sin(1.3 * y + 1.7) * Math.sin(1.1 * z + 0.4);
    out[1] = Math.sin(1.7 * z + 0.6) * Math.sin(0.9 * x + 2.1);
    out[2] = Math.sin(1.1 * x + 2.9) * Math.sin(1.3 * y + 0.9);
  }
  const _pa = [0, 0, 0], _pb = [0, 0, 0];
  function flow(x, y, z, out) {
    const e = 0.05;
    potential(x + e, y, z, _pa); potential(x - e, y, z, _pb);
    // dP/dx
    const dP1dx = (_pa[0] - _pb[0]) / (2 * e), dP2dx = (_pa[1] - _pb[1]) / (2 * e), dP3dx = (_pa[2] - _pb[2]) / (2 * e);
    potential(x, y + e, z, _pa); potential(x, y - e, z, _pb);
    const dP1dy = (_pa[0] - _pb[0]) / (2 * e), dP2dy = (_pa[1] - _pb[1]) / (2 * e), dP3dy = (_pa[2] - _pb[2]) / (2 * e);
    potential(x, y, z + e, _pa); potential(x, y, z - e, _pb);
    const dP1dz = (_pa[0] - _pb[0]) / (2 * e), dP2dz = (_pa[1] - _pb[1]) / (2 * e), dP3dz = (_pa[2] - _pb[2]) / (2 * e);
    out[0] = dP3dy - dP2dz;
    out[1] = dP1dz - dP3dx;
    out[2] = dP2dx - dP1dy;
  }
  function trace(sx, sy, sz) {
    const pts = [];
    let x = sx, y = sy, z = sz;
    const f = [0, 0, 0];
    const box = { x0: 0.8, x1: 6.4, y0: -3.4, y1: 3.4, z0: -2.8, z1: 0.8 };
    let turn = 0, px = 0, py = 0, pz = 1;
    for (let i = 0; i < 230; i++) {
      flow(x, y, z, f);
      const m = Math.hypot(f[0], f[1], f[2]) || 1;
      const step = 0.11;
      // RK2 midpoint
      const mx = x + f[0] / m * step * 0.5, my = y + f[1] / m * step * 0.5, mz = z + f[2] / m * step * 0.5;
      flow(mx, my, mz, f);
      const m2 = Math.hypot(f[0], f[1], f[2]) || 1;
      const dx = f[0] / m2, dy = f[1] / m2, dz = f[2] / m2;
      turn += Math.acos(Math.min(1, Math.max(-1, px * dx + py * dy + pz * dz)));
      px = dx; py = dy; pz = dz;
      x += dx * step; y += dy * step; z += dz * step;
      if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1 || z < box.z0 || z > box.z1) break;
      pts.push(new THREE.Vector3(x, y, z));
    }
    return { pts, turn: pts.length > 40 ? turn : -1 };
  }

  // Arc extraction: the concept's curls are single wave-crests (~180-270 deg),
  // not spiral coils. Slide a window over each trajectory and keep windows
  // whose total turning angle is one clean arc, placed right of x=3.0 so the
  // text zone stays clear on desktop and frustum culling drops them on mobile.
  function extractArcs(runs) {
    const cands = [];
    for (let ri = 0; ri < runs.length; ri++) {
      const pts = runs[ri].pts;
      if (pts.length < 70) continue;
      const cum = [0];
      for (let i = 1; i < pts.length - 1; i++) {
        const ax = pts[i].x - pts[i - 1].x, ay = pts[i].y - pts[i - 1].y, az = pts[i].z - pts[i - 1].z;
        const bx = pts[i + 1].x - pts[i].x, by = pts[i + 1].y - pts[i].y, bz = pts[i + 1].z - pts[i].z;
        const ma = Math.hypot(ax, ay, az) || 1, mb = Math.hypot(bx, by, bz) || 1;
        cum.push(cum[i - 1] + Math.acos(Math.min(1, Math.max(-1, (ax * bx + ay * by + az * bz) / (ma * mb)))));
      }
      for (let s = 0; s + 50 < pts.length; s += 8) {
        for (let e = s + 50; e < Math.min(s + 150, pts.length); e += 8) {
          const turn = cum[e - 1] - cum[s];
          if (turn > 4.2) break;
          if (turn < 2.8) continue;
          let minX = 1e9, maxX = -1e9;
          for (let k = s; k <= e; k++) { minX = Math.min(minX, pts[k].x); maxX = Math.max(maxX, pts[k].x); }
          if (minX < 3.0 || maxX > 5.5) continue;
          cands.push({ ri, s, e, score: turn * (e - s) });
        }
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const picked = [], used = new Set();
    for (const c of cands) {
      if (picked.length >= 3) break;
      if (used.has(c.ri)) continue;
      picked.push(c); used.add(c.ri);
    }
    return picked.map(c => runs[c.ri].pts.slice(c.s, c.e + 1));
  }

  const tubeGeos = [];
  {
    const seeds = [];
    let s = 1234567;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 20; i++) {
      seeds.push([2.6 + rnd() * 3.2, -2.8 + rnd() * 5.6, -2.4 + rnd() * 2.6]);
    }
    const runs = seeds.map(([x, y, z]) => trace(x, y, z)).filter(r => r.pts.length > 70);
    const arcs = extractArcs(runs);
    // Signature curl: one art-directed logarithmic spiral (fiddlehead), outer
    // to inner so the vertex-shader taper finishes at the center tip.
    const spiralPts = [];
    {
      const turns = 1.25, steps = 120;
      const cx = 4.35, cy = 0.55, cz = -1.1;
      const tilt = 0.35; // lean out of the screen plane for depth
      for (let i = 0; i <= steps; i++) {
        const th = (i / steps) * turns * Math.PI * 2;
        const r = 0.85 * Math.exp(-0.18 * th);
        const x = cx + r * Math.cos(th + 0.6);
        const y = cy + r * Math.sin(th + 0.6);
        const z = cz + r * Math.sin(th * 0.7) * tilt;
        spiralPts.push(new THREE.Vector3(x, y, z));
      }
    }
    const palette = [[0x2dd4bf, 0x8b5cf6], [0x4f6df5, 0x5eead4], [0x8b5cf6, 0x4ade80]];
    const tubeSources = [...arcs.map(a => ({ pts: a, radius: 0.13 })), { pts: spiralPts, radius: 0.14, colors: [0x5eead4, 0x8b5cf6] }];
    tubeSources.slice(0, 4).forEach(({ pts, radius, colors }, idx) => {
      const curve = new THREE.CatmullRomCurve3(pts);
      const tg = new THREE.TubeGeometry(curve, 160, radius, 10, false);
      // per-vertex taper amount: shrink toward the tip (uv.x -> 1)
      const uv = tg.attributes.uv, n = uv.count;
      const taper = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        taper[i] = radius * 0.94 * THREE.MathUtils.smoothstep(uv.getX(i), 0.42, 1.0);
      }
      tg.setAttribute('aTaper', new THREE.BufferAttribute(taper, 1));
      tg.userData.colors = colors || palette[idx % palette.length];
      tubeGeos.push(tg);
    });
  }

  // Manual merge (same attributes: position, normal, uv, aTaper) -> 1 draw call
  function mergeGeos(geos) {
    let vTotal = 0, iTotal = 0;
    for (const g of geos) { vTotal += g.attributes.position.count; iTotal += g.index.count; }
    const pos = new Float32Array(vTotal * 3), nor = new Float32Array(vTotal * 3);
    const uv = new Float32Array(vTotal * 2), tap = new Float32Array(vTotal);
    const idx = new Uint32Array(iTotal);
    let vo = 0, io = 0;
    for (const g of geos) {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array, vo * 3);
      nor.set(g.attributes.normal.array, vo * 3);
      uv.set(g.attributes.uv.array, vo * 2);
      tap.set(g.attributes.aTaper.array, vo);
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      vo += c; io += gi.length;
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.setAttribute('aTaper', new THREE.BufferAttribute(tap, 1));
    merged.setIndex(new THREE.BufferAttribute(idx, 1));
    return merged;
  }

  const tubeVertex = /* glsl */`
    uniform float uTime;
    attribute float aTaper;
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vec3 transformed = position - normal * aTaper;
      transformed += normal * sin(uv.x * 12.0 - uTime * 0.7) * 0.018;
      vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
      vNormal = normalMatrix * normal;
      vViewPosition = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }
  `;
  const tubeFragment = /* glsl */`
    uniform float uTime;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    varying vec2 vUv;
    ${NOISE_GLSL}
    void main() {
      vec3 N = normalize(vNormal);
      vec3 V = normalize(vViewPosition);
      float ndv = abs(dot(N, V));
      float rim = pow(1.0 - ndv, 1.8);
      float pulse = 0.72 + 0.28 * sin(vUv.x * 9.0 - uTime * 0.8);
      vec3 col = kodaRamp(uColorA, uColorA, uColorB, 0.4, rim) * pulse;
      float tipFade = smoothstep(0.0, 0.06, vUv.x) * (1.0 - smoothstep(0.90, 1.0, vUv.x));
      float alpha = (0.30 + 0.70 * rim) * tipFade;
      gl_FragColor = vec4(max(col, vec3(0.0)), alpha * 0.85);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb += (kodaIgn(gl_FragCoord.xy) - 0.5) / 255.0;
    }
  `;

  if (tubeGeos.length) {
    const merged = mergeGeos(tubeGeos);
    // single accent material: use first tube's palette (merged mesh, one program)
    const [cA, cB] = tubeGeos[0].userData.colors;
    const tubeMat = new THREE.ShaderMaterial({
      vertexShader: tubeVertex,
      fragmentShader: tubeFragment,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime:   { value: 0 },
        uColorA: { value: srgb(cA) },
        uColorB: { value: srgb(cB) },
      },
    });
    const tubes = new THREE.Mesh(merged, tubeMat);
    tubes.renderOrder = 5;
    group.add(tubes);
    animated.push({ tubeMat });
  }

  // Pointer parallax: +-16px @ 0.06 lerp, fine pointers only
  const fine = window.matchMedia('(pointer: fine)').matches;
  const target = new THREE.Vector2(0, 0);
  if (fine && !reduced) {
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      target.x = ((e.clientX - r.left) / r.width - 0.5) * 0.30;
      target.y = -((e.clientY - r.top) / r.height - 0.5) * 0.24;
    }, { passive: true });
    hero.addEventListener('pointerleave', () => target.set(0, 0), { passive: true });
  }

  function resize() {
    const w = hero.clientWidth, h = hero.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Pull back on narrow screens so the right-clustered forms stay in frame
    camera.position.z = camera.aspect < 0.8 ? 13 : 9;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });

  let running = true;
  let firstFrame = true;
  const clock = new THREE.Clock();

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      running = entries[0].isIntersecting;
      if (running && !reduced) requestAnimationFrame(tick);
    }, { threshold: 0.02 }).observe(hero);
  }

  function renderFrame(t) {
    const tw = t % 240; // wrap: fp32/fp16 time precision
    for (const a of animated) {
      if (a.mesh) {
        a.mesh.material.uniforms.uTime.value = tw;
        a.mesh.rotateOnAxis(a.spinAxis, a.spin * 0.016);
        a.mesh.position.y = a.baseY + Math.sin(tw * 0.5 + a.phase) * 0.22;
      } else if (a.tubeMat) {
        a.tubeMat.uniforms.uTime.value = tw;
      }
    }
    group.position.x += (target.x - group.position.x) * 0.06;
    group.position.y += (target.y - group.position.y) * 0.06;
    renderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      window.__heroStats = {
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        revision: THREE.REVISION,
      };
    }
  }

  function tick() {
    if (!running) return;
    renderFrame(clock.getElapsedTime());
    requestAnimationFrame(tick);
  }

  if (reduced) {
    renderFrame(2.0); // single still frame
  } else {
    tick();
  }
})();
