// Operazioni sulla rete stradale: ricerca, aggancio, incroci automatici, spostamento e fusione nodi.
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};
  const { V, sub, add, mul, dot, crs, len, dist, norm, segDist } = CS2.geom;
  const { ctc, ROAD_TYPES, CELL } = CS2.roads;

  const nodeMap = p => new Map(p.graph.nodes.map(n => [n.id, n]));

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
      const a = nm.get(e.a), b = nm.get(e.b), r = segDist(pt, a, b);
      if (r.d <= bd && r.t > 0.001 && r.t < 0.999) { bd = r.d; best = { edge: e, t: r.t, point: r.q, a, b }; }
    });
    return best;
  }

  // spezza un arco in un punto: ritorna il nodo creato
  function splitEdge(p, edge, pt) {
    const n = p.addNode(pt.x, pt.y);
    const { a, b, type } = edge;
    p.removeEdge(edge.id);
    p.addEdge(a, n.id, type); p.addEdge(n.id, b, type);
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

  // Aggiunge una strada da nodo a nodo creando tutti gli incroci con le strade che attraversa.
  function addRoad(p, aId, bId, type) {
    if (aId === bId) return [];
    const nm = nodeMap(p), A = nm.get(aId), B = nm.get(bId);
    const hits = [];
    p.graph.edges.slice().forEach(e => {
      if (e.a === aId || e.b === aId || e.a === bId || e.b === bId) return;
      const x = segX(A, B, nm.get(e.a), nm.get(e.b));
      if (x) hits.push({ t: x.t, pt: x.pt, edge: e });
    });
    // nodi esistenti che stanno esattamente sul nuovo tratto (es. la fine di un'altra strada)
    p.graph.nodes.forEach(n => {
      if (n.id === aId || n.id === bId) return;
      const r = segDist(n, A, B);
      if (r.d < 0.5 && r.t > 1e-6 && r.t < 1 - 1e-6) hits.push({ t: r.t, pt: V(n.x, n.y), node: n });
    });
    hits.sort((h1, h2) => h1.t - h2.t);
    const chain = [aId];
    hits.forEach(h => {
      // se due incroci cadono nello stesso punto riusa il nodo
      if (h.node) { if (chain[chain.length - 1] !== h.node.id) chain.push(h.node.id); return; }
      const near = nearestNode(p, h.pt, 0.5);
      const live = p.graph.edges.find(e => e.id === h.edge.id);
      chain.push(near ? near.id : live ? splitEdge(p, live, h.pt).id : p.addNode(h.pt.x, h.pt.y).id);
    });
    chain.push(bId);
    const made = [];
    for (let k = 0; k < chain.length - 1; k++) { const e = p.addEdge(chain[k], chain[k + 1], type); if (e) made.push(e); }
    return made;
  }

  // nodo nel punto: riusa un nodo vicino o spezza una strada, altrimenti ne crea uno nuovo
  function nodeAt(p, pt, snap) {
    if (snap && snap.node) return snap.node;
    if (snap && snap.edgeHit) { const live = p.graph.edges.find(e => e.id === snap.edgeHit.edge.id); if (live) return splitEdge(p, live, pt); }
    return p.addNode(pt.x, pt.y);
  }

  function removeOrphans(p) {
    const used = new Set(); p.graph.edges.forEach(e => { used.add(e.a); used.add(e.b); });
    p.graph.nodes = p.graph.nodes.filter(n => used.has(n.id));
  }
  function deleteEdge(p, id) { p.removeEdge(id); removeOrphans(p); }
  function deleteNode(p, id) { p.removeNode(id); removeOrphans(p); }

  // Fine trascinamento di un nodo: fusione con un nodo sotto e ricalcolo degli incroci.
  function finishMove(p, id, mergeRadius) {
    const n = p.node(id); if (!n) return;
    const target = nearestNode(p, n, mergeRadius, new Set([id]));
    let nid = id;
    if (target) {
      p.edgesOf(id).forEach(e => { const other = e.a === id ? e.b : e.a; p.removeEdge(e.id); if (other !== target.id) p.addEdge(other, target.id, e.type); });
      p.removeNode(id); nid = target.id;
    }
    const inc = p.edgesOf(nid).map(e => ({ other: e.a === nid ? e.b : e.a, type: e.type, id: e.id }));
    inc.forEach(e => p.removeEdge(e.id));
    inc.forEach(e => addRoad(p, nid, e.other, e.type));
    removeOrphans(p);
    return nid;
  }

  // pendenza massima (%) lungo un segmento, campionando ogni 16 m
  function grade(p, a, b) {
    const L = dist(a, b), steps = Math.max(1, Math.ceil(L / 16));
    let prev = p.elevationAt(a.x, a.y), worst = 0;
    for (let s = 1; s <= steps; s++) {
      const q = V(a.x + (b.x - a.x) * s / steps, a.y + (b.y - a.y) * s / steps), h = p.elevationAt(q.x, q.y);
      worst = Math.max(worst, Math.abs(h - prev) / (L / steps) * 100); prev = h;
    }
    return worst;
  }

  // Aggancio del cursore durante il disegno.
  // o: { start (punto o null), startNode, prevDir, type, pxTol (m corrispondenti a ~10 px), angles: 90|45, free }
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
      // angolo: rispetto alla direzione di riferimento (tratto precedente o strada del nodo di partenza)
      const ref = o.prevDir || V(1, 0), base = Math.atan2(ref.y, ref.x);
      const d = sub(cur, o.start), L = len(d);
      if (L > 1) {
        const ang = Math.atan2(d.y, d.x), step = Math.PI / (o.angles === 45 ? 4 : 2);
        const k = Math.round((ang - base) / step), snapped = base + k * step;
        let diff = Math.abs(((ang - snapped + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
        if (diff < 8 * Math.PI / 180) {
          const dir = V(Math.cos(snapped), Math.sin(snapped));
          let len2 = Math.max(CELL, Math.round(dot(d, dir) / CELL) * CELL);
          pt = add(o.start, mul(dir, len2));
          out.angle = snapped;
          // guida CtC: dove il raggio incontra la linea parallela a una strada vicina
          const g = ctcGuide(p, pt, o.type, o.pxTol * 2.5);
          if (g && Math.abs(dot(dir, g.normal)) > 0.2) {
            const t = dot(sub(g.linePt, o.start), g.normal) / dot(dir, g.normal);
            if (t > CELL) { pt = add(o.start, mul(dir, t)); out.guide = g; }
          }
        } else {
          pt = add(o.start, mul(norm(d), Math.round(L / CELL) * CELL));
        }
      }
    } else {
      const g = ctcGuide(p, cur, o.type, o.pxTol * 2.5);
      if (g) { pt = add(g.linePt, mul(g.dir, dot(sub(cur, g.linePt), g.dir))); out.guide = g; }
      else pt = V(Math.round(cur.x / CELL) * CELL, Math.round(cur.y / CELL) * CELL);
    }
    out.pt = pt;
    return out;
  }

  // linea guida parallela alla strada più vicina, alla distanza CtC per lotti pieni
  function ctcGuide(p, pt, type, tol) {
    const nm = nodeMap(p);
    let best = null;
    p.graph.edges.forEach(e => {
      const a = nm.get(e.a), b = nm.get(e.b), r = segDist(pt, a, b);
      if (r.t <= 0 || r.t >= 1) return;
      const dir = norm(sub(b, a)), nrm = V(-dir.y, dir.x);
      const side = Math.sign(dot(sub(pt, a), nrm)) || 1, want = ctc(type, e.type);
      const off = Math.abs(r.d - want);
      if (off <= tol && (!best || off < best.off)) {
        best = { off, edge: e, dist: want, dir, normal: nrm, linePt: add(r.q, mul(nrm, side * want)) };
      }
    });
    return best;
  }

  CS2.graph = { nearestNode, nearestEdge, splitEdge, addRoad, nodeAt, deleteEdge, deleteNode, finishMove, grade, snap, ctcGuide, removeOrphans, segX };
})(typeof window !== 'undefined' ? window : globalThis);
