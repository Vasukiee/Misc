// Test del modello dati. Uso: node HTML/CS2/planner/tests/run.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
// gli script si registrano su globalThis.CS2 come nel browser
['core/util', 'core/geom', 'core/roads', 'core/raster', 'core/project', 'core/brush', 'core/analysis', 'core/graph', 'core/modules', 'io/png16', 'io/heightmap', 'io/screenshot', 'io/export'].forEach(f =>
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), { filename: f + '.js' }));
const { CS2 } = globalThis;

let fails = 0, n = 0;
function check(name, cond) { n++; if (!cond) { fails++; console.log('FAIL', name); } }
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// CtC
check('ctc piccola+piccola = 112', CS2.roads.ctc('small', 'small') === 112);
check('ctc grande+media = 124', CS2.roads.ctc('large', 'medium') === 124);

// raster
const r = new CS2.Raster(4, 'f32');
r.set(1, 1, 100); r.set(2, 1, 200);
check('sample al centro pixel', near(r.sample(1.5 / 4, 1.5 / 4), 100, 1e-6));
check('sample interpolato', near(r.sample(2 / 4, 1.5 / 4), 150, 1e-6));
const rr = CS2.Raster.decode(r.encode(4096));
check('roundtrip f32 (quantizzato 16 bit)', near(rr.get(2, 1), 200, 4096 / 65535));
check('raster uniforme compatto', new CS2.Raster(8, 'u8').encode().uniform === 0);

// progetto
const p = new CS2.Project({ name: 'Prova' });
check('coordinate centro', near(p.worldToUV(0, 0).u, 0.5, 1e-9));
check('dentro/fuori mappa', p.inside(7000, -7000) && !p.inside(7200, 0));
p.wind.from = 90;
check('vento da est → sottovento ovest', near(p.downwind().x, -1, 1e-9) && near(p.downwind().y, 0, 1e-9));
p.layers.elevation.fill(10); p.map.seaLevel = 20;
check('sotto il mare = acqua', p.isWater(0, 0));
const a = p.addNode(0, 0), b = p.addNode(100, 0), c = p.addNode(100, 100);
const e1 = p.addEdge(a.id, b.id, 'small');
p.addEdge(b.id, c.id, 'large');
check('arco duplicato aggiorna il tipo', p.addEdge(b.id, a.id, 'medium') === e1 && e1.type === 'medium');
check('niente archi su sé stesso', p.addEdge(a.id, a.id, 'small') === null);
let threw = false; try { p.addEdge(a.id, c.id, 'boh'); } catch (e) { threw = true; }
check('tipo sconosciuto rifiutato', threw);
p.layers.ore.set(3, 3, 200); p.layers.ore.changed();

const json = JSON.parse(JSON.stringify(p.toJSON()));
const q = CS2.Project.fromJSON(json);
check('roundtrip nome', q.name === 'Prova');
check('roundtrip grafo', q.graph.nodes.length === 3 && q.graph.edges.length === 2);
check('roundtrip risorsa', q.layers.ore.get(3, 3) === 200);
check('roundtrip elevazione', near(q.layers.elevation.get(5, 5), 10, 0.1));
check('roundtrip vento', q.wind.from === 90);
const d = q.addNode(1, 1);
check('nextId non collide', ![a.id, b.id, c.id, e1.id].includes(d.id));
q.removeNode(b.id);
check('rimuovere un nodo rimuove i suoi archi', q.graph.edges.length === 0);

threw = false; try { CS2.Project.fromJSON({ format: 'altro' }); } catch (e) { threw = true; }
check('file estraneo rifiutato', threw);
const broken = JSON.parse(JSON.stringify(json));
broken.graph.edges.push({ id: 99, a: 1, b: 12345, type: 'small' });
check('arco verso nodo inesistente scartato', CS2.Project.fromJSON(broken).graph.edges.length === 2);

