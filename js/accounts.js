(function () {
  'use strict';
  // Adding, connecting and setting up stream accounts.
  const { el, settings } = MCH;
  const { accounts, ask, toast, openPage, closePanel, renderPanel, renderTop, head, logo, color, boot, add: start, drop, emit, cfgOf, label, applyShown, applyLook } = MCH.app;
  const { INFO, KickAccount, YouTubeAccount, TikTokAccount, StillAccount, clean, youtubeHours } = MCH.platforms;
  let login = null; // Twitch sign-in in progress: { id, cancelled, code, uri, error }
  let openId = null, adding = null;

  const secretOf = (c) => (c.id === 'twitch' ? 'twitch' : 'acct.' + c.id); // 'twitch' is the sign-in from before 0.5.0
  const keyName = (p) => 'key.' + p;
  const newId = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const save = () => MCH.saveSettings();
  const find = (id) => settings.accounts.find((c) => c.id === id);
  const button = (text, fn, cls) => el('button', { type: 'button', class: cls || '', on: { click: fn } }, text);

  /* ---------- connecting ---------- */

  async function make(c) {
    const kind = INFO[c.platform].kind;
    if (kind === 'link') return new StillAccount(c, 'ok', 'Opens its page');
    if (kind === 'open') return new KickAccount(c, emit);
    if (kind === 'signin') {
      const token = await MCH.secrets.get(secretOf(c));
      if (!token) return new StillAccount(c, 'error', 'Sign in again');
      const a = new MCH.twitch.TwitchAccount(token, emit, secretOf(c));
      return Object.assign(a, { id: c.id, cfg: c, name: c.channel || 'Twitch' });
    }
    const key = await MCH.secrets.get(keyName(c.platform));
    if (!key) return new StillAccount(c, 'error', 'Add your ' + INFO[c.platform].key);
    return c.platform === 'youtube' ? new YouTubeAccount(c, emit, key) : new TikTokAccount(c, emit, key);
  }
  const tries = new Map(); // a newer connect or disconnect cancels an older one
  async function connect(c, still) {
    const n = (tries.get(c.id) || 0) + 1;
    tries.set(c.id, n);
    const a = await make(c);
    if (tries.get(c.id) !== n || settings.demo || !find(c.id) || !find(c.id).on || (still && !still())) return;
    accounts.filter((x) => x.id === c.id).forEach(drop);
    start(a);
    if (c.id === openId) renderPanel();
  }
  function disconnect(id) {
    tries.set(id, (tries.get(id) || 0) + 1);
    accounts.filter((x) => x.id === id).forEach(drop);
  }
  async function connectAll(still) {
    // The one Twitch sign-in from before 0.5.0 becomes the first account box.
    if (!find('twitch') && await MCH.secrets.get('twitch') && still()) {
      settings.accounts.unshift(MCH.look.oneAccount({ id: 'twitch', platform: 'twitch' }));
      save();
    }
    if (!still()) return;
    renderTop();
    await Promise.all(settings.accounts.filter((c) => c.on).map((c) => connect(c, still)));
    if (still() && !settings.accounts.length) add();
  }
  // Another open dock added, removed or switched accounts.
  function sync() {
    for (const a of accounts.slice()) { const c = find(a.id); if (!c || !c.on || (a.platform !== 'twitch' && c.channel !== a.cfg.channel)) disconnect(a.id); else a.cfg = c; }
    for (const c of settings.accounts) if (c.on && !accounts.some((a) => a.id === c.id)) connect(c);
    renderTop();
  }
  function setChat(a, on) {
    cfgOf(a).chat = on;
    save();
    applyShown();
    renderTop();
    if (openId === a.id) renderPanel();
    toast((on ? 'Showing' : 'Hiding') + ' chat from ' + label(a));
  }
  function newAccount(platform, channel) {
    const c = MCH.look.oneAccount({ id: newId(), platform, channel });
    settings.accounts.push(c);
    return c;
  }
  // Adding a real account ends the made-up demo chat.
  async function added(c) {
    save();
    if (settings.demo) { settings.demo = false; save(); await boot(); } else await connect(c);
    renderTop();
    open(c.id);
  }

  /* ---------- add an account ---------- */

  // platform: go straight to that one's page
  function add(platform) { cancel(); adding = { step: INFO[platform] ? platform : 'pick' }; openId = null; openPage(addPage); }
  function addPage() {
    if (adding.step === 'pick') {
      const rows = (kind) => Object.entries(INFO).filter(([, i]) => (i.kind === 'link') === kind).map(([p, i]) => el('button', { type: 'button', class: 'acctRow', on: { click: () => { adding = { step: p }; renderPanel(); } } },
        logo(p), el('span', {}, i.name, el('small', {}, i.note))));
      return [head('Add account', MCH.brand()), el('p', {}, 'Where do you stream?'), ...rows(false), el('h3', {}, 'Link only'), ...rows(true)];
    }
    const p = adding.step, i = INFO[p], kids = [head('Add ' + i.name, logo(p))];
    if (i.kind === 'signin') kids.push(...twitchSignIn(null));
    else kids.push(...channelForm(p, i));
    kids.push(el('div', { class: 'row left' }, button('Back', () => add()), button('Help', () => MCH.help.open())));
    return kids;
  }
  function channelForm(p, i) {
    const box = el('input', { type: 'text', value: adding.text || '', placeholder: i.kind === 'link' ? (i.url ? 'Name or https link' : 'https link') : i.ask, 'aria-label': i.kind === 'link' ? i.name + ' name or link' : i.ask, spellcheck: false, maxLength: 300 });
    box.addEventListener('input', () => { adding.text = box.value; });
    const key = el('input', { type: 'password', placeholder: i.key || '', 'aria-label': i.key || 'Key', autocomplete: 'off' });
    const go = async () => {
      const channel = clean(p, box.value);
      if (!channel) { toast(i.kind === 'link' ? 'Type a name or a link that starts with https.' : 'That does not look like a ' + i.name + ' account.'); return; }
      if (settings.accounts.some((c) => c.platform === p && c.channel.toLowerCase() === channel.toLowerCase())) { toast('This account is already added.'); return; }
      if (i.kind === 'key') {
        if (key.value.trim()) await MCH.secrets.set(keyName(p), key.value.trim());
        else if (!adding.hasKey) { toast('Paste your ' + i.key + ' first.'); return; }
      }
      added(newAccount(p, channel));
    };
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const kids = [el('p', {}, i.note + '.'), el('label', {}, i.kind === 'link' ? 'Name or link' : i.ask, box)];
    if (i.kind === 'key') {
      if (adding.hasKey === undefined) { const mine = adding; MCH.secrets.get(keyName(p)).then((k) => { mine.hasKey = !!k; if (adding === mine) renderPanel(); }); }
      kids.push(el('label', {}, i.key, key), el('p', { class: 'dim' }, adding.hasKey ? 'Your key is already saved. Leave this empty to keep it.' : i.how + ' It is kept encrypted on this PC.'), el('p', {}, el('a', { href: i.get, target: '_blank', rel: 'noopener' }, 'Open ' + new URL(i.get).hostname)));
    }
    kids.push(el('div', { class: 'row left' }, button('Add ' + i.name, go, 'primary')));
    return kids;
  }

  /* ---------- Twitch sign-in ---------- */

  function cancel() { if (login) login.cancelled = true; login = null; }
  function twitchSignIn(id) {
    if (login && login.code) {
      return [el('p', {}, 'Open this page in your browser and enter the code:'),
        el('p', {}, el('a', { href: login.uri, target: '_blank', rel: 'noopener' }, 'twitch.tv/activate')),
        el('div', { class: 'code' }, login.code),
        el('p', { class: 'dim' }, 'To add a different Twitch account, log in to that account in your browser first.'),
        el('div', { class: 'row left' }, button('Copy link', async () => toast(await MCH.copy(login.uri) ? 'Link copied' : 'Could not copy')), button('Cancel', () => { cancel(); renderPanel(); }))];
    }
    const box = el('input', { type: 'text', value: settings.twitchClientId || MCH.twitchClientId, placeholder: 'Twitch Client ID', 'aria-label': 'Twitch Client ID', spellcheck: false });
    box.addEventListener('change', () => { settings.twitchClientId = box.value.trim(); save(); });
    const busy = login && !login.error;
    const b = button(busy ? 'Contacting Twitch…' : 'Sign in to Twitch', () => signIn(box.value.trim(), id), 'primary');
    b.disabled = !!busy;
    return [el('label', {}, 'Client ID of a Twitch app with client type Public', box), login && login.error ? el('p', { class: 'warn' }, login.error) : '', el('div', { class: 'row left' }, b)];
  }
  // id: the account to sign in again, or null for a new one.
  async function signIn(clientId, id) {
    if (!clientId) { toast('Paste your Twitch Client ID first.'); return; }
    settings.twitchClientId = clientId;
    save();
    cancel();
    const mine = login = { cancelled: false };
    const target = id || newId(), secret = secretOf({ id: target });
    const old = id ? await MCH.secrets.get(secret) : null;
    renderPanel();
    try {
      const token = await MCH.twitch.deviceLogin(clientId, (c) => {
        mine.code = c.user_code;
        mine.uri = /^https:\/\/www\.twitch\.tv\//.test(c.verification_uri) ? c.verification_uri : 'https://www.twitch.tv/activate';
        if (login === mine) renderPanel();
      }, mine, secret);
      if (!token || login !== mine) return;
      const who = await whoIs(token);
      if (login !== mine) { await undo(secret, old); return; }
      login = null;
      const twin = settings.accounts.find((c) => c.id !== target && c.platform === 'twitch' && who && c.channel.toLowerCase() === who.toLowerCase());
      if (twin) {
        await undo(secret, old);
        toast(who + ' is already added. Log in to the other account in your browser, then try again.');
        renderPanel();
        return;
      }
      let c = find(target);
      if (!c) { c = MCH.look.oneAccount({ id: target, platform: 'twitch', channel: who || '' }); settings.accounts.push(c); } else { c.on = true; if (who) c.channel = who; }
      await added(c);
    } catch (e) {
      if (login !== mine) return;
      mine.code = null;
      mine.error = e instanceof TypeError ? 'Could not reach Twitch. Check your connection.' : e.message;
      renderPanel();
    }
  }
  const undo = (secret, old) => (old ? MCH.secrets.set(secret, old) : MCH.secrets.del(secret));
  async function whoIs(token) {
    try {
      const r = await fetch('https://api.twitch.tv/helix/users', { headers: { Authorization: 'Bearer ' + token.access, 'Client-Id': token.clientId } });
      return (await r.json()).data[0].display_name;
    } catch { return ''; }
  }

  /* ---------- one account's settings ---------- */

  function open(id) { if (id !== openId) cancel(); openId = id; adding = null; openPage(acctPage); }
  function acctPage() {
    const a = accounts.find((x) => x.id === openId), c = find(openId) || (a && a.cfg);
    if (!c) { openId = null; adding = { step: 'pick' }; return addPage(); }
    const info = INFO[c.platform], link = info.kind === 'link', demo = !!(a && a.demo);
    const title = c.nick || (a && a.name) || c.channel || info.name;
    const kids = [head(title, logo(c.platform))];
    kids.push(el('p', { class: a && a.status === 'error' ? 'warn' : 'dim', id: 'acctNote' }, info.name + '. ' + (a ? a.note : 'Turned off') + '.'));
    if (!link && MCH.conn) kids.push(MCH.conn.light(c.id));

    if (!demo && info.kind === 'signin' && a instanceof StillAccount) kids.push(...twitchSignIn(c.id));
    const tick = (text, key, after) => {
      const box = el('input', { type: 'checkbox', checked: c[key] });
      box.addEventListener('change', () => { c[key] = box.checked; save(); if (after) after(box.checked); renderTop(); });
      return el('label', { class: 'check' }, box, text);
    };
    const nick = el('input', { type: 'text', value: c.nick, placeholder: 'Nickname (optional)', maxLength: 40, 'aria-label': 'Nickname' });
    nick.addEventListener('change', () => { c.nick = nick.value.trim(); save(); renderTop(); renderPanel(); });
    const card = [el('label', {}, 'Nickname', nick)];
    if (!demo) card.push(tick(link ? 'Show this box' : 'Turn this account on', 'on', (on) => { if (on) connect(c); else disconnect(c.id); renderPanel(); }));
    if (!link) {
      card.push(tick('Show its chat', 'chat', applyShown), tick('Show its viewer count', 'viewers'), tick('Count it in the total', 'total'));
      const own = el('input', { type: 'checkbox', checked: !!c.color });
      own.addEventListener('change', () => { c.color = own.checked ? settings.colors.names[c.platform] : ''; save(); applyLook(); renderPanel(); });
      card.push(el('label', { class: 'check' }, own, 'Use its own name color'));
      if (c.color) card.push(color('Name color', c, 'color'));
    }
    kids.push(el('h3', {}, 'This account'), el('div', { class: 'card' }, ...card));

    if (!demo && info.kind !== 'signin') {
      const ch = el('input', { type: 'text', value: c.channel, maxLength: 300, spellcheck: false, 'aria-label': 'Channel' });
      ch.addEventListener('change', () => {
        const v = clean(c.platform, ch.value);
        if (!v) { toast('That does not look like a ' + info.name + ' account.'); ch.value = c.channel; return; }
        c.channel = v;
        save();
        if (c.on) connect(c);
        renderTop();
      });
      const more = [el('label', {}, link ? 'Link' : 'Channel', ch)];
      if (info.kind === 'key') {
        const key = el('input', { type: 'password', placeholder: 'Paste to replace your key', autocomplete: 'off', 'aria-label': info.key });
        more.push(el('label', {}, info.key, key), el('div', { class: 'row left' }, button('Save key', async () => {
          if (!key.value.trim()) { toast('Paste the key first.'); return; }
          await MCH.secrets.set(keyName(c.platform), key.value.trim());
          for (const x of settings.accounts) if (x.platform === c.platform && x.on) connect(x);
          toast('Key saved for every ' + info.name + ' account');
          renderPanel();
        })));
      }
      if (c.platform === 'youtube') {
        const say = () => 'Check chat every ' + c.every + ' seconds. The free daily limit lasts about ' + youtubeHours(c.every).toFixed(1) + ' hours, shared by every YouTube account.';
        const text = el('p', { class: 'dim' }, say());
        const r = el('input', { type: 'range', min: 5, max: 60, step: 1, value: c.every, 'aria-label': 'Seconds between checks' });
        r.addEventListener('input', () => { c.every = Number(r.value); text.textContent = say(); });
        r.addEventListener('change', save);
        more.push(text, el('div', { class: 'colorRow' }, r));
      }
      if (!link && a && a.status !== 'reconnecting') more.push(el('div', { class: 'row left' }, button('Connect now', () => { connect(c); toast('Connecting'); })));
      kids.push(el('h3', {}, info.name), el('div', { class: 'card' }, ...more));
    }
    if (c.platform === 'twitch' && !demo && !(a instanceof StillAccount) && !MCH.secrets.persistent) kids.push(el('p', { class: 'warn' }, 'This sign-in could not be saved, so it lasts until OBS closes.'));

    if (!demo) {
      const at = settings.accounts.indexOf(c);
      const move = (d) => { settings.accounts.splice(at, 1); settings.accounts.splice(at + d, 0, c); save(); renderTop(); renderPanel(); };
      const up = button('Move up', () => move(-1)), down = button('Move down', () => move(1));
      up.disabled = at <= 0;
      down.disabled = at === settings.accounts.length - 1;
      kids.push(el('div', { class: 'row left' }, up, down, info.kind === 'signin' && a && !(a instanceof StillAccount) ? button('Sign out', () => signOut(c)) : '', button('Remove account', () => remove(c), 'danger')));
    }
    return kids;
  }
  async function signOut(c) {
    disconnect(c.id);
    await MCH.secrets.del(secretOf(c));
    if (c.on) await connect(c);
    renderPanel();
  }
  // Twitch ended the sign-in by itself.
  async function lost(a) {
    const c = find(a.id);
    if (!c) return;
    await MCH.secrets.del(secretOf(c));
    await connect(c);
    open(c.id);
    toast('Twitch signed ' + label(a) + ' out. Sign in again.');
  }
  async function remove(c, stay) {
    if (!await ask('Remove ' + (c.nick || c.channel || INFO[c.platform].name) + ' from this dock?' + (INFO[c.platform].kind === 'signin' ? '\nYou can sign in again later.' : ''), 'Remove')) return;
    disconnect(c.id);
    settings.accounts = settings.accounts.filter((x) => x.id !== c.id);
    save();
    if (INFO[c.platform].kind === 'signin') await MCH.secrets.del(secretOf(c));
    // A key is shared, so it goes when the last account using it goes.
    if (INFO[c.platform].kind === 'key' && !settings.accounts.some((x) => x.platform === c.platform)) await MCH.secrets.del(keyName(c.platform));
    renderTop();
    if (stay) return;
    closePanel();
    toast('Account removed');
  }

  /* ---------- for the helper ---------- */

  const hasKey = async (p) => !!await MCH.secrets.get(keyName(p));
  // Adds without opening a page. Returns { account } or { error }.
  async function quickAdd(platform, text, key) {
    const channel = clean(platform, text);
    if (!channel) return { error: INFO[platform].kind === 'link' ? 'I need a name, or a link that starts with https.' : 'That does not look like a ' + INFO[platform].name + ' account.' };
    if (settings.accounts.some((c) => c.platform === platform && c.channel.toLowerCase() === channel.toLowerCase())) return { error: 'This account is already added.' };
    if (key) await MCH.secrets.set(keyName(platform), key);
    const c = newAccount(platform, channel);
    save();
    await connect(c);
    renderTop();
    return { account: c };
  }
  function setOn(id, on) { const c = find(id); if (!c) return; c.on = on; save(); if (on) connect(c); else disconnect(id); renderTop(); }
  function reconnect(id) { const c = find(id); if (c && c.on) connect(c); }
  async function removeById(id) { const c = find(id); if (c) await remove(c, true); return !find(id); }

  /* ---------- in Settings ---------- */

  function list() {
    const rows = (settings.demo ? accounts.map((a) => a.cfg) : settings.accounts).map((c) => {
      const a = accounts.find((x) => x.id === c.id);
      return el('button', { type: 'button', class: 'acctRow', on: { click: () => open(c.id) } }, el('span', { class: 'dot ' + (a ? a.status : '') }), logo(c.platform),
        el('span', {}, c.nick || (a && a.name) || c.channel || INFO[c.platform].name, el('small', {}, a ? a.note : 'Turned off')));
    });
    return [...rows, el('div', { class: 'row left' }, button('Add account', () => add(), 'primary'), button('Connections', () => MCH.conn.open()))];
  }
  // Keeps the open page's status line current without rebuilding what is being typed.
  function changed(a) {
    const n = document.getElementById('acctNote');
    if (a.id !== openId || !n) return;
    n.textContent = INFO[a.platform].name + '. ' + a.note + '.';
    n.className = a.status === 'error' ? 'warn' : 'dim';
    if (a.platform === 'twitch' && a.user && cfgOf(a).channel !== a.name && find(a.id)) { find(a.id).channel = a.name; save(); }
  }

  MCH.accounts = { add, open, setChat, list, changed, cancel, sync, connectAll, lost, hasKey, quickAdd, setOn, reconnect, removeById };
  applyLook();
  boot();
})();
