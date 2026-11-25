const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// A pretend browser: scripted fetch replies, sockets the test drives, and a clock that only moves by hand.
function world(reply) {
  const w = { calls: [], sockets: [], timers: new Map(), events: [], n: 0 };
  class Sock {
    constructor(url) { this.url = url; this.sent = []; this.readyState = 1; w.sockets.push(this); }
    send(t) { this.sent.push(JSON.parse(t)); }
    close() { this.readyState = 3; }
    push(o) { this.onmessage({ data: typeof o === 'string' ? o : JSON.stringify(o) }); }
  }
  const ctx = {
    MCH: { kickChatKey: 'KEY' }, URL, URLSearchParams, WebSocket: Sock,
    setTimeout: (fn, ms) => { w.timers.set(++w.n, { fn, ms }); return w.n; }, clearTimeout: (id) => w.timers.delete(id),
    fetch: async (url, o) => { w.calls.push({ url, o }); const [status, body] = reply(new URL(url), w); if (status === 0) throw new TypeError('offline'); return { ok: status < 300, status, json: async () => body }; },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/platforms.js'), 'utf8'), ctx);
  w.P = ctx.MCH.platforms;
  w.emit = (e, d) => w.events.push([e, d]);
  w.of = (e) => w.events.filter((x) => x[0] === e).map((x) => x[1]);
  w.fire = async (ms) => { for (const [id, t] of [...w.timers]) if (t.ms === ms) { w.timers.delete(id); t.fn(); } await w.settle(); };
  w.settle = () => new Promise((r) => setImmediate(() => setImmediate(r)));
  return w;
}
const waits = (w) => [...w.timers.values()].map((t) => t.ms);

test('names, links and IDs are understood, and nonsense is refused', () => {
  const { clean, youtubeTarget, linkUrl } = world(() => [200, {}]).P;
  for (const t of ['xqc', '@xqc', 'https://kick.com/xqc', 'kick.com/xqc?a=1']) assert.equal(clean('kick', t), 'xqc');
  for (const t of ['Some.User', '@Some.User', 'https://www.tiktok.com/@Some.User/live']) assert.equal(clean('tiktok', t), 'Some.User');
  for (const t of ['', 'two words', 'a/b', '<script>']) { assert.equal(clean('kick', t), null); assert.equal(clean('tiktok', t), null); }
  assert.equal(clean('youtube', 'https://www.youtube.com/@Some.Name/streams'), '@Some.Name');
  assert.equal(clean('youtube', 'https://www.youtube.com/watch?v=abcdefghijk&t=1'), 'https://youtu.be/abcdefghijk');
  assert.equal(clean('youtube', 'https://www.youtube.com/live/abcdefghijk'), 'https://youtu.be/abcdefghijk');
  assert.equal(youtubeTarget('UC' + 'a'.repeat(22)).channel, 'UC' + 'a'.repeat(22));
  assert.equal(youtubeTarget('https://www.youtube.com/channel/UC' + 'a'.repeat(22)).channel, 'UC' + 'a'.repeat(22));
  assert.equal(clean('youtube', ''), null);
  assert.equal(linkUrl('instagram', '@me.too'), 'https://www.instagram.com/me.too');
  assert.equal(linkUrl('other', 'me'), null);
  assert.equal(linkUrl('other', 'javascript:alert(1)'), null);
  assert.equal(linkUrl('other', 'http://plain.example'), null);
});

const kickReply = (u) => (u.hostname === 'kick.com' ? [200, { id: 1, user: { username: 'Some_One' }, chatroom: { id: 668 }, livestream: { is_live: true, viewer_count: 12 } }] : [500, {}]);
test('Kick joins the chat room, reads messages once, and removes deleted ones', async () => {
  const w = world(kickReply), a = new w.P.KickAccount({ id: 'k', platform: 'kick', channel: 'Some_One' }, w.emit);
  a.start();
  await w.settle();
  assert.equal(w.calls[0].url, 'https://kick.com/api/v2/channels/some-one');
  assert.equal(a.viewers, 12);
  const s = w.sockets[0];
  assert.match(s.url, /\/app\/KEY\?/);
  s.push({ event: 'pusher:connection_established', data: '{}' });
  assert.equal(s.sent[0].data.channel, 'chatrooms.668.v2');
  s.push({ event: 'pusher_internal:subscription_succeeded', data: '{}' });
  assert.equal(a.status, 'ok');
  const msg = { id: 'm1', content: 'hi [emote:37226:KEKW]!', type: 'reply', created_at: '2026-11-25T14:11:18+00:00', sender: { id: 5, username: 'Vip_Guy', slug: 'vip-guy', identity: { color: '#FFAE76', badges: [{ type: 'moderator' }] } }, metadata: { original_sender: { username: 'Bob' }, original_message: { content: 'yo [emote:1:LUL]' } } };
  for (let i = 0; i < 2; i++) s.push({ event: 'App\\Events\\ChatMessageEvent', data: JSON.stringify(msg) });
  const [m] = w.of('message');
  assert.equal(w.of('message').length, 1);
  assert.equal(m.name, 'Vip_Guy');
  assert.equal(m.login, 'vip_guy');
  assert.equal(a.profileUrl(m.login), 'https://kick.com/vip-guy');
  assert.equal(m.userId, '5');
  assert.equal(m.roles[0], 'moderator');
  assert.equal(m.parts.map((p) => p.text).join('|'), 'hi |KEKW|!');
  assert.equal(m.parts[1].img, 'https://files.kick.com/emotes/37226/fullsize');
  assert.equal(m.replyTo.text, 'yo LUL');
  s.push({ event: 'App\\Events\\MessageDeletedEvent', data: JSON.stringify({ message: { id: 'm1' } }) });
  s.push({ event: 'App\\Events\\UserBannedEvent', data: JSON.stringify({ user: { id: 5 } }) });
  s.push({ event: 'App\\Events\\ChatroomClearEvent', data: '{}' });
  s.push('not json');
  assert.equal(w.of('remove').map((r) => r.id || r.userId || r.all).join(), 'm1,5,true');
  s.push({ event: 'pusher:ping', data: '{}' });
  assert.equal(s.sent.at(-1).event, 'pusher:pong');
});

test('Kick reconnects after a drop, and says so when Kick changes its key', async () => {
  const w = world(kickReply), a = new w.P.KickAccount({ id: 'k', platform: 'kick', channel: 'x' }, w.emit);
  a.start();
  await w.settle();
  w.sockets[0].onclose({});
  assert.equal(a.status, 'reconnecting');
  [...w.timers.values()].find((t) => t.ms >= 2000 && t.ms < 3000).fn();
  assert.equal(w.sockets.length, 2);
  w.sockets[1].push({ event: 'pusher:error', data: { code: 4001, message: 'no' } });
  assert.equal(a.status, 'error');
  assert.match(a.note, /Update Multi Chat Hub/);
  // The half-open connection's own watchdog must not hide the reason.
  for (const t of [...w.timers.values()].filter((x) => x.ms === 150000)) t.fn();
  assert.equal(a.status, 'error');
});

test('Kick: an unknown name is an error, and no network is a retry', async () => {
  let mode = 404;
  const w = world(() => [mode, {}]), a = new w.P.KickAccount({ id: 'k', platform: 'kick', channel: 'x' }, w.emit);
  a.start();
  await w.settle();
  assert.equal(a.status, 'error');
  assert.equal(w.timers.size, 0);
  mode = 0;
  a.find();
  await w.settle();
  assert.equal(a.status, 'reconnecting');
  assert.equal(w.timers.size, 1);
});

function ytReply(state) {
  return (u) => {
    if (state.error) return state.error;
    const p = u.pathname.split('/v3/')[1];
    if (p === 'channels') return [200, { items: [{ snippet: { title: 'My Channel' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] }];
    if (p === 'playlistItems') return [200, { items: [{ contentDetails: { videoId: 'old' } }, { contentDetails: { videoId: 'now' } }] }];
    if (p === 'videos') return [200, { items: state.live ? [{ id: 'old', snippet: {}, liveStreamingDetails: { actualEndTime: 'x' } }, { id: 'now', snippet: { channelTitle: 'My Channel' }, liveStreamingDetails: { activeLiveChatId: 'CHAT', actualStartTime: 'x', concurrentViewers: '34' } }] : [] }];
    return state.chatError || [200, { nextPageToken: 'P' + ++state.page, pollingIntervalMillis: 3000, offlineAt: state.off, items: state.items }];
  };
}
const ytItem = (id, type, text) => ({ id, snippet: { type, publishedAt: '2026-11-25T00:00:00Z', displayMessage: text, userBannedDetails: { bannedUserDetails: { channelId: 'UCbad' } } }, authorDetails: { channelId: 'UC9', displayName: '@Mod.Person', isChatModerator: true } });
const yt = (w, ch = '@me') => new w.P.YouTubeAccount({ id: 'y', platform: 'youtube', channel: ch, every: 10 }, w.emit, 'SECRET');

test('YouTube finds the live chat, keeps the key out of the address, and reads each message once', async () => {
  const st = { live: true, page: 0, items: [ytItem('1', 'textMessageEvent', 'hello'), ytItem('2', 'superChatEvent', '$5 from x'), ytItem('3', 'userBannedEvent', 'gone'), ytItem('4', 'tombstone')] };
  const w = world(ytReply(st)), a = yt(w);
  a.start();
  await w.settle();
  assert.equal(a.name, 'My Channel');
  assert.equal(a.viewers, 34);
  assert.equal(a.status, 'ok');
  assert.ok(w.calls.every((c) => !c.url.includes('SECRET') && c.o.headers['X-Goog-Api-Key'] === 'SECRET'));
  assert.equal(w.of('message').map((m) => m.parts[0].text).join('|'), 'hello|$5 from x');
  assert.equal(w.of('message')[0].name, 'Mod.Person');
  assert.equal(w.of('message')[0].roles.join(), 'moderator');
  assert.equal(w.of('remove').map((r) => r.userId || r.id).join(), 'UCbad,4');
  assert.ok(waits(w).includes(10000), 'waits for the chosen pace, not a faster one');
  await w.fire(10000);
  assert.equal(w.of('message').length, 2);
  assert.match(w.calls.at(-1).url, /pageToken=P1/);
});

test('YouTube waits while not live, and goes back to waiting when the stream ends', async () => {
  const st = { live: false, page: 0, items: [] }, w = world(ytReply(st)), a = yt(w);
  a.start();
  await w.settle();
  assert.match(a.note, /Not live/);
  assert.equal(a.viewers, null);
  st.live = true;
  await w.fire(120000);
  assert.equal(a.viewers, 34);
  assert.equal(w.calls.filter((c) => c.url.includes('/channels')).length, 1, 'the channel is looked up once');
  st.chatError = [403, { error: { message: 'ended', errors: [{ reason: 'liveChatEnded' }] } }];
  await w.fire(10000);
  assert.equal(a.viewers, null);
  assert.match(a.note, /Not live/);
  assert.equal(waits(w).join(), '120000');
});

test('YouTube says when the key is wrong or the daily limit is used up', async () => {
  const st = { error: [400, { error: { message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'badRequest' }] } }] };
  let w = world(ytReply(st)), a = yt(w);
  a.start();
  await w.settle();
  assert.match(a.note, /did not accept the key/);
  assert.equal(w.timers.size, 0);
  st.error = [403, { error: { message: 'over', errors: [{ reason: 'quotaExceeded' }] } }];
  w = world(ytReply(st));
  a = yt(w);
  a.start();
  await w.settle();
  assert.match(a.note, /daily limit/);
  assert.equal(waits(w).join(), '1800000');
});

test('YouTube keeps reading the same chat after a short network loss', async () => {
  const st = { live: true, page: 0, items: [] }, w = world(ytReply(st)), a = yt(w);
  a.start();
  await w.settle();
  st.error = [0];
  await w.fire(10000);
  assert.equal(a.status, 'reconnecting');
  st.error = null;
  const t = [...w.timers].find(([, x]) => x.ms >= 2000 && x.ms < 3000);
  w.timers.delete(t[0]);
  t[1].fn();
  await w.settle();
  assert.equal(a.status, 'ok');
  assert.match(w.calls.at(-1).url, /pageToken=P1/);
});

test('TikTok reads chat and viewers in either field style, and waits when not live', () => {
  const w = world(() => [500, {}]), a = new w.P.TikTokAccount({ id: 't', platform: 'tiktok', channel: 'me' }, w.emit, 'EULER');
  a.start();
  const s = w.sockets[0], u = new URL(s.url);
  assert.equal(u.host, 'ws.eulerstream.com');
  assert.equal(u.searchParams.get('uniqueId'), 'me');
  const chat = { type: 'WebcastChatMessage', data: { common: { msgId: '9' }, user: { userId: '1', uniqueId: 'Fan_1', nickname: 'A Fan' }, comment: 'hey', userIdentity: { isModeratorOfAnchor: true } } };
  s.push({ messages: [{ type: 'roomInfo', data: {} }, chat, chat, { type: 'WebcastRoomUserSeqMessage', data: { viewerCount: 77 } }, { type: 'WebcastChatMessage', data: { common: { msgId: '10' }, user: { id: '2', displayId: 'two', nickname: '' }, content: 'new style' } }] });
  assert.equal(w.of('message').map((m) => m.name + ':' + m.parts[0].text).join('|'), 'A Fan:hey|two:new style');
  assert.equal(w.of('message')[0].roles.join(), 'moderator');
  assert.equal(a.viewers, 77);
  assert.equal(a.status, 'ok');
  s.onclose({ code: 4005 });
  assert.match(a.note, /Not live/);
  assert.equal(a.viewers, null);
  assert.equal(waits(w).join(), '180000');
});

test('TikTok stops on a refused key and backs off on the rest', () => {
  for (const [code, status, retry] of [[4401, 'error', 0], [4403, 'error', 0], [4429, 'error', 600000], [4404, 'ok', 180000], [4500, 'reconnecting', 10000], [1006, 'reconnecting', 10000]]) {
    const w = world(() => [500, {}]), a = new w.P.TikTokAccount({ id: 't', platform: 'tiktok', channel: 'me' }, w.emit, 'K');
    a.start();
    w.sockets[0].onclose({ code });
    assert.equal(a.status, status, code);
    assert.equal(waits(w)[0] || 0, retry, code);
  }
});

test('removing an account stops everything it was doing', async () => {
  const w = world(ytReply({ live: true, page: 0, items: [] })), a = yt(w);
  a.start();
  await w.settle();
  a.stop();
  assert.equal(w.timers.size, 0);
  const n = w.events.length;
  a.setStatus('ok', 'x');
  a.message({});
  assert.equal(w.events.length, n);
});
