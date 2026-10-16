// Vista della mappa: camera (pan/zoom) e disegno degli strati.
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};
  const { ROAD_TYPES } = CS2.roads;

  const RES_COLORS = {
    fertile:     [196, 170, 70],
    forest:      [60, 140, 70],
    ore:         [170, 120, 200],
    oil:         [205, 95, 55],
    groundwater: [70, 150, 220],
    water:       [40, 90, 150]
  };

  class MapView {
    constructor(canvas, getProject) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.getProject = getProject;
      this.cam = { x: 0, y: 0, s: 0.05 };
      this.W = 800; this.H = 600; this.dpr = 1;
      this.show = { terrain: true, grid: true, fertile: true, forest: true, ore: true, oil: true, groundwater: true, water: true, roads: true };
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
        if (h < sea || extraWater) { const t = Math.min(1, (sea - h) / 60); r = 22 - 10 * t; gg = 48 - 18 * t; b = 70 - 20 * t; }
        else {
          const t = (h - Math.max(lo, sea)) / span;           // tinta ipsometrica scura
          r = 38 + 60 * t; gg = 48 + 40 * t; b = 38 + 30 * t;
          r *= 0.55 + shade * 0.6; gg *= 0.55 + shade * 0.6; b *= 0.55 + shade * 0.6;
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
        im.data[k * 4] = col[0]; im.data[k * 4 + 1] = col[1]; im.data[k * 4 + 2] = col[2]; im.data[k * 4 + 3] = Math.round(a * 0.6);
      }
      g.putImageData(im, 0, 0);
      this.cache[key] = { sig: L.version, img: cv };
      return cv;
    }
    elevationRange(p) { this.terrainImage(p); const c = this.cache.terrain; return { lo: c.lo, hi: c.hi }; }

    // ------------------------------------------------ disegno
    draw() {
      const p = this.getProject(), ctx = this.ctx, S = p.map.size, h = S / 2;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#070809'; ctx.fillRect(0, 0, this.W, this.H);
      const X0 = this.sx(-h), Y0 = this.sy(-h), WW = S * this.cam.s;

      ctx.imageSmoothingEnabled = this.cam.s * S / p.layers.elevation.res < 3;   // pixel netti quando si zooma molto
      if (this.show.terrain) ctx.drawImage(this.terrainImage(p), X0, Y0, WW, WW);
      else { ctx.fillStyle = '#0d0f10'; ctx.fillRect(X0, Y0, WW, WW); }
      ['fertile', 'forest', 'ore', 'oil', 'groundwater'].forEach(k => { if (this.show[k]) ctx.drawImage(this.resourceImage(p, k), X0, Y0, WW, WW); });

      if (this.show.grid) {
        const step = this.cam.s * 1000 > 40 ? 1000 : 2000;
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
        for (let x = -h + step; x < h; x += step) { ctx.beginPath(); ctx.moveTo(this.sx(x), Y0); ctx.lineTo(this.sx(x), Y0 + WW); ctx.stroke(); }
        for (let y = -h + step; y < h; y += step) { ctx.beginPath(); ctx.moveTo(X0, this.sy(y)); ctx.lineTo(X0 + WW, this.sy(y)); ctx.stroke(); }
      }
      ctx.strokeStyle = '#948b76'; ctx.lineWidth = 1.5; ctx.strokeRect(X0, Y0, WW, WW);

      if (this.show.roads) this.drawRoads(p);
      this.overlays.forEach(f => f(ctx, this));
      this.drawWind(p);
      this.drawScale();
    }
    drawRoads(p) {
      const ctx = this.ctx, byId = new Map(p.graph.nodes.map(n => [n.id, n]));
      ctx.lineCap = 'round';
      p.graph.edges.forEach(e => {
        const a = byId.get(e.a), b = byId.get(e.b), t = ROAD_TYPES[e.type];
        ctx.strokeStyle = e.type === 'highway' ? '#4a5560' : '#8a8f93';
        ctx.lineWidth = Math.max(1.5, t.w * this.cam.s);
        ctx.beginPath(); ctx.moveTo(this.sx(a.x), this.sy(a.y)); ctx.lineTo(this.sx(b.x), this.sy(b.y)); ctx.stroke();
      });
    }
    drawWind(p) {
      const ctx = this.ctx, dw = p.downwind(), cx = this.W - 46, cy = 46, r = 26;
      ctx.fillStyle = 'rgba(9,10,11,0.8)'; ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#52585b'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#7a7063'; ctx.font = "9px 'Space Mono', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('N', cx, cy - r - 3);
      const ax = cx - dw.x * r, ay = cy - dw.y * r, bx = cx + dw.x * r, by = cy + dw.y * r;
      ctx.strokeStyle = '#c8904a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      const ang = Math.atan2(dw.y, dw.x);
      ctx.fillStyle = '#c8904a'; ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(bx - 8 * Math.cos(ang - 0.4), by - 8 * Math.sin(ang - 0.4)); ctx.lineTo(bx - 8 * Math.cos(ang + 0.4), by - 8 * Math.sin(ang + 0.4)); ctx.fill();
      ctx.fillStyle = '#a3a8a8'; ctx.fillText('VENTO', cx, cy + r + 18);
    }
    drawScale() {
      const ctx = this.ctx, steps = [50, 100, 200, 500, 1000, 2000, 5000];
      let m = steps[0]; steps.forEach(v => { if (v * this.cam.s <= 140) m = v; });
      ctx.strokeStyle = '#a3a8a8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(12, this.H - 18); ctx.lineTo(12 + m * this.cam.s, this.H - 18); ctx.stroke();
      ctx.fillStyle = '#a3a8a8'; ctx.font = "10px 'Space Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(m >= 1000 ? m / 1000 + ' km' : m + ' m', 18 + m * this.cam.s, this.H - 18);
    }
  }

  CS2.MapView = MapView;
  CS2.RES_COLORS = RES_COLORS;
})(typeof window !== 'undefined' ? window : globalThis);
