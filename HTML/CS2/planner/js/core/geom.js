// Geometria 2D di base (coordinate in metri; x verso est, y verso sud).
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};

  const V = (x, y) => ({ x, y });
  const add = (a, b) => V(a.x + b.x, a.y + b.y);
  const sub = (a, b) => V(a.x - b.x, a.y - b.y);
  const mul = (a, k) => V(a.x * k, a.y * k);
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const crs = (a, b) => a.x * b.y - a.y * b.x;
  const len = a => Math.hypot(a.x, a.y);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const norm = a => { const l = len(a) || 1; return V(a.x / l, a.y / l); };
  const lerp = (a, b, t) => V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

  function polyArea(p) { let s = 0; for (let i = 0; i < p.length; i++) s += crs(p[i], p[(i + 1) % p.length]); return s / 2; }
  function centroid(p) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[i], r = p[(i + 1) % p.length], c = crs(q, r);
      a += c; cx += (q.x + r.x) * c; cy += (q.y + r.y) * c;
    }
    if (Math.abs(a) < 1e-9) return p[0];
    return V(cx / (3 * a), cy / (3 * a));
  }
  // distanza punto-segmento e parametro t della proiezione
  function segDist(p, a, b) {
    const ab = sub(b, a), l2 = dot(ab, ab);
    const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
    const q = add(a, mul(ab, t));
    return { d: dist(p, q), t, q };
  }

  CS2.geom = { V, add, sub, mul, dot, crs, len, dist, norm, lerp, polyArea, centroid, segDist };
})(typeof window !== 'undefined' ? window : globalThis);
