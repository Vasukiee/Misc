// Pennelli per modificare a mano gli strati, con annulla/ripeti.
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};

  // Modalità disponibili per tipo di strato
  const MODES = {
    f32: { raise: 'Alza', lower: 'Abbassa', flatten: 'Livella', smooth: 'Liscia' },
    u8:  { paint: 'Dipingi', erase: 'Cancella', smooth: 'Sfuma' }
  };

  // Una pennellata. o: { x, y (mondo), radius (m), strength 0..1, mode, target (m, per livella) }
  function dab(project, key, o) {
    const L = project.layers[key], n = L.res, px = project.map.size / n;
    const c = project.worldToUV(o.x, o.y), ci = c.u * n - 0.5, cj = c.v * n - 0.5, rp = o.radius / px;
    const i0 = Math.max(0, Math.floor(ci - rp)), i1 = Math.min(n - 1, Math.ceil(ci + rp));
    const j0 = Math.max(0, Math.floor(cj - rp)), j1 = Math.min(n - 1, Math.ceil(cj + rp));
    if (i0 > i1 || j0 > j1) return null;
    const d = L.data, s = o.strength;
    const rate = L.kind === 'f32' ? Math.max(0.5, o.radius * 0.02) : 255;   // m (o unità) per pennellata a forza 1
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const r = Math.hypot(i - ci, j - cj) / rp;
      if (r > 1) continue;
      const w = 0.5 + 0.5 * Math.cos(Math.PI * r);        // bordo morbido
      const k = j * n + i;
      let v = d[k];
      switch (o.mode) {
        case 'raise': v += rate * s * w; break;
        case 'lower': v -= rate * s * w; break;
        case 'flatten': v += (o.target - v) * Math.min(1, s * w); break;
        case 'paint': v += (255 - v) * Math.min(1, s * w * 1.5); break;
        case 'erase': v -= v * Math.min(1, s * w * 1.5); break;
        case 'smooth': {
          let a = 0, m = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
            a += d[jj * n + ii]; m++;   // in place: più leggero di una copia dello strato
          }
          v += (a / m - v) * Math.min(1, s * w);
          break;
        }
      }
      if (L.kind === 'f32') v = Math.max(0, Math.min(project.map.heightScale, v));
      d[k] = L.kind === 'u8' ? Math.max(0, Math.min(255, Math.round(v))) : v;
    }
    L.changed();
    return { i0, i1, j0, j1 };
  }

  // Annulla/ripeti: all'inizio del tratto copia lo strato, alla fine salva solo il rettangolo cambiato.
  class History {
    constructor(limit) { this.limit = limit || 30; this.undoStack = []; this.redoStack = []; this.pending = null; }
    begin(project, key, label) { this.pending = { key, label, before: project.layers[key].data.slice(), box: null }; }
    grow(box) {
      if (!this.pending || !box) return;
      const b = this.pending.box;
      this.pending.box = b ? { i0: Math.min(b.i0, box.i0), i1: Math.max(b.i1, box.i1), j0: Math.min(b.j0, box.j0), j1: Math.max(b.j1, box.j1) } : box;
    }
    end(project) {
      const p = this.pending; this.pending = null;
      if (!p || !p.box) return;
      const L = project.layers[p.key];
      this.undoStack.push({ key: p.key, label: p.label, box: p.box, before: cut(p.before, L.res, p.box), after: cut(L.data, L.res, p.box) });
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack = [];
    }
    // per operazioni che sostituiscono un intero strato (import)
    recordWhole(project, key, label, before) {
      const L = project.layers[key], box = { i0: 0, i1: L.res - 1, j0: 0, j1: L.res - 1 };
      this.undoStack.push({ key, label, box, before, after: L.data.slice() });
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack = [];
    }
    undo(project) { return this._swap(project, this.undoStack, this.redoStack, 'before'); }
    redo(project) { return this._swap(project, this.redoStack, this.undoStack, 'after'); }
    _swap(project, from, to, field) {
      const e = from.pop(); if (!e) return null;
      const L = project.layers[e.key];
      paste(L.data, L.res, e.box, e[field]); L.changed();
      to.push(e);
      return e;
    }
    clear() { this.undoStack = []; this.redoStack = []; this.pending = null; }
  }
  function cut(data, n, b) {
    const w = b.i1 - b.i0 + 1, out = new data.constructor(w * (b.j1 - b.j0 + 1));
    for (let j = b.j0; j <= b.j1; j++) out.set(data.subarray(j * n + b.i0, j * n + b.i1 + 1), (j - b.j0) * w);
    return out;
  }
  function paste(data, n, b, part) {
    const w = b.i1 - b.i0 + 1;
    for (let j = b.j0; j <= b.j1; j++) data.set(part.subarray((j - b.j0) * w, (j - b.j0 + 1) * w), j * n + b.i0);
  }

  CS2.brush = { MODES, dab, History };
})(typeof window !== 'undefined' ? window : globalThis);
