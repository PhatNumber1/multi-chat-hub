// Run with: node --test tests/*.test.js   (only needed by developers, never by the dock)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 20; i++) await tick(); };

function world(routes) {
  const calls = [], sockets = [], timers = [], saved = new Map();
  class FakeWS { constructor(url) { this.url = url; sockets.push(this); } close() { this.closed = true; } send(m) { this.onmessage({ data: JSON.stringify(m) }); } }
  const ctx = {
    URLSearchParams, console, WebSocket: FakeWS,
    setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.dead = true; },
    setInterval: () => ({}), clearInterval: () => {},
    fetch: async (url, o = {}) => {
      const u = new URL(url);
      const call = { method: o.method || 'GET', path: u.host + u.pathname, query: Object.fromEntries(u.searchParams), headers: o.headers || {}, body: o.body instanceof URLSearchParams ? Object.fromEntries(o.body) : o.body && JSON.parse(o.body) };
      calls.push(call);
      const [status, json] = routes(call);
      return { ok: status < 300, status, json: async () => json };
    },
  };
  ctx.window = ctx;
  ctx.MCH = {
    sleep: async () => {}, withLock: (n, fn) => fn(),
    secrets: { get: async (k) => saved.get(k) || null, set: async (k, v) => { saved.set(k, v); }, del: async (k) => { saved.delete(k); } },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/twitch.js'), 'utf8'), ctx);
  return { ctx, calls, sockets, timers, saved, T: ctx.MCH.twitch };
}

const okRoutes = (c) => {
  if (c.path.endsWith('/users')) return [200, { data: [{ id: '10', display_name: 'Host' }] }];
  if (c.path.endsWith('/streams')) return [200, { data: [{ viewer_count: 7 }] }];
  if (c.path.endsWith('/subscriptions')) return [202, {}];
  if (c.path.endsWith('/moderation/bans') && c.method === 'DELETE') return [204];
  if (c.path.endsWith('/moderation/bans')) return [200, { data: [] }];
  if (c.path.endsWith('/moderation/chat')) return [204];
  return [404, {}];
};
const welcome = (id) => ({ metadata: { message_type: 'session_welcome' }, payload: { session: { id, keepalive_timeout_seconds: 10 } } });
const note = (mid, type, event) => ({ metadata: { message_type: 'notification', message_id: mid, subscription_type: type, message_timestamp: '2026-11-24T21:04:00Z' }, payload: { event } });
const chatEvent = { message_id: 'm1', chatter_user_id: '5', chatter_user_login: 'bob', chatter_user_name: 'Bob', color: '#fff000', badges: [{ set_id: 'moderator' }], message: { fragments: [{ type: 'text', text: 'hi ' }, { type: 'emote', text: 'Kappa', emote: { id: '25' } }] } };

async function connected(routes = okRoutes) {
  const w = world(routes);
  const tok = { clientId: 'cid', access: 'A1', refresh: 'R1' };
  w.saved.set('twitch', tok);
  w.events = [];
  w.acct = new w.T.TwitchAccount(tok, (e, d) => w.events.push([e, d]));
  await w.acct.start();
  if (w.sockets[0]) { w.sockets[0].send(welcome('s1')); await settle(); }
  return w;
}

test('connects, subscribes and reads viewers', async () => {
  const w = await connected();
  assert.equal(w.acct.status, 'ok');
  assert.equal(w.acct.viewers, 7);
  assert.equal(w.calls.filter((c) => c.path.endsWith('/subscriptions')).length, 4);
});

test('delivers a message once even when Twitch repeats it', async () => {
  const w = await connected();
  w.sockets[0].send(note('x', 'channel.chat.message', chatEvent));
  w.sockets[0].send(note('x', 'channel.chat.message', chatEvent));
  const msgs = w.events.filter(([e]) => e === 'message');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0][1].parts[1].emote, '25');
  assert.equal(msgs[0][1].roles[0], 'moderator');
});

