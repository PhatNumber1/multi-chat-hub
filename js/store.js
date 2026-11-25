(function () {
  'use strict';
  const KEY = 'mch.settings';
  function read() {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* keep defaults */ }
    return MCH.look.sanitize(raw);
  }
  MCH.settings = read();
  // A second open dock changed something: pick it up instead of overwriting it later.
  addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    Object.assign(MCH.settings, read());
    if (MCH.onSettings) MCH.onSettings();
  });
  MCH.saveSettings = function () {
    try { localStorage.setItem(KEY, JSON.stringify(MCH.settings)); } catch { /* storage unavailable */ }
  };

  // Sign-in tokens: AES-GCM in IndexedDB, under a key the browser will not export.
  // This stops casual reading, not malware running as you. The native plugin
  // stage moves tokens to Windows' own encryption (DPAPI).
  // If storage is unavailable, tokens stay in memory and last until OBS closes.
  const mem = new Map();
  let dbp;
  function db() {
    return dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('mch-secrets', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('kv', mode);
      const r = fn(t.objectStore('kv'));
      t.oncomplete = () => res(r.result);
      t.onerror = t.onabort = () => rej(t.error || r.error);
    });
  }
  async function key() {
    const k = await tx('readonly', (s) => s.get('key'));
    if (k) return k;
    const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    // add() fails if another dock created the key first; then theirs is used.
    try { await tx('readwrite', (s) => s.add(fresh, 'key')); return fresh; } catch { return tx('readonly', (s) => s.get('key')); }
  }
  MCH.secrets = {
    persistent: true,
    async get(name) {
      if (mem.has(name)) return mem.get(name);
      try {
        const rec = await tx('readonly', (s) => s.get('secret.' + name));
        if (!rec) return null;
        const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, await key(), rec.data);
        return JSON.parse(new TextDecoder().decode(raw));
      } catch { return null; }
    },
    async set(name, value) {
      try {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(JSON.stringify(value)));
        await tx('readwrite', (s) => s.put({ iv, data }, 'secret.' + name));
        mem.delete(name);
      } catch { this.persistent = false; mem.set(name, value); }
    },
    async del(name) {
      mem.delete(name);
      try { await tx('readwrite', (s) => s.delete('secret.' + name)); } catch { /* nothing stored */ }
    },
  };

  // Runs fn alone across every open dock, where the browser supports locks here.
  MCH.withLock = function (name, fn) {
    if (!navigator.locks) return fn();
    let ran = false;
    return navigator.locks.request(name, () => { ran = true; return fn(); })
      .catch((e) => { if (!ran) return fn(); throw e; });
  };
})();
