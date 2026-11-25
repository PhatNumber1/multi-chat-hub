(function () {
  'use strict';
  // The Helper: understands plain requests and does them. It is a list of rules,
  // not an online AI. Nothing typed here is saved or leaves this PC, and only the
  // streamer can type here, so chat messages can never give it orders.

  const PLATFORM = { twitch: /\btwitch\b/, youtube: /\b(youtube|yt)\b/, kick: /\bkick\b/, tiktok: /\b(tiktok|tik tok|tt)\b/, instagram: /\b(instagram|insta|ig)\b/, facebook: /\b(facebook|fb)\b/, rumble: /\brumble\b/, trovo: /\btrovo\b/ };
  const PARTS = { timestamps: /\b(time ?stamps?|times)\b/, badges: /\bbadges?\b/, logos: /\b(logos?|platform icons?)\b/, emotes: /\bemotes?\b(?!.*\b(mode|only)\b)/, replies: /\brepl(y|ies)\b/, total: /\btotal\b/, labels: /\b(account )?names?\b/, viewers: /\b(viewer|viewers|view) ?(counts?|numbers?)?\b/, modHighlight: /\bhighlight/ };
  const TILES = [['slow', /\bslow ?mode\b/], ['follow', /\bfollowers?[- ]?only\b/], ['subs', /\bsub(scriber)?s?[- ]?only\b/], ['emote', /\bemotes?[- ]?(only|mode)\b/], ['unique', /\bunique\b/], ['delay', /\bchat delay\b/], ['shield', /\bshield ?mode\b/], ['clear', /\bclear (the |my )?chat\b/],
    ['unraid', /\b(cancel|stop|end) (the |my )?raid\b/], ['raid', /\braid\b/], ['poll', /\bpoll\b/], ['predict', /\bprediction\b/], ['snooze', /\bsnooze\b/], ['ad', /\b(run|start|play) (an? )?(ad|ads|commercial)\b/], ['clip', /\bclip\b/], ['marker', /\bmarker\b/], ['info', /\b(stream )?(title|category)\b|\bstream info\b/],
    ['shout', /\bshout ?out\b/], ['announce', /\bannounce(ment)?\b/], ['goals', /\bgoals?\b/], ['automod', /\bauto ?mod\b/], ['terms', /\bblock(ed)? words?\b/], ['unbans', /\bunban requests?\b/], ['unban', /\bunban\b/], ['ban', /\bban\b/], ['timeout', /\btime ?out\b/], ['warn', /\bwarn\b/], ['unmod', /\b(remove|unmod)\b.*\bmod(erator)?\b|\bunmod\b/], ['mod', /\b(add|make)\b.*\bmod(erator)?\b/], ['unvip', /\bremove\b.*\bvip\b/], ['vip', /\bvip\b/]];
  // Words in a question -> the Help section that answers it.
  const TOPICS = [
    [/\b(twitch|client id)\b/, '2. Add Twitch'], [/\bkick\b/, '3. Add Kick'], [/\b(tiktok|tik tok|euler)\b/, '4. Add TikTok'], [/\b(youtube|yt|google|api key)\b/, '5. Add YouTube'], [/\b(instagram|insta|facebook|rumble|trovo)\b/, '6. Instagram, Facebook, Rumble, Trovo, X and others'],
    [/\b(web ?socket|obs)\b/, '1. Connect OBS'], [/\b(light|yellow|red|green|disconnect\w*|connect\w*)\b/, 'Connection lights'], [/\b(aitum|output|go live|stream button)\b/, 'Go Live buttons'], [/\b(moderator|mod page)\b/, 'Moderator page'], [/\b(search|find)\b/, 'Chat'],
    [/\b(clean mode|color|theme|font)\b/, 'Look and clean mode'], [/\b(box|boxes|viewer|total)\b/, 'Account boxes'], [/\b(private|privacy|safe|saved|password)\b/, 'Where your sign-ins are kept'], [/\b(update|version|download)\b/, 'Updates and links'], [/\bbuttons?\b/, 'The buttons at the top'], [/\bchat\b/, 'Chat'],
  ];
  const OFF = /\b(off|hide|hidden|disable|stop showing|mute|remove|without)\b/;

  // Which account is meant: by nickname or name first, then by platform, then "all".
  function who(t, accounts) {
    const named = accounts.filter((a) => a.names.some((n) => n.length > 1 && new RegExp('(^|[^\\w])' + n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\w])').test(t)));
    if (named.length) return named.map((a) => a.id);
    for (const [p, re] of Object.entries(PLATFORM)) if (re.test(t)) return accounts.filter((a) => a.platform === p).map((a) => a.id);
    return /\b(all|every|everything|everyone|chats)\b/.test(t) ? accounts.map((a) => a.id) : null;
  }
  const platformIn = (t) => (Object.entries(PLATFORM).find(([, re]) => re.test(t)) || [null])[0];

  // Turns what was typed into one thing to do. No side effects.
  function parse(text, accounts = []) {
    const typed = String(text || '').trim(), raw = typed.replace(/^(?:(?:hey|hi|ok|okay|please|can you|could you|would you|will you|i want you to|i want to|i need to|i need you to|id like to|i’d like to|i'd like to)[,\s]+)+(?=\S)/i, '');
    const asked = raw !== typed; // "can you …?" is a request, not a question
    const t = ' ' + raw.toLowerCase().replace(/[’']/g, '').replace(/[?!.,]+(\s|$)/g, ' ').replace(/\s+/g, ' ') + ' ';
    const has = (re) => re.test(t), off = OFF.test(t);
    if (!raw) return { do: 'none' };
    if (has(/\b(undo|put (it|that) back|change (it|that) back)\b/)) return { do: 'undo' };
    if (has(/^ (hi|hello|hey|yo|help|help me|what can you do|commands?) $/)) return { do: 'hello' };
    if (has(/^ (thanks|thank you|ty|ok|okay|cool|nice) $/)) return { do: 'thanks' };
    const question = has(/^ (how|what|why|where|when|can|does|do|is|are|explain|whats)\b/) || (!asked && /\?\s*$/.test(raw));

    if (has(/\b(not working|doesnt work|isnt working|wont (connect|work)|broken|fix|problem|wrong|troubleshoot|check everything)\b/)) return { do: 'check' };
    if (has(/\b(status|whats connected|what is connected|am i connected|is (it|everything|obs) connected|anything disconnected)\b/)) return { do: 'status' };
    if (has(/\b(set ?up|setup|set (it|this|everything|me)( all)? up|get started|start over|do (it|this|everything)( all)? for me|walk me through)\b/) && !platformIn(t) && !has(/\bobs|go live|web ?socket\b/)) return { do: 'setup' };
    if (!question && has(/\b(connect|set ?up|setup|link|hook up)\b/) && has(/\b(obs|go live|web ?socket|buttons)\b/)) return { do: 'obs' };
    if (has(/\b(reconnect|connect (it |them )?(again|now)|retry|refresh)\b/) && !question) return { do: 'reconnect', ids: who(t, accounts) };

    let m = /\b(?:add|connect|set ?up|link|hook up)\b(?: (?:an?|my|the|another|new)\b)*(?: account\b)?(?: (?:on|for)\b)?\s*(.*)$/i.exec(raw);
    if (!question && m && (platformIn(t) || has(/\b(add|new|another)\b.*\baccount\b|^ add( an?)? (stream|chat|channel) $/)) && !has(/\b(mod|moderator|vip|marker)\b/)) {
      const platform = platformIn(t);
      const filler = /^(twitch|youtube|yt|kick|tiktok|tik|tok|tt|instagram|insta|ig|facebook|fb|rumble|trovo|account|accounts|channel|chat|stream|user|username|called|named|for|me|please|my|the|an?|to|on)$/i;
      const rest = m[1].split(/\s+/).map((w) => w.replace(/[!,]+$/, '')).filter((w) => w && !filler.test(w));
      return { do: 'add', platform, name: rest.length === 1 ? rest[0] : '' };
    }
    if (!question && has(/\bdemo\b/)) return { do: 'set', key: 'demo', value: !off && !has(/\b(stop|end|exit|leave)\b/) };
    if (!question && has(/\bclean mode\b/)) return { do: 'clean', value: !off && !has(/\b(exit|leave|stop)\b/) };

    m = /\b(?:rename|call|nickname|name)\b\s+(.+?)\s+(?:to|as|=)?\s*"?([^"]{1,40}?)"?\s*$/i.exec(raw);
    if (!question && m && has(/^ (please )?(rename|call|nickname|name)\b/)) {
      const two = /^(.+?)\s+(?:to|as|=)\s+"?(.+?)"?$/i.exec(raw.replace(/^\s*(please\s+)?(rename|call|nickname|name)\s+/i, ''));
      const src = two ? two[1] : m[1], ids = who(' ' + src.toLowerCase() + ' ', accounts);
      return { do: 'rename', ids, nick: two ? two[2] : m[2] };
    }

    if (!question && has(/\bchats?\b/) && has(/\b(hide|show|mute|unmute|turn (on|off)|stop|only)\b/) && !has(/\bclear\b/) && !has(/\b(only chat|chat delay)\b/)) {
      const ids = who(t, accounts);
      if (has(/\bonly\b/) && ids && ids.length) return { do: 'only', ids };
      if (ids) return { do: 'chat', ids, value: has(/\bunmute\b/) || !(off || has(/\bstop\b/)) };
    }
    if (!question && has(/\b(record|recording)\b/)) return { do: 'record', value: !has(/\b(stop|end|off)\b/) };
    if (!question && has(/\b(end|stop)\b.*\b(stream|streaming|live|broadcast)\b/)) return { do: 'end' };
    if (!question && has(/\b(go|start|going)\b.*\b(live|stream|streaming)\b/)) return { do: 'live' };

    if (!question && (has(/\b(font|text|letters|words|size|chat)\b.*\b(bigger|larger|smaller|tiny|size)\b/) || has(/\b(bigger|larger|smaller)\b.*\b(font|text|letters|words|chat)?\b/))) {
      const n = /\b(\d{2})\b/.exec(t);
      return { do: 'size', value: n ? Number(n[1]) : null, by: has(/\b(smaller|tiny)\b/) ? -2 : 2 };
    }
    m = /\bfont\b(?: to| is|=)?\s+([a-z ]+?)\s*$/i.exec(raw);
    if (!question && m) return { do: 'font', name: m[1].trim() };
    if (!question && has(/\breset\b.*\bcolou?rs?\b/)) return { do: 'resetColors' };
    if (!question && has(/\b(background|bg|chat colou?r)\b/)) {
      const hex = /#?\b([0-9a-f]{6})\b/i.exec(raw), name = /\b(black|white|dark gr[ae]y|gr[ae]y|purple|navy|blue|green|red)\b/.exec(t);
      return { do: 'bg', value: hex ? '#' + hex[1].toLowerCase() : name ? { black: '#000000', white: '#ffffff', purple: '#2a1a4a', navy: '#0f1a33', blue: '#10244a', green: '#0f2a1a', red: '#330f14' }[name[1]] || '#1f2126' : null };
    }

    m = /^\s*(?:please\s+)?(?:search(?: chat)?(?: for)?|find)\s+(.+)$/i.exec(raw);
    if (m && !question) return { do: 'search', text: m[1].replace(/^(messages? )?(from|by)\s+@?(\S+)$/i, 'from:$3') };

    if (!question) {
      if (has(/\bremove\b|\bdelete\b/) && has(/\baccount\b/)) return { do: 'remove', ids: who(t, accounts) };
      const tile = TILES.find(([, re]) => re.test(t));
      if (tile && !(has(/\b(show|hide)\b/) && tile[0] === 'emote' && !has(/only|mode/))) return { do: 'tile', id: tile[0], value: off ? false : has(/\b(on|enable|start|turn on)\b/) ? true : null, ids: who(t, accounts) };
      if (has(/\b(open|go to|take me to|show me)\b/)) {
        if (has(/\b(moderator|mod)\b/)) return { do: 'open', page: 'mod' };
        if (has(/\bconnections?|lights?\b/)) return { do: 'open', page: 'conn' };
        if (has(/\b(colou?rs?|look|theme)\b/)) return { do: 'open', page: 'look' };
        if (has(/\bgo live\b/)) return { do: 'open', page: 'live' };
        if (has(/\bsettings?\b/)) return { do: 'open', page: 'settings' };
      }
      const part = Object.entries(PARTS).find(([, re]) => re.test(t));
      if (part && has(/\b(show|hide|turn|enable|disable|remove)\b/)) return { do: 'show', key: part[0], value: !off };
      if (has(/\bturn (on|off)\b|\b(enable|disable|disconnect)\b/)) { const ids = who(t, accounts); if (ids && ids.length) return { do: 'power', ids, value: !(off || has(/\bdisconnect\b/)) }; }
    }
    const topic = TOPICS.find(([re]) => re.test(t));
    return topic ? { do: 'topic', title: topic[1] } : { do: 'unknown' };
  }

  MCH.botParse = { parse, who, TOPICS };
  if (typeof document === 'undefined') return;

  /* ---------- the little chat ---------- */

  const { el, settings } = MCH;
  const { ask, toast, openPanel, accounts, label, applyLook, renderTop, applyShown, boxes, setClean, searchFor } = MCH.app;
  const INFO = MCH.platforms.INFO;
  const log = el('div', { class: 'botLog', role: 'log', 'aria-label': 'Helper' });
  const input = el('input', { type: 'text', placeholder: 'Ask, or tell me what to do', 'aria-label': 'Message to the helper', maxLength: 300, spellcheck: false });
  const sendBtn = el('button', { type: 'button', class: 'primary', on: { click: () => send() } }, 'Send');
  const boxEl = el('div', { class: 'card bot' }, el('div', { class: 'botHead' }, MCH.brand(), el('b', {}, 'Helper'), el('small', {}, 'Does it for you. Private, stays on this PC.')), log, el('div', { class: 'botRow' }, input, sendBtn));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } });
  let undo = null, settingUp = false;

  function say(text, ...kids) {
    const n = el('div', { class: 'botMsg' }, text ? el('span', {}, text) : '', ...kids);
    log.append(n);
    while (log.childElementCount > 60) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
    return n;
  }
  function me(text) { log.append(el('div', { class: 'botMsg mine' }, el('span', {}, text))); log.scrollTop = log.scrollHeight; }
  // Buttons under a reply. A label alone is sent as if it had been typed.
  function chips(...list) {
    return el('div', { class: 'botChips' }, ...list.map((c) => (typeof c === 'string' ? el('button', { type: 'button', on: { click: () => send(c) } }, c) : el('button', { type: 'button', on: { click: c[1] } }, c[0]))));
  }
  // A hidden-text box inside the chat, for a password or key. It is never put in the log.
  function secret(hint, okLabel, fn) {
    const i = el('input', { type: 'password', placeholder: hint, 'aria-label': hint, autocomplete: 'off' });
    const go = async () => { const v = i.value.trim(); if (!v) { toast('Paste it first.'); return; } i.value = ''; i.disabled = b.disabled = true; await fn(v); };
    const b = el('button', { type: 'button', class: 'primary', on: { click: go } }, okLabel);
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    return el('div', { class: 'botRow' }, i, b);
  }
  const linkTo = (text, href) => el('a', { href, target: '_blank', rel: 'noopener' }, text);
  const cfgs = () => (settings.demo ? accounts.map((a) => a.cfg) : settings.accounts);
  const known = () => boxes().map((a) => { const c = cfgs().find((x) => x.id === a.id) || {}; return { id: a.id, platform: a.platform, names: [c.nick, a.name, /^https/.test(c.channel || '') ? '' : c.channel].filter(Boolean).map((n) => n.replace(/^@/, '')) }; });
  const boxOf = (id) => boxes().find((a) => a.id === id);
  const cfgById = (id) => cfgs().find((c) => c.id === id);
  const names = (ids) => ids.map((id) => label(boxOf(id))).join(', ');
  const examples = () => chips('Set it up for me', 'What is connected?', 'Check everything', 'Add Kick', 'Make the text bigger');

  // Asks which account when it was not said.
  function choose(ids, list, question, fn) {
    const pool = ids && ids.length ? ids : list.map((a) => a.id);
    if (!pool.length) { say('There is no account for that yet.', chips('Add an account')); return; }
    if (ids && ids.length === 1) { fn(pool[0]); return; }
    if (pool.length === 1) { fn(pool[0]); return; }
    say(question, chips(...pool.map((id) => [label(boxOf(id)) + ' (' + INFO[boxOf(id).platform].name + ')', () => { me(label(boxOf(id))); fn(id); }])));
  }
  // Remembers how the look was, so the last change can be undone.
  function change(text, fn) {
    const before = JSON.stringify({ colors: settings.colors, show: settings.show, font: settings.font, size: settings.size });
    fn();
    MCH.saveSettings();
    applyLook();
    undo = () => { Object.assign(settings, JSON.parse(before)); MCH.saveSettings(); applyLook(); };
    say(text, chips('Undo'));
  }

  function send(text) {
    const typed = text == null ? input.value.trim() : text;
    if (!typed) return;
    if (text == null) input.value = '';
    me(typed);
    try { run(parse(typed, known())); } catch (e) { say('That did not work: ' + e.message); }
  }

  /* ---------- doing things ---------- */

  async function leaveDemo() {
    if (!settings.demo) return true;
    if (!await ask('Demo chat is on. Turn it off and use your real accounts?', 'Turn off demo')) { say('Okay, nothing was changed.'); return false; }
    settings.demo = false;
    MCH.saveSettings();
    await MCH.app.boot();
    return true;
  }
  async function connectObs() {
    if (!await leaveDemo()) return;
    if (MCH.live.state().state === 'ok') { say('OBS is already connected.'); next(); return; }
    say('In OBS open Tools > WebSocket Server Settings. Tick Enable WebSocket server, choose Show Connect Info, then Copy beside Server Password. Paste it here:',
      secret('Server Password', 'Connect', async (v) => {
        const wait = say('Connecting…');
        await MCH.live.connect(v, settings.obsPort);
        for (let i = 0; i < 24 && !['ok', 'error'].includes(MCH.live.state().state); i++) await MCH.sleep(250);
        const s = MCH.live.state();
        wait.replaceChildren(MCH.conn.light('obs', 'OBS'));
        if (s.state === 'ok') { say('OBS is connected. The light stays live, and a bar appears at the top if it ever drops.'); next(); } else if (s.state === 'error') say('OBS did not accept that password. Copy it again with the Copy button and try once more.', chips('Connect OBS'));
        else say('OBS did not answer on port ' + settings.obsPort + '. Check that Enable WebSocket server is ticked and the port matches.', chips('Connect OBS', ['Change the port', () => openPanel('Go Live')]));
      }));
  }
  async function addAccount(platform, name) {
    if (!platform) { say('Which one?', chips('Add Twitch', 'Add Kick', 'Add TikTok', 'Add YouTube', 'Add Instagram')); return; }
    const info = INFO[platform];
    if (!await leaveDemo()) return;
    if (platform === 'twitch') {
      say('Twitch needs you to approve it. I opened the sign-in page. Paste your Client ID there, choose Sign in to Twitch, and enter the code it shows.');
      MCH.accounts.add('twitch');
      return;
    }
    if (!name) {
      const i = el('input', { type: 'text', placeholder: info.kind === 'link' ? 'Name or https link' : info.ask, 'aria-label': info.name + ' name', maxLength: 300, spellcheck: false });
      const go = () => { const v = i.value.trim(); if (!v) return; me(v); addAccount(platform, v); };
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      say('What is the ' + info.name + ' name?', el('div', { class: 'botRow' }, i, el('button', { type: 'button', class: 'primary', on: { click: go } }, 'Next')));
      i.focus();
      return;
    }
    const finish = async (key) => {
      const r = await MCH.accounts.quickAdd(platform, name, key);
      if (r.error) { say(r.error); return; }
      say('Added ' + (r.account.nick || name) + '.', info.kind === 'link' ? el('small', {}, ' ' + info.note + '.') : MCH.conn.light(r.account.id, info.name));
      next();
    };
    if (info.kind !== 'key' || await MCH.accounts.hasKey(platform)) { finish(); return; }
    say('I need your ' + info.key + ' once. ' + info.how + ' ', linkTo('Open ' + new URL(info.get).hostname, info.get), secret(info.key, 'Add ' + info.name, finish));
  }
  // One setup step at a time. Comes back here after each one.
  function next() {
    if (!settingUp) return;
    if (!settings.accounts.length || settings.demo) { say('First, add an account. Which one?', chips('Add Twitch', 'Add Kick', 'Add TikTok', 'Add YouTube')); return; }
    if (MCH.live.state().state !== 'ok') { say('Next, connect OBS so the Go Live buttons work.', chips('Connect OBS', ['Skip', () => { settingUp = false; say('Okay, skipped. Say Connect OBS any time.'); }])); return; }
    settingUp = false;
    say('You are all set up. You can add more accounts, or change the look.', chips('Add an account', 'Open look settings'));
  }
  function report(onlyBad) {
    const bad = [], list = [];
    const o = MCH.live.state();
    list.push(MCH.conn.light('obs', 'OBS'));
    if (o.state === 'off') bad.push(['OBS is not set up, so there are no Go Live buttons.', 'Connect OBS']);
    else if (o.state === 'error') bad.push(['OBS: ' + o.note + '.', 'Connect OBS']);
    else if (o.state !== 'ok') bad.push(['OBS: ' + o.note + '. It keeps trying by itself.', 'Connect OBS']);
    for (const a of boxes()) {
      if (a.link) continue;
      const n = label(a), p = INFO[a.platform].name;
      list.push(MCH.conn.light(a.id, n + ' (' + p + ')'));
      if (a.status === 'error') bad.push([n + ': ' + a.note + '.', ['Fix ' + n, () => MCH.accounts.open(a.id)]]);
      else if (a.status === 'reconnecting') bad.push([n + ': ' + a.note + '.', 'Reconnect ' + n]);
      else if (a.off) bad.push([n + ' is turned off.', ['Turn on ' + n, () => power([a.id], true)]]);
      const c = cfgById(a.id);
      if (c && c.chat === false) bad.push([n + '’s chat is hidden.', ['Show ' + n, () => setChat([a.id], true)]]);
    }
    if (!boxes().length) bad.push(['There are no accounts yet.', 'Add an account']);
    if (settings.demo) bad.push(['Demo chat is on, so this is made-up.', 'Turn off demo']);
    if (!onlyBad) say('', ...list);
    if (!bad.length) say('Everything looks good.');
    else for (const [text, chip] of bad) say(text, chips(chip));
  }
  function setChat(ids, on) {
    for (const id of ids) { const c = cfgById(id); if (c && !boxOf(id).link) c.chat = on; }
    MCH.saveSettings();
    applyShown();
    renderTop();
    say((on ? 'Showing' : 'Hiding') + ' chat from ' + names(ids) + '.');
  }
  function power(ids, on) {
    if (settings.demo) { say('Demo accounts cannot be turned off one by one.', chips('Turn off demo')); return; }
    for (const id of ids) MCH.accounts.setOn(id, on);
    say('Turned ' + (on ? 'on ' : 'off ') + names(ids) + '.', ...(on ? ids.map((id) => MCH.conn.light(id, label(boxOf(id)))) : []));
  }

  async function run(a) {
    switch (a.do) {
      case 'hello': say('Tell me what you want in plain words. I can set things up, add accounts, show or hide chats, change the look, run Twitch actions and start a recording. I always ask before anything goes live, bans or deletes.', examples()); break;
      case 'thanks': say('Any time.'); break;
      case 'setup': settingUp = true; say('Let’s set it up. I will do what I can and tell you when I need you.'); next(); break;
      case 'obs': connectObs(); break;
      case 'add': addAccount(a.platform, a.name); break;
      case 'status': report(false); break;
      case 'check': report(true); break;
      case 'undo': if (undo) { undo(); undo = null; say('Put back how it was.'); } else say('There is nothing to undo.'); break;
      case 'reconnect': {
        if (settings.demo) { say('Demo chat has nothing to reconnect.'); break; }
        const ids = a.ids || settings.accounts.filter((c) => c.on).map((c) => c.id);
        if (!a.ids) MCH.live.start();
        ids.forEach((id) => MCH.accounts.reconnect(id));
        say('Reconnecting ' + (a.ids ? names(ids) : 'everything') + '.', ...(a.ids ? [] : [MCH.conn.light('obs', 'OBS')]), ...ids.filter((id) => !boxOf(id).link).map((id) => MCH.conn.light(id, label(boxOf(id)))));
        break;
      }
      case 'set': {
        settings.demo = a.value;
        MCH.saveSettings();
        MCH.accounts.cancel();
        await MCH.app.boot();
        say('Demo chat is ' + (a.value ? 'on. Nothing real happens.' : 'off.'));
        break;
      }
      case 'clean': say(a.value ? 'Clean mode is on. The small corner button brings everything back.' : 'Clean mode is off.'); setClean(a.value); break;
      case 'chat': if (a.ids.length) setChat(a.ids, a.value); else say('I do not see that account.', chips('What is connected?')); break;
      case 'only': {
        const rest = boxes().filter((x) => !x.link && !a.ids.includes(x.id)).map((x) => x.id);
        for (const id of rest) cfgById(id).chat = false;
        setChat(a.ids, true);
        break;
      }
      case 'power': power(a.ids, a.value); break;
      case 'rename': choose(a.ids, boxes(), 'Which account should be called ' + a.nick + '?', (id) => { cfgById(id).nick = a.nick.trim().slice(0, 40); MCH.saveSettings(); renderTop(); say('Renamed to ' + a.nick.trim() + '.'); }); break;
      case 'remove': if (settings.demo) say('Demo accounts cannot be removed.'); else choose(a.ids, boxes(), 'Which account should I remove?', async (id) => { const n = label(boxOf(id)); say(await MCH.accounts.removeById(id) ? 'Removed ' + n + '.' : 'Okay, kept it.'); }); break;
      case 'size': change('Text size is ' + Math.min(28, Math.max(10, a.value || settings.size + a.by)) + '.', () => { settings.size = Math.min(28, Math.max(10, a.value || settings.size + a.by)); }); break;
      case 'font': { const f = MCH.look.fonts.find((x) => x.toLowerCase() === a.name.toLowerCase()); if (f) change('Font is ' + f + '.', () => { settings.font = f; }); else say('I have these fonts:', chips(...MCH.look.fonts.map((x) => 'font ' + x))); break; }
      case 'bg': if (a.value) change('Chat background is ' + a.value + '.', () => { settings.colors.bg = a.value; }); else say('Which color? A name like black, or a code like #1a2b3c.', chips('Black background', 'White background', 'Dark gray background', 'Navy background')); break;
      case 'resetColors': change('Colors are back to default.', () => { settings.colors = MCH.look.copy(MCH.look.defaults.colors); }); break;
      case 'show': change((a.value ? 'Showing ' : 'Hiding ') + ({ labels: 'account names', viewers: 'viewer counts', total: 'the total', replies: 'reply previews', modHighlight: 'the moderator highlight', logos: 'platform logos' }[a.key] || a.key) + '.', () => { settings.show[a.key] = a.value; }); break;
      case 'search': say('Searching chat for ' + a.text + '.'); searchFor(a.text); break;
      case 'open': ({ mod: () => document.getElementById('mod').click(), conn: () => MCH.conn.open(), look: () => openPanel('Colors'), live: () => openPanel('Go Live'), settings: () => openPanel() })[a.page](); break;
      case 'live': say(await MCH.live.askGoLive() || 'Choose where in the window that opened. Nothing starts until you press Go live.'); break;
      case 'end': say(await MCH.live.askEnd() || 'Asking first, then ending.'); break;
      case 'record': say(await MCH.live.askRecord(a.value)); break;
      case 'tile': {
        const tw = boxes().filter((x) => x.platform === 'twitch');
        if (!tw.length) { say('That needs a Twitch account.', chips('Add Twitch')); break; }
        choose((a.ids || []).filter((id) => tw.some((x) => x.id === id)), tw, 'On which Twitch account?', async (id) => say(await MCH.mod.runTile(a.id, id, a.value)));
        break;
      }
      case 'topic': {
        const s = MCH.help.section(a.title);
        say(s ? s.text : '', chips(['Show me', () => MCH.help.show(a.title)], ...(s && /^1\./.test(a.title) ? ['Connect OBS'] : []), ...(/^\d\. Add (Twitch|Kick|TikTok|YouTube)$/.test(a.title) ? [a.title.slice(3)] : [])));
        break;
      }
      default: say('I did not understand that. Try one of these, or say it another way.', examples());
    }
  }

  say('Hi. Tell me what you want and I will do it, or ask me how something works.', examples());
  MCH.bot = { box: boxEl, focus: () => { input.focus(); log.scrollTop = log.scrollHeight; } };
})();