test('timeout, ban, unban and delete send the right requests', async () => {
  const w = await connected();
  w.calls.length = 0;
  await w.acct.ban('5', 600); await w.acct.ban('5', 0); await w.acct.unban('5'); await w.acct.deleteMessage('m1');
  const [a, b, c, d] = w.calls;
  assert.deepEqual(a.body, { data: { user_id: '5', duration: 600 } });
  assert.deepEqual(b.body, { data: { user_id: '5' } });
  assert.deepEqual(c.query, { broadcaster_id: '10', moderator_id: '10', user_id: '5' });
  assert.equal(d.query.message_id, 'm1');
});

test('an expired token is refreshed once, saved, and the call retried', async () => {
  const w = await connected((c) => {
    if (c.path === 'id.twitch.tv/oauth2/token') return [200, { access_token: 'A2', refresh_token: 'R2' }];
    if (c.headers.Authorization === 'Bearer A1') return [401, {}];
    return okRoutes(c);
  });
  assert.equal(w.acct.status, 'ok');
  assert.equal(w.calls.filter((c) => c.path.endsWith('/token')).length, 1);
  assert.equal(w.saved.get('twitch').refresh, 'R2');
});

test('a rejected refresh signs out', async () => {
  const w = await connected((c) => (c.path.endsWith('/token') ? [400, { message: 'Invalid refresh token' }] : [401, {}]));
  assert.ok(w.events.some(([e]) => e === 'authLost'));
  assert.equal(w.saved.has('twitch'), false);
});

test('a Twitch outage during refresh keeps the sign-in and retries', async () => {
  const w = await connected((c) => (c.path.endsWith('/token') ? [503, {}] : [401, {}]));
  assert.equal(w.acct.status, 'reconnecting');
  assert.ok(w.saved.has('twitch'));
});

test('a server move keeps chat going without resubscribing', async () => {
  const w = await connected();
  w.sockets[0].send({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://moved' } } });
  w.sockets[0].send(note('y', 'channel.chat.message', chatEvent)); // old line still works meanwhile
  w.sockets[1].send(welcome('s1')); await settle();
  assert.equal(w.sockets[0].closed, true);
  assert.equal(w.acct.status, 'ok');
  assert.equal(w.calls.filter((c) => c.path.endsWith('/subscriptions')).length, 4);
  assert.equal(w.events.filter(([e]) => e === 'message').length, 1);
});

test('a dropped connection turns yellow, reconnects and resubscribes', async () => {
  const w = await connected();
  w.sockets[0].onclose();
  assert.equal(w.acct.status, 'reconnecting');
  w.timers.filter((t) => !t.dead).pop().fn();
  w.sockets[1].send(welcome('s2')); await settle();
  assert.equal(w.acct.status, 'ok');
  assert.equal(w.calls.filter((c) => c.path.endsWith('/subscriptions')).length, 8);
});

test('refused chat permission is red and does not loop', async () => {
  const w = await connected((c) => (c.path.endsWith('/subscriptions') ? [403, { message: 'no scope' }] : okRoutes(c)));
  assert.equal(w.acct.status, 'error');
  assert.equal(w.sockets.length, 1);
});

test('device sign-in waits for approval then saves the token', async () => {
  let n = 0;
  const w = world((c) => {
    if (c.path.endsWith('/device')) return [200, { device_code: 'D', user_code: 'ABCD', verification_uri: 'https://www.twitch.tv/activate', expires_in: 1800, interval: 5 }];
    return n++ ? [200, { access_token: 'A', refresh_token: 'R' }] : [400, { message: 'authorization_pending' }];
  });
  let code;
  const t = await w.T.deviceLogin('cid', (c) => { code = c.user_code; }, {});
  assert.equal(code, 'ABCD');
  assert.equal(t.access, 'A');
  assert.equal(w.saved.get('twitch').refresh, 'R');
  assert.ok(w.calls.every((c) => !('client_secret' in c.body)));
});
