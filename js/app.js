(function () {
  'use strict';
  const { el, settings } = MCH;
  const $ = (id) => document.getElementById(id);
  const chat = $('chat'), jump = $('jump'), menu = $('menu'), panel = $('panel'), dialog = $('dialog');
  const KEEP = 1000;        // lines kept while following chat
  const KEEP_PAUSED = 3000; // hard limit while scrolled up

  const accounts = [];

  /* ---------- accounts and header ---------- */

  const LOGOS = {
    twitch: 'M3 1 1 4v9h3v2h2l2-2h3l4-4V1H3zm11 7-2 2H9l-2 2v-2H4V2h10v6zM11 4h1.3v3.5H11V4zM7.5 4h1.3v3.5H7.5V4z',
    tiktok: 'M8.5 1H11c.2 1.9 1.4 3.2 3.2 3.4v2.4c-1.2 0-2.3-.4-3.2-1v4.7A4.4 4.4 0 1 1 6.6 6.1c.3 0 .5 0 .8.1v2.5a2 2 0 1 0 1.2 1.8V1z',
    youtube: 'M2.5 3h11A1.5 1.5 0 0 1 15 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 11.5v-7A1.5 1.5 0 0 1 2.5 3zM6.5 5.5v5l4-2.5z',
    kick: 'M2 1h4v4h1V3.5h1.5V1H14v5h-2v1.5h-1v1h1V10h2v5H8.5v-2.5H7V11H6v4H2z',
  };
  const LETTERS = { instagram: 'IG', facebook: 'FB', rumble: 'RU', trovo: 'TR', x: 'X', other: '↗' };
  function logo(platform) {
    if (!LOGOS[platform]) return el('span', { class: 'pf', 'aria-hidden': 'true' }, LETTERS[platform] || '?');
    const s = MCH.svg('0 0 16 16', 'logo ' + platform, { d: LOGOS[platform], 'fill-rule': 'evenodd' });
    s.removeAttribute('aria-hidden');
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', MCH.look.platforms[platform]);
    return s;
  }
  // The saved settings of one account. Demo accounts keep theirs only while open.
  const cfgOf = (a) => settings.accounts.find((c) => c.id === a.id) || a.cfg || {};
  const label = (a) => cfgOf(a).nick || a.name;
  const shows = (a) => cfgOf(a).chat !== false;
  const nameColor = (m) => MCH.look.nameColor(m, settings.colors, cfgOf(m.account).color);

  // Every account box, in the saved order, including ones that are turned off.
  function boxes() {
    if (settings.demo) return accounts;
    return settings.accounts.map((c) => accounts.find((a) => a.id === c.id) || { id: c.id, platform: c.platform, name: c.channel || MCH.platforms.INFO[c.platform].name, status: 'off', note: 'Turned off', viewers: null, off: true });
  }
  function box(a) {
    const c = cfgOf(a), name = label(a);
    const text = a.link ? 'Open' : a.off ? 'Off' : a.viewers == null ? 'Offline' : a.viewers.toLocaleString();
    const main = el('button', { type: 'button', class: 'statMain', title: name + ': ' + a.note + '. Click for its settings', on: { click: () => MCH.accounts.open(a.id) } }, MCH.icon(a.link ? 'link' : 'eye'),
      el('span', { class: 'statText' }, c.viewers === false ? null : el('b', { class: a.viewers == null ? 'none' : '' }, text),
        el('span', { class: 'acctLine' }, el('span', { class: 'dot ' + a.status }), logo(a.platform), el('span', { class: 'acctName' }, name))));
    let side = null;
    if (a.link) side = el('button', { type: 'button', class: 'chatBtn', title: 'Open ' + name + ' in your browser', 'aria-label': 'Open ' + name, on: { click: () => window.open(a.link, '_blank', 'noopener') } }, MCH.icon('stream'));
    else {
      const on = c.chat !== false;
      side = el('button', { type: 'button', class: 'chatBtn', title: on ? 'Hide chat from ' + name : 'Show chat from ' + name, 'aria-label': 'Chat from ' + name, on: { click: () => MCH.accounts.setChat(a, !on) } }, MCH.icon(on ? 'chat' : 'chatOff'));
      side.setAttribute('aria-pressed', String(on));
    }
    return el('span', { class: 'acct stat' + (a.off || c.chat === false ? ' quiet' : '') }, main, side);
  }
  let lastBoxes = '';
  function renderTop() {
    const list = boxes();
    // Skip identical redraws so a click is never lost to a rebuild.
    const key = JSON.stringify([settings.demo, list.map((a) => [a.id, a.status, a.note, a.viewers, a.name, a.off, a.link, cfgOf(a)])]);
    if (key !== lastBoxes) {
      lastBoxes = key;
      const f = document.activeElement && $('accounts').contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') || document.activeElement.title : null;
      $('accounts').replaceChildren(...list.map(box), el('button', { type: 'button', id: 'addAcct', class: 'stat', title: 'Add a stream account', 'aria-label': 'Add account', on: { click: () => MCH.accounts.add() } }, MCH.icon('plus'), el('span', {}, 'Add account')));
      if (f) { const b = [...$('accounts').querySelectorAll('button')].find((n) => (n.getAttribute('aria-label') || n.title) === f); if (b) b.focus(); }
      const live = accounts.filter((a) => a.viewers != null && cfgOf(a).total !== false);
      $('total').replaceChildren(...(live.length && list.length > 1 ? [el('span', { class: 'statMain' }, MCH.icon('people'), el('span', { class: 'statText' }, el('b', {}, live.reduce((n, a) => n + a.viewers, 0).toLocaleString()), el('span', { class: 'acctLine' }, 'Total viewers')))] : []));
    }
    // Clean mode can hide the status dots, so the corner button carries trouble.
    const bad = ['error', 'reconnecting'].find((s) => accounts.some((a) => a.status === s));
    $('corner').className = bad || '';
    if (MCH.mod) MCH.mod.update();
    $('corner').title = bad ? 'Show everything (a connection needs attention)' : 'Show everything';
    status();
  }

  // The middle of the top row: Live, Offline, or what it is waiting for.
  function status() {
    const on = accounts.some((a) => a.viewers != null) || !!(MCH.live && MCH.live.onAir());
    const waiting = !on && accounts.length > 0 && accounts.every((a) => a.status === 'reconnecting');
    const s = $('status'), text = on ? 'Live' : waiting ? 'Connecting' : boxes().length ? 'Offline' : 'No accounts yet';
    if (s.textContent !== text) s.textContent = text;
    s.className = on ? 'live' : waiting ? 'warnText' : '';
    $('demoTag').hidden = !settings.demo;
    fit();
  }
  // Uses the biggest of four sizes that leaves most of the dock for chat.
  function fit() {
    const room = innerHeight * 0.38, root = document.documentElement;
    for (const s of ['', 'snug', 'tinySize', 'mini']) {
      root.className = s;
      const cut = [...document.querySelectorAll('.stat b')].some((b) => b.getBoundingClientRect().right > b.closest('.statMain').getBoundingClientRect().right);
      if (!cut && $('top').offsetHeight + $('live').offsetHeight <= room) break;
    }
  }
  addEventListener('resize', fit);

  function emit(event, data) {
    if (event === 'message') queue(data);
    else if (event === 'remove') remove(data);
    else if (event === 'status') { if (accounts.includes(data)) { renderTop(); MCH.accounts.changed(data); } }
    else if (event === 'authLost') MCH.accounts.lost(data);
  }

  function add(a) { accounts.push(a); renderTop(); a.start(); }
  function drop(a) { a.stop(); const i = accounts.indexOf(a); if (i >= 0) accounts.splice(i, 1); renderTop(); }

  let booting = 0;
  async function boot() {
    const mine = ++booting;
    if (MCH.live) MCH.live.start();
    accounts.slice().forEach(drop);
    pending = [];
    log = [];
    logAccounts.clear();
    detached = false;
    following = true;
    missed = 0;
    chat.replaceChildren();
    closeSearch();
    showJump();
    if (settings.demo) { add(new MCH.DemoAccount(emit)); add(new MCH.DemoAccount(emit, 'tiktok')); return; }
    await MCH.accounts.connectAll(() => mine === booting && !settings.demo);
  }
  // After an account's chat is switched on or off.
  function applyShown() {
    for (const row of document.querySelectorAll('#chat .line')) if (row.msg) row.hidden = !shows(row.msg.account);
    if (query && !sBar.hidden) runSearch();
    if (following) toBottom();
  }

  /* ---------- chat ---------- */

  const LOG_MAX = 30000; // messages kept for search since the dock opened
  const CHUNK = 150;     // lines added at a time when reading back
  let pending = [], flushTimer = null, following = true, missed = 0;
  let log = [], seq = 0, detached = false; // detached: showing an older part of chat
  const logAccounts = new Map();

  function queue(m) {
    m.seq = seq++;
    log.push(m);
    if (log.length > LOG_MAX + 1000) log.splice(0, log.length - LOG_MAX);
    logAccounts.set(MCH.search.accountKey(m.account), { platform: m.account.platform, name: m.account.name });
    pending.push(m);
    if (pending.length > KEEP) pending.shift();
    if (!flushTimer) flushTimer = setTimeout(flush, 60);
  }

  function flush() {
    flushTimer = null;
    const batch = pending;
    pending = [];
    if (!batch.length) return;
    // The scroll event can arrive after this, so check for a scroll up here too.
    if (following && chat.scrollTop < lastTop - 5 && !atBottom()) following = false;
    if (detached) { missed += batch.length; showJump(); searchBatch(batch, []); return; }
    const rows = batch.map(line);
    chat.append(...rows);
    const max = following ? KEEP : KEEP_PAUSED;
    while (chat.childElementCount > max) chat.firstElementChild.remove();
    if (following) toBottom();
    else { missed += batch.filter((m) => shows(m.account)).length; showJump(); }
    searchBatch(batch, rows);
  }

  // Rebuilds chat around one message, when it has scrolled out of the live feed.
  function renderAround(m) {
    const i = m.seq - log[0].seq, end = Math.min(log.length, i + CHUNK);
    chat.replaceChildren(...log.slice(Math.max(0, i - CHUNK), end).map(line));
    detached = end < log.length;
  }
  function renderLatest() {
    flush();
    detached = false;
    chat.replaceChildren(...log.slice(-KEEP).map(line));
    markAll();
  }
  // Reading past either end of what is drawn brings in more of the log.
  function readOn() {
    if (!log.length || !chat.firstElementChild) return;
    const first = chat.firstElementChild.msg.seq - log[0].seq;
    if (chat.scrollTop < 30 && first > 0 && chat.childElementCount < KEEP_PAUSED - CHUNK) {
      const rows = log.slice(Math.max(0, first - CHUNK), first).map(line);
      const h = chat.scrollHeight, t = chat.scrollTop;
      chat.prepend(...rows);
      chat.scrollTop = t + chat.scrollHeight - h;
      rows.forEach(markRow);
    } else if (detached && atBottom()) {
      flush();
      const from = chat.lastElementChild.msg.seq - log[0].seq + 1;
      const rows = log.slice(from, from + CHUNK).map(line);
      const t = chat.scrollTop;
      chat.append(...rows);
      chat.scrollTop = t;
      rows.forEach(markRow);
      detached = chat.lastElementChild.msg !== log[log.length - 1];
      if (!detached) missed = 0;
    }
  }

  function line(m) {
    const badges = [];
    if (m.roles.includes('broadcaster')) badges.push(['HOST', 'host']);
    if (m.roles.includes('moderator') || m.roles.includes('lead_moderator')) badges.push(['MOD', 'mod']);
    if (m.roles.includes('vip')) badges.push(['VIP', 'vip']);
    const name = el('button', { class: 'name', type: 'button', title: 'Actions for ' + m.name }, m.name);
    name.style.color = nameColor(m);
    const same = m.name.toLowerCase() === m.login;
    if (!same) name.append(el('small', {}, ' (' + m.login + ')'));
    const body = el('span', { class: 'body' });
    for (const p of m.parts) {
      if (p.emote || p.img) {
        body.append(el('img', { class: 'emote', loading: 'lazy', alt: p.text, title: p.text, src: p.img || 'https://static-cdn.jtvnw.net/emoticons/v2/' + encodeURIComponent(p.emote) + '/default/dark/1.0' }), el('span', { class: 'emoteText' }, p.text));
      } else body.append(p.mention ? el('b', {}, p.text) : p.text);
    }
    const isMod = badges.some((b) => b[1] === 'mod');
    const row = el('div', { class: 'line' + (isMod ? ' isMod' : '') + (m.removed ? ' removed' : '') },
      m.replyTo ? el('div', { class: 'reply' }, '↪ ' + m.replyTo.name + ': ' + m.replyTo.text) : null,
      el('time', {}, MCH.time12(m.at) + ' '), logo(m.account.platform),
      ...badges.map(([t, c]) => el('span', { class: 'badge ' + c }, t)),
      name, el('span', { class: 'colon' }, ': '), body);
    row.msg = m;
    row.hidden = !shows(m.account);
    name.addEventListener('click', (e) => { e.stopPropagation(); openMenu(m, e.clientX, e.clientY); });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(m, e.clientX, e.clientY); });
    return row;
  }

  function remove(r) {
    flush(); // so a message still waiting to be drawn is marked too
    for (const m of log) {
      if (m.account === r.account && (r.all || (r.id && m.id === r.id) || (r.userId && m.userId === r.userId))) m.removed = true;
    }
    for (const row of document.querySelectorAll('#chat .line, #results .line')) row.classList.toggle('removed', !!row.msg.removed);
  }

  let lastTop = 0; // where we last put the scroll position ourselves
  function atBottom() { return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40; }
  function toBottom() { chat.scrollTop = chat.scrollHeight; lastTop = chat.scrollTop; }
  function showJump() { jump.hidden = following; jump.textContent = missed ? 'Jump to latest (' + missed + ' new)' : 'Jump to latest'; }
  chat.addEventListener('scroll', () => {
    following = !detached && atBottom();
    if (following) { missed = 0; lastTop = chat.scrollTop; }
    else readOn();
    showJump();
  });
  // An emote finishing loading must not push the newest line out of view.
  chat.addEventListener('load', () => { if (following) toBottom(); }, true);
  new ResizeObserver(() => { if (following) toBottom(); }).observe(chat);
  jump.addEventListener('click', () => { if (detached) renderLatest(); following = true; missed = 0; toBottom(); showJump(); });

  /* ---------- search ---------- */

  const sBar = $('search'), sBox = $('sText'), sList = $('results');
  const SHOWN = 200; // result rows drawn at once
  let query = null, results = [], current = null, drawn = [], ran = null;
  const marks = window.Highlight && CSS.highlights ? new Highlight() : null;
  if (marks) CSS.highlights.set('mch-search', marks);

  const filter = () => ({ platform: $('sPlatform').value, account: $('sAccount').value });
  const isHit = (m) => !!query && shows(m.account) && MCH.search.matches(m, query, filter());

  // Highlights are drawn over the text, so the chat itself is not rebuilt.
  function markRow(row) {
    if (!isHit(row.msg)) return;
    row.classList.add('hit');
    if (!marks) return;
    for (const [sel, re] of [['.name', query.inName], ['.body', query.inText]]) {
      if (!re) continue;
      const walk = document.createTreeWalker(row.querySelector(sel), NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        for (const f of n.data.matchAll(re)) {
          const r = new Range();
          r.setStart(n, f.index);
          r.setEnd(n, f.index + f[0].length);
          marks.add(r);
        }
      }
    }
  }
  function markAll() {
    if (marks) marks.clear();
    for (const row of document.querySelectorAll('#chat .line, #results .line')) {
      row.classList.remove('hit');
      row.classList.toggle('current', row.msg === current);
      markRow(row);
    }
  }

  function fillFilters() {
    const keep = filter();
    const opt = (v, t) => el('option', { value: v }, t);
    const plats = [...new Set([...logAccounts.values()].map((a) => a.platform))];
    $('sPlatform').replaceChildren(opt('', 'All platforms'), ...plats.map((p) => opt(p, MCH.look.platforms[p])));
    if (plats.includes(keep.platform)) $('sPlatform').value = keep.platform;
    const list = [...logAccounts].filter(([, a]) => !$('sPlatform').value || a.platform === $('sPlatform').value);
    $('sAccount').replaceChildren(opt('', 'All accounts'), ...list.map(([k, a]) => opt(k, MCH.look.platforms[a.platform] + ': ' + a.name)));
    if (list.some(([k]) => k === keep.account)) $('sAccount').value = keep.account;
  }

  function runSearch() {
    ran = sBox.value;
    query = MCH.search.parse(ran);
    results = query ? log.filter(isHit) : [];
    current = null;
    drawResults();
    markAll();
  }

  function drawResults() {
    let end = results.length;
    const at = results.indexOf(current);
    if (at >= 0 && at < end - SHOWN) end = Math.min(end, at + SHOWN / 2);
    drawn = results.slice(Math.max(0, end - SHOWN), end);
    sList.replaceChildren(...drawn.map(resultRow));
    sList.hidden = !drawn.length;
    const row = [...sList.children].find((r) => r.msg === current);
    if (row) row.scrollIntoView({ block: 'nearest' });
    else sList.scrollTop = sList.scrollHeight;
    showCount();
  }
  function resultRow(m) {
    const row = line(m);
    row.tabIndex = 0;
    row.title = 'Show in chat';
    row.addEventListener('click', (e) => { if (!e.target.closest('.name')) goTo(m); });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) goTo(m); });
    return row;
  }
  function showCount() {
    const i = results.indexOf(current), n = results.length.toLocaleString();
    $('sCount').textContent = !query ? '' : !results.length ? 'No matches' : i < 0 ? n + ' found' : (i + 1).toLocaleString() + ' of ' + n;
    $('sUp').disabled = $('sDown').disabled = !results.length;
  }

  // New messages join the results while search is open.
  function searchBatch(batch, rows) {
    if (sBar.hidden || !query) return;
    if (results.length && results[0].seq < log[0].seq) results = results.filter((m) => m.seq >= log[0].seq);
    const fresh = batch.filter(isHit);
    rows.forEach(markRow);
    if (!fresh.length) return;
    const atEnd = sList.hidden || sList.scrollHeight - sList.scrollTop - sList.clientHeight < 30;
    const showsNewest = !drawn.length || drawn[drawn.length - 1] === results[results.length - 1];
    results.push(...fresh);
    if (showsNewest && atEnd) {
      const added = fresh.map(resultRow);
      sList.append(...added);
      drawn.push(...fresh);
      while (sList.childElementCount > SHOWN) { sList.firstElementChild.remove(); drawn.shift(); }
      sList.hidden = false;
      added.forEach(markRow);
      sList.scrollTop = sList.scrollHeight;
    }
    showCount();
  }

  function goTo(m) {
    flush();
    if (m.seq < log[0].seq) { toast('That message is too old to show.'); return; }
    current = m;
    let row = [...chat.children].find((r) => r.msg === m);
    following = false;
    if (!row) { renderAround(m); row = [...chat.children].find((r) => r.msg === m); }
    if (!drawn.includes(m)) drawResults();
    markAll();
    showCount();
    row.scrollIntoView({ block: 'center' });
    lastTop = chat.scrollTop;
    const inList = [...sList.children].find((r) => r.msg === m);
    if (inList) inList.scrollIntoView({ block: 'nearest' });
    following = !detached && atBottom();
    showJump();
  }
  function move(dir) { const m = MCH.search.step(results, current, dir); if (m) goTo(m); }

  function openSearch() {
    if (!panel.hidden || dialog.open) return;
    const was = following;
    flush();
    sBar.hidden = false;
    fillFilters();
    runSearch();
    sBox.focus();
    sBox.select();
    if (was) toBottom();
  }
  function closeSearch() {
    const was = following;
    sBar.hidden = sList.hidden = true;
    query = current = null;
    results = [];
    drawn = [];
    sList.replaceChildren();
    markAll();
    if (was) toBottom();
  }
  $('find').addEventListener('click', () => (sBar.hidden ? openSearch() : closeSearch()));
  $('sClose').addEventListener('click', closeSearch);
  $('sUp').addEventListener('click', () => move(-1));
  $('sDown').addEventListener('click', () => move(1));
  let typing = null;
  sBox.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { if (!sBar.hidden) runSearch(); }, 120); });
  sBox.addEventListener('keydown', (e) => {
    if (e.isComposing || !['Enter', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    clearTimeout(typing);
    if (sBox.value !== ran) runSearch();
    move(e.key === 'ArrowDown' || (e.key === 'Enter' && e.shiftKey) ? 1 : -1);
  });
  $('sPlatform').addEventListener('change', () => { fillFilters(); runSearch(); });
  $('sAccount').addEventListener('change', runSearch);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearch(); }
    else if (e.key === 'Escape' && !sBar.hidden && menu.hidden && panel.hidden && !dialog.open) closeSearch();
  }, true);

  /* ---------- actions ---------- */

  function openMenu(m, x, y) {
    const locked = m.account.readOnly;
    const item = (label, fn, cls) => el('button', { type: 'button', role: 'menuitem', class: cls || '', disabled: !!(locked && !/^(Copy|View)/.test(label)), on: { click: () => { closeMenu(); fn(); } } }, label);
    menu.replaceChildren(
      el('div', { class: 'menuHead' }, m.name),
      locked ? el('div', { class: 'menuNote' }, locked) : '',
      item('Timeout 1 minute', () => punish(m, 60, '1 minute')),
      item('Timeout 10 minutes', () => punish(m, 600, '10 minutes')),
      item('Timeout 1 hour', () => punish(m, 3600, '1 hour')),
      item('Timeout custom…', () => customTimeout(m)),
      item('Ban', () => punish(m, 0), 'danger'),
      item('Unban / end timeout', () => act(() => m.account.unban(m.userId), m.name + ' can chat again')),
      item('Delete message', () => act(() => m.account.deleteMessage(m.id), 'Message deleted')),
      item('Copy username', async () => toast(await MCH.copy(m.login) ? 'Copied ' + m.login : 'Could not copy')),
      item('View profile', () => window.open(m.account.profileUrl(m.login), '_blank', 'noopener')));
    menu.hidden = false;
    menu.style.left = Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4)) + 'px';
  }
  function closeMenu() { menu.hidden = true; }
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  async function act(fn, done, undo) {
    try { await fn(); toast(done, undo); return true; } catch (e) {
      toast('Not done: ' + (e.message || 'could not reach the platform'));
      return false;
    }
  }

  async function punish(m, seconds, label) {
    if (!seconds && settings.confirmBans) {
      const yes = await ask('Ban ' + m.name + ' from ' + m.account.name + '?', 'Ban');
      if (!yes) return;
    }
    const text = seconds ? m.name + ' timed out for ' + label : m.name + ' banned';
    await act(() => m.account.ban(m.userId, seconds), text,
      () => act(() => m.account.unban(m.userId), m.name + ' can chat again'));
  }

  async function customTimeout(m) {
    const text = await ask('Time out ' + m.name + ' for how long? Examples: 30s, 5m, 2h, 1d (up to 14d)', 'Timeout', true);
    if (text == null) return;
    const secs = MCH.parseDuration(text);
    if (!secs) { toast('Not a valid length. Use something like 30s, 5m, 2h or 1d.'); return; }
    punish(m, secs, /[smhd]\s*$/i.test(text) ? text.trim() : text.trim() + 'm');
  }

  // Resolves true (or the typed text), or false/null when cancelled.
  function ask(text, okLabel, input) {
    return new Promise((res) => {
      const box = input ? el('input', { type: 'text', value: '5m', 'aria-label': 'Length' }) : null;
      let result = input ? null : false;
      const ok = () => { result = input ? box.value : true; dialog.close(); };
      const cancel = el('button', { type: 'button', on: { click: () => dialog.close() } }, 'Cancel');
      dialog.replaceChildren(el('p', { class: 'askText' }, text), ...(box ? [box] : []),
        el('div', { class: 'row' }, cancel, el('button', { type: 'button', class: 'primary', on: { click: ok } }, okLabel)));
      if (box) box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
      dialog.onclose = () => res(result);
      dialog.showModal();
      if (box) { box.focus(); box.select(); } else cancel.focus(); // a stray Enter never bans anyone
    });
  }

  // Asks for several values at once. Resolves { key: value }, or null when cancelled.
  function form(title, fields, okLabel) {
    return new Promise((res) => {
      let result = null;
      const inputs = fields.map((f) => {
        if (f.type === 'select') return el('select', { 'aria-label': f.label }, ...f.options.map(([v, t]) => el('option', { value: v, selected: v === f.value }, t)));
        if (f.type === 'check') return el('input', { type: 'checkbox', checked: !!f.value, disabled: !!f.disabled });
        return el('input', Object.assign({ type: 'text', value: f.value || '', 'aria-label': f.label, spellcheck: false }, f.max ? { maxLength: f.max } : {}));
      });
      const ok = () => { result = Object.fromEntries(fields.map((f, i) => [f.key, f.type === 'check' ? inputs[i].checked : inputs[i].value])); dialog.close(); };
      const cancel = el('button', { type: 'button', on: { click: () => dialog.close() } }, 'Cancel');
      dialog.replaceChildren(el('p', { class: 'askText' }, el('b', {}, title)),
        ...fields.map((f, i) => (f.type === 'check' ? el('label', { class: 'check' }, inputs[i], f.label) : el('label', { class: 'field' }, f.label, inputs[i]))),
        el('div', { class: 'row' }, cancel, el('button', { type: 'button', class: 'primary', on: { click: ok } }, okLabel)));
      inputs.forEach((x) => { if (x.type === 'text') x.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ok(); } }); });
      dialog.onclose = () => res(result);
      dialog.showModal();
      const first = inputs.find((x) => x.type === 'text');
      (first || cancel).focus();
    });
  }

  let toastTimer;
  function toast(text, undo) {
    const t = $('toast');
    t.replaceChildren(el('span', {}, text));
    if (undo) t.append(el('button', { type: 'button', on: { click: () => { t.hidden = true; undo(); } } }, 'Undo'));
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 8000 : 4500);
  }

  /* ---------- settings ---------- */

  // The panel shows Settings, or one of the account pages from accounts.js.
  let page = null;
  function openPanel(sect) { if (MCH.mod) MCH.mod.close(); if (sect) openSections.add(sect); page = null; panel.hidden = false; panel.scrollTop = 0; renderPanel(); }
  function openPage(fn) { if (MCH.mod) MCH.mod.close(); page = fn; panel.hidden = false; panel.scrollTop = 0; renderPanel(); }
  function closePanel() { panel.hidden = true; page = null; }
  $('gear').addEventListener('click', () => (panel.hidden || page ? openPanel() : closePanel()));

  function check(label, key, after) {
    const c = el('input', { type: 'checkbox', checked: settings[key] });
    c.addEventListener('change', () => { settings[key] = c.checked; MCH.saveSettings(); if (after) after(); });
    return el('label', { class: 'check' }, c, label);
  }

  function head(title, mark) {
    return el('div', { class: 'row head' }, el('h2', {}, mark, title), el('button', { type: 'button', on: { click: closePanel } }, 'Close'));
  }
  function renderPanel() {
    if (panel.hidden) return;
    const at = panel.scrollTop;
    if (page) { panel.replaceChildren(...page()); panel.scrollTop = at; return; }
    const kids = [head('Settings', MCH.brand()), el('h3', {}, 'Accounts'), ...MCH.accounts.list()];
    if (MCH.live) kids.push(el('h3', {}, 'OBS'), MCH.live.settingsSection());
    if (MCH.mod) kids.push(el('h3', {}, 'Twitch actions'), MCH.mod.settingsSection());
    kids.push(...lookSections());
    kids.push(el('h3', {}, 'Other'), check('Ask before banning', 'confirmBans'),
      check('Demo chat (made-up messages)', 'demo', () => { MCH.accounts.cancel(); boot().then(renderPanel); }),
      el('p', { class: 'dim' }, 'Multi Chat Hub ' + MCH.version));
    panel.replaceChildren(...kids);
    panel.scrollTop = at;
  }

  /* ---------- look and clean mode ---------- */

  const SHOW = { viewers: 'Viewer counts', total: 'Combined total', live: 'Go Live buttons', mod: 'Moderator button', labels: 'Account names', timestamps: 'Timestamps', logos: 'Platform logos', badges: 'HOST / MOD / VIP badges', emotes: 'Emotes as pictures', replies: 'Reply previews', modHighlight: 'Highlight mods' };
  const CLEAN = { accounts: 'Accounts and viewer counts', total: 'Combined total', search: 'Search button', live: 'Go Live buttons', mod: 'Moderator button', gear: 'Settings gear', timestamps: 'Timestamps', logos: 'Platform logos', badges: 'Badges', replies: 'Reply previews' };
  const PRESETS = { Black: '#000000', White: '#ffffff', 'Dark gray': '#1f2126' };
  const openSections = new Set();

  function applyLook() {
    const vis = MCH.look.visible(settings), c = MCH.look.resolved(settings.colors), root = document.documentElement.style;
    for (const [k, on] of Object.entries(vis)) document.body.classList.toggle('no-' + k, !on);
    document.body.classList.toggle('clean', settings.clean);
    for (const k of ['bg', 'text', 'time', 'mod']) root.setProperty('--chat-' + k, c[k]);
    for (const k of ['viewers', 'total']) root.setProperty('--stat-' + k, MCH.look.statColor(settings.colors, k));
    root.setProperty('--chat-font', '"' + settings.font + '", "Segoe UI", sans-serif');
    root.setProperty('--chat-size', settings.size + 'px');
    for (const row of document.querySelectorAll('.line')) row.querySelector('.name').style.color = nameColor(row.msg);
    $('live').hidden = !vis.live;
    if (MCH.live) MCH.live.draw(true);
    renderTop();
    if (following) toBottom();
  }
  let saveTimer = null;
  function changed() {
    applyLook();
    clearTimeout(saveTimer); // dragging a colour picker fires many changes
    saveTimer = setTimeout(flushSave, 200);
  }
  function flushSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; MCH.saveSettings(); } }
  addEventListener('pagehide', flushSave);
  MCH.onSettings = () => { applyLook(); applyShown(); if (!settings.demo) MCH.accounts.sync(); if (!panel.hidden) renderPanel(); };

  function setClean(on) { settings.clean = on; MCH.saveSettings(); closeMenu(); applyLook(); }
  $('hide').addEventListener('click', () => setClean(true));
  $('corner').addEventListener('click', () => setClean(false));

  function section(title, ...kids) {
    const d = el('details', { class: 'sect', open: openSections.has(title) }, el('summary', {}, title), ...kids);
    d.addEventListener('toggle', () => { if (d.open) openSections.add(title); else openSections.delete(title); });
    return d;
  }
  function toggles(labels, group) {
    return Object.entries(labels).map(([k, label]) => {
      const box = el('input', { type: 'checkbox', checked: settings[group][k] });
      box.addEventListener('change', () => { settings[group][k] = box.checked; changed(); });
      return el('label', { class: 'check' }, box, label);
    });
  }
  // A picker plus a typed code, in case the pop-up picker does not open in a dock.
  function color(label, target, k) {
    const pick = el('input', { type: 'color', value: target[k], 'aria-label': label });
    const code = el('input', { type: 'text', class: 'hex', value: target[k], maxLength: 7, spellcheck: false, 'aria-label': label + ' code' });
    pick.addEventListener('input', () => { target[k] = code.value = pick.value; changed(); });
    code.addEventListener('change', () => {
      let v = code.value.trim().toLowerCase();
      if (v[0] !== '#') v = '#' + v;
      if (!MCH.look.HEX.test(v)) { code.value = target[k]; toast('Use a color code like #1a2b3c.'); return; }
      target[k] = pick.value = code.value = v;
      changed();
    });
    return el('div', { class: 'colorRow' }, el('span', {}, label), pick, code);
  }
  const btn = (label, fn) => el('button', { type: 'button', on: { click: fn } }, label);
  function refreshLook() { changed(); renderPanel(); }

  function sample() {
    const tw = { platform: 'twitch' }, tk = { platform: 'tiktok' }, at = new Date();
    const rows = [
      { account: tw, at, login: 'novapixel', name: 'NovaPixel', color: '#ff4d6d', roles: [], parts: [{ text: 'this is how chat will look ' }, { emote: '25', text: 'Kappa' }] },
      { account: tw, at, login: 'modmaple', name: 'ModMaple', color: '#2ecc71', roles: ['moderator'], parts: [{ text: 'a mod message' }], replyTo: { name: 'NovaPixel', text: 'this is how chat will look' } },
      { account: tk, at, login: 'tiktokfan', name: 'TikTokFan', color: '', roles: [], parts: [{ text: 'hello from TikTok' }] },
    ].map(line);
    return el('div', { id: 'sample', class: 'chatLook', inert: true, 'aria-hidden': 'true' }, ...rows);
  }

  function lookSections() {
    const c = settings.colors;
    const auto = el('input', { type: 'checkbox', checked: c.auto });
    auto.addEventListener('change', () => { c.auto = auto.checked; changed(); });
    const own = el('input', { type: 'checkbox', checked: c.ownNames });
    own.addEventListener('change', () => { c.ownNames = own.checked; changed(); });
    const font = el('select', { 'aria-label': 'Font' }, ...MCH.look.fonts.map((f) => el('option', { value: f, selected: f === settings.font }, f)));
    font.addEventListener('change', () => { settings.font = font.value; changed(); });
    const sizeText = el('span', {}, settings.size + ' px');
    const size = el('input', { type: 'range', min: 10, max: 28, step: 1, value: settings.size, 'aria-label': 'Font size' });
    size.addEventListener('input', () => { settings.size = Number(size.value); sizeText.textContent = settings.size + ' px'; changed(); });
    const name = el('input', { type: 'text', placeholder: 'Theme name', maxLength: 40, 'aria-label': 'Theme name' });
    const saveTheme = () => {
      const n = name.value.trim();
      if (!n) { toast('Type a name for the theme first.'); return; }
      const at = settings.themes.findIndex((t) => t.name.toLowerCase() === n.toLowerCase());
      if (at < 0 && settings.themes.length >= 30) { toast('You have 30 themes. Delete one first.'); return; }
      const t = { name: n, colors: MCH.look.copy(settings.colors) };
      if (at < 0) settings.themes.push(t); else settings.themes[at] = t;
      refreshLook();
      toast((at < 0 ? 'Saved ' : 'Updated ') + n);
    };
    const themes = settings.themes.map((t) => el('div', { class: 'themeRow' }, el('span', {}, t.name),
      btn('Load', () => { settings.colors = MCH.look.copy(t.colors); refreshLook(); }),
      btn('Delete', async () => {
        if (!await ask('Delete the theme ' + t.name + '?', 'Delete')) return;
        settings.themes = settings.themes.filter((x) => x.name !== t.name);
        refreshLook();
      })));
    return [
      el('h3', {}, 'Look'), sample(),
      section('Show / hide', ...toggles(SHOW, 'show')),
      section('Colors',
        color('Chat background', c, 'bg'),
        el('div', { class: 'row left' }, ...Object.entries(PRESETS).map(([n, v]) => btn(n, () => { c.bg = v; refreshLook(); }))),
        el('label', { class: 'check' }, auto, 'Keep text readable automatically'),
        el('p', { class: 'dim' }, 'Turn this off to use your exact colors.'),
        color('Message text', c, 'text'), color('Timestamp', c, 'time'), color('Mod highlight', c, 'mod'),
        ...Object.entries(MCH.look.platforms).map(([p, label]) => color(label + ' names', c.names, p)),
        el('label', { class: 'check' }, own, 'Use each viewer’s own Twitch color'),
        color('Viewer numbers', c.stats, 'viewers'), color('Total number', c.stats, 'total'),
        btn('Reset colors to default', () => { settings.colors = MCH.look.copy(MCH.look.defaults.colors); refreshLook(); })),
      section('Themes', ...themes, name, btn('Save current colors', saveTheme)),
      section('Font', font, el('div', { class: 'colorRow' }, size, sizeText)),
      section('Clean mode hides', ...toggles(CLEAN, 'cleanHide')),
    ];
  }

  MCH.app = { accounts, ask, toast, form, act, openPanel, openPage, closePanel, renderPanel, renderTop, head, logo, section, color, status, boot, add, drop, emit, cfgOf, label, applyShown, applyLook };
})();
