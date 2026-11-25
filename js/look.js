(function () {
  'use strict';
  const HEX = /^#[0-9a-f]{6}$/i;
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  function lum(c) {
    const l = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  }
  // WCAG contrast ratio, 1 to 21.
  function contrast(a, b) {
    const x = lum(rgb(a)), y = lum(rgb(b));
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  // Moves a colour toward black or white only as far as needed to be readable on bg.
  function fit(color, bg, min) {
    if (contrast(color, bg) >= min) return color;
    const end = contrast('#ffffff', bg) >= contrast('#000000', bg) ? '#ffffff' : '#000000';
    for (let t = 0.05; t < 1; t += 0.05) {
      const c = hex(mix(rgb(color), rgb(end), t));
      if (contrast(c, bg) >= min) return c;
    }
    return end;
  }

  const defaults = {
    lookVersion: 2, twitchClientId: '', confirmBans: true, demo: false, clean: false, helpLook: false, obsAuto: '', obsPort: 4455, confirmLive: true,
    show: { viewers: true, total: true, live: true, mod: true, labels: true, timestamps: true, logos: true, badges: true, emotes: true, replies: true, modHighlight: true },
    cleanHide: { accounts: true, total: true, search: true, live: true, mod: true, gear: true, timestamps: false, logos: false, badges: false, replies: false },
    colors: { bg: '#1f2126', auto: true, text: '#f1f1f4', time: '#a5a6b1', mod: '#2ecc71', ownNames: false, names: { twitch: '#bf94ff', tiktok: '#4dd0e1', youtube: '#ff8a80', kick: '#7ee06a' }, stats: { viewers: '#ffffff', total: '#ffffff' } },
    font: 'Segoe UI', size: 14, themes: [], livePick: [], liveHidden: [], liveNames: {}, liveTags: {}, modLinks: [], modHidden: [], accounts: [],
  };
  // One entry per account box. Sign-ins and keys are never kept here.
  const account = { id: '', platform: '', channel: '', nick: '', on: true, chat: true, viewers: true, total: true, color: '', every: 10 };
  const fonts = ['Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Consolas', 'Comic Sans MS'];
  const platforms = { twitch: 'Twitch', tiktok: 'TikTok', youtube: 'YouTube', kick: 'Kick' };
  const kinds = [...Object.keys(platforms), 'instagram', 'facebook', 'rumble', 'trovo', 'x', 'other'];
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const obj = (v) => (v && typeof v === 'object' ? v : {});

  // Takes the known keys of `def`, keeping a saved value only when it is the right kind.
  function pick(def, saved) {
    const out = {};
    for (const [k, d] of Object.entries(def)) {
      const v = obj(saved)[k];
      if (typeof d === 'object') out[k] = pick(d, v);
      else if (typeof v !== typeof d) out[k] = d;
      else if (typeof d === 'string' && HEX.test(d)) out[k] = HEX.test(v) ? v.toLowerCase() : d;
      else out[k] = v;
    }
    return out;
  }
  const OLD = { bg: '#16171b', text: '#e8e9ec', time: '#9a9ea8' }; // defaults before 0.5.0
  const BOX = '#2b2d35'; // the box a stat number sits on
  function oneAccount(v) {
    const a = pick(account, v);
    if (!/^[\w-]{1,40}$/.test(a.id) || !kinds.includes(a.platform)) return null;
    if (!platforms[a.platform] && !/^https:\/\//i.test(a.channel)) return null;
    a.channel = a.channel.slice(0, 300);
    a.nick = a.nick.trim().slice(0, 40);
    if (!HEX.test(a.color)) a.color = '';
    a.every = Math.min(60, Math.max(5, Math.round(a.every) || account.every));
    return a;
  }
  // Saved settings can be old, partial or damaged; this always returns a complete set.
  function sanitize(saved) {
    const { themes, livePick, liveHidden, liveNames, liveTags, modLinks, modHidden, accounts, ...plain } = defaults;
    const s = pick(plain, saved);
    // Once, move colors nobody changed to the new defaults. Chosen colors stay.
    if (obj(saved).lookVersion !== 2) for (const [k, v] of Object.entries(OLD)) if (s.colors[k] === v) s.colors[k] = defaults.colors[k];
    s.lookVersion = 2;
    if (!fonts.includes(s.font)) s.font = defaults.font;
    s.size = Math.min(28, Math.max(10, Math.round(s.size) || defaults.size));
    s.obsPort = Number.isInteger(s.obsPort) && s.obsPort > 0 && s.obsPort < 65536 ? s.obsPort : defaults.obsPort;
    const raw = obj(saved);
    const names = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 100) : []);
    const texts = (v) => Object.fromEntries(Object.entries(Array.isArray(v) ? {} : obj(v)).filter(([, t]) => typeof t === 'string' && t.trim()).slice(0, 100).map(([k, t]) => [k, t.trim().slice(0, 40)]));
    Object.assign(s, { livePick: names(raw.livePick), liveHidden: names(raw.liveHidden), liveNames: texts(raw.liveNames), liveTags: texts(raw.liveTags), modHidden: names(raw.modHidden) });
    s.modLinks = (Array.isArray(raw.modLinks) ? raw.modLinks : []).filter((l) => l && typeof l.name === 'string' && l.name.trim() && typeof l.url === 'string' && /^https:\/\//i.test(l.url))
      .slice(0, 20).map((l) => ({ name: l.name.trim().slice(0, 40), url: l.url }));
    const ids = new Set();
    s.accounts = (Array.isArray(raw.accounts) ? raw.accounts : []).map(oneAccount).filter((a) => a && !ids.has(a.id) && ids.add(a.id)).slice(0, 40);
    const list = Array.isArray(obj(saved).themes) ? saved.themes : themes;
    s.themes = list.filter((t) => t && typeof t.name === 'string' && t.name.trim())
      .slice(0, 30).map((t) => ({ name: t.name.trim().slice(0, 40), colors: pick(defaults.colors, t.colors) }));
    return s;
  }

  // mine: the color picked for this one account, if any
  function nameColor(m, c, mine) {
    const own = c.ownNames && HEX.test(m.color || '') ? m.color : null;
    const base = own || (HEX.test(mine || '') ? mine : null) || c.names[m.account.platform] || c.text;
    return c.auto ? fit(base, c.bg, 4.5) : base;
  }
  function resolved(c) {
    if (!c.auto) return { bg: c.bg, text: c.text, time: c.time, mod: c.mod };
    return { bg: c.bg, text: fit(c.text, c.bg, 9), time: fit(c.time, c.bg, 4.5), mod: c.mod };
  }
  // Stat numbers are lightened until they are readable on their box.
  const statColor = (c, k) => fit(c.stats[k], BOX, 4.5);
  // What is on screen right now: a part must be on, and not hidden by clean mode.
  function visible(s) {
    const out = Object.assign({ accounts: true, search: true, gear: true }, s.show);
    if (s.clean) for (const [k, hide] of Object.entries(s.cleanHide)) if (hide) out[k] = false;
    return out;
  }

  MCH.look = { HEX, contrast, fit, defaults, fonts, platforms, sanitize, nameColor, statColor, oneAccount, resolved, visible, copy };
})();
