// Test del modello dati. Uso: node HTML/CS2/planner/tests/run.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console, Buffer, Math, JSON, Date, Error, Set, Map, Blob, Response, DecompressionStream };
ctx.globalThis = ctx;
vm.createContext(ctx);
['core/util', 'core/geom', 'core/roads', 'core/raster', 'core/project', 'core/brush', 'io/png16', 'io/heightmap', 'io/screenshot'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' }));
const { CS2 } = ctx;

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

  console.log(fails ? fails + ' / ' + n + ' test falliti' : 'OK: ' + n + ' test');
  process.exit(fails ? 1 : 0);
})();
