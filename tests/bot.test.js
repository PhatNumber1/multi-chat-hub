const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { MCH: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/bot.js'), 'utf8'), ctx);
const people = [
  { id: 'tw1', platform: 'twitch', names: ['Main', 'PhatUser'] }, { id: 'tw2', platform: 'twitch', names: ['SecondUser'] },
  { id: 'tk', platform: 'tiktok', names: ['phat.tok'] }, { id: 'kk', platform: 'kick', names: ['kicker_1'] },
];
const P = (t) => JSON.parse(JSON.stringify(ctx.MCH.botParse.parse(t, people)));
const is = (text, want) => assert.deepEqual(P(text), want, text);

test('setup and connection requests', () => {
  for (const t of ['set it up for me', 'Set up', 'can you do it for me', 'walk me through it', 'get started']) assert.equal(P(t).do, 'setup', t);
  for (const t of ['connect obs', 'Connect to OBS please', 'set up go live', 'hook up obs']) assert.equal(P(t).do, 'obs', t);
  for (const t of ['what is connected?', 'status', 'am i connected']) assert.equal(P(t).do, 'status', t);
  for (const t of ['tiktok is not working', 'fix it', 'check everything', "obs won't connect"]) assert.equal(P(t).do, 'check', t);
  is('reconnect tiktok', { do: 'reconnect', ids: ['tk'] });
  is('reconnect', { do: 'reconnect', ids: null });
});

test('adding accounts', () => {
  is('add kick xqc', { do: 'add', platform: 'kick', name: 'xqc' });
  is('Add my TikTok account Some.User', { do: 'add', platform: 'tiktok', name: 'Some.User' });
  is('add https://kick.com/Some_One', { do: 'add', platform: 'kick', name: 'https://kick.com/Some_One' });
  is('connect my youtube @Some.Name', { do: 'add', platform: 'youtube', name: '@Some.Name' });
  is('add twitch', { do: 'add', platform: 'twitch', name: '' });
  is('add an account', { do: 'add', platform: null, name: '' });
  is('add instagram', { do: 'add', platform: 'instagram', name: '' });
});

test('showing and hiding chats', () => {
  is('hide tiktok chat', { do: 'chat', ids: ['tk'], value: false });
  is('show the kick chat', { do: 'chat', ids: ['kk'], value: true });
  is('hide chat from PhatUser', { do: 'chat', ids: ['tw1'], value: false });
  is('turn off all chats', { do: 'chat', ids: ['tw1', 'tw2', 'tk', 'kk'], value: false });
  is('mute twitch chat', { do: 'chat', ids: ['tw1', 'tw2'], value: false });
  is('unmute twitch chat', { do: 'chat', ids: ['tw1', 'tw2'], value: true });
  is('only show kick chat', { do: 'only', ids: ['kk'] });
  is('turn off kicker_1', { do: 'power', ids: ['kk'], value: false });
});

test('names, removing, and which account', () => {
  is('rename tiktok to My Tok', { do: 'rename', ids: ['tk'], nick: 'My Tok' });
  is('rename SecondUser to Alt', { do: 'rename', ids: ['tw2'], nick: 'Alt' });
  is('remove the kick account', { do: 'remove', ids: ['kk'] });
});

test('look', () => {
  is('make the text bigger', { do: 'size', value: null, by: 2 });
  is('make chat smaller', { do: 'size', value: null, by: -2 });
  is('text size 18', { do: 'size', value: 18, by: 2 });
  is('font Verdana', { do: 'font', name: 'Verdana' });
  is('black background', { do: 'bg', value: '#000000' });
  is('background #1A2B3C', { do: 'bg', value: '#1a2b3c' });
  is('hide timestamps', { do: 'show', key: 'timestamps', value: false });
  is('show badges', { do: 'show', key: 'badges', value: true });
  is('hide viewer counts', { do: 'show', key: 'viewers', value: false });
  is('show emotes', { do: 'show', key: 'emotes', value: true });
  assert.equal(P('reset colors').do, 'resetColors');
  is('clean mode', { do: 'clean', value: true });
  is('turn off clean mode', { do: 'clean', value: false });
  assert.equal(P('undo').do, 'undo');
  is('turn off demo', { do: 'set', key: 'demo', value: false });
});

test('polite requests are still requests', () => {
  is('can you hide tiktok chat?', { do: 'chat', ids: ['tk'], value: false });
  is('please add kick xqc', { do: 'add', platform: 'kick', name: 'xqc' });
  is('could you please make the text bigger?', { do: 'size', value: null, by: 2 });
  assert.equal(P('I want to go live').do, 'live');
  assert.equal(P('hi').do, 'hello');
  assert.equal(P('ok').do, 'thanks');
});

test('streaming', () => {
  assert.equal(P('go live').do, 'live');
  assert.equal(P('start streaming').do, 'live');
  assert.equal(P('end stream').do, 'end');
  assert.equal(P('stop the stream').do, 'end');
  is('start recording', { do: 'record', value: true });
  is('stop recording', { do: 'record', value: false });
});

test('Twitch actions', () => {
  is('turn on slow mode', { do: 'tile', id: 'slow', value: true, ids: null });
  is('slow mode off for SecondUser', { do: 'tile', id: 'slow', value: false, ids: ['tw2'] });
  for (const [t, id] of [['turn on emote only', 'emote'], ['sub only mode', 'subs'], ['clear chat', 'clear'], ['make a clip', 'clip'], ['run an ad', 'ad'], ['start a poll', 'poll'], ['raid someone', 'raid'], ['cancel raid', 'unraid'], ['ban someone', 'ban'], ['unban someone', 'unban'], ['change the title', 'info'], ['add a mod', 'mod'], ['remove a moderator', 'unmod'], ['shield mode', 'shield']]) assert.equal(P(t).id, id, t);
});

test('a question is answered, never acted on', () => {
  for (const t of ['how do I go live?', 'how do I end stream?', 'what does ban do?', 'how do i clear chat', 'how do I add twitch?', 'why is recording off?', 'can I hide chat?', 'what is clean mode?', 'do i need a client id?', 'stop recording?']) {
    assert.ok(['topic', 'unknown', 'hello'].includes(P(t).do), t + ' -> ' + P(t).do);
  }
  assert.equal(P('how do I add tiktok?').title, '4. Add TikTok');
  assert.equal(P('what does the yellow light mean?').title, 'Connection lights');
  assert.equal(P('is it private?').title, 'Where your sign-ins are kept');
});

test('search, pages and nonsense', () => {
  is('search for big play', { do: 'search', text: 'big play' });
  is('find messages from Bob', { do: 'search', text: 'from:Bob' });
  is('open the moderator page', { do: 'open', page: 'mod' });
  is('open settings', { do: 'open', page: 'settings' });
  for (const t of ['asdf qwer', '🙂', '((((', '\\', 'x'.repeat(300)]) assert.equal(P(t).do, 'unknown', t);
  is('', { do: 'none' });
});

test('every help answer it points to exists', () => {
  const help = fs.readFileSync(path.join(__dirname, '../js/help.js'), 'utf8');
  for (const [, title] of ctx.MCH.botParse.TOPICS) assert.ok(help.includes("s('" + title + "'"), title);
});
