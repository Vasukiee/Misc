// Export: heightmap PNG 16 bit per l'editor del gioco, immagine guida in scala, piano in JSON.
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};

  // ------------------------------------------------------------ PNG 16 bit in scala di grigi
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function chunk(type, body) {
    const out = new Uint8Array(12 + body.length), dv = new DataView(out.buffer);
    dv.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  }
  async function deflate(u8) {
    const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function encodePNG16(w, h, values) {
    const stride = w * 2, raw = new Uint8Array(h * (stride + 1));
    for (let y = 0; y < h; y++) {
      const o = y * (stride + 1);
      raw[o] = 1;                                         // filtro "Sub": comprime bene i terreni lisci
      let pHi = 0, pLo = 0;
      for (let x = 0; x < w; x++) {
        const v = values[y * w + x], hi = v >> 8, lo = v & 255;
        raw[o + 1 + 2 * x] = (hi - pHi) & 255; raw[o + 2 + 2 * x] = (lo - pLo) & 255;
        pHi = hi; pLo = lo;
      }
    }
    const ih = new Uint8Array(13), dv = new DataView(ih.buffer);
    dv.setUint32(0, w); dv.setUint32(4, h); ih[8] = 16; ih[9] = 0;     // 16 bit, scala di grigi
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))];
    return new Blob(parts, { type: 'image/png' });
  }

  // valori a 16 bit della heightmap da esportare. Se è disponibile l'originale ad alta
  // risoluzione, si parte da quello e si aggiungono solo le modifiche fatte nel pianificatore.
  function heightValues(project, N) {
    const E = project.layers.elevation, scale = project.map.heightScale, hr = project.hires;
    const out = new Uint16Array(N * N);
    const useHi = hr && hr.data && hr.base && hr.scale === scale;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N, v = (j + 0.5) / N;
      let h = E.sample(u, v);
      if (useHi) {
        const x = Math.min(hr.w - 1, Math.max(0, u * hr.w - 0.5)), y = Math.min(hr.h - 1, Math.max(0, v * hr.h - 0.5));
        const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(hr.w - 1, x0 + 1), y1 = Math.min(hr.h - 1, y0 + 1), fx = x - x0, fy = y - y0, d = hr.data;
        const orig = ((d[y0 * hr.w + x0] * (1 - fx) + d[y0 * hr.w + x1] * fx) * (1 - fy) + (d[y1 * hr.w + x0] * (1 - fx) + d[y1 * hr.w + x1] * fx) * fy) / 65535 * scale;
        let dlt = h - hr.base.sample(u, v);                // modifiche fatte nel pianificatore
        if (Math.abs(dlt) <= 1.01 * scale / 65535) dlt = 0; // sotto la precisione a 16 bit del salvataggio: non è una modifica
        h = orig + dlt;
      }
      out[j * N + i] = Math.round(Math.max(0, Math.min(1, h / scale)) * 65535);
    }
    return { values: out, usedHires: !!useHi };
  }
  async function heightmapPNG(project, N) {
    const { values, usedHires } = heightValues(project, N || 4096);
    return { blob: await encodePNG16(N || 4096, N || 4096, values), usedHires };
  }

  // ------------------------------------------------------------ immagine guida
  // opts: { size, transparent }
  function guideImage(view, opts) {
    const size = opts.size || 2048, cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const v = new CS2.MapView(cv, view.getProject);
    v.show = Object.assign({}, view.show);
    v.analysis = view.analysis; v.modules = view.modules; v.maxPhase = view.maxPhase;
    v.W = size; v.H = size; v.dpr = 1;
    v.cam = { x: 0, y: 0, s: size / view.getProject().map.size };
    v.transparent = !!opts.transparent;
    v.draw();
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }

  // ------------------------------------------------------------ piano in JSON leggibile
  function planJSON(project, modules) {
    const G = CS2.graph, R = CS2.roads.ROAD_TYPES;
    const round = x => Math.round(x * 10) / 10;
    return {
      formato: 'cs2-planner-piano', versione: 1, nome: project.name, creato: new Date().toISOString(),
      mappa: { lato_m: project.map.size, livello_mare_m: project.map.seaLevel, vento_da_gradi: project.wind.from },
      nodi: project.graph.nodes.map(n => ({ id: n.id, x: round(n.x), y: round(n.y), quota_m: round(project.elevationAt(n.x, n.y)) })),
      strade: project.graph.edges.map(e => ({
        id: e.id, da: e.a, a: e.b, tipo: e.type, nome_tipo: R[e.type].label, larghezza_m: R[e.type].w,
        lunghezza_m: round(G.edgeLength(project, e)), curva: G.isCurve(e) ? { c1: [round(e.c1.x), round(e.c1.y)], c2: [round(e.c2.x), round(e.c2.y)] } : null,
        fase: modules && modules.growth && modules.growth.edgePhase.has(e.id) ? modules.growth.edgePhase.get(e.id) : null
      })),
      moduli: modules ? modules.faces.map(f => {
        const q = CS2.modules.interiorPoint(f), ha = n => round(n * 64 / 10000);
        return { tipo: f.type, fase: f.phase, centro: [round(q.x), round(q.y)], superficie_ha: ha(f.stats.cells), zonabile_ha: ha(f.stats.zone), interno_ha: ha(f.stats.interior), conflitto_ha: ha(f.stats.conflict), avvisi: f.warnings.filter(w => w[0] !== 'good').map(w => w[1]) };
      }) : [],
      fasi: modules && modules.growth ? modules.growth.rows.map(r => ({ fase: r.phase, moduli: r.modules, zonabile_ha: round(r.zone), abitanti_stima: Math.round(r.cumRes), lavoro_stima: Math.round(r.cumJobs), strade_km: Object.fromEntries(Object.entries(r.km).map(([k, v]) => [k, round(v)])) })) : []
    };
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  CS2.exporter = { crc32, encodePNG16, heightValues, heightmapPNG, guideImage, planJSON, download };
})(typeof window !== 'undefined' ? window : globalThis);
