// Avvio dell'applicazione: progetto corrente, barra strumenti, salvataggi.
(function (root) {
  'use strict';
  const CS2 = root.CS2;
  const { Project, MapView, storage } = CS2;
  const { LAYERS, RESOURCE_KEYS } = CS2.project;
  const $ = id => document.getElementById(id);

  let project = new Project();
  const view = new MapView($('map'), () => project);
  CS2.app = { get project() { return project; }, view, setProject, changed, redraw: () => view.draw() };

  // ------------------------------------------------------------ stato e salvataggio
  let saveTimer = null;
  function changed() {
    project.touch();
    view.draw(); renderPanel();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => setStatus(await storage.autosave(project) ? 'Salvato nel browser' : 'Autosalvataggio non disponibile'), 600);
  }
  function setProject(p, msg) {
    project = p; view.cache = {};
    view.fit(); view.draw(); renderPanel(); syncInputs();
    storage.autosave(project);
    if (msg) setStatus(msg);
  }
  function setStatus(t) { $('status').textContent = t; }

  // ------------------------------------------------------------ pannello
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
  }
  const kv = (k, v) => '<div class="kv"><span>' + k + '</span><span>' + v + '</span></div>';

  function syncInputs() {
    $('pName').value = project.name;
    $('pSize').value = project.map.size;
    $('pSea').value = project.map.seaLevel;
    $('pWind').value = project.wind.from;
    $('vWind').textContent = windLabel(project.wind.from);
  }
  function windLabel(d) {
    const n = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(((d % 360) + 360) % 360 / 45) % 8];
    return 'da ' + n + ' (' + d + '°)';
  }

  // ------------------------------------------------------------ barra strumenti
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
  $('btnDemo').addEventListener('click', () => { demoTerrain(project); project.sources.elevation = 'prova'; RESOURCE_KEYS.forEach(k => project.sources[k] = 'prova'); view.cache = {}; changed(); });
  $('pName').addEventListener('change', e => { project.name = e.target.value || 'Senza nome'; changed(); });
  $('pSize').addEventListener('change', e => { project.map.size = Math.max(1000, +e.target.value || 14336); view.fit(); changed(); });
  $('pSea').addEventListener('change', e => { project.map.seaLevel = +e.target.value || 0; changed(); });
  $('pWind').addEventListener('input', e => { project.wind.from = +e.target.value; $('vWind').textContent = windLabel(project.wind.from); view.draw(); });
  $('pWind').addEventListener('change', () => changed());

  // ------------------------------------------------------------ interazione mappa
  const cv = $('map');
  let drag = null;
  cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: view.cam.x, cy: view.cam.y }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect(), w = view.toWorld(e.clientX - r.left, e.clientY - r.top);
    if (project.inside(w.x, w.y)) {
      const parts = ['x ' + Math.round(w.x) + ' m', 'y ' + Math.round(w.y) + ' m', 'quota ' + Math.round(project.elevationAt(w.x, w.y)) + ' m'];
      if (project.isWater(w.x, w.y)) parts.push('acqua');
      RESOURCE_KEYS.forEach(k => { const v = project.layerAt(k, w.x, w.y); if (v > 20) parts.push(LAYERS[k].label.toLowerCase() + ' ' + Math.round(v / 2.55) + '%'); });
      $('cursor').textContent = parts.join(' · ');
    } else $('cursor').textContent = 'fuori mappa';
    if (!drag) return;
    view.cam.x = drag.cx - (e.clientX - drag.x) / view.cam.s;
    view.cam.y = drag.cy - (e.clientY - drag.y) / view.cam.s;
    view.draw();
  });
  cv.addEventListener('pointerup', () => { drag = null; });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    view.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); view.draw();
  }, { passive: false });
  $('zIn').addEventListener('click', () => { view.zoomAt(view.W / 2, view.H / 2, 1.4); view.draw(); });
  $('zOut').addEventListener('click', () => { view.zoomAt(view.W / 2, view.H / 2, 1 / 1.4); view.draw(); });
  $('zFit').addEventListener('click', () => { view.fit(); view.draw(); });
  root.addEventListener('resize', () => { view.resize(); view.draw(); });

  // ------------------------------------------------------------ terreno di prova
  // Solo per provare la pagina finché non c'è l'import (punto 2 del piano).
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
  view.resize(); view.fit();
  storage.loadAutosave().then(p => {
    if (p) setProject(p, 'Ripreso l\'ultimo progetto salvato nel browser');
    else { view.draw(); renderPanel(); syncInputs(); setStatus('Progetto vuoto'); }
  });
})(window);
