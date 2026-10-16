// Test del modello dati. Uso: node HTML/CS2/planner/tests/run.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console, Buffer, Math, JSON, Date, Error, Set, Map };
ctx.globalThis = ctx;
vm.createContext(ctx);
['util', 'geom', 'roads', 'raster', 'project'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'core', f + '.js'), 'utf8'), ctx, { filename: f + '.js' }));
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

console.log(fails ? fails + ' / ' + n + ' test falliti' : 'OK: ' + n + ' test');
process.exit(fails ? 1 : 0);
