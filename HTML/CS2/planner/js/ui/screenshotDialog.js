// Finestra "Importa screenshot": angoli → campionamento colori → applica a uno strato.
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};
  const $ = id => document.getElementById(id);
  const CORNER_NAMES = ['NO', 'NE', 'SE', 'SO'];

  function setup(app) {
    const dlg = $('shotDlg'), cv = $('shotCanvas'), ctx = cv.getContext('2d');
    let img = null, full = null, corners = [], samples = [], scale = 1;
    const targets = ['fertile', 'forest', 'ore', 'oil', 'groundwater', 'water'];
    const sel = $('shotLayer');
    sel.innerHTML = targets.map(k => '<option value="' + k + '">' + CS2.project.LAYERS[k].label + '</option>').join('');

    function open(file) {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        img = im; corners = []; samples = [];
        const off = document.createElement('canvas'); off.width = im.naturalWidth; off.height = im.naturalHeight;
        const g = off.getContext('2d'); g.drawImage(im, 0, 0);
        full = g.getImageData(0, 0, off.width, off.height);
        $('shotName').textContent = file.name + ' · ' + off.width + '×' + off.height;
        if (!dlg.open) dlg.showModal();
        layout(); update();
        URL.revokeObjectURL(url);
      };
      im.onerror = () => alert('Impossibile leggere l\'immagine.');
      im.src = url;
    }
    function layout() {
      const maxW = Math.min(root.innerWidth - 380, 1100), maxH = root.innerHeight - 140;
      scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
      cv.width = Math.round(img.naturalWidth * scale); cv.height = Math.round(img.naturalHeight * scale);
    }
    function sampleAt(x, y) {
      const k = (Math.round(y) * full.width + Math.round(x)) * 4;
      // media 3×3 per evitare pixel di rumore
      let r = 0, g = 0, b = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
        if (xx < 0 || yy < 0 || xx >= full.width || yy >= full.height) continue;
        const q = (yy * full.width + xx) * 4; r += full.data[q]; g += full.data[q + 1]; b += full.data[q + 2]; c++;
      }
      return c ? { r: r / c, g: g / c, b: b / c } : { r: full.data[k], g: full.data[k + 1], b: full.data[k + 2] };
    }

    function update() {
      if (!img) return;
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const tol = +$('shotTol').value;
      if ($('shotPreview').checked && corners.length === 4 && samples.length) {
        const im = ctx.getImageData(0, 0, cv.width, cv.height), d = im.data;
        for (let k = 0; k < d.length; k += 4) {
          let best = Infinity;
          for (const s of samples) { const dd = Math.hypot(d[k] - s.r, d[k + 1] - s.g, d[k + 2] - s.b); if (dd < best) best = dd; }
          if (best < tol) { d[k] = 255; d[k + 1] = 40; d[k + 2] = 200; }
          else { d[k] *= 0.45; d[k + 1] *= 0.45; d[k + 2] *= 0.45; }
        }
        ctx.putImageData(im, 0, 0);
      }
      if (corners.length) {
        ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 2; ctx.beginPath();
        corners.forEach((p, i) => i ? ctx.lineTo(p.x * scale, p.y * scale) : ctx.moveTo(p.x * scale, p.y * scale));
        if (corners.length === 4) ctx.closePath();
        ctx.stroke();
        corners.forEach((p, i) => {
          ctx.fillStyle = '#ffd36b'; ctx.beginPath(); ctx.arc(p.x * scale, p.y * scale, 5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#000'; ctx.font = 'bold 11px monospace'; ctx.fillText(CORNER_NAMES[i], p.x * scale + 8, p.y * scale - 6);
        });
      }
      const step = corners.length < 4 ? 'Clicca l\'angolo <b>' + CORNER_NAMES[corners.length] + '</b> dell\'area giocabile (' + (corners.length + 1) + '/4)'
        : 'Clicca nell\'immagine sul colore della risorsa scelta. Puoi aggiungere più colori.';
      $('shotStep').innerHTML = step;
      $('shotSamples').innerHTML = samples.map((s, i) => '<button class="swatch" title="Rimuovi" data-i="' + i + '" style="background:rgb(' + [s.r, s.g, s.b].map(Math.round).join(',') + ')"></button>').join('') || '<span class="muted">nessun colore</span>';
      $('shotSamples').querySelectorAll('.swatch').forEach(b => b.addEventListener('click', () => { samples.splice(+b.dataset.i, 1); update(); }));
      $('shotTolV').textContent = tol;
      $('shotApply').disabled = corners.length < 4 || !samples.length;
    }

    cv.addEventListener('click', e => {
      if (!img) return;
      const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
      if (corners.length < 4) corners.push({ x, y });
      else samples.push(sampleAt(x, y));
      update();
    });
    $('shotReset').addEventListener('click', () => { corners = []; update(); });
    $('shotClear').addEventListener('click', () => { samples = []; update(); });
    $('shotTol').addEventListener('input', update);
    $('shotPreview').addEventListener('change', update);
    sel.addEventListener('change', () => { samples = []; update(); });
    $('shotApply').addEventListener('click', () => {
      const key = sel.value, p = app.project, L = p.layers[key];
      const vals = CS2.screenshot.classify(full, corners, L.res, samples, +$('shotTol').value);
      const before = L.data.slice();
      CS2.screenshot.applyToLayer(L, vals, $('shotMode').value);
      app.history.recordWhole(p, key, 'Import screenshot', before);
      p.sources[key] = 'screenshot';
      let hits = 0; for (let k = 0; k < vals.length; k++) if (vals[k]) hits++;
      app.changed();
      $('shotResult').textContent = CS2.project.LAYERS[key].label + ': ' + (100 * hits / vals.length).toFixed(1) + '% della mappa. Scegli un altro strato o chiudi.';
      samples = []; update();
    });
    $('shotClose').addEventListener('click', () => dlg.close());
    root.addEventListener('resize', () => { if (dlg.open && img) { layout(); update(); } });
    return { open };
  }

  CS2.screenshotDialog = { setup };
})(typeof window !== 'undefined' ? window : globalThis);
