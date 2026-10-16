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
  function runAnalysis() {
    const t = performance.now();
    analysis = AN.compute(project); anSig++;
    view.analysis = { A: analysis, mode: $('anMode').value, sig: anSig };
    view.draw(); renderAnalysis();
    $('anStats').dataset.ms = Math.round(performance.now() - t);
  }
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
    $('anSources').innerHTML = Object.keys(P.plumeSources).map(k => '<label class="check"><input type="checkbox" data-src="' + k + '"' + (P.plumeSources[k] ? ' checked' : '') + '>' + LAYERS[k].label + '</label>').join('');
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
    $('map').style.cursor = tool.mode === 'brush' ? 'crosshair' : 'grab';
  }
  $('brushLayer').innerHTML = Object.keys(LAYERS).map(k => '<option value="' + k + '">' + LAYERS[k].label + '</option>').join('');
  $('toolPan').addEventListener('click', () => { tool.mode = 'pan'; syncTool(); view.draw(); });
  $('toolBrush').addEventListener('click', () => { tool.mode = 'brush'; syncTool(); });
  $('brushLayer').addEventListener('change', e => {
    tool.layer = e.target.value; syncTool();
    const key = tool.layer === 'elevation' ? 'terrain' : tool.layer;
    if (!view.show[key]) { view.show[key] = true; renderPanel(); view.draw(); }
  });
  $('brushMode').addEventListener('change', e => { tool.brush = e.target.value; syncTool(); });
  $('brushRadius').addEventListener('input', e => { tool.radius = +e.target.value; syncTool(); view.draw(); });
  $('brushStrength').addEventListener('input', e => { tool.strength = +e.target.value / 100; syncTool(); });
  $('brushTarget').addEventListener('change', e => { tool.target = +e.target.value || 0; });
  function undo() { const e = history.undo(project); if (e) { view.cache = {}; changed(); setStatus('Annullato: ' + e.label); } }
  function redo() { const e = history.redo(project); if (e) { view.cache = {}; changed(); setStatus('Ripristinato: ' + e.label); } }
  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); }
    else if (k === 'b') { tool.mode = 'brush'; syncTool(); }
    else if (k === 'h' || k === 'escape') { tool.mode = 'pan'; syncTool(); view.draw(); }
  });
  view.overlays.push((ctx, v) => {
    if (tool.mode !== 'brush' || !tool.cursor) return;
    ctx.strokeStyle = 'rgba(255,211,107,0.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(v.sx(tool.cursor.x), v.sy(tool.cursor.y), Math.max(3, tool.radius * v.cam.s), 0, Math.PI * 2); ctx.stroke();
  });

  // ------------------------------------------------------------ interazione mappa
  const cv = $('map');
  let drag = null, painting = false, rafPending = false;
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
    drag = { x: e.clientX, y: e.clientY, cx: view.cam.x, cy: view.cam.y };
  });
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
    if (drag) {
      view.cam.x = drag.cx - (e.clientX - drag.x) / view.cam.s;
      view.cam.y = drag.cy - (e.clientY - drag.y) / view.cam.s;
      scheduleDraw(); return;
    }
    if (tool.mode === 'brush') scheduleDraw();
  });
  cv.addEventListener('pointerup', () => {
    if (painting) { painting = false; history.end(project); markManual(tool.layer); changed(); }
    drag = null;
  });
  cv.addEventListener('pointerleave', () => { tool.cursor = null; if (tool.mode === 'brush') scheduleDraw(); });
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
