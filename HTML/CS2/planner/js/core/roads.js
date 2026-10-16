// Tipi di strada CS2 (larghezze base verificate: 8/16/24/32/40 m) e distanze tra assi.
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};

  const CELL = 8;              // m per cella di zona
  const ZONE_DEPTH = 6;        // celle per lato

  const ROAD_TYPES = {
    alley:  { w: 8,  label: 'Vicolo / sterrata', zoning: true },
    small:  { w: 16, label: 'Piccola 2 corsie',  zoning: true },
    medium: { w: 24, label: 'Media 4 corsie',    zoning: true },
    large:  { w: 32, label: 'Grande 6 corsie',   zoning: true },
    xl:     { w: 40, label: 'Viale 8 corsie',    zoning: true },
    highway:{ w: 46, label: 'Autostrada',        zoning: false }
  };

  // distanza tra gli assi di due strade parallele con lotti pieni (depth celle per lato)
  function ctc(a, b, depth) {
    const d = (depth === undefined ? ZONE_DEPTH : depth) * CELL * 2;
    return d + ROAD_TYPES[a].w / 2 + ROAD_TYPES[b].w / 2;
  }

  CS2.roads = { CELL, ZONE_DEPTH, ROAD_TYPES, ctc };
})(typeof window !== 'undefined' ? window : globalThis);
