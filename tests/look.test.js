const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { MCH: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/look.js'), 'utf8'), ctx);
const L = ctx.MCH.look;
const plain = (o) => JSON.parse(JSON.stringify(o));

test('empty or damaged settings become a complete default set', () => {
  for (const bad of [undefined, null, {}, 'x', 5, [], { show: 'no', colors: null, themes: {} }]) {
    assert.deepEqual(plain(L.sanitize(bad)), plain(L.defaults));
  }
});

test('Stage 1 settings carry over', () => {
  const s = L.sanitize({ twitchClientId: 'abc', confirmBans: false, demo: true });
  assert.equal(s.twitchClientId, 'abc');
  assert.equal(s.confirmBans, false);
  assert.equal(s.demo, true);
});

test('bad colors, fonts and sizes are replaced', () => {
  const s = L.sanitize({ colors: { bg: 'red;}', text: '#ABCDEF' }, font: 'x"; }', size: 900 });
  assert.equal(s.colors.bg, L.defaults.colors.bg);
  assert.equal(s.colors.text, '#abcdef');
  assert.equal(s.font, 'Segoe UI');
  assert.equal(s.size, 28);
});

test('changing a loaded copy never changes the defaults', () => {
  const s = L.sanitize({});
  s.colors.names.twitch = '#000000';
  s.show.total = false;
  assert.equal(L.defaults.colors.names.twitch, '#bf94ff');
  assert.equal(L.defaults.show.total, true);
});

test('broken themes are dropped and good ones completed', () => {
  const s = L.sanitize({ themes: [null, { name: '  ' }, { name: 'Night', colors: { bg: '#000000' } }] });
  assert.equal(s.themes.length, 1);
  assert.equal(s.themes[0].colors.bg, '#000000');
  assert.equal(s.themes[0].colors.text, L.defaults.colors.text);
});

test('automatic text is readable on every background', () => {
  for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51) {
    const bg = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    const c = L.resolved(Object.assign({}, L.defaults.colors, { bg }));
    assert.ok(L.contrast(c.text, bg) >= 4.5, bg);
    assert.ok(L.contrast(L.fit('#0000ff', bg, 4.5), bg) >= 4.5, bg);
  }
});

test('manual override uses exact colors', () => {
  const c = Object.assign({}, L.defaults.colors, { auto: false, bg: '#000000', text: '#010101' });
  assert.equal(L.resolved(c).text, '#010101');
  assert.equal(L.nameColor({ account: { platform: 'twitch' }, color: '' }, Object.assign(c, { names: { twitch: '#000001', tiktok: '#000002' } })), '#000001');
});

test('name colors go by platform, or the viewer\'s own when chosen', () => {
  const c = Object.assign({}, L.defaults.colors);
  const m = { account: { platform: 'twitch' }, color: '#ffff00' };
  assert.equal(L.nameColor(m, c), '#bf94ff');
  c.ownNames = true;
  assert.equal(L.nameColor(m, c), '#ffff00');
  assert.equal(L.nameColor({ account: { platform: 'tiktok' }, color: '' }, c), '#4dd0e1');
});

test('clean mode hides only what is chosen and restores it', () => {
  const s = L.sanitize({ clean: true, cleanHide: { accounts: false } });
  let v = L.visible(s);
  assert.equal(v.accounts, true);
  assert.equal(v.gear, false);
  assert.equal(v.timestamps, true);
  s.clean = false;
  v = L.visible(s);
  assert.equal(v.gear, true);
});

test('old default colors move to the new ones once, and chosen colors stay', () => {
  const s = L.sanitize({ colors: { bg: '#16171b', text: '#abcdef', time: '#9a9ea8' } });
  assert.equal(s.colors.bg, L.defaults.colors.bg);
  assert.equal(s.colors.text, '#abcdef');
  assert.equal(s.colors.time, L.defaults.colors.time);
  assert.equal(L.sanitize({ lookVersion: 2, colors: { bg: '#16171b' } }).colors.bg, '#16171b');
});

test('stat numbers stay readable on their box', () => {
  for (const viewers of ['#000000', '#2b2d35', '#0000ff', '#ff0000']) {
    const c = Object.assign({}, L.defaults.colors, { stats: { viewers, total: '#ffffff' } });
    assert.ok(L.contrast(L.statColor(c, 'viewers'), '#2b2d35') >= 4.5, viewers);
  }
  assert.equal(L.statColor(L.defaults.colors, 'total'), '#ffffff');
});

test('accounts are kept when good, and dropped or repaired when not', () => {
  const s = L.sanitize({ accounts: [
    { id: 'a1', platform: 'kick', channel: 'someone', nick: '  Main  ', every: 999, color: 'red', chat: false, token: 'no' },
    { id: 'a1', platform: 'kick', channel: 'same id' }, { id: '../x', platform: 'kick' }, { id: 'a2', platform: 'nope' }, null, 'x',
    { id: 'a3', platform: 'instagram', channel: 'javascript:alert(1)' }, { id: 'a4', platform: 'other', channel: 'https://example.com/chat' },
  ] });
  assert.deepEqual(plain(s.accounts.map((a) => a.id)), ['a1', 'a4']);
  const a = s.accounts[0];
  assert.equal(a.nick, 'Main');
  assert.equal(a.every, 60);
  assert.equal(a.color, '');
  assert.equal(a.chat, false);
  assert.equal(a.viewers, true);
  assert.ok(!('token' in a));
});

test('one account can have its own color', () => {
  const m = { account: { platform: 'kick' }, color: '' };
  assert.equal(L.nameColor(m, L.defaults.colors, '#ffff00'), '#ffff00');
  assert.equal(L.nameColor(m, L.defaults.colors, ''), L.defaults.colors.names.kick);
});
