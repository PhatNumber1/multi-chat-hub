(function () {
  'use strict';
  // The Help page: a setup checklist that ticks itself, then how everything works.
  const { el, settings } = MCH;
  const { openPage, openPanel, head, section, toast, accounts } = MCH.app;

  const LINKS = {
    twitchApps: ['Twitch developer console', 'https://dev.twitch.tv/console/apps/create'],
    activate: ['twitch.tv/activate', 'https://www.twitch.tv/activate'],
    ytApi: ['YouTube Data API v3 in Google Cloud', 'https://console.cloud.google.com/apis/library/youtube.googleapis.com'],
    ytKeys: ['Google Cloud credentials', 'https://console.cloud.google.com/apis/credentials'],
    ytDocs: ['YouTube API getting started', 'https://developers.google.com/youtube/data/getting-started'],
    euler: ['Euler Stream', 'https://www.eulerstream.com/'],
    eulerPrice: ['Euler Stream plans', 'https://www.eulerstream.com/pricing'],
    obsRemote: ['OBS remote control guide', 'https://obsproject.com/kb/remote-control-guide'],
    aitum: ['Aitum', 'https://aitum.tv/'],
    releases: ['Multi Chat Hub downloads', 'https://github.com/PhatNumber1/multi-chat-hub/releases'],
    readme: ['Multi Chat Hub on GitHub', 'https://github.com/PhatNumber1/multi-chat-hub'],
    issues: ['Report a problem', 'https://github.com/PhatNumber1/multi-chat-hub/issues'],
  };
  // May open inside OBS or in the normal browser. Copy is there to choose.
  function link(id) {
    const [text, href] = LINKS[id];
    return el('span', { class: 'helpLink' }, el('a', { href, target: '_blank', rel: 'noopener' }, text),
      el('button', { type: 'button', class: 'copyBtn', 'aria-label': 'Copy the link to ' + text, on: { click: async () => toast(await MCH.copy(href) ? 'Link copied' : 'Could not copy') } }, 'Copy'));
  }
  const go = (text, fn) => el('button', { type: 'button', class: 'primary', on: { click: fn } }, text);
  const row = (...kids) => el('div', { class: 'row left' }, ...kids);
  const steps = (...list) => el('ol', { class: 'steps' }, ...list.map((s) => el('li', {}, ...[].concat(s))));
  const points = (...list) => el('ul', { class: 'steps' }, ...list.map((s) => el('li', {}, ...[].concat(s))));
  const p = (...kids) => el('p', {}, ...kids);
  const b = (t) => el('b', {}, t);
  const keyed = (icon, name, text) => el('div', { class: 'helpKey' }, MCH.icon(icon), el('span', {}, b(name), ' ', text));
  const goLive = () => openPanel('Go Live'), add = (platform) => MCH.accounts.add(platform);

  function checklist() {
    const real = settings.demo ? [] : settings.accounts, obs = MCH.live.state();
    const list = [
      ['Add a stream account', real.length > 0, 'Add account', () => add()],
      ['See one connect', real.some((c) => accounts.some((a) => a.id === c.id && a.status === 'ok' && !a.link)), 'Connections', () => MCH.conn.open()],
      ['Connect OBS for the Go Live buttons', !settings.demo && obs.state === 'ok', 'Go Live settings', goLive],
      ['Pick your look', !!settings.helpLook, 'Look settings', () => { settings.helpLook = true; MCH.saveSettings(); openPanel('Colors'); }],
    ];
    const done = list.filter((x) => x[1]).length;
    return el('div', { class: 'card' }, el('b', {}, done === list.length ? 'You are all set up.' : done + ' of ' + list.length + ' done'),
      ...list.map(([text, ok, label, fn], i) => el('div', { class: 'todo' + (ok ? ' ok' : '') }, ok ? MCH.icon('ok') : el('span', { class: 'num' }, String(i + 1)), el('span', {}, text), el('button', { type: 'button', on: { click: fn } }, label))),
      settings.demo ? el('p', { class: 'warn' }, 'Demo chat is on. Turn it off at the bottom of Settings to use your real accounts.') : '');
  }

  function page() {
    const s = (title, ...kids) => section(title, ...kids);
    return [head('Help', MCH.icon('help')),
      MCH.bot.box,
      p('Viewers never see any of this.'),
      el('h3', {}, 'Set it up'), checklist(),

      el('h3', {}, 'Step by step'),
      s('1. Connect OBS',
        p('This makes the Go Live buttons work. Connecting does not start anything.'),
        p(b('By itself: '), 'close OBS, run the installer from ', link('releases'), ' and leave ', b('Connect to OBS by itself'), ' ticked. Open OBS and the light turns green. Run it again if you ever change the WebSocket password.'),
        p(b('By hand:')),
        steps(['In OBS, open ', b('Tools > WebSocket Server Settings'), '.'],
          ['Tick ', b('Enable WebSocket server'), ' and check that ', b('Server Port'), ' is ', b('4455'), '.'],
          ['Choose ', b('Show Connect Info'), ', then ', b('Copy'), ' beside ', b('Server Password'), '.'],
          ['Open the Go Live settings with the button below, click the password box and press ', b('Ctrl+V'), '.'],
          ['Choose ', b('Connect to OBS'), '. The light turns green with a check and says ', b('Connected'), '.'],
          'Close the password window in OBS. Keep it off your stream.'),
        row(go('Open Go Live settings', goLive)), p('More: ', link('obsRemote'))),
      s('2. Add Twitch',
        p('You make a free Client ID once. It is not a password.'),
        steps(['Open the ', link('twitchApps'), ' and sign in. Twitch asks for two-factor sign-in to be on.'],
          ['Name: anything. OAuth Redirect URL: ', b('http://localhost'), '. Category: any. Client Type: ', b('Public'), '.'],
          ['Choose ', b('Create'), ', open the app again and copy the ', b('Client ID'), '. Ignore any secret.'],
          ['In the dock choose ', b('Add account > Twitch'), ', paste it and choose ', b('Sign in to Twitch'), '.'],
          ['Open ', link('activate'), ', enter the code the dock shows and choose ', b('Authorize'), '.']),
        p(b('A second Twitch account: '), 'log in to that account in your browser first, then add Twitch again. The same Client ID works.'),
        row(go('Add Twitch', () => add('twitch')))),
      s('3. Add Kick',
        steps(['Choose ', b('Add account > Kick'), '.'], 'Type the channel name or paste its link.', 'That is all. There is no sign-in.'),
        row(go('Add Kick', () => add('kick')))),
      s('4. Add TikTok',
        p('TikTok has no chat for apps, so this uses a free outside service called Euler Stream. It is read-only.'),
        steps(['Open ', link('euler'), ' and make a free account. The free plan is called ', b('Community'), ' (', link('eulerPrice'), ').'],
          'Make an API key on its dashboard and copy it.',
          ['Choose ', b('Add account > TikTok'), ', type your TikTok name and paste the key.'],
          'Until you are live it says Not live and checks every 3 minutes. Connect now, in its settings, checks at once.'),
        row(go('Add TikTok', () => add('tiktok')))),
      s('5. Add YouTube',
        p('This uses your own free key from Google. It is read-only.'),
        steps(['Open ', link('ytApi'), '. If Google asks, make a project. Any name is fine.'],
          ['Choose ', b('Enable'), '.'],
          ['Open ', link('ytKeys'), ' and choose ', b('Create credentials > API key'), '. Copy the key.'],
          ['Do not choose ', b('Try this API'), '. It is only a help page.'],
          ['If Google offers restrictions, limit it to ', b('YouTube Data API v3'), '. Leave website restrictions off, because the dock is not a website.'],
          ['Choose ', b('Add account > YouTube'), ', type your @handle and paste the key.']),
        p('The free daily limit lasts about 5.4 hours of chat. The slider in the account’s settings makes it last longer. More: ', link('ytDocs')),
        row(go('Add YouTube', () => add('youtube')))),
      s('6. Instagram, Facebook, Rumble, Trovo, X and others',
        p('Their chat cannot be read from inside OBS yet, so you get a box that opens the page in your browser.'),
        row(go('Add account', () => add()))),

      el('h3', {}, 'How everything works'),
      s('The buttons at the top',
        keyed('search', 'Search', 'finds words in chat. Ctrl+F works too.'), keyed('shield', 'Moderator', 'opens every Twitch action.'),
        keyed('help', 'Help', 'opens this page.'), keyed('clean', 'Clean mode', 'shows only chat. The small corner button brings it all back.'), keyed('gear', 'Settings', 'has everything else.')),
      s('Account boxes',
        keyed('eye', 'Number', 'is how many people are watching. Click it for that account’s settings.'),
        keyed('chat', 'Chat bubble', 'shows or hides that account’s chat.'), keyed('people', 'Total viewers', 'adds up your accounts.'), keyed('plus', 'Add account', 'adds another one.'),
        p('In an account’s settings you can change its nickname, turn it on or off, pick its name color, move it or remove it.')),
      s('Connection lights',
        keyed('ok', 'Green check', 'means connected, and since when.'), keyed('wait', 'Yellow', 'means it dropped and is reconnecting by itself.'), keyed('bad', 'Red', 'means it needs you, such as a new sign-in.'),
        p('If something drops, a bar appears at the top with the time, even in clean mode. It clears itself when the connection is back.'),
        row(go('See all connections', () => MCH.conn.open()))),
      s('Chat',
        points('Click a name, or right-click a message, for timeouts, bans, delete, copy and profile. Those work on Twitch.', 'Scroll up to pause. Jump to latest goes back to live.', 'Green lines are moderators. You can turn that off.'),
        p(b('Search: '), 'several words find messages with all of them. "Quotes" find an exact phrase. from:name finds one person. It covers messages since the dock opened.')),
      s('Go Live buttons',
        points('Go Live asks where, then starts the main stream first. Your choice is remembered.', 'Each small button starts or ends one stream.', 'The arrow opens every output: recording, clips, chapters, file splits, virtual cameras, and start or stop everything.', 'End stream always works, even while something is still starting.'),
        p('Outputs you made in Aitum Stream Suite show up by themselves (', link('aitum'), '). Add outputs and change stream keys in OBS or Aitum. The dock never reads stream keys.'),
        p('Rename, hide or tag outputs in the Go Live settings.'), row(go('Open Go Live settings', goLive))),
      s('Moderator page',
        points('There is a tab for each Twitch account.', 'Greyed-out actions say why, such as only while live.', 'Choose what shows picks which actions you see.'),
        row(go('Open Moderator page', () => document.getElementById('mod').click()))),
      s('Look and clean mode',
        points('Change colors, font, size and what shows. Save your colors as themes.', 'The dock picks the biggest of four sizes that leaves room for chat.', 'You choose what clean mode hides.'),
        row(go('Open look settings', () => openPanel('Colors')))),

      el('h3', {}, 'Fix a problem'),
      s('OBS will not connect',
        points('“Did not accept that WebSocket password”: copy it again with the Copy button in OBS and paste it again.', 'It keeps saying reconnecting: check that Enable WebSocket server is ticked and the port matches.', 'Aitum outputs are missing: make sure Aitum Stream Suite is installed, then restart OBS.')),
      s('Twitch problems',
        points('It asks you to sign in again: open the account’s box and sign in. This also happens after about 30 days without use.', 'Actions are greyed out: sign out and in once so Twitch allows the newer ones.', '“Does not recognise that Client ID”: copy it again, and check the app’s Client Type is Public.')),
      s('Kick, TikTok or YouTube problems',
        points('“Update Multi Chat Hub” on Kick: Kick changed something. Get the newest version below.', '“Did not accept the key”: copy the key again and save it in the account’s settings.', 'TikTok says Not live but you are: choose Connect now in its settings, and check the name.', 'YouTube’s daily limit is used up: it resets at midnight Pacific time.')),
      s('A link does not open', p('Links can open in a window inside OBS. To use your normal browser, choose Copy beside the link and paste it there.')),
      s('Try it safely', p('Demo chat, at the bottom of Settings, uses made-up chat and a made-up OBS. Nothing real happens.')),

      el('h3', {}, 'Privacy and updates'),
      s('Where your sign-ins are kept', p('On this PC, encrypted, inside OBS’s own browser storage. Passwords and keys are never in the files on GitHub. This stops casual reading, not malware running as you.')),
      s('Updates and links', p('You have version ' + MCH.version + '.'), p(link('releases')), p(link('readme')), p(link('issues')))];
  }

  // Finds one section, for the helper's answers.
  function find(title) {
    const d = page().find((n) => n.matches && n.matches('details') && n.querySelector('summary').textContent === title);
    if (!d) return null;
    const first = d.querySelector('p, li, .helpKey'), list = [...d.querySelectorAll('li')].slice(0, 2).map((n) => n.textContent.replace(/Copy(?= |$|\.)/g, '').trim());
    return { text: first && first.tagName === 'P' ? first.textContent.replace(/Copy(?= |$|\.)/g, '').trim() : first && first.tagName === 'LI' ? list.join(' ') : [...d.querySelectorAll('.helpKey')].map((n) => n.textContent).join(' ') };
  }
  function show(title) {
    MCH.app.openSections.add(title);
    openPage(page);
    const d = [...document.querySelectorAll('#panel details')].find((n) => n.querySelector('summary').textContent === title);
    if (d) d.scrollIntoView({ block: 'start' });
  }
  function open() { openPage(page); MCH.bot.focus(); }
  document.getElementById('help').addEventListener('click', open);
  MCH.help = { open, show, section: find, LINKS };
})();
