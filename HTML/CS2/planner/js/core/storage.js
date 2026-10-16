// Salvataggio: autosalvataggio nel browser (IndexedDB) + file .cs2plan da scaricare/aprire.
// Il file è JSON compresso gzip quando il browser lo supporta; in apertura si accettano entrambi.
(function (root) {
  'use strict';
  const CS2 = root.CS2 = root.CS2 || {};

  const DB = 'cs2-planner', STORE = 'projects', KEY = 'autosave';

  function openDb() {
    return new Promise((res, rej) => {
      if (!root.indexedDB) return rej(new Error('IndexedDB non disponibile'));
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function autosave(project) {
    try {
      const db = await openDb();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(JSON.stringify(project.toJSON()), KEY);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      return true;
    } catch (e) { return false; }   // finestra privata o storage bloccato: si continua senza
  }
  async function loadAutosave() {
    try {
      const db = await openDb();
      const txt = await new Promise((res, rej) => {
        const r = db.transaction(STORE).objectStore(STORE).get(KEY);
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      return txt ? CS2.Project.fromJSON(JSON.parse(txt)) : null;
    } catch (e) { return null; }
  }

  async function gzip(text) {
    if (typeof CompressionStream === 'undefined') return new Blob([text], { type: 'application/json' });
    const s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Blob([await new Response(s).arrayBuffer()], { type: 'application/gzip' });
  }
  async function readText(file) {
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (head[0] === 0x1f && head[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') throw new Error('Questo browser non sa decomprimere il file.');
      return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    }
    return file.text();
  }

  async function downloadProject(project) {
    const blob = await gzip(JSON.stringify(project.toJSON()));
    const safe = project.name.replace(/[^\w\-àèéìòù ]+/gi, '').trim().replace(/\s+/g, '_') || 'citta';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safe + '.cs2plan';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function openProjectFile(file) {
    return CS2.Project.fromJSON(JSON.parse(await readText(file)));
  }

  CS2.storage = { autosave, loadAutosave, downloadProject, openProjectFile };
})(typeof window !== 'undefined' ? window : globalThis);
