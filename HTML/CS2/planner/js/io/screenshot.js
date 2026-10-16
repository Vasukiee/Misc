// Lettura delle risorse da uno screenshot delle viste del gioco.
// 1) l'utente indica i 4 angoli dell'area giocabile nello screenshot (NO, NE, SE, SO);
// 2) per ogni strato campiona uno o più colori; 3) ogni pixel dello strato viene
//    rimappato sullo screenshot e confrontato con i colori campionati.
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};

  // Omografia che porta (u,v) del quadrato unitario nei 4 punti dati (ordine NO, NE, SE, SO).
  function homography(pts) {
    const src = [[0, 0], [1, 0], [1, 1], [0, 1]], A = [], b = [];
    for (let k = 0; k < 4; k++) {
      const [u, v] = src[k], { x, y } = pts[k];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
    }
    // eliminazione di Gauss con pivot parziale
    for (let c = 0; c < 8; c++) {
      let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12) throw new Error('Angoli non validi (allineati o coincidenti).');
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const h = b.map((v, i) => v / A[i][i]);
    return (u, v) => {
      const w = h[6] * u + h[7] * v + 1;
      return { x: (h[0] * u + h[1] * v + h[2]) / w, y: (h[3] * u + h[4] * v + h[5]) / w };
    };
  }

  // intensità 0..255 per ogni pixel dello strato
  function classify(imgData, corners, res, samples, tol) {
    const H = homography(corners), out = new Uint8Array(res * res), { width: W, height: Hh, data } = imgData;
    if (!samples.length) return out;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const p = H((i + 0.5) / res, (j + 0.5) / res), x = Math.round(p.x), y = Math.round(p.y);
      if (x < 0 || y < 0 || x >= W || y >= Hh) continue;
      const k = (y * W + x) * 4, r = data[k], g = data[k + 1], bl = data[k + 2];
      let best = Infinity;
      for (const s of samples) { const d = Math.hypot(r - s.r, g - s.g, bl - s.b); if (d < best) best = d; }
      if (best < tol) out[j * res + i] = Math.round(255 * (1 - best / tol));
    }
    return out;
  }

  // scrive nello strato: 'replace' sostituisce, 'max' unisce tenendo il valore più alto
  function applyToLayer(layer, values, mode) {
    if (mode === 'replace') layer.data.set(values);
    else for (let k = 0; k < values.length; k++) if (values[k] > layer.data[k]) layer.data[k] = values[k];
    layer.changed();
  }

  CS2.screenshot = { homography, classify, applyToLayer };
})(typeof window !== 'undefined' ? window : globalThis);