// ---------------------------------------------------------------- PNG 16 bit
const zlib = require('zlib');
function pngEncode(w, h, ch, bd, samples, filterOf) {
  const bpp = ch * bd / 8, stride = w * bpp, raw = Buffer.alloc(h * (stride + 1));
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const line = Buffer.alloc(stride);
    for (let k = 0; k < w * ch; k++) {
      const v = samples[y * w * ch + k];
      if (bd === 16) { line[2 * k] = v >> 8; line[2 * k + 1] = v & 255; } else line[k] = v;
    }
    const f = filterOf(y); raw[y * (stride + 1)] = f;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const pred = [0, a, b, (a + b) >> 1, pr][f];
      raw[y * (stride + 1) + 1 + x] = (line[x] - pred) & 255;
    }
    prev = line;
  }
  const chunk = (t, body) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); return Buffer.concat([len, Buffer.from(t), body, Buffer.alloc(4)]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = bd; ih[9] = { 1: 0, 2: 4, 3: 2, 4: 6 }[ch];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const W = 37, Hh = 11, vals = [];
  for (let k = 0; k < W * Hh; k++) vals.push((k * 2654435761) % 65536);
  const png = pngEncode(W, Hh, 1, 16, vals, y => y % 5);
  const img = await CS2.png16.decode(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength));
  check('PNG 16 bit: dimensioni', img.width === W && img.height === Hh && img.bitDepth === 16);
  check('PNG 16 bit: tutti i filtri, valori esatti', vals.every((v, k) => img.data[k] === v));
  const rgb = []; for (let k = 0; k < 4 * 3 * 3; k++) rgb.push(k * 7 % 256);
  const png8 = pngEncode(4, 3, 3, 8, rgb, y => (y + 2) % 5);
  const img8 = await CS2.png16.decode(png8);
  check('PNG RGB 8 bit', img8.channels === 3 && rgb.every((v, k) => img8.data[k] === v));
  let threw = false; try { await CS2.png16.decode(Buffer.from('nope nope nope')); } catch (e) { threw = true; }
  check('non-PNG rifiutato', threw);

  // heightmap: mappa mondo 8×8 → centro 2×2
  const hp = new CS2.Project();
  const world = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) world.push(x >= 3 && x < 5 && y >= 3 && y < 5 ? 65535 : 0);
  CS2.heightmap.applyToProject(hp, { width: 8, height: 8, channels: 1, bitDepth: 16, data: world }, { world: true, heightScale: 1000 });
  check('heightmap mondo: prende il centro', near(hp.layers.elevation.get(0, 0), 1000, 1e-3) && near(hp.layers.elevation.get(1023, 1023), 1000, 1e-3));
  CS2.heightmap.applyToProject(hp, { width: 8, height: 8, channels: 1, bitDepth: 16, data: world }, { world: false, heightScale: 1000 });
  check('heightmap giocabile: tutto', near(hp.layers.elevation.get(0, 0), 0, 1e-3) && near(hp.layers.elevation.get(512, 512), 1000, 1e-3));

  // screenshot: omografia e classificazione
  const Hm = CS2.screenshot.homography([{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 120 }, { x: 10, y: 120 }]);
  const pc = Hm(0.5, 0.5);
  check('omografia: centro', near(pc.x, 60, 1e-6) && near(pc.y, 70, 1e-6));
  const id = { width: 120, height: 140, data: new Uint8ClampedArray(120 * 140 * 4) };
  for (let y = 0; y < 140; y++) for (let x = 0; x < 120; x++) { const k = (y * 120 + x) * 4; const ore = x < 60; id.data[k] = ore ? 170 : 30; id.data[k + 1] = ore ? 120 : 30; id.data[k + 2] = ore ? 200 : 30; id.data[k + 3] = 255; }
  const cl = CS2.screenshot.classify(id, [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 120 }, { x: 10, y: 120 }], 10, [{ r: 170, g: 120, b: 200 }], 30);
  check('classificazione: metà sinistra riconosciuta', cl[5 * 10 + 1] === 255 && cl[5 * 10 + 8] === 0);

  // pennelli + annulla/ripeti
  const bp = new CS2.Project(); bp.layers.elevation.fill(100);
  const hist = new CS2.brush.History();
  hist.begin(bp, 'elevation', 'Alza');
  hist.grow(CS2.brush.dab(bp, 'elevation', { x: 0, y: 0, radius: 500, strength: 1, mode: 'raise' }));
  hist.end(bp);
  const up = bp.elevationAt(0, 0);
  check('pennello alza al centro', up > 100);
  check('pennello non tocca lontano', near(bp.elevationAt(3000, 3000), 100, 1e-6));
  hist.undo(bp);
  check('annulla ripristina', near(bp.elevationAt(0, 0), 100, 1e-6));
  hist.redo(bp);
  check('ripeti riapplica', near(bp.elevationAt(0, 0), up, 1e-6));
  CS2.brush.dab(bp, 'elevation', { x: 0, y: 0, radius: 500, strength: 1, mode: 'flatten', target: 50 });
  check('livella va verso la quota', near(bp.elevationAt(0, 0), 50, 0.5));
  CS2.brush.dab(bp, 'ore', { x: 0, y: 0, radius: 500, strength: 1, mode: 'paint' });
  check('dipingi risorsa', bp.layerAt('ore', 0, 0) > 200);
  CS2.brush.dab(bp, 'ore', { x: 0, y: 0, radius: 500, strength: 1, mode: 'erase' });
  check('cancella risorsa', bp.layerAt('ore', 0, 0) < 10);
  check('pennello fuori mappa: nessun effetto', CS2.brush.dab(bp, 'ore', { x: 99999, y: 0, radius: 100, strength: 1, mode: 'paint' }) === null);

  // ---------------------------------------------------------------- vincoli
  const ap = new CS2.Project(); const E = ap.layers.elevation, en = E.res, S = ap.map.size;
  // rampa est-ovest: 10% (1 m ogni 10 m) nella metà est, piano nella metà ovest
  for (let j = 0; j < en; j++) for (let i = 0; i < en; i++) { const x = (i + 0.5) / en * S - S / 2; E.data[j * en + i] = 100 + Math.max(0, x) * 0.10; }
  E.changed();
  ap.wind.from = 90;                          // da est: l'inquinamento va verso ovest
  // minerali in un quadrato a est del centro
  const O = ap.layers.ore; for (let j = 240; j < 272; j++) for (let i = 150; i < 180; i++) O.set(i, j, 255); O.changed();
  ap.analysis = { slopeMax: 20 };
  let A = CS2.analysis.compute(ap);
  const at = (x, y) => CS2.analysis.at(A, ap, x, y);
  check('pendenza su rampa 10%', near(at(3000, 0).slope, 10, 0.6));
  check('pendenza in piano 0%', near(at(-3000, 0).slope, 0, 0.1));
  check('pendenza 10% > attenzione 6% → categoria "pendenza"', at(5000, 3000).housing === CS2.analysis.HOUSING.SLOPE);
  const oreX = ((165 + 0.5) / 512 - 0.5) * S;
  check('sopra i minerali → da riservare', at(oreX, 0).housing === CS2.analysis.HOUSING.RESERVED);
  check('pennacchio sottovento (ovest) > sopravento (est)', at(oreX - 1200, 0).plume > 0.2 && at(oreX + 1200, 0).plume < 0.02);
  check('ovest dei minerali → sottovento per le case', at(oreX - 1000, 0).housing === CS2.analysis.HOUSING.PLUME || at(oreX - 1000, 0).housing === CS2.analysis.HOUSING.RESERVED);
  check('vicino ai minerali → buono per l\'industria', at(oreX, 0).industry === CS2.analysis.INDUSTRY.GOOD);
  ap.map.seaLevel = 150; A = CS2.analysis.compute(ap);
  check('sotto il livello del mare → non costruibile', CS2.analysis.at(A, ap, -1500, 3000).housing === CS2.analysis.HOUSING.BLOCKED);
  const dm = new Uint8Array(512 * 512); dm[256 * 512 + 256] = 1;
  const dd = CS2.analysis.distance(dm, 10);
  check('distanza chamfer ~ euclidea', near(dd[256 * 512 + 266], 100, 1e-6) && near(dd[266 * 512 + 266], 141.42, 1));
  const st = A.stat;
  check('statistiche sommano a 1', near(st.ok + st.slope + st.plume + st.reserved + st.blocked, 1, 1e-9));
  const pj = CS2.Project.fromJSON(JSON.parse(JSON.stringify(ap.toJSON())));
  check('parametri vincoli salvati', pj.analysis.slopeMax === 20);
  check('strato industria prevista presente', !!pj.layers.industryPlan);

  // ---------------------------------------------------------------- strade
  const G = CS2.graph, gp = new CS2.Project();
  const nA = gp.addNode(-500, 0), nB = gp.addNode(500, 0);
  G.addRoad(gp, nA.id, nB.id, 'large');
  const nC = gp.addNode(0, -500), nD = gp.addNode(0, 500);
  G.addRoad(gp, nC.id, nD.id, 'small');
  check('incrocio creato automaticamente', gp.graph.edges.length === 4 && gp.graph.nodes.length === 5);
  const mid = G.nearestNode(gp, { x: 0, y: 0 }, 1);
  check('nodo d\'incrocio al centro con 4 strade', mid && gp.edgesOf(mid.id).length === 4);
  check('tipi conservati dopo la divisione', gp.edgesOf(mid.id).filter(e => e.type === 'large').length === 2);
  // aggancio: angolo 90° e lunghezza multipla di 8
  let sn = G.snap(gp, { x: 205, y: 303 }, { start: { x: 200, y: 100 }, startNode: null, prevDir: { x: 1, y: 0 }, type: 'small', pxTol: 5, angles: 90 });
  check('aggancio a 90°', Math.abs(sn.pt.x - 200) < 1e-6 && sn.pt.y > 100);
  check('lunghezza multipla di 8 m', Math.abs(((sn.pt.y - 100) / 8) % 1) < 1e-9);
  // guida CtC: strada piccola parallela alla grande (32 m) → 96 + 16 + 8 = 120 m
  const gd = G.ctcGuide(gp, { x: 250, y: 118 }, 'small', 20);
  check('guida CtC grande+piccola = 120 m', gd && gd.dist === 120 && Math.abs(gd.linePt.y - 120) < 1e-6);
  sn = G.snap(gp, { x: 300, y: 110 }, { start: null, type: 'small', pxTol: 5, angles: 90 });
  check('punto libero agganciato alla linea CtC', sn.guide && Math.abs(sn.pt.y - 120) < 1e-6);
  sn = G.snap(gp, { x: 300, y: 3 }, { start: null, type: 'small', pxTol: 5, angles: 90 });
  check('vicino a una strada: aggancio sulla strada', !!sn.edgeHit && Math.abs(sn.pt.y) < 1e-6);
  // spezzare una strada con nodeAt
  const before = JSON.stringify(gp.graph);
  const split = G.nodeAt(gp, sn.pt, sn);
  check('nodeAt su strada la spezza', gp.edgesOf(split.id).length === 2);
  // spostamento e fusione
  const lone = gp.addNode(1000, 1000), lone2 = gp.addNode(1000, 1200); gp.addEdge(lone.id, lone2.id, 'small');
  gp.moveNode(lone.id, 500.5, 0.3);
  const merged = G.finishMove(gp, lone.id, 2);
  check('nodo trascinato su un altro si fonde', merged === nB.id && !gp.node(lone.id) && gp.edgesOf(nB.id).length === 2);
  // spostamento che crea un incrocio
  const p1 = gp.addNode(-300, -300), p2 = gp.addNode(-300, -100); gp.addEdge(p1.id, p2.id, 'small');
  gp.moveNode(p2.id, -300, 200);
  G.finishMove(gp, p2.id, 2);
  check('spostamento che attraversa una strada crea l\'incrocio', !!G.nearestNode(gp, { x: -300, y: 0 }, 0.5));
  // cancellazioni
  const cnt = gp.graph.nodes.length;
  G.deleteEdge(gp, gp.edgesOf(p1.id)[0].id);
  check('cancellare una strada rimuove i nodi rimasti soli', !gp.node(p1.id) && gp.graph.nodes.length < cnt);
  // annulla del grafo
  const hg = new CS2.brush.History();
  hg.recordGraph(gp, 'test', before);
  hg.undo(gp);
  check('annulla ripristina il grafo', JSON.stringify(gp.graph) === before);
  hg.redo(gp);
  check('ripeti riapplica il grafo', JSON.stringify(gp.graph) !== before);
  // nuovo tratto che passa sopra la fine di un'altra strada: la collega
  const tp = new CS2.Project();
  const t1 = tp.addNode(0, 0), t2 = tp.addNode(0, -100); tp.addEdge(t1.id, t2.id, 'small');
  const t3 = tp.addNode(-100, -100), t4 = tp.addNode(100, -100);
  G.addRoad(tp, t3.id, t4.id, 'small');
  check('incrocio a T su un nodo esistente', tp.edgesOf(t2.id).length === 3);
  // ---------------------------------------------------------------- curve
  const Gm = CS2.geom;
  const cc = { a: { x: 0, y: 0 }, c1: { x: 100, y: 200 }, c2: { x: 300, y: 200 }, b: { x: 400, y: 0 } };
  const [cl1, cr1] = Gm.bezSplit(cc, 0.3);
  check('divisione Bézier esatta', [0.1, 0.5, 0.9].every(t => Gm.dist(Gm.bezPoint(cl1, t), Gm.bezPoint(cc, t * 0.3)) < 1e-9 && Gm.dist(Gm.bezPoint(cr1, t), Gm.bezPoint(cc, 0.3 + t * 0.7)) < 1e-9));
  const cp = new CS2.Project();
  const s1 = cp.addNode(-500, 0), s2 = cp.addNode(500, 0); G.addRoad(cp, s1.id, s2.id, 'medium');
  // curva che parte sotto la strada, sale sopra e torna sotto: la attraversa due volte
  const k1 = cp.addNode(-300, 100), k2 = cp.addNode(300, 100);
  const q = Gm.quadToCubic(k1, { x: 0, y: -300 }, k2);
  const madeC = G.addRoad(cp, k1.id, k2.id, 'small', q);
  const xNodes = cp.graph.nodes.filter(nn => Math.abs(nn.y) < 1.5 && Math.abs(nn.x) < 400);
  check('curva che attraversa due volte: 2 incroci', xNodes.length === 2);
  check('curva divisa in 3 pezzi curvi', madeC.length === 3 && madeC.every(e => G.isCurve(e)));
  check('strada dritta divisa in 3 e resta dritta', cp.graph.edges.filter(e => e.type === 'medium').length === 3 && cp.graph.edges.filter(e => e.type === 'medium').every(e => !G.isCurve(e)));
  const totalLen = madeC.reduce((a2, e) => a2 + G.edgeLength(cp, e), 0);
  check('lunghezza della curva conservata dopo la divisione', near(totalLen, Gm.bezLength(q), 2));
  // le maniglie seguono il nodo
  const ce = madeC[0], c1before = { x: ce.c1.x, y: ce.c1.y };
  G.moveNodeWithHandles(cp, ce.a, cp.node(ce.a).x + 50, cp.node(ce.a).y);
  check('maniglia segue il nodo spostato', near(ce.c1.x, c1before.x + 50, 1e-9));
  // tangente in uscita: continuando dalla fine della curva
  const tdir = G.tangentAt(cp, madeC[2], k2.id);
  check('tangente in uscita dalla fine curva punta verso il basso-destra', tdir.y > 0 && tdir.x > 0);
  // curva salvata e riletta
  const cj = CS2.Project.fromJSON(JSON.parse(JSON.stringify(cp.toJSON())));
  check('curve salvate nel file', cj.graph.edges.filter(e => e.c1 && e.c2).length === 3);
  // dividere una curva con nodeAt
  const hitC = G.nearestEdge(cj, Gm.bezPoint(G.shape(cj, cj.graph.edges.find(e => e.c1)), 0.5), 5);
  check('click su una curva la trova', !!hitC);

  // ---------------------------------------------------------------- moduli
  const M = CS2.modules;
  const sq = (pp, x0, y0, x1, y1, type) => {
    const q = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => G.nodeAt(pp, { x, y }, { node: G.nearestNode(pp, { x, y }, 0.5) }));
    for (let i = 0; i < 4; i++) G.addRoad(pp, q[i].id, q[(i + 1) % 4].id, type);
  };
  const mp = new CS2.Project();
  sq(mp, -400, -400, 400, 400, 'large');
  check('un anello = 1 modulo', M.extractFaces(mp).length === 1);
  const mid1 = G.nodeAt(mp, { x: 0, y: -400 }, G.snap(mp, { x: 0, y: -400 }, { start: null, type: 'small', pxTol: 2 }));
  const mid2 = G.nodeAt(mp, { x: 0, y: 400 }, G.snap(mp, { x: 0, y: 400 }, { start: null, type: 'small', pxTol: 2 }));
  G.addRoad(mp, mid1.id, mid2.id, 'medium');
  check('anello diviso a metà = 2 moduli', M.extractFaces(mp).length === 2);
  const dn = mp.addNode(-200, 0), dn2 = mp.addNode(-200, 400);
  G.addRoad(mp, dn.id, G.nearestNode(mp, { x: 0, y: 400 }, 1).id, 'small');   // strada a fondo cieco dentro un modulo
  const fd = M.extractFaces(mp);
  check('strada a fondo cieco non crea moduli', fd.length === 2 && fd.some(f => f.dangling));
  // analisi senza strade interne: banda zonabile di 48 m dal bordo
  const z = new CS2.Project(); sq(z, -400, -400, 400, 400, 'small');
  let R = M.compute(z, false, null);
  const st0 = R.faces[0].stats;
  // lato interno libero: 800 - 16 = 784 m; banda = 48 m per lato → (784² - 688²) / 64 celle circa
  check('banda zonabile di 6 celle', near(st0.zone, (784 * 784 - 688 * 688) / 64, 120));
  check('interno non zonabile segnalato', R.faces[0].warnings.some(w => w[0] === 'warn' && /oltre 6 celle/.test(w[1])));
  // con le strade proposte: prima locale a CtC esatto dal fronte
  R = M.compute(z, true, null);
  const pr = R.faces[0].proposal;
  check('proposta presente', pr && pr.segs.length > 4);
  check('prima locale proposta a 112 m dal fronte (piccola+piccola)', pr.first === 112);
  check('con la proposta quasi tutto zonabile', R.faces[0].stats.interior / R.faces[0].stats.cells < 0.05);
  // accettare la proposta crea i lotti come moduli
  M.setType(z, R.faces[0], 'centro');
  const nAdded = M.acceptProposal(z, R.faces[0]);
  const after = M.extractFaces(z);
  check('accetta proposta: strade aggiunte e area divisa', nAdded > 4 && after.length > 6);
  check('le aree nuove ereditano il tipo', after.every(f => M.typeOf(z, f) === 'centro'));
  check('dopo l\'accettazione niente nuove proposte (lotti piccoli)', M.compute(z, true, null).faces.every(f => !f.proposal || !f.proposal.segs.length));
  // conflitto: strada storta di 20° vicino a una dritta
  const cf = new CS2.Project(); sq(cf, -300, -300, 300, 300, 'small');
  const k1c = G.nodeAt(cf, { x: -300, y: -100 }, G.snap(cf, { x: -300, y: -100 }, { start: null, type: 'small', pxTol: 2 }));
  const ang = 20 * Math.PI / 180, endX = 300, endY = -100 + Math.tan(ang) * 600;
  const k2c = G.nodeAt(cf, { x: endX, y: endY }, G.snap(cf, { x: endX, y: endY }, { start: null, type: 'small', pxTol: 2 }));
  G.addRoad(cf, k1c.id, k2c.id, 'small');
  R = M.compute(cf, false, null);
  check('griglie storte: celle in conflitto', R.totals.conflict > 50);
  // industria → sorgente di inquinamento
  const ip = new CS2.Project(); sq(ip, 1000, -200, 1400, 200, 'medium');
  ip.wind.from = 90;
  const fI = M.extractFaces(ip)[0]; M.setType(ip, fI, 'industria');
  R = M.compute(ip, false, CS2.analysis.compute);
  check('modulo industriale inquina sottovento', CS2.analysis.at(R.analysis, ip, 200, 0).plume > 0.2 && CS2.analysis.at(R.analysis, ip, 2400, 0).plume < 0.05);
  const ipj = CS2.Project.fromJSON(JSON.parse(JSON.stringify(ip.toJSON())));
  check('tipo dei moduli salvato', ipj.modules.length === 1 && ipj.modules[0].type === 'industria' && ipj.settings.autoRoads === true);
  check('maschera derivata non salvata', !('derived' in ip.toJSON()));
  // modulo curvo (concavo)
  const cv2 = new CS2.Project(); const ca = cv2.addNode(-400, 0), cb = cv2.addNode(400, 0);
  G.addRoad(cv2, ca.id, cb.id, 'medium');
  G.addRoad(cv2, ca.id, cb.id, 'medium', Gm.quadToCubic(ca, { x: 0, y: -700 }, cb));
  const cfc = M.extractFaces(cv2);
  check('area chiusa da una curva e una dritta = 1 modulo', cfc.length === 1 && cfc[0].area > 150000);

  // ---------------------------------------------------------------- crescita
  const gr = new CS2.Project();
  // tre moduli in fila: A | B | C
  sq(gr, -900, -300, -300, 300, 'medium'); sq(gr, -300, -300, 300, 300, 'medium'); sq(gr, 300, -300, 900, 300, 'medium');
  R = M.compute(gr, false, null);
  check('tre moduli in fila', R.faces.length === 3);
  const byX = R.faces.slice().sort((f1, f2) => f1.bbox.x0 - f2.bbox.x0);
  M.setPhase(gr, byX[0], 1); M.setPhase(gr, byX[2], 2);
  R = M.compute(gr, false, null);
  check('modulo isolato segnalato', R.growth.warn.some(w => /non confina/.test(w[1])));
  check('righe del piano', R.growth.rows.length === 2 && R.growth.rows[1].cumMods === 2);
  check('moduli senza fase contati', R.growth.unplanned === 1);
  const sharedEdge = gr.graph.edges.find(e => { const a2 = gr.node(e.a), b2 = gr.node(e.b); return Math.abs(a2.x + 300) < 1 && Math.abs(b2.x + 300) < 1; });
  check('strada condivisa prende la fase più bassa', R.growth.edgePhase.get(sharedEdge.id) === 1);
  // suggerimento: anelli dal modulo di sinistra
  const R2 = M.compute(gr, false, null);
  const left = R2.faces.slice().sort((f1, f2) => f1.bbox.x0 - f2.bbox.x0)[0];
  M.suggestOrder(gr, R2, left);
  R = M.compute(gr, false, null);
  const ord = R.faces.slice().sort((f1, f2) => f1.bbox.x0 - f2.bbox.x0).map(f => f.phase).join(',');
  check('ordine suggerito ad anelli: 1,2,3', ord === '1,2,3');
  check('nessun isolato dopo il suggerimento', !R.growth.warn.length);
  check('abitanti cumulati crescono', R.growth.rows[2].cumRes > R.growth.rows[0].cumRes);
  // centro non nelle prime fasi
  M.setType(gr, R.faces.sort((f1, f2) => f1.bbox.x0 - f2.bbox.x0)[1], 'centro');
  const R3 = M.compute(gr, false, null);
  M.suggestOrder(gr, R3, R3.faces.slice().sort((f1, f2) => f1.bbox.x0 - f2.bbox.x0)[0]);
  const R4 = M.compute(gr, false, null);
  check('centro spostato almeno alla fase 3', R4.faces.find(f => f.type === 'centro').phase >= 3);
  // fase ereditata quando si accetta una proposta
  const ga = new CS2.Project(); sq(ga, -400, -400, 400, 400, 'small');
  let RA = M.compute(ga, true, null); M.setPhase(ga, RA.faces[0], 4);
  RA = M.compute(ga, true, null); M.acceptProposal(ga, RA.faces[0]);
  check('le aree nuove ereditano la fase', M.extractFaces(ga).every(f => M.phaseOf(ga, f) === 4));
  const gj = CS2.Project.fromJSON(JSON.parse(JSON.stringify(gr.toJSON())));
  check('fasi salvate', gj.modules.filter(m => Number.isFinite(m.phase)).length === 3);

  // ---------------------------------------------------------------- export
  const EX = CS2.exporter;
  check('CRC32 standard', EX.crc32(new Uint8Array([73, 69, 78, 68])) === 0xAE426082);
  const ev = new Uint16Array(64 * 32); for (let k = 0; k < ev.length; k++) ev[k] = (k * 40503) & 65535;
  const eb = await EX.encodePNG16(64, 32, ev);
  const dec = await CS2.png16.decode(await eb.arrayBuffer());
  check('PNG 16 bit esportato e riletto identico', dec.width === 64 && dec.height === 32 && dec.bitDepth === 16 && ev.every((v, k) => dec.data[k] === v));
  // heightmap: originale ad alta risoluzione + modifiche
  const xp = new CS2.Project(), HR = 256;
  const orig = []; for (let y = 0; y < HR; y++) for (let x = 0; x < HR; x++) orig.push(Math.round((0.1 + 0.3 * ((x * 7 + y * 13) % 17) / 17) * 65535));   // dettaglio fine
  CS2.heightmap.applyToProject(xp, { width: HR, height: HR, channels: 1, bitDepth: 16, data: orig }, { world: false, heightScale: 4096 });
  let hv = EX.heightValues(xp, HR);
  check('export senza modifiche = originale (dettaglio conservato)', hv.usedHires && hv.values.every((v, k) => Math.abs(v - orig[k]) <= 2));
  CS2.brush.dab(xp, 'elevation', { x: 0, y: 0, radius: 1500, strength: 1, mode: 'raise' });
  hv = EX.heightValues(xp, HR);
  const cIdx = (HR / 2) * HR + HR / 2, far = 5 * HR + 5;
  check('modifica applicata al centro', hv.values[cIdx] > orig[cIdx] + 100);
  check('lontano dalla modifica resta l\'originale', Math.abs(hv.values[far] - orig[far]) <= 2);
  xp.hires = null;
  check('senza originale: ricavata dall\'elevazione', !EX.heightValues(xp, 64).usedHires);
  const pj2 = EX.planJSON(gr, M.compute(gr, false, null));
  check('piano JSON: strade, moduli e fasi', pj2.strade.length === gr.graph.edges.length && pj2.moduli.length === 3 && pj2.fasi.length === new Set(pj2.moduli.map(m => m.fase)).size);

  // pendenza
  const pg = new CS2.Project(); const PE = pg.layers.elevation;
  for (let j = 0; j < PE.res; j++) for (let i = 0; i < PE.res; i++) PE.data[j * PE.res + i] = (i / PE.res) * 1433.6;   // 10%
  PE.changed();
  check('pendenza di un tratto ~10%', near(G.grade(pg, { x: -1000, y: 0 }, { x: 1000, y: 0 }), 10, 0.5));

  console.log(fails ? fails + ' / ' + n + ' test falliti' : 'OK: ' + n + ' test');
  process.exit(fails ? 1 : 0);
})();
