(function () {
  'use strict';
  // All chat text goes in through textContent, never as HTML.
  MCH.el = function (tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') n.className = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
      else if (k in n) n[k] = v;
      else n.setAttribute(k, v);
    }
    n.append(...kids.filter((x) => x != null));
    return n;
  };

  MCH.time12 = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  // "45", "30s", "5m", "2h", "1d" -> seconds. A bare number is minutes. Null when invalid.
  MCH.parseDuration = function (text) {
    const m = /^\s*(\d+)\s*([smhd]?)\s*$/i.exec(text || '');
    if (!m) return null;
    const secs = Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[(m[2] || 'm').toLowerCase()];
    return secs >= 1 && secs <= 1209600 ? secs : null; // Twitch's limit is two weeks
  };

  MCH.copy = async function (text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* blocked in some docks */ }
    const t = MCH.el('textarea', { value: text });
    document.body.append(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* leave ok false */ }
    t.remove();
    return ok;
  };

  MCH.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
})();
