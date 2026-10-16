// Avvio dell'applicazione: progetto corrente, barra strumenti, import, pennelli, salvataggi.
(function (root) {
  'use strict';
  const CS2 = root.CS2;
  const { Project, MapView, storage, brush } = CS2;
  const { LAYERS, RESOURCE_KEYS } = CS2.project;
  const $ = id => document.getElementById(id);

  let project = new Project();
  const view = new MapView($('map'), () => project);
  const history = new brush.History(30);
  const app = CS2.app = { get project() { return project; }, view, history, setProject, changed, redraw: () => view.draw() };

  // ------------------------------------------------------------ stato e salvataggio
  let saveTimer = null;
  function changed() {
    project.touch();
    scheduleAnalysis();
    view.draw(); renderPanel();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => setStatus(await storage.autosave(project) ? 'Salvato nel browser' : 'Autosalvataggio non disponibile'), 600);
  }
  function setProject(p, msg) {
    project = p; view.cache = {}; history.clear(); analysis = null; scheduleAnalysis(0);
    view.fit(); view.draw(); renderPanel(); syncInputs();
    storage.autosave(project);
    if (msg) setStatus(msg);
  }
  function setStatus(t) { $('status').textContent = t; }
  function markManual(key) {
    const s = project.sources[key] || 'vuoto';
    if (!/a mano$/.test(s)) project.sources[key] = (s === 'vuoto' ? '' : s + ' + ') + 'a mano';
  }

  // ------------------------------------------------------------ pannello strati
  function renderPanel() {
    const p = project, r = view.elevationRange(p);
    let h = '<h4>Mappa</h4>';
    h += kv('Lato area giocabile', (p.map.size / 1000).toFixed(3) + ' km');
    h += kv('Elevazione', Math.round(r.lo) + ' – ' + Math.round(r.hi) + ' m');
    h += kv('Strade', p.graph.edges.length + ' tratti · ' + p.graph.nodes.length + ' nodi');
    h += '<h4 style="margin-top:12px;">Strati</h4>';
    Object.keys(LAYERS).forEach(k => {
      const key = k === 'elevation' ? 'terrain' : k;
      const on = view.show[key] ? 'checked' : '';
      const sw = CS2.RES_COLORS[k] ? '<span class="sw" style="background:rgb(' + CS2.RES_COLORS[k].join(',') + ')"></span>' : '<span class="sw" style="background:#4a5a44"></span>';
      h += '<label class="layer-row"><input type="checkbox" data-show="' + key + '" ' + on + '>' + sw + '<span>' + LAYERS[k].label + '</span><em>' + p.sources[k] + '</em></label>';
    });
    h += '<label class="layer-row"><input type="checkbox" data-show="grid" ' + (view.show.grid ? 'checked' : '') + '><span class="sw" style="background:#333"></span><span>Griglia 1 km</span><em></em></label>';
    $('panel').innerHTML = h;
    $('panel').querySelectorAll('[data-show]').forEach(el => el.addEventListener('change', () => { view.show[el.dataset.show] = el.checked; view.draw(); }));
    $('btnUndo').disabled = !history.undoStack.length;
    $('btnRedo').disabled = !history.redoStack.length;
  }
  const kv = (k, v) => '<div class="kv"><span>' + k + '</span><span>' + v + '</span></div>';

  function syncInputs() {
    syncAnalysisInputs();
    $('pName').value = project.name;
    $('pSize').value = project.map.size;
    $('pSea').value = project.map.seaLevel;
    $('pWind').value = project.wind.from;
    $('vWind').textContent = windLabel(project.wind.from);
    $('hmScale').value = project.map.heightScale;
  }
  function windLabel(d) {
    const n = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(((d % 360) + 360) % 360 / 45) % 8];
    return 'da ' + n + ' (' + d + '°)';
  }

  // ------------------------------------------------------------ progetto e file
  $('btnNew').addEventListener('click', () => {
    if (!confirm('Creare un progetto nuovo? Quello attuale resta solo se l\'hai salvato su file.')) return;
    setProject(new Project(), 'Nuovo progetto');
  });
  $('btnSave').addEventListener('click', async () => { await storage.downloadProject(project); setStatus('File scaricato'); });
  $('btnOpen').addEventListener('click', () => $('fileOpen').click());
  $('fileOpen').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { setProject(await storage.openProjectFile(f), 'Aperto: ' + f.name); }
    catch (err) { alert(err.message); }
  });
  $('btnDemo').addEventListener('click', () => {
    const before = project.layers.elevation.data.slice();
    demoTerrain(project);
    history.recordWhole(project, 'elevation', 'Terreno di prova', before);
    project.sources.elevation = 'prova'; RESOURCE_KEYS.forEach(k => project.sources[k] = 'prova');
    view.cache = {}; changed();
  });
  $('pName').addEventListener('change', e => { project.name = e.target.value || 'Senza nome'; changed(); });
  $('pSize').addEventListener('change', e => { project.map.size = Math.max(1000, +e.target.value || 14336); view.fit(); changed(); });
  $('pSea').addEventListener('change', e => { project.map.seaLevel = +e.target.value || 0; changed(); });
  $('pWind').addEventListener('input', e => { project.wind.from = +e.target.value; $('vWind').textContent = windLabel(project.wind.from); view.draw(); });
  $('pWind').addEventListener('change', () => changed());

  // ------------------------------------------------------------ import
  $('btnHeightmap').addEventListener('click', () => $('fileHeightmap').click());
  $('fileHeightmap').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    setStatus('Lettura heightmap…');
    const before = project.layers.elevation.data.slice();
    try {
      const { img, warn } = await CS2.heightmap.importFile(project, f, { world: $('hmWorld').checked, heightScale: Math.max(1, +$('hmScale').value || 4096) });
      history.recordWhole(project, 'elevation', 'Import heightmap', before);
      view.cache = {}; changed();
      setStatus('Heightmap importata: ' + img.width + '×' + img.height + ', ' + img.bitDepth + ' bit');
      if (warn.length) alert(warn.join('\n'));
    } catch (err) { setStatus('Import fallito'); alert(err.message); }
  });
  const shot = CS2.screenshotDialog.setup(app);
  $('btnShot').addEventListener('click', () => $('fileShot').click());
  $('fileShot').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) shot.open(f); });

  // ------------------------------------------------------------ vincoli
  const AN = CS2.analysis;
  let analysis = null, anTimer = null, anSig = 0;
  const LEGENDS = {
    housing: [['transparent', 'Adatto'], ['rgb(220,200,60)', 'Pendenza da gestire'], ['rgb(150,100,50)', 'Sottovento all\'industria'], ['rgb(230,140,40)', 'Risorsa da riservare'], ['rgb(200,60,60)', 'Non costruibile (acqua, riva, pendenza)']],
    industry: [['rgb(90,190,90)', 'Vicino a minerali/petrolio o industria prevista'], ['transparent', 'Possibile'], ['rgb(220,200,60)', 'Pendenza da gestire'], ['rgb(70,150,220)', 'Sopra o vicino alla falda'], ['rgb(200,60,60)', 'Non costruibile']],
    slope: [['rgb(230,160,40)', 'Oltre la soglia di attenzione'], ['rgb(200,60,60)', 'Oltre la soglia massima']],
    plume: [['rgb(150,100,50)', 'Inquinamento dell\'aria trasportato dal vento']]
  };
  function scheduleAnalysis(delay) {
    clearTimeout(anTimer);
    anTimer = setTimeout(runAnalysis, delay === undefined ? 400 : delay);
  }
  const MOD = CS2.modules;
  let modules = null;
  function runAnalysis() {
    const t = performance.now();
    // moduli → maschera industria → vincoli → vincoli sulle celle
    modules = MOD.compute(project, project.settings.autoRoads, AN.compute);
    analysis = modules.analysis; anSig++;
    modules.sig = anSig;
    view.modules = modules;
    view.analysis = { A: analysis, mode: $('anMode').value, sig: anSig };
    if (view.selection && view.selection.module) view.selection.moduleFace = MOD.faceAt(modules, view.selection.module);
    renderGrowth(); view.draw(); renderAnalysis(); renderModules(); renderSelection();
    $('anStats').dataset.ms = Math.round(performance.now() - t);
  }
  function renderModules() {
    $('modAuto').textContent = 'Genera strade interne: ' + (project.settings.autoRoads ? 'ON' : 'OFF');
    $('modAuto').classList.toggle('active', !!project.settings.autoRoads);
    const T = modules && modules.totals;
    if (!T) { $('modStats').innerHTML = ''; return; }
    const ha = n => (n * 64 / 10000).toFixed(1) + ' ha', props = modules.faces.reduce((s, f) => s + (f.proposal ? f.proposal.segs.length : 0), 0);
    $('modStats').innerHTML = kv('Moduli', T.modules) + kv('Zonabile', ha(T.zone)) + kv('Interno non zonabile', ha(T.interior)) + kv('Celle in conflitto', ha(T.conflict)) +
      kv('Lotti su vincoli', ha(T.constrained)) + kv('Avvisi', T.warnings) + (project.settings.autoRoads ? kv('Strade proposte', props) : '');
    $('modAcceptAll').disabled = !props;
    const L = [['rgba(70,150,80,.7)', 'Zonabile (colore del tipo)'], ['rgb(25,25,25)', 'Interno: oltre 6 celle dalla strada'], ['rgb(230,60,200)', 'Conflitto tra griglie'],
      ['rgb(230,140,40)', 'Sopra risorse da riservare'], ['rgb(150,100,50)', 'Sottovento all\'industria'], ['rgb(200,50,50)', 'Acqua / riva / troppo ripido'], ['rgb(220,200,60)', 'Pendenza da gestire'], ['rgb(70,150,220)', 'Industria sulla falda'], ['rgba(255,211,107,.9)', 'Strada proposta (tratteggio)']];
    $('modLegend').innerHTML = L.map(([c, l]) => '<div><span class="sw" style="background:' + c + ';border:1px solid #333"></span>' + l + '</div>').join('');
  }
  function renderGrowth() {
    const g = modules && modules.growth; if (!g) return;
    const sl = $('phaseShow');
    sl.max = Math.max(1, g.maxPhase);
    if (+sl.value > g.maxPhase) sl.value = 0;
    const cur = +sl.value;
    view.maxPhase = cur ? cur : null;
    $('vPhase').textContent = cur ? 'fase ' + cur + ' di ' + g.maxPhase : 'tutto';
    if (!g.rows.length) { $('growthTable').innerHTML = '<p class="hint">Nessuna fase assegnata. Usa "Pianifica a click" o "Suggerisci ordine".</p>'; return; }
    const ha = x => x.toFixed(0), k = x => x >= 1000 ? (x / 1000).toFixed(1) + 'k' : Math.round(x);
    let h = '<table class="gtable"><tr><th>Fase</th><th>Moduli</th><th>Zon. ha</th><th>Abit.</th><th>Lavoro</th><th>Strade km</th></tr>';
    g.rows.forEach(r => {
      const km = Object.keys(r.km).map(t => ROAD_TYPES[t].label.split(' ')[0].slice(0, 3) + ' ' + r.km[t].toFixed(1)).join(', ');
      h += '<tr class="' + (!cur || r.phase <= cur ? 'on' : '') + '"><td>F' + r.phase + '</td><td>' + r.modules + '</td><td>' + ha(r.zone) + '</td><td>' + k(r.cumRes) + '</td><td>' + k(r.cumJobs) + '</td><td title="' + km + '">' + Object.values(r.km).reduce((a, b) => a + b, 0).toFixed(1) + '</td></tr>';
    });
    h += '</table>';
    if (g.unplanned) h += '<p class="hint">' + g.unplanned + ' moduli senza fase.</p>';
    if (g.warn.length) h += '<ul class="tips">' + g.warn.slice(0, 8).map(w => '<li class="t-warn">' + w[1] + '</li>').join('') + (g.warn.length > 8 ? '<li>… altri ' + (g.warn.length - 8) + '</li>' : '') + '</ul>';
    $('growthTable').innerHTML = h;
  }
  $('phaseShow').addEventListener('input', () => { renderGrowth(); view.draw(); });
  $('phaseSuggest').addEventListener('click', () => {
    if (!modules || !modules.faces.length) return;
    const start = view.selection && view.selection.moduleFace;
    const n = MOD.suggestOrder(project, modules, start);
    changed(); setStatus('Ordine suggerito per ' + n + ' moduli' + (start ? ' a partire dal modulo selezionato' : ''));
  });
  $('phaseClear').addEventListener('click', () => {
    if (!confirm('Togliere la fase da tutti i moduli?')) return;
    (project.modules || []).forEach(m => delete m.phase); $('phaseNext').value = 1; $('phaseShow').value = 0; changed();
  });
  $('modShow').addEventListener('change', e => { view.show.modules = e.target.checked; view.draw(); });
  $('modAuto').addEventListener('click', () => { project.settings.autoRoads = !project.settings.autoRoads; changed(); renderModules(); });
  function accept(faces) {
    const before = JSON.stringify({ graph: project.graph, modules: project.modules });
    let n = 0; faces.forEach(f => { n += MOD.acceptProposal(project, f); });
    if (!n) return;
    history.recordGraph(project, 'Accetta strade proposte', JSON.stringify(JSON.parse(before).graph));
    view.selection = null; changed(); setStatus(n + ' strade aggiunte alla rete');
  }
  $('modAcceptAll').addEventListener('click', () => { if (modules) accept(modules.faces.filter(f => f.proposal && f.proposal.segs.length)); });
  function renderAnalysis() {
    const mode = $('anMode').value;
    $('anLegend').innerHTML = (LEGENDS[mode] || []).map(([c, l]) => '<div><span class="sw" style="background:' + c + ';border:1px solid #333"></span>' + l + '</div>').join('');
    if (!analysis) { $('anStats').innerHTML = ''; return; }
    const st = analysis.stat, pc = x => (x * 100).toFixed(1) + '%';
    $('anStats').innerHTML = '<div class="hint" style="margin-top:4px;">Mappa per le case:</div>' +
      kv('Adatta', pc(st.ok)) + kv('Pendenza da gestire', pc(st.slope)) + kv('Sottovento', pc(st.plume)) + kv('Da riservare', pc(st.reserved)) + kv('Non costruibile', pc(st.blocked));
  }
  function syncAnalysisInputs() {
    const P = AN.params(project);
    $('anSlopeWarn').value = P.slopeWarn; $('anSlopeMax').value = P.slopeMax; $('anShore').value = P.shore;
    $('anThreshold').value = Math.round(P.threshold / 2.55); $('anPlume').value = P.plumeLength;
    $('anBuffers').innerHTML = Object.keys(P.buffers).map(k =>
      '<span>' + LAYERS[k].label + '</span><input type="number" min="0" max="3000" step="10" data-buf="' + k + '" value="' + P.buffers[k] + '">' +
      (k in P.reserve ? '<label class="check" title="Non coprire con case"><input type="checkbox" data-res="' + k + '"' + (P.reserve[k] ? ' checked' : '') + '>riserva</label>' : '<span class="hint">solo industria</span>')).join('');
    $('anSources').innerHTML = Object.keys(P.plumeSources).map(k => '<label class="check"><input type="checkbox" data-src="' + k + '"' + (P.plumeSources[k] ? ' checked' : '') + '>' + (LAYERS[k] ? LAYERS[k].label : 'Moduli di tipo industria') + '</label>').join('');
    $('anBuffers').querySelectorAll('[data-buf]').forEach(el => el.addEventListener('change', () => { setParam(a => { a.buffers = Object.assign({}, a.buffers, { [el.dataset.buf]: Math.max(0, +el.value || 0) }); }); }));
    $('anBuffers').querySelectorAll('[data-res]').forEach(el => el.addEventListener('change', () => { setParam(a => { a.reserve = Object.assign({}, a.reserve, { [el.dataset.res]: el.checked }); }); }));
    $('anSources').querySelectorAll('[data-src]').forEach(el => el.addEventListener('change', () => { setParam(a => { a.plumeSources = Object.assign({}, a.plumeSources, { [el.dataset.src]: el.checked }); }); }));
  }
  function setParam(fn) { project.analysis = project.analysis || {}; fn(project.analysis); changed(); }
  [['anSlopeWarn', 'slopeWarn', 1], ['anSlopeMax', 'slopeMax', 1], ['anShore', 'shore', 1], ['anThreshold', 'threshold', 2.55], ['anPlume', 'plumeLength', 1]].forEach(([id, key, f]) => {
    $(id).addEventListener('change', e => setParam(a => { a[key] = Math.max(0, (+e.target.value || 0) * f); }));
  });
  $('anMode').addEventListener('change', () => {
    if (view.analysis) view.analysis.mode = $('anMode').value;
    renderAnalysis(); view.draw();
  });
  const HOUSING_TXT = ['adatto alle case', 'pendenza da gestire', 'sottovento all\'industria', 'risorsa da riservare', 'non costruibile'];

  // ------------------------------------------------------------ strumenti
  const tool = { mode: 'pan', layer: 'elevation', brush: 'raise', radius: 300, strength: 0.5, target: 100, cursor: null };
  function syncTool() {
    $('toolPan').classList.toggle('active', tool.mode === 'pan');
    $('toolBrush').classList.toggle('active', tool.mode === 'brush');
    $('brushOpts').style.display = tool.mode === 'brush' ? '' : 'none';
    const modes = brush.MODES[LAYERS[tool.layer].kind];
    if (!modes[tool.brush]) tool.brush = Object.keys(modes)[0];
    $('brushMode').innerHTML = Object.keys(modes).map(k => '<option value="' + k + '"' + (k === tool.brush ? ' selected' : '') + '>' + modes[k] + '</option>').join('');
    $('flattenRow').style.display = tool.brush === 'flatten' ? '' : 'none';
    $('brushTarget').value = Math.round(tool.target);
    $('vRadius').textContent = tool.radius + ' m';
    $('vStrength').textContent = Math.round(tool.strength * 100) + '%';
    $('map').style.cursor = tool.mode === 'brush' || tool.mode === 'road' ? 'crosshair' : tool.mode === 'select' ? 'default' : 'grab';
    $('toolRoad').classList.toggle('active', tool.mode === 'road');
    $('toolSelect').classList.toggle('active', tool.mode === 'select');
    $('toolPhase').classList.toggle('active', tool.mode === 'phase');
    if (tool.mode === 'phase') $('map').style.cursor = 'pointer';
    view.showNodes = tool.mode === 'road' || tool.mode === 'select';
    if (tool.mode !== 'road') endChain();
    if (tool.mode !== 'select') { view.selection = null; renderSelection(); }
  }
  function setMode(m) { tool.mode = m; syncTool(); view.draw(); }
  $('brushLayer').innerHTML = Object.keys(LAYERS).map(k => '<option value="' + k + '">' + LAYERS[k].label + '</option>').join('');
  $('toolPan').addEventListener('click', () => setMode('pan'));
  $('toolBrush').addEventListener('click', () => setMode('brush'));
  $('toolRoad').addEventListener('click', () => setMode('road'));
  $('toolSelect').addEventListener('click', () => setMode('select'));
  $('toolPhase').addEventListener('click', () => setMode(tool.mode === 'phase' ? 'pan' : 'phase'));
  $('brushLayer').addEventListener('change', e => {
    tool.layer = e.target.value; syncTool();
    const key = tool.layer === 'elevation' ? 'terrain' : tool.layer;
    if (!view.show[key]) { view.show[key] = true; renderPanel(); view.draw(); }
  });
  $('brushMode').addEventListener('change', e => { tool.brush = e.target.value; syncTool(); });
  $('brushRadius').addEventListener('input', e => { tool.radius = +e.target.value; syncTool(); view.draw(); });
  $('brushStrength').addEventListener('input', e => { tool.strength = +e.target.value / 100; syncTool(); });
  $('brushTarget').addEventListener('change', e => { tool.target = +e.target.value || 0; });
  function undo() { endChain(); const e = history.undo(project); if (e) { view.cache = {}; changed(); setStatus('Annullato: ' + e.label); } }
  function redo() { const e = history.redo(project); if (e) { view.cache = {}; changed(); setStatus('Ripristinato: ' + e.label); } }
  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);
  // ------------------------------------------------------------ strade
  const G = CS2.graph, { ROAD_TYPES } = CS2.roads;
  const road = { type: 'small', angles: 90, shape: 'straight', chain: null, prevDir: null, ctrl: null, snap: null, before: null };
  const pxTol = () => 10 / view.cam.s;
  $('roadType').innerHTML = Object.keys(ROAD_TYPES).map(k => '<option value="' + k + '"' + (k === road.type ? ' selected' : '') + '>' + ROAD_TYPES[k].label + ' (' + ROAD_TYPES[k].w + ' m)</option>').join('');
  $('roadType').addEventListener('change', e => { road.type = e.target.value; });
  $('roadAngles').addEventListener('change', e => { road.angles = +e.target.value; });
  $('roadShape').addEventListener('change', e => { road.shape = e.target.value; road.ctrl = null; view.draw(); });
  const Gm = CS2.geom;
  // continuando da una strada esistente si riparte nella sua direzione
  function firstDir(nodeId) { const e = project.edgesOf(nodeId)[0]; return e ? G.tangentAt(project, e, nodeId) : null; }
  function computeSnap(w, free) {
    const st = road.chain ? project.node(road.chain) : null;
    // curva, secondo click: il punto di controllo resta sulla tangente della strada precedente
    if (st && road.shape === 'curve' && !road.ctrl) {
      if (road.prevDir && road.lock && !free) {
        const t = Math.max(CS2.roads.CELL, Math.round(Gm.dot(Gm.sub(w, st), road.prevDir) / CS2.roads.CELL) * CS2.roads.CELL);
        return { pt: Gm.add(st, Gm.mul(road.prevDir, t)), tangent: true };
      }
      return G.snap(project, w, { start: st, startNode: st, prevDir: road.prevDir, type: road.type, pxTol: pxTol(), angles: road.angles, free });
    }
    const ref = road.ctrl ? Gm.norm(Gm.sub(road.ctrl, st)) : road.prevDir;
    return G.snap(project, w, { start: st, startNode: st, prevDir: ref, type: road.type, pxTol: pxTol(), angles: road.angles, free });
  }
  function roadClick(w, free) {
    const sn = computeSnap(w, free);
    if (!road.chain) {
      road.before = JSON.stringify(project.graph);
      const n = G.nodeAt(project, sn.pt, sn);
      road.chain = n.id; road.prevDir = firstDir(n.id);
      road.lock = project.edgesOf(n.id).length === 1;     // si prosegue una strada solo da un fondo cieco
      return;
    }
    const st = project.node(road.chain);
    if (Gm.dist(st, sn.pt) < CS2.roads.CELL / 2) { endChain(); return; }   // doppio click: fine
    if (road.shape === 'curve' && !road.ctrl) { road.ctrl = sn.pt; setStatus('Ora clicca il punto finale della curva'); return; }
    const n = G.nodeAt(project, sn.pt, sn);
    let made;
    if (road.shape === 'curve') {
      const c = Gm.quadToCubic(st, road.ctrl, n);
      made = G.addRoad(project, road.chain, n.id, road.type, c);
      road.prevDir = Gm.norm(Gm.sub(n, road.ctrl));
      road.ctrl = null;
    } else {
      made = G.addRoad(project, road.chain, n.id, road.type);
      road.prevDir = Gm.norm(Gm.sub(n, st));
    }
    road.chain = n.id; road.lock = true;
    setStatus(made.length + ' tratti aggiunti · Esc o tasto destro per finire');
    view.draw(); renderPanel();
  }
  function endChain() {
    if (!road.chain) return;
    road.chain = null; road.prevDir = null; road.snap = null; road.ctrl = null;
    G.removeOrphans(project);
    if (road.before !== null && road.before !== JSON.stringify(project.graph)) { history.recordGraph(project, 'Strade', road.before); changed(); }
    road.before = null;
    view.draw();
  }
  view.overlays.push((ctx, v) => {
    if (tool.mode !== 'road' || !road.snap) return;
    const sn = road.snap, p = sn.pt;
    if (sn.guide) {
      const g = sn.guide, a = CS2.geom.add(g.linePt, CS2.geom.mul(g.dir, -4000)), b = CS2.geom.add(g.linePt, CS2.geom.mul(g.dir, 4000));
      ctx.strokeStyle = 'rgba(109,179,109,0.8)'; ctx.lineWidth = 1; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(v.sx(a.x), v.sy(a.y)); ctx.lineTo(v.sx(b.x), v.sy(b.y)); ctx.stroke(); ctx.setLineDash([]);
    }
    const st = road.chain ? project.node(road.chain) : null;
    if (st) {
      const t = ROAD_TYPES[road.type];
      let curve = null;
      ctx.strokeStyle = 'rgba(255,211,107,0.55)'; ctx.lineWidth = Math.max(2, t.w * v.cam.s);
      ctx.beginPath(); ctx.moveTo(v.sx(st.x), v.sy(st.y));
      if (road.shape === 'curve' && road.ctrl) {
        curve = Gm.quadToCubic(st, road.ctrl, p);
        ctx.bezierCurveTo(v.sx(curve.c1.x), v.sy(curve.c1.y), v.sx(curve.c2.x), v.sy(curve.c2.y), v.sx(p.x), v.sy(p.y));
      } else ctx.lineTo(v.sx(p.x), v.sy(p.y));
      if (road.shape === 'curve' && !road.ctrl) { ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.restore(); }
      else ctx.stroke();
      if (road.ctrl) {
        ctx.strokeStyle = 'rgba(255,211,107,0.6)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(v.sx(st.x), v.sy(st.y)); ctx.lineTo(v.sx(road.ctrl.x), v.sy(road.ctrl.y)); ctx.lineTo(v.sx(p.x), v.sy(p.y)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#ffd36b'; ctx.fillRect(v.sx(road.ctrl.x) - 4, v.sy(road.ctrl.y) - 4, 8, 8);
      }
      if (road.shape === 'curve' && !road.ctrl) return;
      const L = curve ? Gm.bezLength(curve) : Gm.dist(st, p), gr = G.grade(project, st, p, curve), maxS = CS2.analysis.params(project).slopeMax;
      let ang = Math.atan2(-(p.y - st.y), p.x - st.x) * 180 / Math.PI; if (ang < 0) ang += 360;
      const txt = Math.round(L) + ' m · ' + Math.round(ang) + '° · pend. ' + gr.toFixed(1) + '%' + (sn.guide ? ' · CtC ' + sn.guide.dist + ' m' : '');
      ctx.font = "bold 11px 'Space Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const X = v.sx(p.x) + 12, Y = v.sy(p.y) - 14, wd = ctx.measureText(txt).width + 8;
      ctx.fillStyle = 'rgba(9,10,11,0.88)'; ctx.fillRect(X - 4, Y - 9, wd, 18);
      ctx.fillStyle = gr > maxS ? '#e06060' : '#e8e2c8'; ctx.fillText(txt, X, Y);
    } else if (sn.guide) {
      ctx.font = "bold 11px 'Space Mono', monospace"; ctx.fillStyle = '#9fd09f'; ctx.textAlign = 'left';
      ctx.fillText('CtC ' + sn.guide.dist + ' m', v.sx(p.x) + 12, v.sy(p.y) - 12);
    }
    ctx.fillStyle = sn.node ? '#6db36d' : sn.edgeHit ? '#7fb0e0' : '#ffd36b';
    ctx.beginPath(); ctx.arc(v.sx(p.x), v.sy(p.y), 5, 0, Math.PI * 2); ctx.fill();
  });

  // selezione
  function hitTest(w) {
    const sel = view.selection, se = sel && sel.edge && project.graph.edges.find(e => e.id === sel.edge);
    if (se) {
      const h = view.handles(project, se).find(h => Gm.dist(h, w) <= pxTol());
      if (h) return { edge: se.id, handle: h.kind };
    }
    const n = G.nearestNode(project, w, pxTol());
    if (n) return { node: n.id };
    const e = G.nearestEdge(project, w, pxTol());
    if (e) return { edge: e.edge.id };
    return null;
  }
  function renderSelection() {
    const sel = view.selection, el = $('selInfo');
    if (sel && sel.module) {
      const f = sel.moduleFace; if (!f) { el.innerHTML = ''; return; }
      const s = f.stats, ha = n => (n * 64 / 10000).toFixed(1) + ' ha', pc = n => s.cells ? Math.round(100 * n / s.cells) + '%' : '—';
      el.innerHTML = '<h4 style="margin-top:6px;">Modulo</h4>' +
        '<label class="field">Tipo <select id="modType">' + Object.keys(MOD.TYPES).map(k => '<option value="' + k + '"' + (k === f.type ? ' selected' : '') + '>' + MOD.TYPES[k].label + '</option>').join('') + '</select></label>' +
        '<label class="field">Fase di costruzione <input id="modPhase" type="number" min="1" step="1" value="' + (f.phase === null ? '' : f.phase) + '" placeholder="non pianificato"></label>' +
        kv('Superficie (senza strade)', ha(s.cells)) + kv('Zonabile', pc(s.zone)) + kv('Interno', pc(s.interior)) + kv('Conflitto', pc(s.conflict)) +
        (f.proposal ? kv('Fronte', ROAD_TYPES[f.proposal.frontType].label) + (f.proposal.first ? kv('Prima locale dal fronte', Math.round(f.proposal.first) + ' m') : '') + kv('Strade proposte', f.proposal.segs.length + (f.proposal.tooSmall ? ' (area piccola)' : '')) : '') +
        (f.proposal && f.proposal.segs.length ? '<button class="btn primary" id="modAccept">Accetta strade proposte</button>' : '') +
        '<ul class="tips">' + f.warnings.map(w => '<li class="t-' + w[0] + '">' + w[1] + '</li>').join('') + '</ul>';
      $('modType').addEventListener('change', ev => { MOD.setType(project, f, ev.target.value); changed(); });
      $('modPhase').addEventListener('change', ev => { const v = ev.target.value === '' ? null : +ev.target.value; MOD.setPhase(project, f, v); changed(); });
      if ($('modAccept')) $('modAccept').addEventListener('click', () => accept([f]));
      return;
    }
    if (!sel || (!sel.edge && !sel.node)) { el.innerHTML = tool.mode === 'select' ? '<p class="hint">Clicca una strada o un nodo. Trascina i nodi per spostarli; Canc per eliminare.</p>' : ''; return; }
    if (sel.edge) {
      const e = project.graph.edges.find(x => x.id === sel.edge); if (!e) { view.selection = null; return renderSelection(); }
      const a = project.node(e.a), b = project.node(e.b);
      el.innerHTML = kv('Lunghezza', Math.round(G.edgeLength(project, e)) + ' m') + kv('Forma', G.isCurve(e) ? 'curva' : 'dritta') +
        kv('Pendenza max', G.grade(project, a, b, G.isCurve(e) ? e : null).toFixed(1) + '%') +
        '<label class="field">Tipo <select id="selType">' + Object.keys(ROAD_TYPES).map(k => '<option value="' + k + '"' + (k === e.type ? ' selected' : '') + '>' + ROAD_TYPES[k].label + '</option>').join('') + '</select></label>' +
        (G.isCurve(e) ? '<button class="btn" id="selStraight">Raddrizza</button>' : '<p class="hint">Trascina il cerchio al centro per curvarla.</p>') +
        '<button class="btn" id="selDel">Elimina strada</button>';
      if ($('selStraight')) $('selStraight').addEventListener('click', () => { const before = JSON.stringify(project.graph); delete e.c1; delete e.c2; G.rebuildEdges(project, [e]); history.recordGraph(project, 'Raddrizza', before); view.selection = null; changed(); renderSelection(); });
      $('selType').addEventListener('change', ev => { const before = JSON.stringify(project.graph); e.type = ev.target.value; history.recordGraph(project, 'Tipo strada', before); changed(); renderSelection(); });
    } else {
      const n = project.node(sel.node); if (!n) { view.selection = null; return renderSelection(); }
      el.innerHTML = kv('Strade collegate', project.edgesOf(n.id).length) + kv('Quota', Math.round(project.elevationAt(n.x, n.y)) + ' m') + '<button class="btn" id="selDel">Elimina nodo</button>';
    }
    $('selDel').addEventListener('click', deleteSelection);
  }
  function deleteSelection() {
    const sel = view.selection; if (!sel) return;
    const before = JSON.stringify(project.graph);
    if (sel.edge) G.deleteEdge(project, sel.edge); else if (sel.node) G.deleteNode(project, sel.node);
    view.selection = null; history.recordGraph(project, 'Elimina', before); changed(); renderSelection();
  }

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); endChain(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); endChain(); redo(); }
    else if (k === 'escape') { if (road.chain) endChain(); else setMode('pan'); }
    else if (k === 'b') setMode('brush');
    else if (k === 'r') setMode('road');
    else if (k === 'v') setMode('select');
    else if (k === 'h') setMode('pan');
    else if (k === 'p') setMode('phase');
    else if ((k === 'delete' || k === 'backspace') && tool.mode === 'select') { e.preventDefault(); deleteSelection(); }
  });
  view.overlays.push((ctx, v) => {
    if (tool.mode !== 'brush' || !tool.cursor) return;
    ctx.strokeStyle = 'rgba(255,211,107,0.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(v.sx(tool.cursor.x), v.sy(tool.cursor.y), Math.max(3, tool.radius * v.cam.s), 0, Math.PI * 2); ctx.stroke();
  });

  // ------------------------------------------------------------ interazione mappa
  const cv = $('map');
  let drag = null, painting = false, rafPending = false, moving = null, shaping = null;
  const worldOf = e => { const r = cv.getBoundingClientRect(); return view.toWorld(e.clientX - r.left, e.clientY - r.top); };
  function scheduleDraw() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; view.draw(); }); }
  function paint(w) { history.grow(brush.dab(project, tool.layer, { x: w.x, y: w.y, radius: tool.radius, strength: tool.strength * 0.35, mode: tool.brush, target: tool.target })); scheduleDraw(); }

  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    const w = worldOf(e);
    if (tool.mode === 'brush' && e.button === 0) {
      if (e.altKey && LAYERS[tool.layer].kind === 'f32') {           // Alt+click: prendi la quota per "Livella"
        tool.target = project.elevationAt(w.x, w.y); syncTool(); setStatus('Quota per Livella: ' + Math.round(tool.target) + ' m'); return;
      }
      painting = true;
      history.begin(project, tool.layer, (brush.MODES[LAYERS[tool.layer].kind][tool.brush]) + ' · ' + LAYERS[tool.layer].label);
      paint(w);
      return;
    }
    if (tool.mode === 'road') {
      if (e.button === 0) { roadClick(w, e.shiftKey); road.snap = computeSnap(w, e.shiftKey); view.draw(); return; }
      if (e.button === 2 && road.chain) { endChain(); return; }
    }
    if (tool.mode === 'phase' && e.button === 0 && modules) {
      const f = MOD.faceAt(modules, w);
      if (f) {
        const ph = Math.max(1, +$('phaseNext').value || 1);
        MOD.setPhase(project, f, ph);
        if ($('phaseAuto').checked) $('phaseNext').value = ph + 1;
        changed(); setStatus('Modulo assegnato alla fase ' + ph);
      }
      return;
    }
    if (tool.mode === 'select' && e.button === 0) {
      const h = hitTest(w);
      if (h && h.handle) { shaping = { edge: h.edge, kind: h.handle, before: JSON.stringify(project.graph), moved: false }; view.selection = { edge: h.edge, hoverHandle: h.handle }; view.draw(); return; }
      if (!h && modules) { const f = MOD.faceAt(modules, w); if (f) { view.selection = { module: w, moduleFace: f }; renderSelection(); view.draw(); return; } }
      view.selection = h; renderSelection();
      if (h && h.node) { moving = { id: h.node, before: JSON.stringify(project.graph), moved: false }; view.draw(); return; }
      view.draw();
      if (h) return;
    }
    drag = { x: e.clientX, y: e.clientY, cx: view.cam.x, cy: view.cam.y };
  });
  cv.addEventListener('dblclick', () => { if (tool.mode === 'road') endChain(); });
  cv.addEventListener('pointermove', e => {
    const w = worldOf(e);
    tool.cursor = w;
    if (project.inside(w.x, w.y)) {
      const parts = ['x ' + Math.round(w.x) + ' m', 'y ' + Math.round(w.y) + ' m', 'quota ' + Math.round(project.elevationAt(w.x, w.y)) + ' m'];
      if (project.isWater(w.x, w.y)) parts.push('acqua');
      if (analysis) { const a = AN.at(analysis, project, w.x, w.y); parts.push('pendenza ' + a.slope.toFixed(1) + '%', HOUSING_TXT[a.housing]); }
      RESOURCE_KEYS.forEach(k => { const v = project.layerAt(k, w.x, w.y); if (v > 20) parts.push(LAYERS[k].label.toLowerCase() + ' ' + Math.round(v / 2.55) + '%'); });
      $('cursor').textContent = parts.join(' · ');
    } else $('cursor').textContent = 'fuori mappa';
    if (painting) { paint(w); return; }
    if (moving) {
      const other = G.nearestNode(project, w, pxTol(), new Set([moving.id]));
      const pt = other ? other : { x: Math.round(w.x / CS2.roads.CELL) * CS2.roads.CELL, y: Math.round(w.y / CS2.roads.CELL) * CS2.roads.CELL };
      G.moveNodeWithHandles(project, moving.id, pt.x, pt.y); moving.moved = true;
      scheduleDraw(); return;
    }
    if (shaping) {
      const e = project.graph.edges.find(x => x.id === shaping.edge);
      if (e) {
        const a = project.node(e.a), b = project.node(e.b);
        if (shaping.kind === 'mid') {
          // la curva passa per il cursore a metà: controllo quadratico Q = 2M − (A+B)/2
          const q = Gm.sub(Gm.mul(w, 2), Gm.mul(Gm.add(a, b), 0.5)), c = Gm.quadToCubic(a, q, b);
          e.c1 = c.c1; e.c2 = c.c2;
        } else e[shaping.kind] = { x: w.x, y: w.y };
        shaping.moved = true;
      }
      scheduleDraw(); return;
    }
    if (drag) {
      view.cam.x = drag.cx - (e.clientX - drag.x) / view.cam.s;
      view.cam.y = drag.cy - (e.clientY - drag.y) / view.cam.s;
      scheduleDraw(); return;
    }
    if (tool.mode === 'road') { road.snap = computeSnap(w, e.shiftKey); scheduleDraw(); }
    else if (tool.mode === 'select') {
      const h = hitTest(w) || {}, sel = view.selection || {};
      if (h.node !== sel.hoverNode || h.edge !== sel.hoverEdge || h.handle !== sel.hoverHandle) { view.selection = Object.assign({}, view.selection, { hoverNode: h.node, hoverEdge: h.handle ? sel.hoverEdge : h.edge, hoverHandle: h.handle }); scheduleDraw(); }
    }
    else if (tool.mode === 'brush') scheduleDraw();
  });
  cv.addEventListener('pointerup', () => {
    if (painting) { painting = false; history.end(project); markManual(tool.layer); changed(); }
    if (moving) {
      if (moving.moved) {
        const nid = G.finishMove(project, moving.id, pxTol());
        view.selection = { node: nid };
        history.recordGraph(project, 'Sposta nodo', moving.before); changed(); renderSelection();
      }
      moving = null;
    }
    if (shaping) {
      if (shaping.moved) {
        const e = project.graph.edges.find(x => x.id === shaping.edge);
        if (e) G.rebuildEdges(project, [e]);
        history.recordGraph(project, 'Forma strada', shaping.before);
        view.selection = null; changed(); renderSelection();
      }
      shaping = null;
    }
    drag = null;
  });
  cv.addEventListener('pointerleave', () => { tool.cursor = null; road.snap = null; if (tool.mode === 'brush' || tool.mode === 'road') scheduleDraw(); });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    view.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); scheduleDraw();
  }, { passive: false });
  $('zIn').addEventListener('click', () => { view.zoomAt(view.W / 2, view.H / 2, 1.4); view.draw(); });
  $('zOut').addEventListener('click', () => { view.zoomAt(view.W / 2, view.H / 2, 1 / 1.4); view.draw(); });
  $('zFit').addEventListener('click', () => { view.fit(); view.draw(); });
  root.addEventListener('resize', () => { view.resize(); view.draw(); });

  // ------------------------------------------------------------ terreno di prova
  // Solo per provare la pagina senza una heightmap vera.
  function demoTerrain(p) {
    const { hash3 } = CS2.util, seed = 1729;
    const noise = (x, y, k) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, s = t => t * t * (3 - 2 * t), u = s(fx), v = s(fy);
      const a = hash3(seed, xi, yi, k), b = hash3(seed, xi + 1, yi, k), c = hash3(seed, xi, yi + 1, k), d = hash3(seed, xi + 1, yi + 1, k);
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    };
    const fbm = (x, y, k) => noise(x, y, k) * 0.55 + noise(x * 2, y * 2, k + 1) * 0.28 + noise(x * 4, y * 4, k + 2) * 0.17;
    const E = p.layers.elevation, n = E.res;
    p.map.seaLevel = 40;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const u = i / n, v = j / n;
      const coast = Math.max(0, v - 0.8) * 1500;               // mare a sud, colline a ovest
      E.data[j * n + i] = Math.max(0, 60 + fbm(u * 5, v * 5, 1) * 260 - coast + Math.max(0, 0.25 - u) * 900);
    }
    E.changed();
    const R = { fertile: 11, forest: 21, ore: 31, oil: 41, groundwater: 51 };
    RESOURCE_KEYS.forEach(k => {
      const L = p.layers[k], m = L.res;
      for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
        const val = fbm(i / m * 7, j / m * 7, R[k]);
        L.data[j * m + i] = val > 0.68 ? Math.min(255, (val - 0.68) * 1200) : 0;
      }
      L.changed();
    });
    syncInputs();
  }

  // ------------------------------------------------------------ avvio
  view.resize(); view.fit(); syncTool();
  storage.loadAutosave().then(p => {
    if (p) setProject(p, 'Ripreso l\'ultimo progetto salvato nel browser');
    else { view.draw(); renderPanel(); syncInputs(); setStatus('Progetto vuoto'); }
  });
})(window);
