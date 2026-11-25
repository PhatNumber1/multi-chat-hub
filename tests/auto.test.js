const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { MCH: {}, crypto: globalThis.crypto, TextEncoder, TextDecoder, atob, Uint8Array };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/auto.js'), 'utf8'), ctx);
const unlock = ctx.MCH.unlockConnect;

// Locks the same way the installer does.
const mac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
function lock(key, value) {
  const iv = crypto.randomBytes(16), c = crypto.createCipheriv('aes-256-cbc', mac(key, 'lock'), iv);
  const both = Buffer.concat([iv, c.update(JSON.stringify(value)), c.final()]);
  return { box: both.toString('base64'), tag: mac(mac(key, 'check'), both).toString('base64') };
}
const key = crypto.randomBytes(32), hex = key.toString('hex');

test('the right key opens the saved connection', async () => {
  const saved = lock(key, { port: 4456, password: 'pä"ss' }), o = await unlock(hex, saved);
  assert.equal(o.port, 4456);
  assert.equal(o.password, 'pä"ss');
  assert.equal(o.id, saved.tag);
});

test('a wrong key, a changed file or a bad value opens nothing', async () => {
  const saved = lock(key, { port: 4455, password: 'x' });
  assert.equal(await unlock('0'.repeat(64), saved), null);
  const b = Buffer.from(saved.box, 'base64');
  b[20] ^= 1;
  assert.equal(await unlock(hex, { box: b.toString('base64'), tag: saved.tag }), null);
  assert.equal(await unlock(hex, { box: saved.box, tag: 'AAAA' }), null);
  for (const v of [{ port: 0, password: 'x' }, { port: '4455', password: 'x' }, { port: 4455 }, null, 'x']) assert.equal(await unlock(hex, lock(key, v)), null);
  for (const v of [{}, { box: '!!', tag: '!!' }, { box: '', tag: '' }]) assert.equal(await unlock(hex, v), null);
});
