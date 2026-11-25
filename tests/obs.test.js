const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = (f) => fs.readFileSync(path.join(__dirname, '../js/' + f), 'utf8');
const ctx = { MCH: { sleep: () => Promise.resolve() }, crypto: globalThis.crypto, TextEncoder, btoa, Uint8Array, setTimeout, clearTimeout, Date, console };
vm.createContext(ctx);
vm.runInContext(src('obs.js'), ctx);
vm.runInContext(src('look.js'), ctx);
vm.runInContext(src('twitch.js'), ctx);
const O = ctx.MCH.obs, L = ctx.MCH.look;
const plain = (o) => JSON.parse(JSON.stringify(o));

test('signs in the way the obs-websocket documentation shows', async () => {
  assert.equal(await O.authString('supersecretpassword', 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=', '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY='), '1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=');
});

test('outputs are grouped, and unavailable ones say why', () => {
  const l = O.buildList({ stream: { outputActive: true, outputDuration: 5000 }, record: { outputActive: false }, backtrack: null, virtual_cam: { outputActive: false } },
    [{ name: 'TikTok Output', type: 'stream', active: false }, { name: 'Old', type: '', active: false }, { name: 'Clip', type: 'backtrack', active: true }]);
  assert.deepEqual(plain(l.map((o) => o.id)), ['main:stream', 'suite:TikTok Output', 'suite:Old', 'main:record', 'main:backtrack', 'suite:Clip', 'main:virtual_cam']);
  assert.equal(l[0].ms, 5000);
  assert.match(l.find((o) => o.id === 'main:backtrack').off, /Replay Buffer/);
});

test('only the virtual camera that is really running shows as on', () => {
  const l = O.buildList({ virtual_cam: { outputActive: true } }, [{ name: 'Cam2', type: 'virtual_cam', active: true }]);
  const main = l.find((o) => o.id === 'main:virtual_cam'), two = l.find((o) => o.id === 'suite:Cam2');
  assert.equal(main.active, false);
  assert.match(main.off, /one virtual camera/);
  assert.equal(two.active, true);
  assert.equal(two.off, '');
});

test('main stream starts first and stops last', () => {
  const l = [{ id: 'suite:A' }, { id: 'main:stream' }, { id: 'suite:B' }];
  assert.equal(O.startOrder(l)[0].id, 'main:stream');
  assert.equal(O.stopOrder(l)[2].id, 'main:stream');
});

test('platform icons come from the name', () => {
  for (const [n, p] of [['TikTok Output', 'tiktok'], ['tik tok', 'tiktok'], ['YouTube Output', 'youtube'], ['Twitter', 'x'], ['X', 'x'], ['Xbox', ''], ['Record Output', '']]) assert.equal(O.platformOf(n), p, n);
});

function fake(answers) {
  const calls = [];
  const c = { state: 'ok', request: async (t, d) => { calls.push([t, d]); const a = answers[t] || answers[d && d.requestType]; if (a instanceof O.ObsError) throw a; return typeof a === 'function' ? a() : a || {}; } };
  return { c, calls };
}
test('works without Aitum, and never asks OBS for stream settings', async () => {
  const { c, calls } = fake({ CallVendorRequest: new O.ObsError(600, 'No vendor') });
  const o = new O.Outputs(c);
  assert.equal(await o.refresh(), true);
  assert.equal(o.hasSuite, false);
  assert.equal(o.list.length, 4);
  assert.ok(!calls.some(([t]) => /Settings|ServiceSettings/.test(t)));
});
test('a lost connection keeps the last list', async () => {
  let dead = false;
  const { c } = fake({ GetStreamStatus: () => { if (dead) throw vm.runInContext("new Error('gone')", ctx); return { outputActive: true }; }, CallVendorRequest: new O.ObsError(600, 'x') });
  const o = new O.Outputs(c);
  await o.refresh();
  dead = true;
  assert.equal(await o.refresh(), false);
  assert.equal(o.find('main:stream').active, true);
});
test('Aitum outputs use Aitum commands, built-in ones use OBS commands', async () => {
  const { c, calls } = fake({});
  const o = new O.Outputs(c), suite = { id: 'suite:R', name: 'R', kind: 'record', main: false }, main = { id: 'main:record', kind: 'record', main: true };
  await o.start(suite); await o.stop(suite); await o.saveClip(suite); await o.split(suite); await o.chapter(suite);
  await o.start(main); await o.stop(main); await o.saveClip(main); await o.split(main); await o.chapter(main);
  const names = calls.map(([t, d]) => (d && d.requestType) || t);
  assert.deepEqual(names, ['start_output', 'stop_output', 'save_backtrack', 'TriggerHotkeyByName', 'add_chapter', 'StartRecord', 'StopRecord', 'SaveReplayBuffer', 'SplitRecordFile', 'CreateRecordChapter']);
  assert.equal(calls[0][1].vendorName, 'aitum-stream-suite');
  assert.equal(calls[0][1].requestData.output, 'R');
});
test('an output that never starts is reported, not assumed live', async () => {
  const { c } = fake({ CallVendorRequest: { responseData: { success: true, outputs: [{ name: 'T', type: 'stream', active: false }] } } });
  const o = new O.Outputs(c);
  await o.refresh();
  await assert.rejects(o.drive(o.find('suite:T'), true, 30), /did not start/);
});

test('new settings survive damage', () => {
  const s = L.sanitize({ obsPort: 'x', livePick: ['main:stream', 5], liveHidden: 'no', liveNames: { a: ' TikTok ', b: 3 }, liveTags: [1], modHidden: ['poll', null], modLinks: [{ name: 'ok', url: 'https://a.b/' }, { name: 'bad', url: 'javascript:alert(1)' }, { name: 'file', url: 'file:///c:/x' }, null] });
  assert.equal(s.obsPort, 4455);
  assert.deepEqual(plain(s.livePick), ['main:stream']);
  assert.deepEqual(plain(s.liveHidden), []);
  assert.deepEqual(plain(s.liveNames), { a: 'TikTok' });
  assert.deepEqual(plain(s.liveTags), {});
  assert.deepEqual(plain(s.modHidden), ['poll']);
  assert.deepEqual(plain(s.modLinks), [{ name: 'ok', url: 'https://a.b/' }]);
});

test('moderator calls match Twitch’s reference', async () => {
  const a = new ctx.MCH.twitch.TwitchAccount({ clientId: 'c', access: 'a' }, () => {});
  a.user = { id: '10' };
  const calls = [];
  a.api = async (m, p, q, b) => { calls.push([m, p, plain(q || null), plain(b || null)]); return { data: [{}] }; };
  const mod = { broadcaster_id: '10', moderator_id: '10' };
  await a.setChatSettings({ slow_mode: true }); await a.clearChat(); await a.setShield(true); await a.raid('7'); await a.shoutout('7');
  await a.startPoll('q', ['a', 'b'], 60); await a.endPrediction('p', 'RESOLVED', 'o1'); await a.warn('5', 'r'); await a.addVip('5'); await a.suspicious('5', ''); await a.resolveUnban('u', 'denied', '');
  assert.deepEqual(calls[0], ['PATCH', '/chat/settings', mod, { slow_mode: true }]);
  assert.deepEqual(calls[1], ['DELETE', '/moderation/chat', mod, null]);
  assert.deepEqual(calls[2], ['PUT', '/moderation/shield_mode', mod, { is_active: true }]);
  assert.deepEqual(calls[3], ['POST', '/raids', { from_broadcaster_id: '10', to_broadcaster_id: '7' }, null]);
  assert.deepEqual(calls[4][2], { from_broadcaster_id: '10', to_broadcaster_id: '7', moderator_id: '10' });
  assert.deepEqual(calls[5][3], { broadcaster_id: '10', title: 'q', choices: [{ title: 'a' }, { title: 'b' }], duration: 60 });
  assert.deepEqual(calls[6][3], { broadcaster_id: '10', id: 'p', status: 'RESOLVED', winning_outcome_id: 'o1' });
  assert.deepEqual(calls[7][3], { data: { user_id: '5', reason: 'r' } });
  assert.deepEqual(calls[8], ['POST', '/channels/vips', { broadcaster_id: '10', user_id: '5' }, null]);
  assert.deepEqual(calls[9], ['DELETE', '/moderation/suspicious_users', Object.assign({}, mod, { user_id: '5' }), null]);
  assert.deepEqual(calls[10][2], Object.assign({}, mod, { unban_request_id: 'u', status: 'denied' }));
});
test('actions an older sign-in does not allow are known', () => {
  const a = new ctx.MCH.twitch.TwitchAccount({}, () => {});
  assert.equal(a.can('x'), true); // not known yet
  a.scopes = ['user:read:chat'];
  assert.equal(a.can('channel:manage:raids'), false);
});
