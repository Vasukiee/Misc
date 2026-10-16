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

  // ---- curve di Bézier cubiche {a, c1, c2, b}
  function bezPoint(c, t) {
    const u = 1 - t;
    return V(u * u * u * c.a.x + 3 * u * u * t * c.c1.x + 3 * u * t * t * c.c2.x + t * t * t * c.b.x,
             u * u * u * c.a.y + 3 * u * u * t * c.c1.y + 3 * u * t * t * c.c2.y + t * t * t * c.b.y);
  }
  function bezTangent(c, t) {
    const u = 1 - t;
    return norm(V(3 * u * u * (c.c1.x - c.a.x) + 6 * u * t * (c.c2.x - c.c1.x) + 3 * t * t * (c.b.x - c.c2.x),
                  3 * u * u * (c.c1.y - c.a.y) + 6 * u * t * (c.c2.y - c.c1.y) + 3 * t * t * (c.b.y - c.c2.y)));
  }
  // de Casteljau: divide la curva in t mantenendo la forma esatta
  function bezSplit(c, t) {
    const p01 = lerp(c.a, c.c1, t), p12 = lerp(c.c1, c.c2, t), p23 = lerp(c.c2, c.b, t);
    const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t), m = lerp(p012, p123, t);
    return [{ a: c.a, c1: p01, c2: p012, b: m }, { a: m, c1: p123, c2: p23, b: c.b }];
  }
  // punti campionati con il loro parametro t
  function bezSample(c, n) { const out = []; for (let k = 0; k <= n; k++) { const t = k / n; out.push({ t, p: bezPoint(c, t) }); } return out; }
  function bezLength(c) { const s = bezSample(c, 24); let L = 0; for (let k = 1; k < s.length; k++) L += dist(s[k - 1].p, s[k].p); return L; }
  // curva quadratica (inizio, controllo, fine) → cubica
  const quadToCubic = (a, q, b) => ({ a, c1: lerp(a, q, 2 / 3), c2: lerp(b, q, 2 / 3), b });
  const straight = (a, b) => ({ a, c1: lerp(a, b, 1 / 3), c2: lerp(a, b, 2 / 3), b });

  CS2.geom = { V, add, sub, mul, dot, crs, len, dist, norm, lerp, polyArea, centroid, segDist,
    bezPoint, bezTangent, bezSplit, bezSample, bezLength, quadToCubic, straight };
})(typeof window !== 'undefined' ? window : globalThis);
