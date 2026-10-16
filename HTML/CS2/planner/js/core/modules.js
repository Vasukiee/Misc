// Moduli: aree chiuse dalla rete stradale. Per ognuna:
// - eventuale proposta di strade interne (collettore + locali alla distanza CtC);
// - analisi a celle di 8 m come le zone del gioco: zonabile entro 6 celle dal bordo strada,
//   interno sprecato oltre, conflitto dove strade con angoli diversi si contendono le stesse celle;
// - vincoli per cella (risorse, sottovento, falda) e avvisi.
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};
  const { V, sub, add, mul, dot, dist, norm, polyArea, centroid, segDist, bezPoint } = CS2.geom;
  const { ROAD_TYPES, ctc, CELL, ZONE_DEPTH } = CS2.roads;

  const REACH = ZONE_DEPTH * CELL;                 // 48 m
  const TYPES = {
    residenziale: { label: 'Residenziale', L: 208, color: [70, 150, 80] },
    centro:       { label: 'Centro',       L: 160, color: [190, 80, 80] },
    industria:    { label: 'Industria',    L: 288, color: [200, 160, 60] },
    parco:        { label: 'Parco / servizi', L: 256, color: [60, 110, 70] }
  };
  // stato delle celle
  const C = { ZONE: 1, CONFLICT: 2, INTERIOR: 3, RESERVED: 4, PLUME: 5, BLOCKED: 6, SLOPE: 7, GROUNDWATER: 8 };

  // ------------------------------------------------------------ facce del grafo planare
  function extractFaces(p) {
    const G = CS2.graph, nm = new Map(p.graph.nodes.map(n => [n.id, n]));
    const out = new Map(), halves = [];
    p.graph.edges.forEach(e => {
      const pts = G.edgePoly(p, e, nm).map(s => s.p);
      if (pts.length < 2) return;
      const h1 = { edge: e, from: e.a, to: e.b, pts }, h2 = { edge: e, from: e.b, to: e.a, pts: pts.slice().reverse() };
      h1.twin = h2; h2.twin = h1;
      [h1, h2].forEach(h => {
        const d = sub(h.pts[1], h.pts[0]); h.ang = Math.atan2(d.y, d.x);
        if (!out.has(h.from)) out.set(h.from, []);
        out.get(h.from).push(h); halves.push(h);
      });
    });
    out.forEach(list => { list.sort((a, b) => a.ang - b.ang); list.forEach((h, i) => h.idx = i); });
    const seen = new Set(), faces = [];
    halves.forEach(h0 => {
      if (seen.has(h0)) return;
      const poly = [], bound = [];
      let h = h0, guard = 0;
      do {
        seen.add(h); bound.push(h);
        for (let k = 0; k < h.pts.length - 1; k++) poly.push(h.pts[k]);
        const list = out.get(h.to);
        h = list[(h.twin.idx + 1) % list.length];
      } while (h !== h0 && ++guard < 100000);
      const area = polyArea(poly);
      faces.push({ poly, bound, area });
    });
    // le facce interne hanno area negativa con questa convenzione (y verso sud); le altre sono il "fuori"
    return faces.filter(f => f.area < -1).map((f, i) => {
      f.id = i; f.area = -f.area;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      f.poly.forEach(q => { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); });
      f.bbox = { x0, y0, x1, y1 };
      f.dangling = f.bound.some(h => f.bound.includes(h.twin));   // strade a fondo cieco dentro l'area
      return f;
    });
  }

  function inPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function interiorPoint(f) {
    const c = centroid(f.poly);
    if (inPoly(c, f.poly)) return c;
    const { x0, y0, x1, y1 } = f.bbox;
    for (let k = 1; k < 400; k++) { const q = V(x0 + (x1 - x0) * ((k * 0.618) % 1), y0 + (y1 - y0) * ((k * 0.382) % 1)); if (inPoly(q, f.poly)) return q; }
    return c;
  }

  // intervalli in cui la retta P + s·D sta dentro il poligono (pari/dispari)
  function clipLine(P, D, poly) {
    const ss = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i], e = sub(b, a);
      const den = D.x * e.y - D.y * e.x;
      if (Math.abs(den) < 1e-12) continue;
      const w = sub(a, P), s = (w.x * e.y - w.y * e.x) / den, u = (w.x * D.y - w.y * D.x) / den;
      if (u >= 0 && u < 1) ss.push(s);
    }
    ss.sort((x, y) => x - y);
    const iv = [];
    for (let k = 0; k + 1 < ss.length; k += 2) iv.push([ss[k], ss[k + 1]]);
    return iv;
  }

  // ------------------------------------------------------------ tipo dei moduli (marcatori salvati nel progetto)
  function typeOf(p, f) {
    const m = (p.modules || []).find(mk => inPoly(mk, f.poly));
    return m ? m.type : 'residenziale';
  }
  function setType(p, f, type) {
    p.modules = (p.modules || []).filter(mk => !inPoly(mk, f.poly));
    const q = interiorPoint(f);
    p.modules.push({ x: q.x, y: q.y, type });
  }

  // ------------------------------------------------------------ proposta di strade interne
  function propose(p, f, type) {
    // fronte: la strada di bordo più importante (larghezza, poi lunghezza)
    let best = null;
    f.bound.forEach(h => {
      if (f.bound.includes(h.twin)) return;
      const L = h.pts.reduce((s, q, k) => k ? s + dist(h.pts[k - 1], q) : 0, 0);
      const sc = ROAD_TYPES[h.edge.type].w * 1000 + L;
      if (!best || sc > best.sc) best = { h, sc, L };
    });
    if (!best) return null;
    const h = best.h, a = h.pts[0], b = h.pts[h.pts.length - 1];
    const eU = norm(sub(b, a));
    // punto medio del fronte sulla strada vera
    let acc = 0, anchor = a;
    for (let k = 1; k < h.pts.length; k++) { const d = dist(h.pts[k - 1], h.pts[k]); if (acc + d >= best.L / 2) { anchor = CS2.geom.lerp(h.pts[k - 1], h.pts[k], (best.L / 2 - acc) / d); break; } acc += d; }
    let eV = V(-eU.y, eU.x);
    if (!inPoly(add(anchor, mul(eV, 20)), f.poly)) eV = mul(eV, -1);
    let vmin = Infinity, vmax = -Infinity, umin = Infinity, umax = -Infinity;
    f.poly.forEach(q => { const d = sub(q, anchor), u = dot(d, eU), v = dot(d, eV); umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); });
    const frontType = h.edge.type, step = ctc('small', 'small');
    if (vmax - Math.max(0, vmin) < 2 * step + 16 || umax - umin < 2 * step) return { frontType, anchor, eU, eV, segs: [], tooSmall: true };
    // linee parallele al fronte, collettore a metà
    const first = ctc(frontType, 'small');
    const tent = []; for (let q = first; q < vmax - 56; q += step) tent.push(q);
    const coll = tent.length >= 3 ? Math.floor(tent.length / 2) : -1;
    const vl = []; let cur = first, prevT = null;
    for (let k = 0; k < tent.length; k++) {
      const t = k === coll ? 'medium' : 'small';
      if (k > 0) cur += ctc(prevT, t);
      if (cur >= vmax - 56) break;
      vl.push({ pos: cur, type: t }); prevT = t;
    }
    // perpendicolari: spina al centro, isolati lunghi L
    const L = TYPES[type].L, spineT = umax - umin > 420 ? 'medium' : 'small';
    const ul = [{ pos: 0, type: spineT }];
    const s0 = L + (ROAD_TYPES[spineT].w - 16) / 2;
    for (let q = s0; q < umax - 56; q += L) ul.push({ pos: q, type: 'small' });
    for (let q = -s0; q > umin + 56; q -= L) ul.push({ pos: q, type: 'small' });
    const segs = [];
    const addLine = (P, D, t) => clipLine(P, D, f.poly).forEach(([s1, s2]) => { if (s2 - s1 > 40) segs.push({ a: add(P, mul(D, s1)), b: add(P, mul(D, s2)), type: t }); });
    vl.forEach(l => addLine(add(anchor, mul(eV, l.pos)), eU, l.type));
    ul.forEach(l => addLine(add(anchor, mul(eU, l.pos)), eV, l.type));
    return { frontType, anchor, eU, eV, segs, first };
  }

  // ------------------------------------------------------------ indice spaziale dei tratti di strada
  function roadIndex(p, extra) {
    const G = CS2.graph, nm = new Map(p.graph.nodes.map(n => [n.id, n])), B = 64, grid = new Map();
    const put = s => {
      const x0 = Math.floor(Math.min(s.a.x, s.b.x) / B), x1 = Math.floor(Math.max(s.a.x, s.b.x) / B);
      const y0 = Math.floor(Math.min(s.a.y, s.b.y) / B), y1 = Math.floor(Math.max(s.a.y, s.b.y) / B);
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const k = i + ',' + j; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s); }
    };
    p.graph.edges.forEach(e => {
      const pts = G.edgePoly(p, e, nm).map(s => s.p), hw = ROAD_TYPES[e.type].w / 2;
      for (let k = 0; k < pts.length - 1; k++) put({ a: pts[k], b: pts[k + 1], hw, key: 'e' + e.id, dir: norm(sub(pts[k + 1], pts[k])) });
    });
    (extra || []).forEach((s, i) => put({ a: s.a, b: s.b, hw: ROAD_TYPES[s.type].w / 2, key: 'p' + i, dir: norm(sub(s.b, s.a)) }));
    return {
      near(pt, r) {
        const out = new Set(), i0 = Math.floor((pt.x - r) / B), i1 = Math.floor((pt.x + r) / B), j0 = Math.floor((pt.y - r) / B), j1 = Math.floor((pt.y + r) / B);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const l = grid.get(i + ',' + j); if (l) l.forEach(s => out.add(s)); }
        return out;
      }
    };
  }
  const angDiff90 = (u, v) => { const a = Math.abs(Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y)) * 180 / Math.PI % 90; return Math.min(a, 90 - a); };

  // celle di 8 m dentro il modulo, classificate rispetto alle strade
  function cells(f, idx) {
    const out = [], { x0, y0, x1, y1 } = f.bbox, R = REACH + 20;
    for (let y = Math.floor(y0 / CELL) * CELL + CELL / 2; y < y1; y += CELL)
      for (let x = Math.floor(x0 / CELL) * CELL + CELL / 2; x < x1; x += CELL) {
        const pt = V(x, y);
        if (!inPoly(pt, f.poly)) continue;
        let best = null;
        const cand = [];
        idx.near(pt, R).forEach(s => { const de = segDist(pt, s.a, s.b).d - s.hw; cand.push({ s, de }); if (!best || de < best.de) best = { s, de }; });
        if (best && best.de < 0) continue;                     // sulla carreggiata
        let st = C.INTERIOR;
        if (best && best.de <= REACH) {
          st = C.ZONE;
          for (const c of cand) {
            if (c.s.key === best.s.key || c.de > REACH) continue;
            const ad = angDiff90(c.s.dir, best.s.dir);
            if (ad > 8 && ad < 82) { st = C.CONFLICT; break; }
          }
        }
        out.push(x, y, st);
      }
    return out;
  }

  // ------------------------------------------------------------ calcolo completo
  // analysisFn(project) viene chiamata dopo aver preparato la maschera dell'industria (sorgente di inquinamento)
  function compute(p, auto, analysisFn) {
    const faces = extractFaces(p);
    faces.forEach(f => { f.type = typeOf(p, f); f.proposal = auto && !f.dangling ? propose(p, f, f.type) : null; });
    const extra = []; faces.forEach(f => { if (f.proposal) f.proposal.segs.forEach(s => extra.push(s)); });
    const idx = roadIndex(p, extra);
    faces.forEach(f => { f.cells = cells(f, idx); });
    // maschera dell'industria per il pennacchio
    const R = 512, mask = new Float32Array(R * R), S = p.map.size;
    faces.forEach(f => {
      if (f.type !== 'industria') return;
      for (let k = 0; k < f.cells.length; k += 3) {
        if (f.cells[k + 2] === C.INTERIOR) continue;
        const i = Math.floor((f.cells[k] / S + 0.5) * R), j = Math.floor((f.cells[k + 1] / S + 0.5) * R);
        if (i >= 0 && j >= 0 && i < R && j < R) mask[j * R + i] = 1;
      }
    });
    p.derived = p.derived || {};
    p.derived.industryMask = mask;
    const A = analysisFn ? analysisFn(p) : null;
    // vincoli sulle celle zonabili e statistiche
    const AN = CS2.analysis, H = AN.HOUSING, I = AN.INDUSTRY;
    const tot = { modules: faces.length, cells: 0, zone: 0, conflict: 0, interior: 0, constrained: 0, warnings: 0 };
    faces.forEach(f => {
      const st = { cells: 0, zone: 0, conflict: 0, interior: 0, reserved: 0, plume: 0, blocked: 0, slope: 0, groundwater: 0 };
      for (let k = 0; k < f.cells.length; k += 3) {
        let s = f.cells[k + 2];
        if (A && (s === C.ZONE || s === C.CONFLICT) && f.type !== 'parco') {
          const a = AN.at(A, p, f.cells[k], f.cells[k + 1]);
          if (f.type === 'industria') { if (a.industry === I.BLOCKED) s = C.BLOCKED; else if (a.industry === I.GROUNDWATER) s = C.GROUNDWATER; else if (a.industry === I.SLOPE && s === C.ZONE) s = C.SLOPE; }
          else { if (a.housing === H.BLOCKED) s = C.BLOCKED; else if (a.housing === H.RESERVED) s = C.RESERVED; else if (a.housing === H.PLUME) s = C.PLUME; else if (a.housing === H.SLOPE && s === C.ZONE) s = C.SLOPE; }
          f.cells[k + 2] = s;
        }
        st.cells++;
        if (s === C.INTERIOR) st.interior++;
        else if (s === C.CONFLICT) st.conflict++;
        else { st.zone++; if (s === C.RESERVED) st.reserved++; if (s === C.PLUME) st.plume++; if (s === C.BLOCKED) st.blocked++; if (s === C.SLOPE) st.slope++; if (s === C.GROUNDWATER) st.groundwater++; }
      }
      f.stats = st;
      f.warnings = warnings(f);
      tot.cells += st.cells; tot.zone += st.zone; tot.conflict += st.conflict; tot.interior += st.interior;
      tot.constrained += st.reserved + st.plume + st.blocked + st.groundwater; tot.warnings += f.warnings.filter(w => w[0] !== 'good').length;
    });
    return { faces, totals: tot, analysis: A };
  }

  const ha = n => (n * CELL * CELL / 10000).toFixed(1) + ' ha';
  function warnings(f) {
    const s = f.stats, w = [], T = f.type;
    if (!s.cells) return w;
    const pc = x => x / s.cells;
    if (T !== 'parco' && pc(s.interior) > 0.15) w.push(['warn', ha(s.interior) + ' all\'interno sono oltre 6 celle da ogni strada: non si possono zonizzare. ' + (f.proposal && f.proposal.segs.length ? 'Accetta le strade proposte o disegnane di tue.' : 'Aggiungi strade interne (o attiva "Genera strade interne").')]);
    if (pc(s.conflict) > 0.02) w.push(['bad', ha(s.conflict) + ' di celle in conflitto: strade con angoli diversi si contendono gli stessi lotti. Rendi le strade parallele o perpendicolari, o lascia quei triangoli a servizi e verde.']);
    if (s.blocked) w.push(['bad', ha(s.blocked) + ' di lotti su acqua, riva o pendenza oltre il massimo.']);
    if (T === 'industria') {
      if (s.groundwater) w.push(['bad', ha(s.groundwater) + ' di industria sopra o vicino alla falda: rischio di inquinare l\'acqua.']);
    } else if (T !== 'parco') {
      if (s.reserved) w.push(['warn', ha(s.reserved) + ' di lotti sopra risorse da riservare (minerali, petrolio, foreste, terra fertile).']);
      if (s.plume) w.push(['warn', ha(s.plume) + ' di lotti sottovento all\'industria.']);
    }
    if (s.slope && pc(s.slope) > 0.1) w.push(['warn', ha(s.slope) + ' di lotti in pendenza: i lotti in salita crescono peggio.']);
    if (!w.length) w.push(['good', 'Nessun problema: ' + Math.round(100 * pc(s.zone)) + '% dell\'area è zonabile.']);
    return w;
  }

  // ------------------------------------------------------------ accettare la proposta: diventa rete stradale
  function acceptProposal(p, f) {
    if (!f.proposal || !f.proposal.segs.length) return 0;
    const G = CS2.graph, type = typeOf(p, f), poly = f.poly;   // tipo attuale, non quello dell'ultimo calcolo
    const at = pt => {
      const n = G.nearestNode(p, pt, 1.5);
      if (n) return n;
      const eh = G.nearestEdge(p, pt, 1.5);
      return eh ? G.splitEdge(p, eh.edge, eh.t) : p.addNode(pt.x, pt.y);
    };
    let n = 0;
    f.proposal.segs.forEach(s => { const a = at(s.a), b = at(s.b); if (a.id !== b.id) { G.addRoad(p, a.id, b.id, s.type); n++; } });
    // le aree nuove ereditano il tipo del modulo
    const sub = extractFaces(p).filter(g => inPoly(interiorPoint(g), poly));
    sub.forEach(g => setType(p, g, type));
    return n;
  }

  // modulo che contiene il punto (il più piccolo, se annidati)
  function faceAt(res, pt) {
    let best = null;
    res.faces.forEach(f => { if (pt.x < f.bbox.x0 || pt.x > f.bbox.x1 || pt.y < f.bbox.y0 || pt.y > f.bbox.y1) return; if (inPoly(pt, f.poly) && (!best || f.area < best.area)) best = f; });
    return best;
  }

  CS2.modules = { TYPES, C, REACH, extractFaces, inPoly, interiorPoint, clipLine, propose, roadIndex, cells, compute, acceptProposal, faceAt, typeOf, setType };
})(typeof window !== 'undefined' ? window : globalThis);
