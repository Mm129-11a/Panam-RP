import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signRelay, verifyRelay, checkTarget, createRelayFetch, createSmartFetch, handleRelay, isIpBan } from '../lib/relay.js';

const SECRET = 's'.repeat(40);
const NOW = 1_763_700_000_000;

test('firma del puente: válida, alterada, vieja o con otro secreto', () => {
  const ts = String(NOW);
  const body = '{"a":1}';
  const sig = signRelay(SECRET, ts, body);
  assert.equal(verifyRelay({ secret: SECRET, timestamp: ts, signature: sig, body, now: NOW }), true);
  assert.equal(verifyRelay({ secret: SECRET, timestamp: ts, signature: sig, body: '{"a":2}', now: NOW }), false);
  assert.equal(verifyRelay({ secret: SECRET, timestamp: ts, signature: sig, body, now: NOW + 120_000 }), false);
  assert.equal(verifyRelay({ secret: 'x'.repeat(40), timestamp: ts, signature: sig, body, now: NOW }), false);
  assert.equal(verifyRelay({ secret: SECRET, timestamp: ts, signature: 'zz', body, now: NOW }), false);
  assert.equal(verifyRelay({ secret: '', timestamp: ts, signature: sig, body, now: NOW }), false);
});

test('el puente solo habla con la API de Discord', () => {
  assert.ok(checkTarget('https://discord.com/api/v10/users/@me'));
  assert.ok(checkTarget('https://discord.com/api/webhooks/1/abc?wait=true'));
  for (const bad of ['https://evil.com/api/x', 'http://discord.com/api/x', 'https://discord.com/login', 'https://user:pw@discord.com/api/x', 'https://discord.com.evil.net/api/', 'nada']) {
    assert.equal(checkTarget(bad), null, bad);
  }
});

test('reconoce un bloqueo de IP (1015) frente a un límite normal', async () => {
  assert.equal(await isIpBan(new Response('error code: 1015', { status: 429, headers: { 'content-type': 'text/plain' } })), true);
  assert.equal(await isIpBan(new Response('<html>banned you temporarily</html>', { status: 429, headers: { 'content-type': 'text/html' } })), true);
  assert.equal(await isIpBan(new Response('{"retry_after":1,"global":false}', { status: 429, headers: { 'content-type': 'application/json' } })), false);
  assert.equal(await isIpBan(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })), false);
});

test('ida y vuelta por el puente, con firma y solo cabeceras permitidas', async () => {
  const seen = [];
  const discord = async (url, opts) => { seen.push({ url, opts }); return new Response('{"id":"5"}', { status: 201, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4', 'set-cookie': 'x=1' } }); };
  const relaySide = async (url, opts) => {
    const out = await handleRelay({ secret: SECRET, timestamp: opts.headers['x-relay-timestamp'], signature: opts.headers['x-relay-signature'], rawBody: opts.body, fetchImpl: discord, target: 'https://discord.com' });
    return new Response(JSON.stringify(out.json), { status: out.status, headers: { 'content-type': 'application/json' } });
  };
  const viaRelay = createRelayFetch({ relayUrl: 'https://puente.example', secret: SECRET, fetchImpl: relaySide });

  const r = await viaRelay('https://discord.com/api/v10/channels/1/messages', {
    method: 'POST', headers: { Authorization: 'Bot T', 'Content-Type': 'application/json', Cookie: 'no', 'X-Otra': 'no' }, body: '{"content":"hola"}',
  });
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { id: '5' });
  assert.equal(r.headers.get('x-ratelimit-remaining'), '4');
  assert.equal(r.headers.get('set-cookie'), null);
  assert.equal(seen[0].url, 'https://discord.com/api/v10/channels/1/messages');
  assert.deepEqual(seen[0].opts.headers, { authorization: 'Bot T', 'content-type': 'application/json' });

  // formulario del login (URLSearchParams)
  await viaRelay('https://discord.com/api/v10/oauth2/token', { method: 'POST', body: new URLSearchParams({ code: 'abc' }) });
  assert.equal(seen[1].opts.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(seen[1].opts.body, 'code=abc');

  // sin la firma correcta no hace nada
  const forged = await handleRelay({ secret: SECRET, timestamp: String(Date.now()), signature: 'a'.repeat(64), rawBody: '{}', fetchImpl: discord });
  assert.equal(forged.status, 401);
  assert.equal(seen.length, 2);
});

test('va directo y usa el puente solo cuando la IP está bloqueada (y un rato después)', async () => {
  let t = 0; let banned = true; const calls = [];
  const direct = async (url) => { calls.push('directo'); return banned ? new Response('error code: 1015', { status: 429, headers: { 'content-type': 'text/plain' } }) : new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  const relay = async () => { calls.push('puente'); return new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  let bans = 0;
  const f = createSmartFetch({ direct, relay, banMs: 1000, now: () => t, onBan: () => bans++ });
  assert.equal((await f('https://discord.com/api/x')).status, 200);
  assert.deepEqual(calls, ['directo', 'puente']);
  await f('https://discord.com/api/x');
  assert.deepEqual(calls, ['directo', 'puente', 'puente'], 'durante el bloqueo no insiste con la IP bloqueada');
  assert.equal(bans, 1);
  t = 2000; banned = false;
  await f('https://discord.com/api/x');
  assert.equal(calls.at(-1), 'directo', 'pasado el rato vuelve a ir directo');

  const noRelay = createSmartFetch({ direct: async () => new Response('error code: 1015', { status: 429 }) });
  assert.equal((await noRelay('https://discord.com/api/x')).status, 429, 'sin puente devuelve el 429 tal cual');
});
