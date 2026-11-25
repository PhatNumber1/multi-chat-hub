(function () {
  'use strict';
  // Keeps watch on every connection: a light for each, a bar when one drops, and a short history.
  const { el } = MCH;
  const GRACE = 3000; // shorter drops are only written in the history
  const KEEP = 40;

  const STATE = { ok: ['ok', 'Connected'], reconnecting: ['wait', 'Reconnecting'], connecting: ['wait', 'Connecting'], error: ['bad', 'Needs attention'], off: ['off', 'Off'] };
  function lasted(ms) {
    const s = Math.max(1, Math.round(ms / 1000));
    if (s < 60) return s + (s === 1 ? ' second' : ' seconds');
    const m = Math.round(s / 60);
    if (m < 60) return m + (m === 1 ? ' minute' : ' minutes');
    const h = Math.floor(m / 60), r = m % 60;
    return h + (h === 1 ? ' hour' : ' hours') + (r ? ' ' + r + ' min' : '');
  }

  // No page parts in here, so it can be tested by itself.
  // feed() takes every connection as it is now: [{ id, name, state, note }]
  class Watch {
    constructor() { this.items = new Map(); this.history = []; }
    write(now, text, kind) { this.history.unshift({ at: now, text, kind }); this.history.length = Math.min(this.history.length, KEEP); }
    feed(list, now) {
      const good = [];
      for (const n of list) {
        const old = this.items.get(n.id);
        if (!old) {
          this.items.set(n.id, Object.assign({}, n, { since: now, everOk: n.state === 'ok', lostAt: 0, alerted: false, dismissed: false }));
          if (n.state === 'ok') this.write(now, n.name + ' connected', 'ok');
          continue;
        }
        const was = old.state;
        old.name = n.name;
        old.note = n.note;
        if (n.state === was) continue;
        old.state = n.state;
        if (n.state === 'ok') {
          const back = old.everOk && old.lostAt > 0, ms = now - old.lostAt;
          this.write(now, n.name + (back ? ' connected again after ' + lasted(ms) : ' connected'), 'ok');
          if (back && old.alerted) good.push(n.name + ' is connected again. It was down for ' + lasted(ms) + '.');
          else if (!back && n.announce) good.push(n.name + ' is connected.');
          Object.assign(old, { since: now, everOk: true, lostAt: 0, alerted: false, dismissed: false });
        } else if (n.state === 'off') {
          if (was === 'ok') this.write(now, n.name + ' turned off', 'off');
          Object.assign(old, { since: now, everOk: false, lostAt: 0, alerted: false, dismissed: false });
        } else {
          if (was === 'ok') { old.lostAt = old.since = now; this.write(now, n.name + ' disconnected', 'bad'); }
          if (n.state === 'error') { this.write(now, n.name + ': ' + n.note, 'bad'); old.dismissed = false; }
        }
      }
      for (const id of [...this.items.keys()]) if (!list.some((n) => n.id === id)) this.items.delete(id);
      return good;
    }
    // Connections that were working and are down now, longer than a blink.
    down(now) {
      const out = [];
      for (const i of this.items.values()) {
        if (!i.everOk || i.state === 'ok' || i.state === 'off' || now - i.lostAt < GRACE) continue;
        i.alerted = true;
        if (!i.dismissed) out.push(i);
      }
      return out;
    }
    dismiss() { for (const i of this.items.values()) if (i.alerted) i.dismissed = true; }
  }
  MCH.connWatch = { Watch, lasted };
  if (typeof document === 'undefined') return;

  const { openPage, openPanel, head, boxes, label } = MCH.app;
  const bar = document.getElementById('alert'), corner = document.getElementById('corner');
  const watch = new Watch();
  let goodTimer = null, demo = MCH.settings.demo;

  function snapshot() {
    const list = [];
    if (MCH.live) { const o = MCH.live.state(); list.push({ id: 'obs', name: 'OBS', state: o.state, note: o.note, announce: !demo }); }
    for (const a of boxes()) if (!a.link) list.push({ id: a.id, name: label(a) + ' (' + MCH.platforms.INFO[a.platform].name + ')', state: a.status, note: a.note });
    return list;
  }
  function check() {
    if (demo !== MCH.settings.demo) { demo = MCH.settings.demo; watch.items.clear(); }
    const good = watch.feed(snapshot(), Date.now());
    const down = watch.down(Date.now());
    if (down.length) {
      const text = down.map((i) => i.name + (i.state === 'error' ? ' stopped at ' + MCH.time12(i.lostAt) + ': ' + i.note : ' disconnected at ' + MCH.time12(i.lostAt) + '. Reconnecting')).join('. ') + '.';
      show(text, down.some((i) => i.state === 'error') ? 'bad' : 'wait');
    } else if (good.length) {
      show(good.join(' '), 'ok');
      clearTimeout(goodTimer);
      goodTimer = setTimeout(() => { if (bar.className === 'ok') hide(); }, 8000);
    } else if (!bar.hidden && bar.className !== 'ok') hide();
    paint();
  }
  function show(text, kind) {
    if (!bar.hidden && bar.dataset.text === text && bar.className === kind) return;
    bar.dataset.text = text;
    bar.className = kind;
    bar.replaceChildren(MCH.icon(kind), el('span', {}, text),
      kind === 'ok' ? '' : el('button', { type: 'button', on: { click: open } }, 'Details'),
      el('button', { type: 'button', 'aria-label': 'Hide this message', title: 'Hide this message', on: { click: () => { watch.dismiss(); hide(); } } }, '✕'));
    bar.hidden = false;
  }
  function hide() { bar.hidden = true; bar.dataset.text = ''; }

  /* ---------- lights and the Connections page ---------- */

  function words(i) {
    if (!i) return ['off', 'Off', ''];
    const [icon, text] = STATE[i.state] || STATE.off;
    if (i.state === 'ok') return [icon, /^Not live/.test(i.note) ? 'Ready' : 'Connected', (/^Connected( to OBS)?$/.test(i.note) ? '' : i.note.replace(/^Connected, r/, 'R').replace(/^Connected, b/, 'B') + '. ') + 'Since ' + MCH.time12(i.since)];
    if (i.state === 'off') return [icon, i.note || text, ''];
    return [icon, i.lostAt ? 'Disconnected at ' + MCH.time12(i.lostAt) : text, i.note];
  }
  // A light that keeps itself current while it is on screen.
  function light(id, name) {
    const n = el('div', { class: 'connLight' });
    n.dataset.conn = id;
    n.dataset.name = name || '';
    fill(n);
    return n;
  }
  function fill(n) {
    const i = watch.items.get(n.dataset.conn), [icon, big, small] = words(i);
    const key = [icon, big, small].join('|');
    if (n.dataset.key === key) return;
    n.dataset.key = key;
    n.className = 'connLight ' + icon;
    n.setAttribute('role', 'status');
    n.replaceChildren(icon === 'off' ? el('span', { class: 'dot' }) : MCH.icon(icon), el('span', {}, el('b', {}, (n.dataset.name ? n.dataset.name + ': ' : '') + big), small ? el('small', {}, small) : ''));
  }
  function paint() {
    for (const n of document.querySelectorAll('[data-conn]')) fill(n);
    const bad = [...watch.items.values()].find((i) => i.everOk && i.state !== 'ok' && i.state !== 'off');
    if (bad && !corner.className) { corner.className = bad.state === 'error' ? 'error' : 'reconnecting'; corner.title = 'Show everything (a connection needs attention)'; }
    const p = document.getElementById('connHistory');
    if (p && p.dataset.n !== String(watch.history.length && watch.history[0].at)) drawHistory(p);
  }
  function drawHistory(p) {
    p.dataset.n = String(watch.history.length && watch.history[0].at);
    p.replaceChildren(...(watch.history.length ? watch.history.map((h) => el('div', { class: 'histRow ' + h.kind }, el('time', {}, MCH.time12(h.at)), el('span', {}, h.text))) : [el('p', { class: 'dim' }, 'Nothing yet.')]));
  }
  function page() {
    const p = el('div', { id: 'connHistory', class: 'card' });
    drawHistory(p);
    return [head('Connections', MCH.icon('wait')), el('p', {}, 'Every light here is live. A bar also appears at the top of the dock when one drops.'),
      ...[...watch.items.values()].map((i) => el('button', { type: 'button', class: 'connRow', on: { click: () => (i.id === 'obs' ? openPanel('Go Live') : MCH.accounts.open(i.id)) } }, light(i.id, i.name))),
      el('h3', {}, 'What happened since the dock opened'), p];
  }
  function open() { check(); openPage(page); }

  MCH.conn = { check, light, open };
  check();
  setInterval(check, 1000);
})();
