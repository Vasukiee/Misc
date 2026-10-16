// Operazioni sulla rete stradale: ricerca, aggancio, incroci automatici, curve, spostamento e fusione nodi.
// Ogni strada è una Bézier cubica: se non ha c1/c2 è dritta.
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};
  const { V, sub, add, mul, dot, crs, len, dist, norm, segDist, bezPoint, bezTangent, bezSplit, bezSample, bezLength, straight } = CS2.geom;
  const { ctc, CELL } = CS2.roads;

  const nodeMap = p => new Map(p.graph.nodes.map(n => [n.id, n]));
  const isCurve = e => !!(e.c1 && e.c2);

  // forma della strada come curva cubica (anche se dritta)
  function shape(p, e, nm) {
    const a = (nm ? nm.get(e.a) : p.node(e.a)), b = (nm ? nm.get(e.b) : p.node(e.b));
    return isCurve(e) ? { a, c1: e.c1, c2: e.c2, b } : straight(a, b);
  }
  // polilinea con parametro t, densità ~ 1 punto ogni 25 m
  function poly(c, curved) {
    if (!curved) return [{ t: 0, p: c.a }, { t: 1, p: c.b }];
    return bezSample(c, Math.max(8, Math.min(64, Math.ceil(bezLength(c) / 25))));
  }
  function edgePoly(p, e, nm) { return poly(shape(p, e, nm), isCurve(e)); }

  // distanza da una polilinea campionata: punto più vicino e parametro t interpolato
  function polyDist(pt, pl) {
    let best = { d: Infinity };
    for (let k = 0; k < pl.length - 1; k++) {
      const r = segDist(pt, pl[k].p, pl[k + 1].p);
      if (r.d < best.d) best = { d: r.d, t: pl[k].t + (pl[k + 1].t - pl[k].t) * r.t, q: r.q, k, dir: norm(sub(pl[k + 1].p, pl[k].p)) };
    }
    return best;
  }

  function nearestNode(p, pt, radius, exclude) {
    let best = null, bd = radius;
    p.graph.nodes.forEach(n => { if (exclude && exclude.has(n.id)) return; const d = dist(n, pt); if (d <= bd) { bd = d; best = n; } });
    return best;
  }
  function nearestEdge(p, pt, radius, excludeNodes) {
    const nm = nodeMap(p);
    let best = null, bd = radius;
    p.graph.edges.forEach(e => {
      if (excludeNodes && (excludeNodes.has(e.a) || excludeNodes.has(e.b))) return;
      const c = shape(p, e, nm), r = polyDist(pt, poly(c, isCurve(e)));
      if (r.d <= bd && r.t > 0.001 && r.t < 0.999) { bd = r.d; best = { edge: e, t: r.t, point: isCurve(e) ? bezPoint(c, r.t) : r.q }; }
    });
    return best;
  }

  // imposta (o toglie) la forma curva di un arco a partire da una cubica
  function setShape(e, c, curved) { if (curved) { e.c1 = V(c.c1.x, c.c1.y); e.c2 = V(c.c2.x, c.c2.y); } else { delete e.c1; delete e.c2; } }

  // spezza un arco nel parametro t (forma esatta): ritorna il nodo creato
  function splitEdge(p, edge, t) {
    const c = shape(p, edge), curved = isCurve(edge), [L, R] = bezSplit(c, t);
    const n = p.addNode(L.b.x, L.b.y);
    const { a, b, type } = edge;
    p.removeEdge(edge.id);
    p.addEdge(a, n.id, type, curved ? L : null); p.addEdge(n.id, b, type, curved ? R : null);
    return n;
  }

  // intersezione tra segmenti (esclusi gli estremi)
  function segX(p1, p2, q1, q2) {
    const r = sub(p2, p1), s = sub(q2, q1), den = crs(r, s);
    if (Math.abs(den) < 1e-9) return null;
    const t = crs(sub(q1, p1), s) / den, u = crs(sub(q1, p1), r) / den;
    if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) return null;
    return { t, u, pt: add(p1, mul(r, t)) };
  }
  // intersezioni tra due polilinee parametrizzate
  function polyX(A, B) {
    const out = [];
    for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < B.length - 1; j++) {
      const x = segX(A[i].p, A[i + 1].p, B[j].p, B[j + 1].p);
      if (x) out.push({ ta: A[i].t + (A[i + 1].t - A[i].t) * x.t, tb: B[j].t + (B[j + 1].t - B[j].t) * x.u, pt: x.pt });
    }
    return out;
  }

  // Aggiunge una strada da nodo a nodo (dritta, o curva se c è una cubica) creando gli incroci.
  function addRoad(p, aId, bId, type, c) {
    if (aId === bId) return [];
    const nm = nodeMap(p), A = nm.get(aId), B = nm.get(bId);
    const curved = !!c;
    const cur = curved ? { a: A, c1: c.c1, c2: c.c2, b: B } : straight(A, B);
    const mine = poly(cur, curved);
    const hits = [];
    p.graph.edges.slice().forEach(e => {
      if (e.a === aId || e.b === aId || e.a === bId || e.b === bId) return;
      polyX(mine, edgePoly(p, e, nm)).forEach(x => hits.push({ t: x.ta, tOther: x.tb, edge: e }));
    });
    // nodi che stanno sul tracciato (es. la fine di un'altra strada)
    p.graph.nodes.forEach(n => {
      if (n.id === aId || n.id === bId) return;
      const r = polyDist(n, mine);
      if (r.d < 0.5 && r.t > 1e-4 && r.t < 1 - 1e-4) hits.push({ t: r.t, node: n });
    });
    hits.sort((h1, h2) => h1.t - h2.t);
    // nodi lungo il percorso
    const stops = [];
    hits.forEach(h => {
      let nid;
      if (h.node) nid = h.node.id;
      else {
        const pt = curved ? bezPoint(cur, h.t) : V(A.x + (B.x - A.x) * h.t, A.y + (B.y - A.y) * h.t);
        const near = nearestNode(p, pt, 0.5);
        const live = p.graph.edges.find(e => e.id === h.edge.id);
        if (near) nid = near.id;
        else if (live) nid = splitEdge(p, live, h.tOther).id;
        else {
          // la stessa strada attraversata due volte: è già stata divisa, cerca il pezzo giusto
          const eh = nearestEdge(p, pt, 2);
          nid = eh ? splitEdge(p, eh.edge, eh.t).id : p.addNode(pt.x, pt.y).id;
        }
      }
      if (!stops.length || stops[stops.length - 1].id !== nid) stops.push({ id: nid, t: h.t });
    });
    // tratti: la curva nuova viene divisa ai parametri degli incroci
    const made = [];
    let rest = cur, t0 = 0, from = aId;
    stops.concat([{ id: bId, t: 1 }]).forEach(s => {
      if (s.id === from) return;
      let piece = rest;
      if (s.t < 1) { const [L, R] = bezSplit(rest, (s.t - t0) / (1 - t0)); piece = L; rest = R; t0 = s.t; }
      const e = p.addEdge(from, s.id, type, curved ? piece : null);
      if (e) made.push(e);
      from = s.id;
    });
    return made;
  }

  // nodo nel punto: riusa un nodo vicino o spezza una strada, altrimenti ne crea uno nuovo
  function nodeAt(p, pt, snap) {
    if (snap && snap.node) return snap.node;
    if (snap && snap.edgeHit) {
      const live = p.graph.edges.find(e => e.id === snap.edgeHit.edge.id);
      if (live) { const n = splitEdge(p, live, snap.edgeHit.t); return n; }
    }
    return p.addNode(pt.x, pt.y);
  }

  function removeOrphans(p) {
    const used = new Set(); p.graph.edges.forEach(e => { used.add(e.a); used.add(e.b); });
    p.graph.nodes = p.graph.nodes.filter(n => used.has(n.id));
  }
  function deleteEdge(p, id) { p.removeEdge(id); removeOrphans(p); }
  function deleteNode(p, id) { p.removeNode(id); removeOrphans(p); }

  // le maniglie delle curve seguono il nodo che si sposta
  function moveNodeWithHandles(p, id, x, y) {
    const n = p.node(id); if (!n) return;
    const dx = x - n.x, dy = y - n.y;
    p.edgesOf(id).forEach(e => {
      if (!isCurve(e)) return;
      if (e.a === id) { e.c1.x += dx; e.c1.y += dy; }
      if (e.b === id) { e.c2.x += dx; e.c2.y += dy; }
    });
    n.x = x; n.y = y;
  }

  // ricalcola gli incroci di un insieme di strade (dopo uno spostamento o una modifica di forma)
  function rebuildEdges(p, edges) {
    const list = edges.map(e => ({ a: e.a, b: e.b, type: e.type, c: isCurve(e) ? { c1: V(e.c1.x, e.c1.y), c2: V(e.c2.x, e.c2.y) } : null, id: e.id }));
    list.forEach(e => p.removeEdge(e.id));
    list.forEach(e => { if (p.node(e.a) && p.node(e.b)) addRoad(p, e.a, e.b, e.type, e.c); });
  }

  // Fine trascinamento di un nodo: fusione con un nodo sotto e ricalcolo degli incroci.
  function finishMove(p, id, mergeRadius) {
    const n = p.node(id); if (!n) return;
    const target = nearestNode(p, n, mergeRadius, new Set([id]));
    let nid = id;
    if (target) {
      p.edgesOf(id).forEach(e => {
        const other = e.a === id ? e.b : e.a, curved = isCurve(e);
        p.removeEdge(e.id);
        if (other === target.id) return;
        const sh = curved ? { c1: e.c1, c2: e.c2 } : null;
        if (e.a === id) p.addEdge(target.id, other, e.type, sh); else p.addEdge(other, target.id, e.type, sh);
      });
      p.removeNode(id); nid = target.id;
    }
    rebuildEdges(p, p.edgesOf(nid));
    removeOrphans(p);
    return nid;
  }

  // pendenza massima (%) lungo una strada o un segmento, campionando ogni ~16 m
  function grade(p, a, b, c) {
    const cur = c ? { a, c1: c.c1, c2: c.c2, b } : straight(a, b), L = c ? bezLength(cur) : dist(a, b);
    const steps = Math.max(1, Math.ceil(L / 16));
    let prev = p.elevationAt(a.x, a.y), prevP = a, worst = 0;
    for (let s = 1; s <= steps; s++) {
      const q = bezPoint(cur, s / steps), h = p.elevationAt(q.x, q.y), d = dist(prevP, q);
      if (d > 0) worst = Math.max(worst, Math.abs(h - prev) / d * 100);
      prev = h; prevP = q;
    }
    return worst;
  }
  function edgeLength(p, e) { return isCurve(e) ? bezLength(shape(p, e)) : dist(p.node(e.a), p.node(e.b)); }
  // direzione con cui la strada arriva/parte dal nodo (verso l'esterno del nodo)
  function tangentAt(p, e, nodeId) {
    const c = shape(p, e);
    return e.a === nodeId ? mul(bezTangent(c, 0), -1) : bezTangent(c, 1);
  }

  // Aggancio del cursore durante il disegno.
  // o: { start, startNode, prevDir, type, pxTol (m ≈ 10 px), angles: 90|45, free }
  function snap(p, cur, o) {
    const out = { pt: cur, node: null, edgeHit: null, guide: null, angle: null };
    const excl = o.startNode ? new Set([o.startNode.id]) : null;
    const n = nearestNode(p, cur, o.pxTol * 1.2, excl);
    if (n) { out.pt = V(n.x, n.y); out.node = n; return out; }
    const eh = nearestEdge(p, cur, o.pxTol, excl);
    if (eh) { out.pt = eh.point; out.edgeHit = eh; return out; }
    if (o.free) return out;
    let pt = cur;
    if (o.start) {
      const ref = o.prevDir || V(1, 0), base = Math.atan2(ref.y, ref.x);
      const d = sub(cur, o.start), L = len(d);
      if (L > 1) {
        const ang = Math.atan2(d.y, d.x), step = Math.PI / (o.angles === 45 ? 4 : 2);
        const k = Math.round((ang - base) / step), snapped = base + k * step;
        const diff = Math.abs(((ang - snapped + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
        if (diff < 8 * Math.PI / 180) {
          const dir = V(Math.cos(snapped), Math.sin(snapped));
          pt = add(o.start, mul(dir, Math.max(CELL, Math.round(dot(d, dir) / CELL) * CELL)));
          out.angle = snapped;
          const g = ctcGuide(p, pt, o.type, o.pxTol * 2.5);
          if (g && Math.abs(dot(dir, g.normal)) > 0.2) {
            const t = dot(sub(g.linePt, o.start), g.normal) / dot(dir, g.normal);
            if (t > CELL) { pt = add(o.start, mul(dir, t)); out.guide = g; }
          }
        } else pt = add(o.start, mul(norm(d), Math.round(L / CELL) * CELL));
      }
    } else {
      const g = ctcGuide(p, cur, o.type, o.pxTol * 2.5);
      if (g) { pt = add(g.linePt, mul(g.dir, dot(sub(cur, g.linePt), g.dir))); out.guide = g; }
      else pt = V(Math.round(cur.x / CELL) * CELL, Math.round(cur.y / CELL) * CELL);
    }
    out.pt = pt;
    return out;
  }

  // linea guida parallela (localmente, anche sulle curve) alla strada più vicina, a distanza CtC
  function ctcGuide(p, pt, type, tol) {
    const nm = nodeMap(p);
    let best = null;
    p.graph.edges.forEach(e => {
      const r = polyDist(pt, edgePoly(p, e, nm));
      if (!(r.t > 0 && r.t < 1)) return;
      const dir = r.dir, nrm = V(-dir.y, dir.x);
      const side = Math.sign(dot(sub(pt, r.q), nrm)) || 1, want = ctc(type, e.type), off = Math.abs(r.d - want);
      if (off <= tol && (!best || off < best.off)) best = { off, edge: e, dist: want, dir, normal: nrm, linePt: add(r.q, mul(nrm, side * want)) };
    });
    return best;
  }

  CS2.graph = { isCurve, shape, edgePoly, nearestNode, nearestEdge, splitEdge, addRoad, nodeAt, deleteEdge, deleteNode,
    moveNodeWithHandles, rebuildEdges, finishMove, grade, edgeLength, tangentAt, snap, ctcGuide, removeOrphans, segX, setShape };
})(typeof window !== 'undefined' ? window : globalThis);
