// Namespace condiviso. Script classici (non moduli ES) così la pagina funziona
// anche aperta da file:// e tramite htmlpreview.
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function hash3(seed, i, j, k) {
    let h = (seed | 0) ^ Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(k | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    h = Math.imul(h ^ (h >>> 15), 2246822519); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }

  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const fmtInt = x => Math.round(x).toLocaleString('it-IT');

  // Base64 per array tipizzati, sia nel browser sia in Node (test).
  function bytesToBase64(u8) {
    if (typeof Buffer !== 'undefined') return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function base64ToBytes(b64) {
    if (typeof Buffer !== 'undefined') { const b = Buffer.from(b64, 'base64'); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength).slice(); }
    const s = atob(b64), u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }

  CS2.util = { mulberry32, hash3, clamp, fmtInt, bytesToBase64, base64ToBytes };
})(typeof window !== 'undefined' ? window : globalThis);
