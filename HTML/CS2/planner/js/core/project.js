// Modello del progetto: mappa a strati + rete stradale + metadati.
// Coordinate mondo in metri, origine al centro della mappa, x verso est, y verso sud.
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};
  const { Raster } = CS2;
  const { ROAD_TYPES } = CS2.roads;

  const FORMAT = 'cs2-planner';
  const VERSION = 1;

  // Strati della mappa. Tutti modificabili a mano; "source" dice da dove vengono i dati.
  const LAYERS = {
    elevation:   { label: 'Elevazione',   kind: 'f32', res: 1024, unit: 'm' },
    water:       { label: 'Acqua extra',  kind: 'u8',  res: 512,  note: 'oltre a ciò che sta sotto il livello del mare' },
    fertile:     { label: 'Terra fertile', kind: 'u8', res: 512 },
    forest:      { label: 'Foresta',      kind: 'u8',  res: 512 },
    ore:         { label: 'Minerali',     kind: 'u8',  res: 512 },
    oil:         { label: 'Petrolio',     kind: 'u8',  res: 512 },
    groundwater: { label: 'Falda',        kind: 'u8',  res: 512 },
    industryPlan:{ label: 'Industria prevista', kind: 'u8', res: 512, note: 'aree che pensi di usare per l\'industria: sorgente di inquinamento' }
  };
  const RESOURCE_KEYS = ['fertile', 'forest', 'ore', 'oil', 'groundwater'];

  const DEFAULT_MAP = {
    size: 14336,        // m, area giocabile (4096 px × 3.5 m, valore riportato dalla community)
    heightScale: 4096,  // m, intervallo coperto dai 16 bit della heightmap
    seaLevel: 0         // m
  };

  class Project {
    constructor(o) {
      o = o || {};
      this.name = o.name || 'Nuova città';
      this.map = Object.assign({}, DEFAULT_MAP, o.map);
      this.wind = Object.assign({ from: 90, strength: 0.5 }, o.wind);   // da dove soffia (0 = nord, 90 = est)
      this.layers = {};
      this.sources = Object.assign({}, o.sources);
      Object.keys(LAYERS).forEach(k => {
        const d = LAYERS[k];
        this.layers[k] = (o.layers && o.layers[k]) || new Raster(d.res, d.kind);
        if (!this.sources[k]) this.sources[k] = 'vuoto';
      });
      this.graph = o.graph || { nodes: [], edges: [], nextId: 1 };
      this.analysis = o.analysis || {};          // parametri dei vincoli (vedi analysis.js)
      this.modules = o.modules || [];            // tipo dei moduli: [{ x, y, type }] (un punto dentro l'area)
      this.settings = Object.assign({ autoRoads: true }, o.settings);
      this.created = o.created || new Date().toISOString();
      this.modified = o.modified || this.created;
    }

    touch() { this.modified = new Date().toISOString(); }

    // ---------------------------------------------------------- coordinate
    worldToUV(x, y) { const s = this.map.size; return { u: x / s + 0.5, v: y / s + 0.5 }; }
    uvToWorld(u, v) { const s = this.map.size; return { x: (u - 0.5) * s, y: (v - 0.5) * s }; }
    inside(x, y) { const h = this.map.size / 2; return x >= -h && x <= h && y >= -h && y <= h; }

    elevationAt(x, y) { const { u, v } = this.worldToUV(x, y); return this.layers.elevation.sample(u, v); }
    layerAt(key, x, y) { const { u, v } = this.worldToUV(x, y); return this.layers[key].sample(u, v); }
    isWater(x, y) { return this.elevationAt(x, y) < this.map.seaLevel || this.layerAt('water', x, y) > 127; }
    // vettore unitario verso cui va l'inquinamento (sottovento), in coordinate mondo
    downwind() {
      const r = this.wind.from * Math.PI / 180;
      return { x: -Math.sin(r), y: Math.cos(r) };
    }

    // ---------------------------------------------------------- rete stradale
    node(id) { return this.graph.nodes.find(n => n.id === id) || null; }
    addNode(x, y) { const n = { id: this.graph.nextId++, x, y }; this.graph.nodes.push(n); this.touch(); return n; }
    moveNode(id, x, y) { const n = this.node(id); if (n) { n.x = x; n.y = y; this.touch(); } return n; }
    // c: { c1, c2 } per una curva. Due strade dritte tra gli stessi nodi sono la stessa strada;
    // una curva può invece affiancare una dritta (o un'altra curva) tra gli stessi nodi.
    addEdge(a, b, type, c) {
      if (a === b || !this.node(a) || !this.node(b)) return null;
      if (!ROAD_TYPES[type]) throw new Error('tipo di strada sconosciuto: ' + type);
      if (!c) {
        const dup = this.graph.edges.find(e => !e.c1 && ((e.a === a && e.b === b) || (e.a === b && e.b === a)));
        if (dup) { dup.type = type; this.touch(); return dup; }
      }
      const e = { id: this.graph.nextId++, a, b, type };
      if (c) { e.c1 = { x: c.c1.x, y: c.c1.y }; e.c2 = { x: c.c2.x, y: c.c2.y }; }
      this.graph.edges.push(e); this.touch();
      return e;
    }
    removeEdge(id) { const g = this.graph; const n = g.edges.length; g.edges = g.edges.filter(e => e.id !== id); if (g.edges.length !== n) this.touch(); }
    removeNode(id) {
      const g = this.graph;
      g.edges = g.edges.filter(e => e.a !== id && e.b !== id);
      g.nodes = g.nodes.filter(n => n.id !== id);
      this.touch();
    }
    edgesOf(id) { return this.graph.edges.filter(e => e.a === id || e.b === id); }

    // ---------------------------------------------------------- serializzazione
    toJSON() {
      const layers = {};
      Object.keys(this.layers).forEach(k => {
        layers[k] = this.layers[k].encode(k === 'elevation' ? this.map.heightScale : undefined);
      });
      return {
        format: FORMAT, version: VERSION,
        name: this.name, map: this.map, wind: this.wind, sources: this.sources, analysis: this.analysis, modules: this.modules, settings: this.settings,
        created: this.created, modified: this.modified,
        graph: this.graph, layers
      };
    }
    static fromJSON(o) {
      if (!o || o.format !== FORMAT) throw new Error('Il file non è un progetto del pianificatore CS2.');
      if (o.version > VERSION) throw new Error('Il progetto è stato creato con una versione più recente del pianificatore.');
      const layers = {};
      Object.keys(LAYERS).forEach(k => {
        const d = LAYERS[k], enc = o.layers && o.layers[k];
        let r = enc ? Raster.decode(enc) : null;
        if (r && (r.res !== d.res || r.kind !== d.kind)) r = null;   // strato incompatibile: ignorato
        layers[k] = r || new Raster(d.res, d.kind);
      });
      const g = o.graph || {};
      const graph = {
        nodes: (g.nodes || []).filter(n => Number.isFinite(n.x) && Number.isFinite(n.y)),
        edges: (g.edges || []).filter(e => ROAD_TYPES[e.type]).map(e => {
          const ok = q => q && Number.isFinite(q.x) && Number.isFinite(q.y);
          const out = { id: e.id, a: e.a, b: e.b, type: e.type };
          if (ok(e.c1) && ok(e.c2)) { out.c1 = { x: e.c1.x, y: e.c1.y }; out.c2 = { x: e.c2.x, y: e.c2.y }; }   // curva
          return out;
        }),
        nextId: g.nextId || 1
      };
      const ids = new Set(graph.nodes.map(n => n.id));
      graph.edges = graph.edges.filter(e => ids.has(e.a) && ids.has(e.b));
      graph.nextId = Math.max(graph.nextId, 1 + Math.max(0, ...graph.nodes.map(n => n.id), ...graph.edges.map(e => e.id)));
      return new Project({ name: o.name, map: o.map, wind: o.wind, sources: o.sources, analysis: o.analysis, settings: o.settings,
        modules: (o.modules || []).filter(m => Number.isFinite(m.x) && Number.isFinite(m.y) && typeof m.type === 'string')
          .map(m => Number.isFinite(m.phase) ? { x: m.x, y: m.y, type: m.type, phase: m.phase } : { x: m.x, y: m.y, type: m.type }),
        created: o.created, modified: o.modified, layers, graph });
    }
  }

  CS2.Project = Project;
  CS2.project = { FORMAT, VERSION, LAYERS, RESOURCE_KEYS, DEFAULT_MAP };
})(typeof window !== 'undefined' ? window : globalThis);
