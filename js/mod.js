(function () {
  'use strict';
  const { el, settings } = MCH;
  const { accounts, ask, toast, form, act, openPanel, renderPanel, section, label } = MCH.app;
  const page = document.getElementById('modPage'), btn = document.getElementById('mod');
  let current = null, chat = null, shield = null, timer = null, load = 0, problem = '';

  const twitch = () => accounts.filter((a) => a.platform === 'twitch' && (a.user || a.demo) && !a.stopped);
  const base = (a) => 'https://dashboard.twitch.tv/u/' + encodeURIComponent(a.user ? a.user.login : a.name.toLowerCase());
  const go = (url) => window.open(url, '_blank', 'noopener');
  const manager = (a) => go(base(a) + '/stream-manager');

  async function refresh() {
    const a = current, id = ++load;
    if (!a || page.hidden) return;
    const [c, s] = await Promise.allSettled([a.can('moderator:manage:chat_settings') ? a.chatSettings() : null, a.can('moderator:manage:shield_mode') ? a.shield() : null]);
    if (id !== load || a !== current) return;
    if (c.status === 'fulfilled') chat = c.value;
    if (s.status === 'fulfilled') shield = s.value;
    problem = c.status === 'rejected' ? 'Could not read chat settings: ' + c.reason.message : '';
    draw();
  }
  // Runs a Twitch call, says how it went, then shows Twitch's real state.
  async function run(fn, done) { const ok = await act(fn, done); refresh(); return ok; }
  const mode = (a, text, patch) => run(() => a.setChatSettings(patch), text);
  async function read(fn) { try { return await fn(); } catch (e) { toast('Could not read from Twitch: ' + e.message); return undefined; } }
  async function findUser(a, login) {
    const u = await a.findUser(login.trim().replace(/^@/, '').toLowerCase());
    if (!u) throw new Error('no Twitch account called ' + login.trim());
    return u;
  }
  const text = (key, label, max, value) => ({ key, label, type: 'text', value: value || '', max });
  const select = (key, label, options, value) => ({ key, label, type: 'select', options, value: value || options[0][0] });
  // Asks for a username (and maybe more), finds that person, then acts on them.
  async function person(a, title, okLabel, fn, done, extra) {
    const v = await form(title, [text('who', 'Username', 25), ...(extra || [])], okLabel);
    if (!v || !v.who.trim()) return;
    let u;
    try { u = await findUser(a, v.who); } catch (e) { toast('Not done: ' + e.message); return; }
    if (okLabel === 'Ban' && settings.confirmBans && !await ask('Ban ' + u.display_name + ' from ' + a.name + '?', 'Ban')) return;
    await run(() => fn(u, v), u.display_name + ' ' + done);
  }
  // Pick one from a list, shown as a drop-down.
  async function pick(title, label, list, okLabel, none) {
    if (!list) return null;
    if (!list.length) { toast(none); return null; }
    const v = await form(title, [select('id', label, list.map((x) => [x.id, x.label]))], okLabel);
    return v ? list.find((x) => x.id === v.id) : null;
  }
  const toggle = (key, name) => (a, c) => mode(a, name + ' is ' + (c[key] ? 'off' : 'on'), { [key]: !c[key] });

  async function editInfo(a) {
    const i = await read(() => a.channelInfo());
    if (!i) return;
    const v = await form('Edit stream info for ' + a.name, [text('title', 'Title', 140, i.title), text('game', 'Category', 0, i.game_name), text('tags', 'Tags, separated by commas', 0, (i.tags || []).join(', '))], 'Save');
    if (!v) return;
    await run(async () => {
      const body = {}, tags = v.tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (v.title.trim() !== i.title) {
        if (!v.title.trim()) throw new Error('the title cannot be empty');
        body.title = v.title.trim();
      }
      if (tags.join() !== (i.tags || []).join()) {
        if (tags.length > 10) throw new Error('Twitch allows up to 10 tags');
        body.tags = tags;
      }
      if (v.game.trim().toLowerCase() !== (i.game_name || '').toLowerCase()) {
        const g = v.game.trim() ? await a.findCategory(v.game.trim()) : { id: '0' };
        if (!g) throw new Error('no Twitch category called ' + v.game.trim());
        body.game_id = g.id;
      }
      if (!Object.keys(body).length) throw new Error('nothing was changed');
      await a.setChannelInfo(body);
    }, 'Stream info saved');
  }
  async function poll(a) {
    const list = await read(() => a.polls());
    if (!list) return;
    const on = list.find((p) => p.status === 'ACTIVE');
    if (on) {
      const counts = on.choices.map((c) => c.title + ': ' + (c.votes || 0)).join('\n');
      if (await ask(on.title + '\n' + counts + '\n\nEnd this poll now? Viewers will see the result.', 'End poll')) await run(() => a.endPoll(on.id), 'Poll ended');
      return;
    }
    const v = await form('Start a poll', [text('t', 'Question', 60), ...[1, 2, 3, 4, 5].map((n) => text('c' + n, 'Answer ' + n + (n > 2 ? ' (optional)' : ''), 25)),
      select('d', 'Runs for', [['60', '1 minute'], ['120', '2 minutes'], ['180', '3 minutes'], ['300', '5 minutes'], ['600', '10 minutes'], ['1800', '30 minutes']], '120')], 'Start poll');
    if (!v) return;
    const choices = [1, 2, 3, 4, 5].map((n) => v['c' + n].trim()).filter(Boolean);
    if (!v.t.trim() || choices.length < 2) { toast('A poll needs a question and at least 2 answers.'); return; }
    await run(() => a.startPoll(v.t.trim(), choices, Number(v.d)), 'Poll started');
  }
  async function predict(a) {
    const list = await read(() => a.predictions());
    if (!list) return;
    const on = list.find((p) => p.status === 'ACTIVE' || p.status === 'LOCKED');
    if (on) {
      const opts = [...(on.status === 'ACTIVE' ? [['LOCKED', 'Lock it (no more guesses)']] : []), ...on.outcomes.map((o) => ['win:' + o.id, 'Winner: ' + o.title]), ['CANCELED', 'Cancel and refund everyone']];
      const v = await form(on.title, [select('what', 'What should happen?', opts)], 'Next');
      if (!v) return;
      const win = v.what.startsWith('win:') ? v.what.slice(4) : null, name = opts.find((o) => o[0] === v.what)[1];
      if (!await ask(name + '? ' + (v.what === 'LOCKED' ? '' : 'This cannot be undone.'), 'Confirm')) return;
      await run(() => a.endPrediction(on.id, win ? 'RESOLVED' : v.what, win), 'Prediction updated');
      return;
    }
    const n = [1, 2, 3, 4, 5];
    const v = await form('Start a prediction', [text('t', 'Question', 45), ...n.map((i) => text('o' + i, 'Outcome ' + i + (i > 2 ? ' (optional)' : ''), 25)),
      select('d', 'Guessing is open for', [['60', '1 minute'], ['120', '2 minutes'], ['300', '5 minutes'], ['600', '10 minutes'], ['1800', '30 minutes']], '120')], 'Start prediction');
    if (!v) return;
    const outs = n.map((i) => v['o' + i].trim()).filter(Boolean);
    if (!v.t.trim() || outs.length < 2) { toast('A prediction needs a question and at least 2 outcomes.'); return; }
    await run(() => a.startPrediction(v.t.trim(), outs, Number(v.d)), 'Prediction started');
  }
  async function goals(a) {
    const g = await read(() => a.goals());
    if (!g) return;
    const names = { follower: 'Followers', subscription: 'Sub points', subscription_count: 'Subs', new_subscription: 'New sub points', new_subscription_count: 'New subs', new_bit: 'Bits', new_cheerer: 'Cheerers' };
    const body = g.length ? g.map((x) => (names[x.type] || x.type) + (x.description ? ' (' + x.description + ')' : '') + ': ' + x.current_amount.toLocaleString() + ' of ' + x.target_amount.toLocaleString()).join('\n') : 'No goals are running.';
    if (await ask(body + '\n\nTwitch only lets goals be changed on its own page.', 'Open Twitch')) manager(a);
  }
  async function unbanRequests(a) {
    const list = await read(() => a.unbanRequests());
    const r = await pick('Unban requests', 'Choose one to answer', list && list.map((x) => ({ id: x.id, label: x.user_name, x })), 'Open', 'No unban requests are waiting.');
    if (!r) return;
    const v = await form(r.x.user_name + ' wrote: ' + (r.x.text || '(nothing)'), [select('s', 'Answer', [['approved', 'Approve: let them back in'], ['denied', 'Deny: keep them banned']]), text('t', 'Reply (optional)', 500)], 'Send answer');
    if (v) await run(() => a.resolveUnban(r.id, v.s, v.t.trim()), 'Request ' + v.s);
  }
  async function blockedTerms(a) {
    const list = await read(() => a.blockedTerms());
    if (!list) return;
    const v = await form('Blocked words', [text('add', 'Block a new word or phrase', 500), select('del', 'Or unblock one', [['', '(none)'], ...list.map((t) => [t.id, t.text])])], 'Save');
    if (!v || (!v.add.trim() && !v.del)) return;
    await run(async () => { if (v.add.trim()) await a.blockTerm(v.add.trim()); if (v.del) await a.unblockTerm(v.del); }, 'Blocked words updated');
  }
  async function automod(a) {
    const s = await read(() => a.automod());
    if (!s) return;
    const now = s.overall_level == null ? 'custom' : String(s.overall_level);
    const v = await form('AutoMod level (now: ' + now + ')', [select('l', 'New level', [['0', '0: off'], ['1', '1: a little'], ['2', '2: some'], ['3', '3: more'], ['4', '4: strictest']], now)], 'Next');
    if (v && v.l !== now && await ask('Set AutoMod to level ' + v.l + '? This replaces any custom levels you set for each category.', 'Set level')) await run(() => a.setAutomod(Number(v.l)), 'AutoMod set to level ' + v.l);
  }
  async function followers(a, c) {
    if (c.follower_mode) { mode(a, 'Follower-only chat is off', { follower_mode: false }); return; }
    const v = await form('Follower-only chat', [select('m', 'Must have followed for', [['0', 'Any time'], ['10', '10 minutes'], ['60', '1 hour'], ['1440', '1 day'], ['10080', '1 week'], ['43200', '30 days']])], 'Turn on');
    if (v) mode(a, 'Follower-only chat is on', { follower_mode: true, follower_mode_duration: Number(v.m) });
  }
  async function slow(a, c) {
    if (c.slow_mode) { mode(a, 'Slow mode is off', { slow_mode: false }); return; }
    const v = await form('Slow mode', [select('s', 'One message every', [['3', '3 seconds'], ['5', '5 seconds'], ['10', '10 seconds'], ['30', '30 seconds'], ['60', '1 minute'], ['120', '2 minutes']], '30')], 'Turn on');
    if (v) mode(a, 'Slow mode is on', { slow_mode: true, slow_mode_wait_time: Number(v.s) });
  }
  async function delay(a, c) {
    if (c.non_moderator_chat_delay) { mode(a, 'Chat delay is off', { non_moderator_chat_delay: false }); return; }
    const v = await form('Chat delay', [select('s', 'Hold messages from viewers for', [['2', '2 seconds'], ['4', '4 seconds'], ['6', '6 seconds']])], 'Turn on');
    if (v) mode(a, 'Chat delay is on', { non_moderator_chat_delay: true, non_moderator_chat_delay_duration: Number(v.s) });
  }
  async function shieldMode(a) {
    const on = !shield;
    if (on && !await ask('Turn on Shield Mode for ' + a.name + '? It applies the strict rules you set up on Twitch.', 'Turn on')) return;
    await run(() => a.setShield(on), 'Shield Mode is ' + (on ? 'on' : 'off'));
  }
  async function announce(a) {
    const v = await form('Send an announcement to ' + a.name + '’s chat', [text('m', 'Message', 500), select('c', 'Color', [['primary', 'Channel color'], ['blue', 'Blue'], ['green', 'Green'], ['orange', 'Orange'], ['purple', 'Purple']])], 'Send');
    if (v && v.m.trim()) await run(() => a.announce(v.m.trim(), v.c), 'Announcement sent');
  }
  async function raid(a) {
    const v = await form('Raid a channel', [text('who', 'Channel name', 25)], 'Next');
    if (!v || !v.who.trim()) return;
    let u;
    try { u = await findUser(a, v.who); } catch (e) { toast('Not done: ' + e.message); return; }
    if (await ask('Send ' + a.name + '’s viewers to ' + u.display_name + '? Twitch starts a countdown you can cancel.', 'Raid')) await run(() => a.raid(u.id), 'Raid on ' + u.display_name + ' starting');
  }
  async function clip(a) {
    await run(async () => { const c = await a.clip(); if (c && /^https:\/\/([a-z]+\.)*twitch\.tv\//.test(c.edit_url || '')) go(c.edit_url); }, 'Clip made');
  }
  async function addLink() {
    const v = await form('Add a shortcut', [text('n', 'Name', 40), text('u', 'Web address', 0, 'https://')], 'Add');
    if (!v) return;
    let u;
    try { u = new URL(v.u.trim()); } catch { u = null; }
    if (!v.n.trim() || !u || u.protocol !== 'https:' || u.username) { toast('Give it a name and an address starting with https://'); return; }
    if (settings.modLinks.length >= 20) { toast('You have 20 shortcuts. Remove one first.'); return; }
    settings.modLinks.push({ name: v.n.trim(), url: u.href });
    MCH.saveSettings();
    draw();
  }
  async function dropLink(l) {
    if (!await ask('Remove the shortcut ' + l.name + '?', 'Remove')) return;
    settings.modLinks = settings.modLinks.filter((x) => x !== l);
    MCH.saveSettings();
    draw();
  }
  const opens = (name) => ({ name, run: manager, note: () => 'Opens Twitch' });
  const CHAT = 'moderator:manage:chat_settings', BANS = 'moderator:manage:banned_users';

  // Every action. scope: the permission it needs. live: the channel must be live.
  // on: for switches, whether it is on. off: why it can never work from here.
  const GROUPS = [
    ['Stream', 'stream', {
      info: { name: 'Edit stream info', scope: 'channel:manage:broadcast', run: editInfo },
      clip: { name: 'Make a clip', scope: 'clips:edit', live: true, run: clip },
      marker: { name: 'Add a marker', scope: 'channel:manage:broadcast', live: true, run: async (a) => { const v = await form('Add a stream marker', [text('d', 'Note (optional)', 140)], 'Add'); if (v) await run(() => a.marker(v.d.trim()), 'Marker added'); } },
      ad: { name: 'Run an ad', scope: 'channel:edit:commercial', live: true, run: async (a) => { const v = await form('Run an ad on ' + a.name, [select('s', 'Length', [['30', '30 seconds'], ['60', '1 minute'], ['90', '1.5 minutes'], ['120', '2 minutes'], ['150', '2.5 minutes'], ['180', '3 minutes']])], 'Run ad'); if (v) await run(() => a.commercial(Number(v.s)), 'Ad starting'); } },
      snooze: { name: 'Snooze next ad', scope: 'channel:manage:ads', live: true, run: (a) => run(() => a.snoozeAd(), 'Next ad pushed back 5 minutes') },
    }],
    ['Community', 'heart', {
      raid: { name: 'Raid a channel', scope: 'channel:manage:raids', run: raid },
      unraid: { name: 'Cancel raid', scope: 'channel:manage:raids', run: (a) => run(() => a.cancelRaid(), 'Raid cancelled') },
      poll: { name: 'Poll', scope: 'channel:manage:polls', run: poll },
      predict: { name: 'Prediction', scope: 'channel:manage:predictions', run: predict },
      shout: { name: 'Shoutout', scope: 'moderator:manage:shoutouts', live: true, run: (a) => person(a, 'Give a shoutout', 'Shout out', (u) => a.shoutout(u.id), 'got a shoutout') },
      announce: { name: 'Announcement', scope: 'moderator:manage:announcements', run: announce },
      goals: { name: 'Goals', scope: 'channel:read:goals', run: goals },
      together: opens('Stream Together'),
      shared: { name: 'Start shared chat', off: 'Twitch does not let apps start this', run: () => {} },
      rewards: opens('Channel Points'),
      hype: opens('Hype Train'),
      charity: opens('Charity'),
    }],
    ['Chat', 'chat', {
      follow: { name: 'Follower-only chat', scope: CHAT, on: (c) => c.follower_mode, note: (c) => (c.follower_mode && c.follower_mode_duration ? c.follower_mode_duration + ' min' : ''), run: followers },
      subs: { name: 'Subscriber-only chat', scope: CHAT, on: (c) => c.subscriber_mode, run: toggle('subscriber_mode', 'Subscriber-only chat') },
      emote: { name: 'Emote-only chat', scope: CHAT, on: (c) => c.emote_mode, run: toggle('emote_mode', 'Emote-only chat') },
      slow: { name: 'Slow mode', scope: CHAT, on: (c) => c.slow_mode, note: (c) => (c.slow_mode ? c.slow_mode_wait_time + ' s' : ''), run: slow },
      unique: { name: 'Unique messages only', scope: CHAT, on: (c) => c.unique_chat_mode, run: toggle('unique_chat_mode', 'Unique messages only') },
      delay: { name: 'Chat delay', scope: CHAT, on: (c) => c.non_moderator_chat_delay, note: (c) => (c.non_moderator_chat_delay ? c.non_moderator_chat_delay_duration + ' s' : ''), run: delay },
      clear: { name: 'Clear chat', red: true, scope: 'moderator:manage:chat_messages', run: async (a) => { if (await ask('Clear all of ' + a.name + '’s chat? This cannot be undone.', 'Clear chat')) await run(() => a.clearChat(), 'Chat cleared'); } },
    }],
    ['Safety', 'shield', {
      shield: { name: 'Shield Mode', scope: 'moderator:manage:shield_mode', shield: true, on: () => shield, run: shieldMode },
      automod: { name: 'AutoMod level', scope: 'moderator:manage:automod_settings', run: automod },
      terms: { name: 'Blocked words', scope: 'moderator:manage:blocked_terms', run: blockedTerms },
      unbans: { name: 'Unban requests', scope: 'moderator:manage:unban_requests', run: unbanRequests },
      verify: opens('Verified-only chat'),
    }],
    ['People', 'person', {
      ban: { name: 'Ban someone', scope: BANS, run: (a) => person(a, 'Ban someone from ' + a.name, 'Ban', (u) => a.ban(u.id, 0), 'banned') },
      timeout: { name: 'Time someone out', scope: BANS, run: (a) => person(a, 'Time someone out', 'Time out', (u, v) => a.ban(u.id, Number(v.s)), 'timed out', [select('s', 'For', [['60', '1 minute'], ['600', '10 minutes'], ['3600', '1 hour'], ['86400', '1 day'], ['604800', '1 week'], ['1209600', '2 weeks']], '600')]) },
      unban: { name: 'Unban someone', scope: BANS, run: (a) => person(a, 'Unban or end a timeout', 'Unban', (u) => a.unban(u.id), 'can chat again') },
      warn: { name: 'Warn someone', scope: 'moderator:manage:warnings', run: (a) => person(a, 'Warn someone', 'Warn', (u, v) => { if (!v.r.trim()) throw new Error('a warning needs a reason'); return a.warn(u.id, v.r.trim()); }, 'warned', [text('r', 'Reason (they must accept it to chat)', 500)]) },
      watch: { name: 'Suspicious user', scope: 'moderator:manage:suspicious_users', run: (a) => person(a, 'Suspicious user', 'Save', (u, v) => a.suspicious(u.id, v.s), 'updated', [select('s', 'Set to', [['ACTIVE_MONITORING', 'Monitor their messages'], ['RESTRICTED', 'Restrict: hide from viewers'], ['', 'Not suspicious']])]) },
      mod: { name: 'Add a moderator', scope: 'channel:manage:moderators', run: (a) => person(a, 'Add a moderator', 'Add', (u) => a.addMod(u.id), 'is now a moderator') },
      unmod: { name: 'Remove a moderator', scope: 'channel:manage:moderators', run: (a) => person(a, 'Remove a moderator', 'Remove', (u) => a.removeMod(u.id), 'is no longer a moderator') },
      vip: { name: 'Add a VIP', scope: 'channel:manage:vips', run: (a) => person(a, 'Add a VIP', 'Add', (u) => a.addVip(u.id), 'is now a VIP') },
      unvip: { name: 'Remove a VIP', scope: 'channel:manage:vips', run: (a) => person(a, 'Remove a VIP', 'Remove', (u) => a.removeVip(u.id), 'is no longer a VIP') },
    }],
    ['Shortcuts', 'link', {
      manager: opens('Stream Manager'),
      channel: { name: 'My channel page', note: () => 'Opens Twitch', run: (a) => go('https://www.twitch.tv/' + encodeURIComponent(a.user ? a.user.login : a.name.toLowerCase())) },
      popout: { name: 'Pop-out chat', note: () => 'Opens Twitch', run: (a) => go('https://www.twitch.tv/popout/' + encodeURIComponent(a.user ? a.user.login : a.name.toLowerCase()) + '/chat') },
      addLink: { name: '+ Add a shortcut', add: true, run: addLink },
    }],
  ];

  function tile(t) {
    const a = current, c = chat || {};
    let why = t.off || '';
    if (!why && t.scope && !a.can(t.scope)) why = 'Sign in to Twitch again to allow this';
    if (!why && t.live && a.viewers == null) why = 'Only works while this channel is live';
    if (!why && t.scope === CHAT && !chat) why = 'Reading from Twitch…';
    if (!why && t.shield && shield == null) why = 'Reading from Twitch…';
    const on = t.on && !why ? !!t.on(c) : null, note = why || (t.note ? t.note(c) : '');
    const b = el('button', { type: 'button', class: 'tile' + (t.red ? ' red' : '') + (on ? ' isOn' : '') + (t.add ? ' add' : ''), disabled: !!why, title: why, on: { click: () => t.run(a, c) } },
      el('span', {}, t.name), on == null ? '' : el('small', { class: 'sw' }, on ? 'On' : 'Off'), note ? el('small', {}, note) : '');
    if (on != null) b.setAttribute('aria-pressed', String(on));
    return b;
  }

  function draw() {
    if (page.hidden) return;
    const list = twitch();
    if (!list.includes(current)) { current = list[0] || null; chat = shield = null; if (current) refresh(); }
    const at = page.scrollTop;
    const kids = [el('div', { class: 'row head' }, el('h2', {}, 'Moderator'), el('span', { class: 'headBtns' },
      el('button', { type: 'button', on: { click: () => openPanel('Moderator page') } }, 'Choose what shows'), el('button', { type: 'button', on: { click: close } }, 'Close')))];
    if (!current) {
      kids.push(el('p', {}, 'Sign in to Twitch to use this page.'), el('button', { type: 'button', class: 'primary', on: { click: () => openPanel() } }, 'Open settings'));
      page.replaceChildren(...kids);
      return;
    }
    const a = current;
    kids.push(el('div', { class: 'tabs', role: 'group', 'aria-label': 'Twitch account' }, ...list.map((x) => {
      const b = el('button', { type: 'button', class: x === a ? 'sel' : '', on: { click: () => { current = x; chat = shield = null; draw(); refresh(); } } }, el('span', { class: 'dot ' + x.status }), label(x), el('small', {}, x.viewers == null ? 'offline' : x.viewers.toLocaleString()));
      b.setAttribute('aria-pressed', String(x === a));
      return b;
    })));
    if (!a.demo && a.scopes && MCH.twitch.SCOPES.split(' ').some((s) => !a.can(s))) kids.push(el('p', { class: 'warn' }, 'This sign-in is from an older version. In Settings, sign out and sign in again to use the greyed-out actions.'));
    if (problem) kids.push(el('p', { class: 'warn' }, problem));
    let any = false;
    for (const [title, symbol, tiles] of GROUPS) {
      const show = Object.entries(tiles).filter(([id]) => !settings.modHidden.includes(id)).map(([, t]) => tile(t));
      if (title === 'Shortcuts') show.unshift(...settings.modLinks.map((l) => el('div', { class: 'linkTile' }, el('button', { type: 'button', class: 'tile', title: l.url, on: { click: () => go(l.url) } }, el('span', {}, l.name), el('small', {}, 'Opens your browser')),
        el('button', { type: 'button', class: 'x', 'aria-label': 'Remove ' + l.name, on: { click: () => dropLink(l) } }, '✕'))));
      if (show.length) { any = true; kids.push(el('h3', {}, MCH.icon(symbol), title), el('div', { class: 'tiles' }, ...show)); }
    }
    if (!any) kids.push(el('p', { class: 'dim' }, 'Everything is hidden. Use Choose what shows to bring actions back.'));
    const f = page.contains(document.activeElement) ? document.activeElement.textContent : null;
    page.replaceChildren(...kids);
    page.scrollTop = at;
    if (f) { const b = [...page.querySelectorAll('button')].find((x) => x.textContent === f); if (b) b.focus(); }
  }

  // Settings: one checkbox for each action.
  function settingsSection() {
    const ids = GROUPS.flatMap(([, , t]) => Object.keys(t));
    const set = (hidden) => { settings.modHidden = hidden; MCH.saveSettings(); draw(); };
    const b = (label, fn) => el('button', { type: 'button', on: { click: fn } }, label);
    const kids = [el('p', { class: 'dim' }, 'Tick the actions you want on the Moderator page.'),
      el('div', { class: 'row left' }, b('Show all', () => { set([]); renderPanel(); }), b('Hide all', () => { set(ids); renderPanel(); }), b('Open Moderator page', show))];
    for (const [title, , tiles] of GROUPS) {
      kids.push(el('h4', {}, title));
      for (const [id, t] of Object.entries(tiles)) {
        const c = el('input', { type: 'checkbox', checked: !settings.modHidden.includes(id) });
        c.addEventListener('change', () => set(settings.modHidden.filter((x) => x !== id).concat(c.checked ? [] : [id])));
        kids.push(el('label', { class: 'check' }, c, t.name));
      }
    }
    return section('Moderator page', ...kids);
  }

  function show() {
    document.getElementById('panel').hidden = true;
    page.hidden = false;
    draw();
    refresh();
    clearInterval(timer);
    timer = setInterval(refresh, 15000); // only while the page is open
  }
  function close() { page.hidden = true; clearInterval(timer); load++; }
  btn.addEventListener('click', () => (page.hidden ? show() : close()));
  // A connection can report status often; redraw only when something shown here changed.
  let sig = '';
  function update() {
    const s = JSON.stringify(twitch().map((a) => [label(a), a.status, a.viewers, a.scopes]));
    if (s !== sig) { sig = s; draw(); }
  }
  MCH.mod = { update, close, settingsSection, groups: GROUPS };
})();
