// Strato raster quadrato che copre tutta la mappa (u, v in [0,1], origine in alto a sinistra).
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};
  const { bytesToBase64, base64ToBytes, clamp } = CS2.util;

  const ARR = { f32: Float32Array, u8: Uint8Array };

  class Raster {
    constructor(res, kind, data) {
      this.res = res;
      this.kind = kind;
      this.data = data || new ARR[kind](res * res);
      this.version = 0;            // incrementato a ogni modifica (cache del render)
    }
    idx(i, j) { return j * this.res + i; }
    get(i, j) { return this.data[this.idx(clamp(i, 0, this.res - 1), clamp(j, 0, this.res - 1))]; }
    set(i, j, val) { this.data[this.idx(i, j)] = val; }
    // campionamento bilineare in coordinate normalizzate
    sample(u, v) {
      const n = this.res, x = clamp(u * n - 0.5, 0, n - 1), y = clamp(v * n - 0.5, 0, n - 1);
      const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
      const a = this.get(i, j), b = this.get(i + 1, j), c = this.get(i, j + 1), d = this.get(i + 1, j + 1);
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
    fill(val) { this.data.fill(val); this.version++; return this; }
    isUniform() { const d = this.data, v = d[0]; for (let k = 1; k < d.length; k++) if (d[k] !== v) return false; return true; }
    changed() { this.version++; }

    // serializzazione: f32 viene quantizzato a 16 bit su [0, scale] come la heightmap del gioco
    encode(scale) {
      if (this.isUniform()) return { res: this.res, kind: this.kind, uniform: this.data[0] };
      if (this.kind === 'f32') {
        const q = new Uint16Array(this.data.length);
        for (let k = 0; k < q.length; k++) q[k] = Math.round(clamp(this.data[k] / scale, 0, 1) * 65535);
        return { res: this.res, kind: 'f32', enc: 'u16', scale, b64: bytesToBase64(new Uint8Array(q.buffer)) };
      }
      return { res: this.res, kind: 'u8', enc: 'u8', b64: bytesToBase64(this.data) };
    }
    static decode(o) {
      const r = new Raster(o.res, o.kind);
      if (o.uniform !== undefined) { r.data.fill(o.uniform); return r; }
      const bytes = base64ToBytes(o.b64);
      if (o.enc === 'u16') {
        const q = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
        for (let k = 0; k < q.length; k++) r.data[k] = q[k] / 65535 * o.scale;
      } else r.data.set(bytes);
      return r;
    }
  }

  CS2.Raster = Raster;
})(typeof window !== 'undefined' ? window : globalThis);
