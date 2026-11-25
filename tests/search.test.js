const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { MCH: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/search.js'), 'utf8'), ctx);
const S = ctx.MCH.search;
const msg = (name, text, platform = 'twitch', acct = 'Me') => ({ name, login: name.toLowerCase(), parts: [{ text }], account: { platform, name: acct } });
const hit = (q, m, f) => { const p = S.parse(q); return !!p && S.matches(m, p, f); };

test('nothing to search gives null', () => {
  for (const q of ['', '   ', '"', '""', 'from:', '  from: ']) assert.equal(S.parse(q), null, JSON.stringify(q));
});

test('words match in any order, ignoring case', () => {
  assert.ok(hit('PLAY great', msg('Bob', 'That was a Great play')));
  assert.ok(!hit('great game', msg('Bob', 'a great play')));
});

test('quotes need the exact phrase, even before the closing quote', () => {
  assert.ok(hit('"great play"', msg('Bob', 'a great play')));
  assert.ok(!hit('"play great"', msg('Bob', 'a great play')));
  assert.ok(hit('"great pl', msg('Bob', 'a great play')));
});

test('usernames match, and from: looks only at usernames', () => {
  assert.ok(hit('bob', msg('Bob', 'hi')));
  assert.ok(hit('from:@bob', msg('Bob', 'hi')));
  assert.ok(!hit('from:bob', msg('Ann', 'hi bob')));
  assert.ok(hit('from:bob hello', msg('Bob', 'hello')));
  assert.ok(!hit('from:bob hello', msg('Bob', 'bye')));
});

test('a display name in another alphabet is found by login too', () => {
  const m = msg('さくら', 'hi'); m.login = 'sakura_tv';
  assert.ok(hit('sakura', m) && hit('from:さくら', m));
});

test('symbols are plain text, never patterns', () => {
  for (const q of ['.*', '(', '[', 'a\\', '$5', 'c++', '/ban', 'x-y', '{', '^', '?', '|']) {
    assert.ok(hit(q, msg('Bob', 'has ' + q + ' inside')), q);
    assert.ok(!hit(q, msg('Bob', 'zzz')), q);
  }
});

test('emote names are searchable', () => {
  const m = msg('Bob', 'nice ');
  m.parts.push({ emote: '25', text: 'Kappa' });
  assert.ok(hit('kappa', m));
});

test('platform and account filters', () => {
  const m = msg('Bob', 'hi', 'tiktok', 'Mine');
  assert.ok(hit('hi', m, { platform: 'tiktok' }));
  assert.ok(!hit('hi', m, { platform: 'twitch' }));
  assert.ok(hit('hi', m, { account: 'tiktok:Mine' }));
  assert.ok(!hit('hi', m, { account: 'tiktok:Other' }));
});

test('arrows start at the newest, move and wrap', () => {
  assert.equal(S.step([], null, -1), null);
  assert.equal(S.step([1, 2, 3], null, -1), 3);
  assert.equal(S.step([1, 2, 3], null, 1), 1);
  assert.equal(S.step([1, 2, 3], 3, -1), 2);
  assert.equal(S.step([1, 2, 3], 1, -1), 3);
  assert.equal(S.step([1, 2, 3], 3, 1), 1);
  assert.equal(S.step([1, 2, 3], 99, -1), 3);
});
