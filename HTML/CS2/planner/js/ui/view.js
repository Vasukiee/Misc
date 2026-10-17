// Vista della mappa: camera (pan/zoom) e disegno degli strati.
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};
  const { ROAD_TYPES } = CS2.roads;

  const RES_COLORS = {
    fertile:     [134, 168, 52],
    forest:      [46, 120, 66],
    ore:         [128, 84, 176],
    oil:         [184, 78, 40],
    groundwater: [44, 124, 196],
    industryPlan:[214, 168, 20],
    water:       [120, 164, 200]
  };

  class MapView {
    constructor(canvas, getProject) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.getProject = getProject;
      this.cam = { x: 0, y: 0, s: 0.05 };
      this.W = 800; this.H = 600; this.dpr = 1;
      this.show = { terrain: true, grid: true, fertile: true, forest: true, ore: true, oil: true, groundwater: true, industryPlan: true, water: true, roads: true, modules: true };
      this.modules = null;     // risultato di CS2.modules.compute
      this.maxPhase = null;    // piano di crescita: mostra solo fino a questa fase (null = tutto)
      this.analysis = null;    // { A, mode, sig } impostato dall'app
      this.cache = {};
      this.overlays = [];      // funzioni (ctx, view) disegnate sopra, per gli strumenti futuri
    }
    resize() {
      const c = this.canvas, w = c.clientWidth || 800, h = c.clientHeight || 600;
      this.dpr = root.devicePixelRatio || 1;
      const oldW = this.W;
      this.W = w; this.H = h;
      c.width = Math.round(w * this.dpr); c.height = Math.round(h * this.dpr);
      if (oldW && oldW !== w) this.cam.s *= w / oldW;
    }
    fit() {
      const s = this.getProject().map.size;
      this.cam.s = Math.min(this.W, this.H) / (s * 1.08);
      this.cam.x = 0; this.cam.y = 0;
    }
    sx(x) { return (x - this.cam.x) * this.cam.s + this.W / 2; }
    sy(y) { return (y - this.cam.y) * this.cam.s + this.H / 2; }
    toWorld(X, Y) { return { x: (X - this.W / 2) / this.cam.s + this.cam.x, y: (Y - this.H / 2) / this.cam.s + this.cam.y }; }
    zoomAt(X, Y, k) {
      const b = this.toWorld(X, Y);
      this.cam.s = Math.max(0.005, Math.min(4, this.cam.s * k));
      const a = this.toWorld(X, Y);
      this.cam.x += b.x - a.x; this.cam.y += b.y - a.y;
    }

    // ------------------------------------------------ immagini degli strati (cache)
    terrainImage(p) {
      const L = p.layers.elevation, key = 'terrain', sea = p.map.seaLevel;
      const sig = L.version + '|' + sea + '|' + p.layers.water.version + '|' + p.map.size;
      const c = this.cache[key];
      if (c && c.sig === sig) return c.img;
      const n = L.res, cv = document.createElement('canvas'); cv.width = n; cv.height = n;
      const g = cv.getContext('2d'), im = g.createImageData(n, n), d = L.data;
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < d.length; k++) { if (d[k] < lo) lo = d[k]; if (d[k] > hi) hi = d[k]; }
      const span = Math.max(1, hi - Math.max(lo, sea));
      const px = p.map.size / n;                              // metri per pixel
      const W = p.layers.water, wr = W.res / n;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i, h = d[k];
        const dx = (L.get(i + 1, j) - L.get(i - 1, j)) / (2 * px), dy = (L.get(i, j + 1) - L.get(i, j - 1)) / (2 * px);
        const shade = Math.max(0, Math.min(1, 0.7 - (dx * -0.7 + dy * -0.7) * 9));   // luce da nord-ovest
        let r, gg, b;
        const extraWater = W.data[Math.floor(j * wr) * W.res + Math.floor(i * wr)] > 127;
        if (h < sea || extraWater) { const t = Math.min(1, Math.max(0, (sea - h) / 60)); r = 190 - 40 * t; gg = 212 - 30 * t; b = 226 - 18 * t; }
        else {
          const t = (h - Math.max(lo, sea)) / span;           // tinta ipsometrica chiara, come una carta stampata
          r = 236 - 30 * t; gg = 236 - 44 * t; b = 222 - 54 * t;
          const k = 0.74 + shade * 0.4;                       // ombreggiatura leggera
          r *= k; gg *= k; b *= k;
        }
        im.data[k * 4] = r; im.data[k * 4 + 1] = gg; im.data[k * 4 + 2] = b; im.data[k * 4 + 3] = 255;
      }
      g.putImageData(im, 0, 0);
      this.cache[key] = { sig, img: cv, lo, hi };
      return cv;
    }
    resourceImage(p, key) {
      const L = p.layers[key], c = this.cache[key];
      if (c && c.sig === L.version) return c.img;
      const n = L.res, cv = document.createElement('canvas'); cv.width = n; cv.height = n;
      const g = cv.getContext('2d'), im = g.createImageData(n, n), col = RES_COLORS[key];
      for (let k = 0; k < L.data.length; k++) {
        const a = L.data[k];
        if (!a) continue;
        im.data[k * 4] = col[0]; im.data[k * 4 + 1] = col[1]; im.data[k * 4 + 2] = col[2]; im.data[k * 4 + 3] = Math.round(a * 0.5);
      }
      g.putImageData(im, 0, 0);
      this.cache[key] = { sig: L.version, img: cv };
      return cv;
    }
    analysisImage() {
      const { A, mode, sig } = this.analysis, c = this.cache.analysis;
      if (c && c.sig === sig + mode) return c.img;
      const n = A.res, cv = document.createElement('canvas'); cv.width = n; cv.height = n;
      const g = cv.getContext('2d'), im = g.createImageData(n, n), d = im.data, P = A.params;
      const put = (k, rgb, a) => { d[k * 4] = rgb[0]; d[k * 4 + 1] = rgb[1]; d[k * 4 + 2] = rgb[2]; d[k * 4 + 3] = a; };
      const H = [null, [[220, 200, 60], 90], [[150, 100, 50], 140], [[230, 140, 40], 150], [[200, 60, 60], 150]];
      const I = [null, [[220, 200, 60], 90], [[70, 150, 220], 140], null, [[200, 60, 60], 150], [[90, 190, 90], 130]];
      for (let k = 0; k < n * n; k++) {
        if (mode === 'slope') {
          const s = A.slope[k];
          if (s > P.slopeMax) put(k, [200, 60, 60], 160);
          else if (s > P.slopeWarn) put(k, [230, 160, 40], 70 + 80 * (s - P.slopeWarn) / Math.max(1, P.slopeMax - P.slopeWarn));
        } else if (mode === 'plume') {
          if (A.plume[k] > 0.02) put(k, [150, 100, 50], Math.min(200, A.plume[k] * 220));
        } else if (mode === 'housing') {
          const e = H[A.housing[k]]; if (e) put(k, e[0], e[1]);
        } else if (mode === 'industry') {
          const e = I[A.industry[k]]; if (e) put(k, e[0], e[1]);
        }
      }
      g.putImageData(im, 0, 0);
      this.cache.analysis = { sig: sig + mode, img: cv };
      return cv;
    }
    elevationRange(p) { this.terrainImage(p); const c = this.cache.terrain; return { lo: c.lo, hi: c.hi }; }

    // ------------------------------------------------ disegno
    draw() {
      const p = this.getProject(), ctx = this.ctx, S = p.map.size, h = S / 2;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.transparent) ctx.clearRect(0, 0, this.W, this.H);       // export "solo strade e moduli"
      else { ctx.fillStyle = '#e4dfd2'; ctx.fillRect(0, 0, this.W, this.H); }
      const X0 = this.sx(-h), Y0 = this.sy(-h), WW = S * this.cam.s;

      ctx.imageSmoothingEnabled = this.cam.s * S / p.layers.elevation.res < 3;   // pixel netti quando si zooma molto
      if (this.transparent) { /* niente terreno né strati */ }
      else if (this.show.terrain) ctx.drawImage(this.terrainImage(p), X0, Y0, WW, WW);
      else { ctx.fillStyle = '#fbfaf6'; ctx.fillRect(X0, Y0, WW, WW); }
      if (!this.transparent) ['fertile', 'forest', 'ore', 'oil', 'groundwater', 'industryPlan'].forEach(k => { if (this.show[k]) ctx.drawImage(this.resourceImage(p, k), X0, Y0, WW, WW); });
      if (this.analysis && this.analysis.mode !== 'none') ctx.drawImage(this.analysisImage(), X0, Y0, WW, WW);
      if (this.show.modules && this.modules) this.drawModules(p);

      if (this.show.grid && !this.transparent) {
        const step = this.cam.s * 1000 > 40 ? 1000 : 2000;
        ctx.strokeStyle = 'rgba(31,42,54,0.12)'; ctx.lineWidth = 1;
        for (let x = -h + step; x < h; x += step) { ctx.beginPath(); ctx.moveTo(this.sx(x), Y0); ctx.lineTo(this.sx(x), Y0 + WW); ctx.stroke(); }
        for (let y = -h + step; y < h; y += step) { ctx.beginPath(); ctx.moveTo(X0, this.sy(y)); ctx.lineTo(X0 + WW, this.sy(y)); ctx.stroke(); }
      }
      if (!this.transparent) { ctx.strokeStyle = '#1f2a36'; ctx.lineWidth = 1.5; ctx.strokeRect(X0, Y0, WW, WW); }

      if (this.show.roads) this.drawRoads(p);
      if (this.show.modules && this.modules) this.drawProposals();
      this.overlays.forEach(f => f(ctx, this));
      if (!this.transparent) { this.drawWind(p); this.drawScale(); }
    }
    drawRoads(p) {
      const ctx = this.ctx, byId = new Map(p.graph.nodes.map(n => [n.id, n])), sel = this.selection || {};
      const COL = { highway: '#e39a3b', xl: '#f2c75c', large: '#f6dc8a', medium: '#ffffff', small: '#ffffff', alley: '#f1ede4' };
      const order = ['alley', 'small', 'medium', 'large', 'xl', 'highway'];
      ctx.lineCap = 'round';
      const edges = p.graph.edges.slice().sort((x, y) => order.indexOf(x.type) - order.indexOf(y.type));
      const path = e => {
        const a = byId.get(e.a), b = byId.get(e.b);
        ctx.beginPath(); ctx.moveTo(this.sx(a.x), this.sy(a.y));
        if (e.c1 && e.c2) ctx.bezierCurveTo(this.sx(e.c1.x), this.sy(e.c1.y), this.sx(e.c2.x), this.sy(e.c2.y), this.sx(b.x), this.sy(b.y));
        else ctx.lineTo(this.sx(b.x), this.sy(b.y));
      };
      edges.forEach(e => {
        const t = ROAD_TYPES[e.type];
        if (this.edgeFuture(e)) {
          ctx.strokeStyle = 'rgba(31,42,54,0.35)'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 5]);
          path(e); ctx.stroke(); ctx.setLineDash([]);
          return;
        }
        const hl = sel.edge === e.id || sel.hoverEdge === e.id;
        if (hl) {
          ctx.strokeStyle = sel.edge === e.id ? '#c2410c' : 'rgba(194,65,12,0.45)';
          ctx.lineWidth = Math.max(5, t.w * this.cam.s + 4);
          path(e); ctx.stroke();
        }
        const lw = Math.max(order.indexOf(e.type) * 0.5 + 1.2, t.w * this.cam.s);
        ctx.strokeStyle = 'rgba(31,42,54,0.85)'; ctx.lineWidth = lw + 2;              // bordo d'inchiostro
        path(e); ctx.stroke();
        ctx.strokeStyle = COL[e.type];
        ctx.lineWidth = lw;
        path(e); ctx.stroke();
      });
      // maniglie della strada selezionata
      const se = sel.edge && p.graph.edges.find(e => e.id === sel.edge);
      if (se && this.showNodes) {
        const a = byId.get(se.a), b = byId.get(se.b);
        const hs = this.handles(p, se);
        ctx.strokeStyle = 'rgba(194,65,12,0.7)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        if (se.c1) { ctx.beginPath(); ctx.moveTo(this.sx(a.x), this.sy(a.y)); ctx.lineTo(this.sx(se.c1.x), this.sy(se.c1.y)); ctx.moveTo(this.sx(b.x), this.sy(b.y)); ctx.lineTo(this.sx(se.c2.x), this.sy(se.c2.y)); ctx.stroke(); }
        ctx.setLineDash([]);
        hs.forEach(h => {
          const X = this.sx(h.x), Y = this.sy(h.y), on = sel.hoverHandle === h.kind;
          ctx.fillStyle = on ? '#c2410c' : '#ffffff'; ctx.strokeStyle = '#c2410c'; ctx.lineWidth = 1.5;
          if (h.kind === 'mid') { ctx.beginPath(); ctx.arc(X, Y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
          else { ctx.fillRect(X - 4, Y - 4, 8, 8); ctx.strokeRect(X - 4, Y - 4, 8, 8); }
        });
      }
      if (this.showNodes) {
        p.graph.nodes.forEach(n => {
          const on = sel.node === n.id || sel.hoverNode === n.id;
          ctx.fillStyle = on ? '#c2410c' : '#ffffff'; ctx.strokeStyle = '#1f2a36'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(this.sx(n.x), this.sy(n.y), on ? 5 : 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        });
      }
    }
    drawModules(p) {
      const ctx = this.ctx, M = CS2.modules, C = M.C, sel = this.selection || {};
      const COL = { [C.CONFLICT]: [230, 60, 200, 200], [C.INTERIOR]: [96, 102, 112, 150], [C.RESERVED]: [230, 140, 40, 190], [C.PLUME]: [150, 100, 50, 190],
        [C.BLOCKED]: [200, 50, 50, 200], [C.SLOPE]: [220, 200, 60, 170], [C.GROUNDWATER]: [70, 150, 220, 190] };
      const sig = this.modules.sig;
      ctx.imageSmoothingEnabled = false;
      this.modules.faces.forEach(f => {
        const tc = M.TYPES[f.type].color;
        ctx.beginPath(); f.poly.forEach((q, i) => i ? ctx.lineTo(this.sx(q.x), this.sy(q.y)) : ctx.moveTo(this.sx(q.x), this.sy(q.y))); ctx.closePath();
        if (this.isFuture(f)) {
          ctx.fillStyle = 'rgba(31,42,54,0.04)'; ctx.fill();
          ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(31,42,54,0.3)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
          if (sel.module && f === sel.moduleFace) { ctx.strokeStyle = '#c2410c'; ctx.lineWidth = 2; ctx.stroke(); }
          return;
        }
        ctx.fillStyle = 'rgba(' + tc.join(',') + ',0.10)'; ctx.fill();
        if (!f.img || f.imgSig !== sig) {
          const x0 = Math.floor(f.bbox.x0 / 8) * 8, y0 = Math.floor(f.bbox.y0 / 8) * 8;
          const w = Math.max(1, Math.ceil((f.bbox.x1 - x0) / 8)), h = Math.max(1, Math.ceil((f.bbox.y1 - y0) / 8));
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          const g = cv.getContext('2d'), im = g.createImageData(w, h), d = im.data;
          for (let k = 0; k < f.cells.length; k += 3) {
            const i = Math.floor((f.cells[k] - x0) / 8), j = Math.floor((f.cells[k + 1] - y0) / 8), s = f.cells[k + 2];
            const c = s === C.ZONE ? [tc[0], tc[1], tc[2], 120] : COL[s];
            const o = (j * w + i) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = c[3];
          }
          g.putImageData(im, 0, 0);
          f.img = cv; f.imgSig = sig; f.imgX = x0; f.imgY = y0;
        }
        ctx.drawImage(f.img, this.sx(f.imgX), this.sy(f.imgY), f.img.width * 8 * this.cam.s, f.img.height * 8 * this.cam.s);
        if (sel.module && f === sel.moduleFace) { ctx.strokeStyle = '#c2410c'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]); }
      });
      ctx.imageSmoothingEnabled = true;
    }
    isFuture(f) { return this.maxPhase !== null && (f.phase === null || f.phase > this.maxPhase); }
    edgeFuture(e) {
      if (this.maxPhase === null || !this.modules || !this.modules.growth) return false;
      const m = this.modules.growth.edgePhase;
      if (!m.has(e.id)) return false;
      const ph = m.get(e.id);
      return ph === null || ph > this.maxPhase;
    }
    drawProposals() {
      const ctx = this.ctx;
      ctx.setLineDash([7, 5]); ctx.lineCap = 'butt';
      this.modules.faces.forEach(f => {
        if (!f.proposal || this.isFuture(f)) return;
        f.proposal.segs.forEach(s => {
          ctx.strokeStyle = s.type === 'medium' ? 'rgba(29,78,216,0.9)' : 'rgba(29,78,216,0.6)';
          ctx.lineWidth = Math.max(1.2, ROAD_TYPES[s.type].w * this.cam.s * 0.7);
          ctx.beginPath(); ctx.moveTo(this.sx(s.a.x), this.sy(s.a.y)); ctx.lineTo(this.sx(s.b.x), this.sy(s.b.y)); ctx.stroke();
        });
      });
      ctx.setLineDash([]); ctx.lineCap = 'round';
      // etichette dei moduli quando c'è spazio
      ctx.font = "600 10.5px 'IBM Plex Mono', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      this.modules.faces.forEach(f => {
        if ((f.bbox.x1 - f.bbox.x0) * this.cam.s < 70 || !f.stats.cells) return;
        const q = CS2.modules.interiorPoint(f), bad = f.warnings.filter(w => w[0] !== 'good').length;
        if (this.isFuture(f)) {
          if (f.phase === null) return;
          ctx.fillStyle = 'rgba(31,42,54,0.45)'; ctx.fillText('F' + f.phase, this.sx(q.x), this.sy(q.y)); return;
        }
        const txt = (f.phase !== null ? 'F' + f.phase + ' · ' : '') + Math.round(100 * f.stats.zone / f.stats.cells) + '% zonabile' + (bad ? ' · ⚠ ' + bad : '');
        const w = ctx.measureText(txt).width + 8;
        ctx.fillStyle = 'rgba(251,250,246,0.92)'; ctx.fillRect(this.sx(q.x) - w / 2, this.sy(q.y) - 8, w, 16);
        ctx.strokeStyle = 'rgba(31,42,54,0.3)'; ctx.lineWidth = 1; ctx.strokeRect(this.sx(q.x) - w / 2 + 0.5, this.sy(q.y) - 7.5, w - 1, 15);
        ctx.fillStyle = bad ? '#b45309' : '#1f2a36'; ctx.fillText(txt, this.sx(q.x), this.sy(q.y));
      });
    }
    // maniglie modificabili di una strada: c1/c2 se curva, punto medio se dritta
    handles(p, e) {
      if (e.c1 && e.c2) return [{ kind: 'c1', x: e.c1.x, y: e.c1.y }, { kind: 'c2', x: e.c2.x, y: e.c2.y }];
      const a = p.node(e.a), b = p.node(e.b);
      return [{ kind: 'mid', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }];
    }
    drawWind(p) {
      const ctx = this.ctx, dw = p.downwind(), cx = this.W - 46, cy = 46, r = 26;
      ctx.fillStyle = 'rgba(251,250,246,0.94)'; ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#b8af9b'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#1f2a36'; ctx.font = "600 9px 'IBM Plex Mono', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('N', cx, cy - r - 3);
      const ax = cx - dw.x * r, ay = cy - dw.y * r, bx = cx + dw.x * r, by = cy + dw.y * r;
      ctx.strokeStyle = '#c2410c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      const ang = Math.atan2(dw.y, dw.x);
      ctx.fillStyle = '#c2410c'; ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(bx - 8 * Math.cos(ang - 0.4), by - 8 * Math.sin(ang - 0.4)); ctx.lineTo(bx - 8 * Math.cos(ang + 0.4), by - 8 * Math.sin(ang + 0.4)); ctx.fill();
      ctx.fillStyle = '#4a5563'; ctx.fillText('VENTO', cx, cy + r + 18);
    }
    drawScale() {
      const ctx = this.ctx, steps = [50, 100, 200, 500, 1000, 2000, 5000];
      let m = steps[0]; steps.forEach(v => { if (v * this.cam.s <= 140) m = v; });
      ctx.strokeStyle = '#1f2a36'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(12, this.H - 18); ctx.lineTo(12 + m * this.cam.s, this.H - 18); ctx.stroke();
      ctx.fillStyle = '#1f2a36'; ctx.font = "600 10.5px 'IBM Plex Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(m >= 1000 ? m / 1000 + ' km' : m + ' m', 18 + m * this.cam.s, this.H - 18);
    }
  }

  CS2.MapView = MapView;
  CS2.RES_COLORS = RES_COLORS;
})(typeof window !== 'undefined' ? window : globalThis);
