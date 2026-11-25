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
