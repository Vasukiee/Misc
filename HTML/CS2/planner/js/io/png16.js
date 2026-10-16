// Decoder PNG minimale che conserva i 16 bit (il canvas del browser li tronca a 8).
// Supporta: scala di grigi / grigi+alfa / RGB / RGBA, 8 o 16 bit, non interlacciato.
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};

  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

  async function inflate(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Il browser non supporta la decompressione necessaria per leggere i PNG.');
    const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  function paeth(a, b, c) {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }

  // Ritorna { width, height, channels, bitDepth, data } con data Uint16Array (valori 0..65535
  // se 16 bit, 0..255 se 8 bit), canali interlacciati.
  async function decode(buffer) {
    const u8 = new Uint8Array(buffer), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    for (let i = 0; i < 8; i++) if (u8[i] !== SIG[i]) throw new Error('Il file non è un PNG.');
    let off = 8, ihdr = null;
    const idat = [];
    while (off < u8.length) {
      const len = dv.getUint32(off), type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
      const body = u8.subarray(off + 8, off + 8 + len);
      if (type === 'IHDR') {
        ihdr = { width: dv.getUint32(off + 8), height: dv.getUint32(off + 12), bitDepth: body[8], colorType: body[9], interlace: body[12] };
      } else if (type === 'IDAT') idat.push(body);
      else if (type === 'IEND') break;
      off += 12 + len;
    }
    if (!ihdr) throw new Error('PNG senza intestazione.');
    const ch = CHANNELS[ihdr.colorType];
    if (!ch) throw new Error('Tipo di colore PNG non supportato (palette?). Esporta in scala di grigi a 16 bit.');
    if (ihdr.bitDepth !== 8 && ihdr.bitDepth !== 16) throw new Error('Profondità ' + ihdr.bitDepth + ' bit non supportata: usa 8 o 16 bit.');
    if (ihdr.interlace) throw new Error('PNG interlacciato non supportato: salvalo senza interlacciamento.');

    let total = 0; idat.forEach(c => total += c.length);
    const z = new Uint8Array(total); let p = 0; idat.forEach(c => { z.set(c, p); p += c.length; });
    const raw = await inflate(z);

    const { width: w, height: h, bitDepth: bd } = ihdr;
    const bpp = ch * bd / 8, stride = w * bpp;
    if (raw.length < h * (stride + 1)) throw new Error('PNG troncato o danneggiato.');
    const out = new Uint16Array(w * h * ch);
    let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
    for (let y = 0; y < h; y++) {
      const base = y * (stride + 1), f = raw[base];
      for (let x = 0; x < stride; x++) {
        const r = raw[base + 1 + x], a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
        let v;
        switch (f) {
          case 0: v = r; break;
          case 1: v = r + a; break;
          case 2: v = r + b; break;
          case 3: v = r + ((a + b) >> 1); break;
          case 4: v = r + paeth(a, b, c); break;
          default: throw new Error('Filtro PNG sconosciuto: ' + f);
        }
        cur[x] = v & 255;
      }
      const o = y * w * ch;
      if (bd === 16) for (let k = 0; k < w * ch; k++) out[o + k] = (cur[2 * k] << 8) | cur[2 * k + 1];
      else for (let k = 0; k < w * ch; k++) out[o + k] = cur[k];
      const t = prev; prev = cur; cur = t;
    }
    return { width: w, height: h, channels: ch, bitDepth: bd, data: out };
  }

  CS2.png16 = { decode };
})(typeof window !== 'undefined' ? window : globalThis);
