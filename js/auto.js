(function () {
  'use strict';
  // Opens the OBS connection the installer saved. connect.js is locked; the key is in this
  // dock's own address, which only OBS knows. Without both, this does nothing.
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const hex = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));
  const text = (t) => new TextEncoder().encode(t);
  async function mac(key, data) {
    const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
  }
  // Returns { id, port, password }, or null when the key does not fit or anything was changed.
  async function unlock(keyHex, saved) {
    try {
      const key = hex(keyHex), both = bytes(saved.box), tag = bytes(saved.tag);
      const k = await crypto.subtle.importKey('raw', await mac(key, text('check')), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
      if (!await crypto.subtle.verify('HMAC', k, tag, both)) return null;
      const aes = await crypto.subtle.importKey('raw', await mac(key, text('lock')), 'AES-CBC', false, ['decrypt']);
      const o = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: both.slice(0, 16) }, aes, both.slice(16))));
      if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535 || typeof o.password !== 'string') return null;
      return { id: saved.tag, port: o.port, password: o.password };
    } catch { return null; }
  }
  MCH.unlockConnect = unlock;
  if (typeof document === 'undefined') return;

  const m = /[#&]k=([0-9a-f]{64})\b/.exec(location.hash);
  function load() {
    return new Promise((res) => {
      const s = document.createElement('script');
      s.src = 'connect.js';
      s.onload = s.onerror = () => { s.remove(); const v = window.MCH_CONNECT; delete window.MCH_CONNECT; res(v && typeof v.box === 'string' && typeof v.tag === 'string' ? v : null); };
      document.head.append(s);
    });
  }
  MCH.auto = {
    has: !!m,
    // Each saved connection is used once, so Forget password and typed changes stick.
    async use() {
      if (!m) return false;
      const saved = await load();
      if (!saved || saved.tag === MCH.settings.obsAuto) return false;
      const o = await unlock(m[1], saved);
      if (!o) return false;
      await MCH.secrets.set('obs', o.password);
      MCH.settings.obsPort = o.port;
      MCH.settings.obsAuto = o.id;
      MCH.saveSettings();
      return true;
    },
  };
})();
