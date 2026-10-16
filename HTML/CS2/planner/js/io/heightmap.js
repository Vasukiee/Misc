// Import della heightmap del gioco (PNG 4096×4096, 16 bit, scala di grigi) nello strato elevazione.
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};

  // img: risultato di png16.decode. opts.world: true se è la "mappa mondo" (solo il centro
  // 1/4 corrisponde all'area giocabile). opts.heightScale: metri coperti dai 16 bit.
  function applyToProject(project, img, opts) {
    const E = project.layers.elevation, n = E.res;
    const max = img.bitDepth === 16 ? 65535 : 255;
    const scale = opts.heightScale || project.map.heightScale;
    // regione sorgente in pixel
    let x0 = 0, y0 = 0, sw = img.width, sh = img.height;
    if (opts.world) { sw = img.width / 4; sh = img.height / 4; x0 = (img.width - sw) / 2; y0 = (img.height - sh) / 2; }
    const ch = img.channels, d = img.data;
    for (let j = 0; j < n; j++) {
      const ya = y0 + j * sh / n, yb = y0 + (j + 1) * sh / n;
      for (let i = 0; i < n; i++) {
        const xa = x0 + i * sw / n, xb = x0 + (i + 1) * sw / n;
        // media dei pixel sorgente coperti dal pixel di destinazione
        let s = 0, c = 0;
        for (let y = Math.floor(ya); y < Math.max(Math.floor(ya) + 1, Math.ceil(yb)); y++)
          for (let x = Math.floor(xa); x < Math.max(Math.floor(xa) + 1, Math.ceil(xb)); x++) {
            s += d[(Math.min(y, img.height - 1) * img.width + Math.min(x, img.width - 1)) * ch]; c++;
          }
        E.data[j * n + i] = s / c / max * scale;
      }
    }
    E.changed();
    project.map.heightScale = scale;
  }

  async function importFile(project, file, opts) {
    const img = await CS2.png16.decode(await file.arrayBuffer());
    const warn = [];
    if (img.bitDepth !== 16) warn.push('Il PNG è a 8 bit: l\'elevazione avrà solo 256 livelli (scalini).');
    if (img.width !== img.height) warn.push('L\'immagine non è quadrata (' + img.width + '×' + img.height + '): verrà stirata.');
    if (img.width !== 4096) warn.push('Il gioco usa 4096×4096; questa è ' + img.width + '×' + img.height + '.');
    if (img.channels > 2) warn.push('Immagine a colori: uso solo il canale rosso.');
    applyToProject(project, img, opts);
    project.sources.elevation = 'heightmap: ' + file.name;
    return { img, warn };
  }

  CS2.heightmap = { applyToProject, importFile };
})(typeof window !== 'undefined' ? window : globalThis);
