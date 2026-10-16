// Analisi dei vincoli calcolata dagli strati del progetto (tutto a 512×512, ~28 m/pixel).
// Le soglie non sono valori ufficiali del gioco: sono regole pratiche, modificabili in project.analysis.
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};

  const RES = 512;
  const DEFAULTS = {
    slopeWarn: 6,            // % oltre cui i lotti diventano scomodi
    slopeMax: 15,            // % oltre cui non conviene zonizzare
    shore: 50,               // m di rispetto dalla riva
    threshold: 64,           // 0..255: da quale intensità una risorsa conta
    buffers: { ore: 200, oil: 200, forest: 0, fertile: 0, groundwater: 150 },   // m
    reserve: { ore: true, oil: true, forest: true, fertile: true },             // risorse da non coprire con case
    plumeLength: 2000,       // m di pennacchio sottovento
    plumeSources: { ore: true, oil: true, industryPlan: true }
  };

  // CATEGORIE del riepilogo (valori nel raster)
  const HOUSING = { OK: 0, SLOPE: 1, PLUME: 2, RESERVED: 3, BLOCKED: 4 };
  const INDUSTRY = { OK: 0, SLOPE: 1, GROUNDWATER: 2, BLOCKED: 4, GOOD: 5 };

  function params(project) {
    const a = project.analysis = project.analysis || {};
    const out = Object.assign({}, DEFAULTS, a);
    out.buffers = Object.assign({}, DEFAULTS.buffers, a.buffers);
    out.reserve = Object.assign({}, DEFAULTS.reserve, a.reserve);
    out.plumeSources = Object.assign({}, DEFAULTS.plumeSources, a.plumeSources);
    return out;
  }

  // ricampiona uno strato qualsiasi a RES×RES
  function resample(L) {
    if (L.res === RES) return L.data instanceof Float32Array ? L.data : Float32Array.from(L.data);
    const out = new Float32Array(RES * RES);
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) out[j * RES + i] = L.sample((i + 0.5) / RES, (j + 0.5) / RES);
    return out;
  }

  // distanza (m) dal pixel "vero" più vicino, trasformata chamfer 3-4
  function distance(mask, px) {
    const n = RES, INF = 1e9, d = new Float32Array(n * n);
    for (let k = 0; k < d.length; k++) d[k] = mask[k] ? 0 : INF;
    const a = px, b = px * Math.SQRT2;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i; let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + a);
      if (j > 0) { v = Math.min(v, d[k - n] + a); if (i > 0) v = Math.min(v, d[k - n - 1] + b); if (i < n - 1) v = Math.min(v, d[k - n + 1] + b); }
      d[k] = v;
    }
    for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i; let v = d[k];
      if (i < n - 1) v = Math.min(v, d[k + 1] + a);
      if (j < n - 1) { v = Math.min(v, d[k + n] + a); if (i < n - 1) v = Math.min(v, d[k + n + 1] + b); if (i > 0) v = Math.min(v, d[k + n - 1] + b); }
      d[k] = v;
    }
    return d;
  }

  // pennacchio: le sorgenti vengono trascinate sottovento di 1 pixel per passo, attenuandosi
  // e allargandosi. La direzione è costante, quindi i pesi bilineari si calcolano una volta;
  // si lavora solo nel rettangolo che contiene inquinamento.
  function plume(src, dir, lengthM, px) {
    const n = RES, steps = Math.max(1, Math.round(lengthM / px)), decay = Math.pow(0.15, 1 / steps);
    const out = Float32Array.from(src);
    let cur = Float32Array.from(src), nxt = new Float32Array(n * n);
    let i0 = n, i1 = -1, j0 = n, j1 = -1;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (src[j * n + i] > 0) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
    if (i1 < 0) return out;
    // valore in (i,j) = cur campionato in (i - dir.x, j - dir.y)
    const ox = Math.floor(-dir.x), oy = Math.floor(-dir.y), fx = -dir.x - ox, fy = -dir.y - oy;
    const w00 = (1 - fx) * (1 - fy) * decay, w10 = fx * (1 - fy) * decay, w01 = (1 - fx) * fy * decay, w11 = fx * fy * decay;
    const px_ = Math.round(-dir.y), py_ = Math.round(dir.x);   // perpendicolare (per l'allargamento)
    for (let s = 1; s <= steps; s++) {
      // il rettangolo attivo si sposta e cresce di 1 pixel per passo
      i0 = Math.max(1, i0 - 2); i1 = Math.min(n - 2, i1 + 2); j0 = Math.max(1, j0 - 2); j1 = Math.min(n - 2, j1 + 2);
      for (let j = j0; j <= j1; j++) {
        const sj = j + oy;
        for (let i = i0; i <= i1; i++) {
          const si = i + ox;
          if (si < 0 || sj < 0 || si >= n - 1 || sj >= n - 1) { nxt[j * n + i] = 0; continue; }
          const k = sj * n + si;
          nxt[j * n + i] = cur[k] * w00 + cur[k + 1] * w10 + cur[k + n] * w01 + cur[k + n + 1] * w11;
        }
      }
      if (s % 4 === 0) {
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cur[j * n + i] = nxt[j * n + i];
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const k = j * n + i, l = k + py_ * n + px_, r = k - py_ * n - px_;
          nxt[k] = cur[k] * 0.6 + (cur[l] + cur[r]) * 0.2;
        }
      }
      const t = cur; cur = nxt; nxt = t;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * n + i; if (cur[k] > out[k]) out[k] = cur[k]; }
    }
    return out;
  }

  function compute(project) {
    const P = params(project), n = RES, px = project.map.size / n, N = n * n;
    const L = project.layers;
    const elev = resample(L.elevation), waterX = resample(L.water);
    const res = {};
    ['ore', 'oil', 'forest', 'fertile', 'groundwater', 'industryPlan'].forEach(k => { res[k] = resample(L[k]); });

    // pendenza in %
    const slope = new Float32Array(N);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const h = (ii, jj) => elev[Math.min(n - 1, Math.max(0, jj)) * n + Math.min(n - 1, Math.max(0, ii))];
      const dx = (h(i + 1, j) - h(i - 1, j)) / (2 * px), dy = (h(i, j + 1) - h(i, j - 1)) / (2 * px);
      slope[j * n + i] = Math.hypot(dx, dy) * 100;
    }
    // acqua + rive
    const water = new Uint8Array(N);
    for (let k = 0; k < N; k++) water[k] = (elev[k] < project.map.seaLevel || waterX[k] > 127) ? 1 : 0;
    const dWater = distance(water, px);
    // risorse con fascia di rispetto
    const near = {};
    Object.keys(P.buffers).forEach(k => {
      const m = new Uint8Array(N); let any = false;
      for (let q = 0; q < N; q++) if (res[k][q] >= P.threshold) { m[q] = 1; any = true; }
      near[k] = any ? distance(m, px) : null;
    });
    const inBuf = (k, q) => near[k] && near[k][q] <= P.buffers[k];
    // inquinamento
    const src = new Float32Array(N);
    Object.keys(P.plumeSources).forEach(k => {
      if (!P.plumeSources[k] || !res[k]) return;
      for (let q = 0; q < N; q++) { const v = res[k][q] >= P.threshold ? 1 : 0; if (v > src[q]) src[q] = v; }
    });
    const dw = project.downwind(), hasSrc = src.some(v => v > 0);
    const pl = hasSrc ? plume(src, dw, P.plumeLength, px) : new Float32Array(N);
    // per le case il pennacchio conta fuori dalla sorgente stessa
    // riepiloghi
    const housing = new Uint8Array(N), industry = new Uint8Array(N), reason = new Uint8Array(N);
    let stat = { ok: 0, slope: 0, plume: 0, reserved: 0, blocked: 0 };
    for (let q = 0; q < N; q++) {
      const blocked = water[q] || dWater[q] <= P.shore || slope[q] > P.slopeMax;
      let reserved = false;
      Object.keys(P.reserve).forEach(k => { if (P.reserve[k] && inBuf(k, q)) reserved = true; });
      let h = HOUSING.OK;
      if (blocked) h = HOUSING.BLOCKED;
      else if (reserved) h = HOUSING.RESERVED;
      else if (pl[q] > 0.25 && !src[q]) h = HOUSING.PLUME;
      else if (slope[q] > P.slopeWarn) h = HOUSING.SLOPE;
      housing[q] = h;
      stat[['ok', 'slope', 'plume', 'reserved', 'blocked'][h]]++;
      let g = INDUSTRY.OK;
      if (blocked) g = INDUSTRY.BLOCKED;
      else if (inBuf('groundwater', q)) g = INDUSTRY.GROUNDWATER;
      else if (slope[q] > P.slopeWarn) g = INDUSTRY.SLOPE;
      else if (inBuf('ore', q) || inBuf('oil', q) || res.industryPlan[q] >= P.threshold) g = INDUSTRY.GOOD;
      industry[q] = g;
    }
    Object.keys(stat).forEach(k => stat[k] = stat[k] / N);
    return { res: n, px, params: P, slope, water, dWater, near, plume: pl, housing, industry, stat };
  }

  // valori puntuali per il cursore
  function at(A, project, x, y) {
    const { u, v } = project.worldToUV(x, y);
    const i = Math.min(A.res - 1, Math.max(0, Math.floor(u * A.res))), j = Math.min(A.res - 1, Math.max(0, Math.floor(v * A.res)));
    const q = j * A.res + i;
    return { slope: A.slope[q], plume: A.plume[q], housing: A.housing[q], industry: A.industry[q], shore: A.dWater[q] };
  }

  CS2.analysis = { RES, DEFAULTS, HOUSING, INDUSTRY, params, compute, at, distance, plume };
})(typeof window !== 'undefined' ? window : globalThis);
