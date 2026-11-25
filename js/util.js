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

  // Simple rounded line drawings, all on a 24 by 24 grid.
  const ICONS = {
    eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    people: 'M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M9 3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM22 20v-1.5a4 4 0 0 0-3-3.9M15.5 3.7a3.5 3.5 0 0 1 0 6.6',
    stream: 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2',
    record: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    backtrack: 'M3 4v5h5M3.5 9a9 9 0 1 1-.4 4M12 8v4.5l3 2',
    virtual_cam: 'M4 6h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM15 10.5l6-3.5v10l-6-3.5',
    heart: 'M12 20.5 4.2 12.7a5 5 0 0 1 7.1-7l.7.7.7-.7a5 5 0 0 1 7.1 7z',
    chat: 'M21 11.5a8 8 0 0 1-8 8H4.5l1.7-3.3A8 8 0 1 1 21 11.5z',
    chatOff: 'M9 4.6A8 8 0 0 1 20 15.4M17.2 18.4a8 8 0 0 1-4.2 1.1H4.5l1.7-3.3A8 8 0 0 1 5.8 7.6M3 3l18 18',
    shield: 'M12 2.5 20 5.5v6c0 4.7-3.2 8.3-8 10-4.8-1.7-8-5.3-8-10v-6z',
    person: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4.5 21v-1a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5v1',
    link: 'M10 14a4 4 0 0 0 5.7 0l3.5-3.5a4 4 0 0 0-5.7-5.7L12 6.3M14 10a4 4 0 0 0-5.7 0l-3.5 3.5a4 4 0 0 0 5.7 5.7L12 17.7',
    plus: 'M12 5v14M5 12h14', up: 'M5 15l7-7 7 7', down: 'M5 9l7 7 7-7',
  };
  MCH.svg = function (box, cls, ...paths) {
    const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg');
    for (const [k, v] of Object.entries({ viewBox: box, class: cls, 'aria-hidden': 'true' })) s.setAttribute(k, v);
    for (const p of paths) {
      const n = document.createElementNS(ns, 'path');
      for (const [k, v] of Object.entries(p)) n.setAttribute(k, v);
      s.append(n);
    }
    return s;
  };
  MCH.icon = (name) => MCH.svg('0 0 24 24', 'ico', { d: ICONS[name] });
  const pen = { fill: 'none', stroke: '#fff', 'stroke-width': 20, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  MCH.brand = () => MCH.svg('0 0 256 256', 'brand', { d: 'M58 0h140a58 58 0 0 1 58 58v140a58 58 0 0 1-58 58H58a58 58 0 0 1-58-58V58A58 58 0 0 1 58 0z', fill: '#5B2FC4' },
    { d: 'M166 76a28 28 0 0 0-28-28H72a28 28 0 0 0-28 28v82l28-26', ...pen }, { d: 'M124 98h60a28 28 0 0 1 28 28v82l-28-26h-60a28 28 0 0 1-28-28v-28a28 28 0 0 1 28-28z', ...pen });

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
