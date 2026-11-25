(function () {
  'use strict';
  const { el, settings } = MCH;
  const { ask, toast, form, openPanel, renderPanel, logo, section } = MCH.app;
  const { KINDS, Outputs, ObsClient, DemoObs, platformOf, startOrder, stopOrder } = MCH.obs;
  const bar = document.getElementById('live'), drawer = document.getElementById('outputs');
  const BADGE = { youtube: ['YT', '#d32020'], instagram: ['IG', '#b5307f'], facebook: ['FB', '#1464cc'], kick: ['K', '#1f7a1f'], trovo: ['TR', '#14785a'], x: ['X', '#444a52'] };
  let client = null, outs = null, open = false, run = 0, hasPassword = false, polling = false, again = false;
  const busy = new Map(); // output id -> 'Starting…' or 'Stopping…'

  const label = (o) => settings.liveNames[o.id] || o.name;
  const shown = () => (outs ? outs.list.filter((o) => !settings.liveHidden.includes(o.id)) : []);
  const ready = () => !!client && client.state === 'ok' && !!outs && outs.list.length > 0;
  const clock = (ms) => {
    const s = Math.floor(ms / 1000), p = (n) => String(n).padStart(2, '0');
    return Math.floor(s / 3600) + ':' + p(Math.floor(s / 60) % 60) + ':' + p(s % 60);
  };
  function icon(o) {
    const p = platformOf(label(o));
    if (p === 'twitch' || p === 'tiktok') return logo(p);
    const [t, c] = BADGE[p] || { stream: ['LIVE', '#5b3bb0'], record: ['REC', '#a1242f'], backtrack: ['BT', '#1d55b8'], virtual_cam: ['CAM', '#8a5a00'] }[o.kind];
    const b = el('span', { class: 'pf', 'aria-hidden': 'true' }, t);
    b.style.background = c;
    return b;
  }
  const button = (text, cls, fn, title) => el('button', { type: 'button', class: cls, title: title || '', on: { click: fn } }, text);

  /* ---------- actions ---------- */

  async function drive(o, want) {
    if (busy.has(o.id)) return false;
    const mine = outs;
    busy.set(o.id, want ? 'Starting…' : 'Stopping…');
    draw();
    try { await mine.drive(o, want); return true; } catch (e) {
      if (mine === outs) toast(label(o) + ': ' + e.message + '.');
      return false;
    } finally { busy.delete(o.id); if (mine === outs) draw(); }
  }
  async function toggle(o) {
    if (busy.has(o.id)) return;
    const want = !o.active;
    if (o.kind === 'stream' && settings.confirmLive) {
      if (!await ask(want ? 'Go live on ' + label(o) + '?' : 'End the stream on ' + label(o) + '?', want ? 'Go live' : 'End stream')) return;
    }
    const now = outs && outs.find(o.id);
    if (now && now.active !== want) drive(now, want);
  }
  let starting = 0; // a newer start, or any stop, cancels what is left of an older start
  async function startMany(list) {
    const mine = ++starting;
    for (const o of startOrder(list)) {
      if (mine !== starting) return;
      const now = outs && outs.find(o.id);
      if (!now || now.active || now.off || busy.has(o.id)) continue;
      const ok = await drive(now, true);
      if (!ok && mine === starting && o.id === 'main:stream') { toast('Main stream did not start, so nothing else was started.'); return; }
    }
  }
  async function stopMany(list) {
    starting++;
    for (const o of stopOrder(list)) {
      // One still starting cannot be stopped yet, so wait for it to settle first.
      for (let i = 0; i < 100 && busy.has(o.id); i++) await MCH.sleep(250);
      const now = outs && outs.find(o.id);
      if (now && now.active && !busy.has(o.id)) await drive(now, false);
    }
  }
  async function goLive() {
    const streams = shown().filter((o) => o.kind === 'stream');
    const picked = settings.livePick.length ? settings.livePick : ['main:stream'];
    const v = await form('Go live on', streams.map((o) => ({ key: o.id, label: label(o) + (o.active ? ' (already live)' : ''), type: 'check', value: o.active || picked.includes(o.id), disabled: o.active })), 'Go live');
    if (!v) return;
    const list = streams.filter((o) => v[o.id]);
    if (!list.length) { toast('Nothing was ticked, so nothing was started.'); return; }
    settings.livePick = list.map((o) => o.id);
    MCH.saveSettings();
    startMany(list);
  }
  async function endStream() {
    const on = outs.list.filter((o) => o.kind === 'stream' && (o.active || busy.has(o.id))); // hidden ones too
    if (!on.length) return;
    if (settings.confirmLive && !await ask('End the stream on ' + on.map(label).join(', ') + '?', 'End stream')) return;
    stopMany(on);
  }
  async function startAll(kind) {
    const list = shown().filter((o) => !kind || o.kind === kind);
    const cam = list.find((o) => o.kind === 'virtual_cam'); // only one can run
    const pick = list.filter((o) => !o.active && !o.off && (o.kind !== 'virtual_cam' || o === cam));
    if (!pick.length) { toast('Nothing left to start.'); return; }
    if (await ask('Start ' + pick.map(label).join(', ') + '?', 'Start')) startMany(pick);
  }
  async function stopAll() {
    const on = outs.list.filter((o) => o.active || busy.has(o.id));
    if (!on.length) { toast('Nothing is running.'); return; }
    if (await ask('Stop ' + on.map(label).join(', ') + '?', 'Stop all')) stopMany(on);
  }
  async function quick(fn, done) {
    try { await fn(); toast(done); } catch (e) { toast('Not done: ' + e.message); }
    poll();
  }

  /* ---------- drawing ---------- */

  function chip(o) {
    const b = busy.get(o.id);
    const state = b || (o.active ? (o.reconnecting ? 'Reconnecting' : 'Live') : 'Off');
    return el('button', { type: 'button', class: 'chip' + (o.active ? ' on' : '') + (o.reconnecting ? ' warnOn' : ''), disabled: !!b || !!(o.off && !o.active), title: label(o) + ': ' + (o.off && !o.active ? o.off : state) + (b ? '' : o.active ? '. Click to end.' : '. Click to go live.'), on: { click: () => toggle(o) } },
      icon(o), el('span', { class: 'chipName' }, label(o).replace(/ output$/i, '') || label(o)), el('span', { class: 'sr' }, state));
  }
  function row(o) {
    const b = busy.get(o.id), tag = settings.liveTags[o.id] || (o.main ? 'Main canvas' : '');
    const kids = [];
    if (o.active && !b) {
      if (o.kind === 'backtrack') kids.push(button('Save clip', '', () => quick(() => outs.saveClip(o), 'Clip saved')));
      if (o.kind === 'record') {
        if (o.main) kids.push(button(o.paused ? 'Resume' : 'Pause', '', () => quick(() => outs.pause(), o.paused ? 'Recording resumed' : 'Recording paused')));
        kids.push(button('Chapter', '', () => quick(() => outs.chapter(o), 'Chapter added'), 'Add a chapter marker'),
          button('Split', '', () => quick(() => outs.split(o), 'Split requested'), 'Start a new file'));
      }
    }
    const main = button(b || (o.active ? 'Stop' : 'Start'), 'go' + (o.active ? ' danger' : ''), () => toggle(o));
    main.disabled = !!b || !!(o.off && !o.active);
    main.setAttribute('aria-label', (o.active ? 'Stop ' : 'Start ') + label(o));
    const state = o.active ? (o.paused ? 'Paused ' : o.reconnecting ? 'Reconnecting ' : '') + clock(o.ms) : o.off || '';
    return el('div', { class: 'outRow' + (o.active ? ' on' : '') }, icon(o),
      el('div', { class: 'outName' }, el('span', {}, label(o)), el('small', {}, [tag, state].filter(Boolean).join(' · '))), ...kids, main);
  }
  function drawDrawer() {
    drawer.hidden = !open || !ready() || bar.hidden;
    if (drawer.hidden) return;
    const at = drawer.scrollTop, focus = document.activeElement && drawer.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
    const kids = [];
    for (const [kind, title] of Object.entries(KINDS)) {
      const list = shown().filter((o) => o.kind === kind);
      if (list.length) kids.push(el('h4', {}, title), ...list.map(row));
    }
    kids.push(el('h4', {}, 'All at once'), el('div', { class: 'allRow' },
      button('Start all streams', '', () => startAll('stream')), button('Start all recordings', '', () => startAll('record')),
      button('Start everything', '', () => startAll()), button('Stop everything', 'danger', stopAll)));
    if (outs.hasSuite === false) kids.push(el('p', { class: 'dim' }, 'Aitum Stream Suite was not found, so only OBS’s own outputs are listed.'));
    drawer.replaceChildren(...kids);
    drawer.scrollTop = at;
    if (focus) { const f = [...drawer.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === focus); if (f) f.focus(); }
  }
  let lastDraw = '';
  function draw(force) {
    // Skip identical redraws so a click is never lost to a rebuild.
    const key = JSON.stringify([client && client.state, client && client.note, open, hasPassword, outs && outs.list.map((o) => [o.id, o.active, o.off, o.reconnecting, o.paused]), [...busy], settings.liveHidden, settings.liveNames, settings.liveTags, outs && outs.hasSuite]);
    if (key !== lastDraw || force) {
      lastDraw = key;
      if (!client) {
        bar.replaceChildren(button('Set up Go Live', '', () => openPanel('Go Live'), 'Connect to OBS'));
      } else if (!ready()) {
        bar.replaceChildren(el('span', { class: 'dot ' + (client.state === 'error' ? 'error' : 'reconnecting') }), el('span', { class: 'dim' }, client.state === 'ok' ? 'Reading outputs…' : client.note), button('Settings', '', () => openPanel('Go Live')));
      } else {
        const on = outs.list.some((o) => o.kind === 'stream' && o.active), working = outs.list.some((o) => o.kind === 'stream' && busy.has(o.id));
        const main = button('', 'goLive' + (on ? ' on' : ''), on ? endStream : goLive, on ? 'End every running stream' : 'Choose where to go live');
        main.append(el('span', {}, on ? 'End stream' : working ? 'Working…' : 'Go Live'), el('b', { id: 'liveTime' }));
        main.disabled = working && !on; // ending is always possible
        const more = button(open ? '▴' : '▾', 'more', () => { open = !open; draw(true); }, 'All outputs');
        more.setAttribute('aria-expanded', String(open));
        more.setAttribute('aria-label', 'All outputs');
        const extra = outs.list.filter((o) => o.kind !== 'stream' && o.active).map((o) => el('span', { class: 'tiny', title: label(o) + ' is running' }, icon(o)));
        bar.replaceChildren(main, ...shown().filter((o) => o.kind === 'stream').map(chip), ...extra, client.demo ? el('span', { class: 'dim' }, 'Demo') : '', more);
      }
      drawDrawer();
    } else if (open && ready()) {
      // Only the clocks changed.
      const rows = [...drawer.querySelectorAll('.outRow small')];
      let i = 0;
      for (const kind of Object.keys(KINDS)) for (const o of shown().filter((x) => x.kind === kind)) {
        const tag = settings.liveTags[o.id] || (o.main ? 'Main canvas' : ''), s = rows[i++];
        if (s && o.active) s.textContent = [tag, (o.paused ? 'Paused ' : o.reconnecting ? 'Reconnecting ' : '') + clock(o.ms)].filter(Boolean).join(' · ');
      }
    }
    const t = document.getElementById('liveTime');
    if (t && outs) { const ms = Math.max(0, ...outs.list.filter((o) => o.kind === 'stream' && o.active).map((o) => o.ms)); t.textContent = ms ? clock(ms) : ''; }
  }

  async function poll() {
    if (!outs || client.state !== 'ok') return;
    if (polling) { again = true; return; }
    polling = true;
    const mine = outs;
    try { await mine.refresh(); } catch { /* the next poll tries again */ }
    polling = false;
    if (mine === outs) draw();
    if (again) { again = false; poll(); }
  }

  async function start() {
    const id = ++run;
    if (client) client.stop();
    client = outs = null;
    busy.clear();
    const password = await MCH.secrets.get('obs');
    if (id !== run) return;
    hasPassword = password != null;
    const onState = () => { if (id === run) { draw(); poll(); } };
    const onEvent = () => { if (id === run) poll(); };
    if (settings.demo) client = new DemoObs(onState, onEvent);
    else if (hasPassword) client = new ObsClient(settings.obsPort, password, onState, onEvent);
    if (client) { outs = new Outputs(client); client.start(); }
    draw(true);
  }

  /* ---------- settings ---------- */

  function settingsSection() {
    const kids = [el('p', { class: 'dim' }, 'In OBS: Tools > WebSocket Server Settings > Show Connect Info. Copy the Server Password and paste it here. It is kept encrypted on this PC and only used to reach OBS on this PC.')];
    const pass = el('input', { type: 'password', placeholder: hasPassword ? 'Saved. Paste to replace' : 'Server Password', autocomplete: 'off', 'aria-label': 'OBS WebSocket password' });
    const port = el('input', { type: 'text', value: String(settings.obsPort), 'aria-label': 'OBS WebSocket port' });
    const save = async () => {
      const n = Number(port.value.trim());
      if (!Number.isInteger(n) || n < 1 || n > 65535) { toast('The port must be a number. OBS uses 4455.'); return; }
      settings.obsPort = n;
      MCH.saveSettings();
      if (pass.value || !hasPassword) await MCH.secrets.set('obs', pass.value.trim());
      await start();
      renderPanel();
      toast('Connecting to OBS');
    };
    kids.push(pass, el('label', {}, 'Port', port), el('div', { class: 'row left' }, button(hasPassword ? 'Save and reconnect' : 'Connect to OBS', 'primary', save),
      hasPassword ? button('Forget password', '', async () => { await MCH.secrets.del('obs'); await start(); renderPanel(); }) : ''));
    if (client) kids.push(el('p', { class: client.state === 'error' ? 'warn' : 'dim' }, client.note + '.'));
    const c = el('input', { type: 'checkbox', checked: settings.confirmLive });
    c.addEventListener('change', () => { settings.confirmLive = c.checked; MCH.saveSettings(); });
    kids.push(el('label', { class: 'check' }, c, 'Ask before starting or ending one stream'));
    if (outs && outs.list.length) {
      kids.push(el('p', { class: 'dim' }, 'Outputs: untick to hide. You can rename each one and note its canvas.'));
      for (const o of outs.list) {
        const on = el('input', { type: 'checkbox', checked: !settings.liveHidden.includes(o.id), 'aria-label': 'Show ' + o.name });
        on.addEventListener('change', () => { settings.liveHidden = settings.liveHidden.filter((x) => x !== o.id).concat(on.checked ? [] : [o.id]); MCH.saveSettings(); draw(true); });
        const text = (group, hint, value) => {
          const t = el('input', { type: 'text', value: settings[group][o.id] || '', placeholder: value, maxLength: 40, 'aria-label': hint + ' for ' + o.name });
          t.addEventListener('change', () => { const v = t.value.trim(); if (v) settings[group][o.id] = v; else delete settings[group][o.id]; MCH.saveSettings(); draw(true); });
          return t;
        };
        kids.push(el('div', { class: 'outSet' }, on, text('liveNames', 'Name', o.name), text('liveTags', 'Canvas', 'Canvas')));
      }
    }
    return section('Go Live', ...kids);
  }

  MCH.live = { start, settingsSection, draw };
  setInterval(poll, 2000);
  start();
})();
