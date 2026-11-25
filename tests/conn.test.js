const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { MCH: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/conn.js'), 'utf8'), ctx);
const { Watch, lasted } = ctx.MCH.connWatch;
const obs = (state, note = '') => [{ id: 'obs', name: 'OBS', state, note, announce: true }];
const words = (w) => Array.from(w.history, (h) => h.text);

test('a first connection is confirmed, but not again at every check', () => {
  const w = new Watch();
  assert.equal(w.feed(obs('off'), 0).length, 0);
  w.feed(obs('connecting'), 1000);
  assert.equal(w.feed(obs('ok'), 2000)[0], 'OBS is connected.');
  assert.equal(w.feed(obs('ok'), 3000).length, 0);
  assert.equal(w.items.get('obs').since, 2000);
  assert.deepEqual(words(w), ['OBS connected']);
});

test('a drop is shown after a moment, with its time, and clears when it is back', () => {
  const w = new Watch();
  w.feed(obs('ok'), 0);
  w.feed(obs('reconnecting', 'Lost'), 10000);
  assert.equal(w.down(11000).length, 0);
  assert.equal(w.down(13500).length, 1);
  assert.equal(w.down(13500)[0].lostAt, 10000);
  assert.equal(w.feed(obs('ok'), 58000)[0], 'OBS is connected again. It was down for 48 seconds.');
  assert.equal(w.down(60000).length, 0);
  assert.deepEqual(words(w), ['OBS connected again after 48 seconds', 'OBS disconnected', 'OBS connected']);
});

test('a blink is only written in the history', () => {
  const w = new Watch();
  w.feed(obs('ok'), 0);
  w.feed(obs('reconnecting'), 1000);
  w.down(2000);
  assert.equal(w.feed(obs('ok'), 2500).length, 0);
  assert.equal(w.history.length, 3);
});

test('hiding the bar lasts until the next drop or a new problem', () => {
  const w = new Watch();
  w.feed(obs('ok'), 0);
  w.feed(obs('reconnecting'), 1000);
  assert.equal(w.down(9000).length, 1);
  w.dismiss();
  assert.equal(w.down(9500).length, 0);
  w.feed(obs('error', 'Password changed'), 10000);
  assert.equal(w.down(10500).length, 1);
  w.dismiss();
  w.feed(obs('ok'), 11000);
  w.feed(obs('reconnecting'), 12000);
  assert.equal(w.down(16000).length, 1);
});

test('turning something off, removing it, or never connecting is not a drop', () => {
  const w = new Watch();
  const two = (s) => [...obs('error', 'bad password'), { id: 'a', name: 'Kick', state: s, note: '' }];
  w.feed(two('ok'), 0);
  w.feed(two('off'), 1000);
  assert.equal(w.down(9000).length, 0);
  w.feed(two('reconnecting'), 10000);
  assert.equal(w.down(20000).length, 0);
  w.feed(two('ok'), 21000);
  w.feed(two('reconnecting'), 22000);
  w.feed(obs('error', 'bad password'), 23000);
  assert.equal(w.down(40000).length, 0);
});

test('the history stays short and times read well', () => {
  const w = new Watch();
  for (let i = 0; i < 200; i++) w.feed(obs(i % 2 ? 'reconnecting' : 'ok'), i * 1000);
  assert.equal(w.history.length, 40);
  assert.equal(lasted(300), '1 second');
  assert.equal(lasted(61000), '1 minute');
  assert.equal(lasted(3 * 3600000 + 120000), '3 hours 2 min');
});
