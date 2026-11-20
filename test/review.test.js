import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  publicKeyFromHex, verifyInteraction, decide, isStaff, reviewComponents, decisionDm, createDiscordBot, BOT_PERMISSIONS, BOT_TOKEN_RE,
} from '../lib/review.js';

const NOW = 1_763_600_000_000;
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB_HEX = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');
const KEY = publicKeyFromHex(PUB_HEX);
const sign = (ts, body) => crypto.sign(null, Buffer.concat([Buffer.from(ts), body]), privateKey).toString('hex');

const APPLICANT = '1414024365342986424';
const STAFF = { user: { id: '999000111222333444', username: 'staffeo' }, roles: ['555'], permissions: '0' };
const ADMIN = { user: { id: '888', username: 'admin' }, roles: [], permissions: String(1n << 3n) };
const MOD = { user: { id: '777', username: 'mod' }, roles: [], permissions: String(1n << 28n) };
const NOBODY = { user: { id: '666', username: 'random' }, roles: ['123'], permissions: '0' };
const message = (extra = []) => ({
  id: '42',
  embeds: [{
    type: 'rich', title: 'Solicitud de whitelist', color: 0x22c55e,
    thumbnail: { url: 'https://tr.rbxcdn.com/x/420/420/AvatarHeadshot/Png/noFilter', proxy_url: 'https://images-ext.discordapp.net/x', width: 420, height: 420 },
    fields: [{ name: 'Discord', value: `<@${APPLICANT}>`, inline: true }, { name: 'Roblox', value: 'Santi', inline: true }, ...extra],
  }],
});
const click = (customId, member, msg = message()) => ({ type: 3, guild_id: '1560736880478130178', member, message: msg, data: { custom_id: customId, component_type: 2 } });

test('firma de Discord: válida, alterada, vieja o con clave mala', () => {
  const body = Buffer.from('{"type":1}');
  const ts = String(Math.floor(NOW / 1000));
  assert.equal(verifyInteraction({ key: KEY, signature: sign(ts, body), timestamp: ts, body, now: NOW }), true);
  assert.equal(verifyInteraction({ key: KEY, signature: sign(ts, body), timestamp: ts, body: Buffer.from('{"type":2}'), now: NOW }), false);
  const old = String(Math.floor(NOW / 1000) - 3600);
  assert.equal(verifyInteraction({ key: KEY, signature: sign(old, body), timestamp: old, body, now: NOW }), false);
  assert.equal(verifyInteraction({ key: KEY, signature: 'ab', timestamp: ts, body, now: NOW }), false);
  assert.equal(verifyInteraction({ key: KEY, signature: undefined, timestamp: undefined, body, now: NOW }), false);
  assert.equal(verifyInteraction({ key: null, signature: sign(ts, body), timestamp: ts, body, now: NOW }), false);
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  const forged = crypto.sign(null, Buffer.concat([Buffer.from(ts), body]), other).toString('hex');
  assert.equal(verifyInteraction({ key: KEY, signature: forged, timestamp: ts, body, now: NOW }), false);
  assert.equal(publicKeyFromHex('xyz'), null);
});

test('PING de Discord responde PONG', () => {
  assert.deepEqual(decide({ type: 1 }).response, { type: 1 });
});

test('quién es staff', () => {
  assert.equal(isStaff(ADMIN, ['555']), true, 'admin siempre');
  assert.equal(isStaff(STAFF, ['555']), true, 'rol de staff');
  assert.equal(isStaff(MOD, []), true, 'sin roles configurados: gestionar roles');
  assert.equal(isStaff(MOD, ['555']), false, 'con roles configurados hace falta el rol');
  assert.equal(isStaff(NOBODY, []), false);
  assert.equal(isStaff(null, []), false);
  assert.equal(isStaff({ roles: [], permissions: 'basura' }, []), false);
});

test('alguien sin permiso no puede aceptar', () => {
  const { response, effect } = decide(click(`wl:ok:${APPLICANT}`, NOBODY), { staffRoleIds: ['555'] });
  assert.equal(response.type, 4);
  assert.equal(response.data.flags, 64, 'solo lo ve quien hizo clic');
  assert.match(response.data.content, /Solo el staff/);
  assert.equal(effect, undefined);
});

test('aceptar: actualiza el mensaje, quita los botones y pide dar el rol', () => {
  const { response, effect } = decide(click(`wl:ok:${APPLICANT}`, STAFF), { staffRoleIds: ['555'], now: NOW });
  assert.equal(response.type, 7);
  assert.deepEqual(response.data.components, []);
  const e = response.data.embeds[0];
  assert.equal(e.fields[0].name, 'Estado');
  assert.match(e.fields[0].value, /Aceptada.*<@999000111222333444>/);
  assert.deepEqual(e.thumbnail, { url: 'https://tr.rbxcdn.com/x/420/420/AvatarHeadshot/Png/noFilter' }, 'sin campos internos de Discord');
  assert.equal(e.type, undefined);
  assert.equal(e.fields.length, 3);
  assert.deepEqual(response.data.allowed_mentions, { parse: [] });
  assert.deepEqual(effect, { kind: 'accept', applicantId: APPLICANT, guildId: '1560736880478130178', staffId: '999000111222333444', staffName: 'staffeo' });
});

test('rechazar: primero pide el motivo y luego actualiza con él', () => {
  const first = decide(click(`wl:no:${APPLICANT}`, ADMIN));
  assert.equal(first.response.type, 9, 'abre el formulario');
  assert.equal(first.response.data.custom_id, `wl:motivo:${APPLICANT}`);
  assert.equal(first.effect, undefined);

  const submit = {
    type: 5, guild_id: '1', member: ADMIN, message: message(),
    data: { custom_id: `wl:motivo:${APPLICANT}`, components: [{ type: 1, components: [{ type: 4, custom_id: 'motivo', value: 'No leyó la normativa @everyone' }] }] },
  };
  const { response, effect } = decide(submit, { now: NOW });
  assert.equal(response.type, 7);
  assert.match(response.data.embeds[0].fields[0].value, /Rechazada[\s\S]*Motivo:\*\* No leyó la normativa @​everyone/);
  assert.equal(effect.kind, 'reject');
  assert.equal(effect.motivo, 'No leyó la normativa @​everyone');

  // formato nuevo de Discord (Label → componente)
  const labeled = { ...submit, data: { custom_id: submit.data.custom_id, components: [{ type: 18, component: { type: 4, custom_id: 'motivo', value: 'Respuestas copiadas' } }] } };
  assert.equal(decide(labeled).effect.motivo, 'Respuestas copiadas');

  const empty = { ...submit, data: { custom_id: submit.data.custom_id, components: [] } };
  assert.equal(decide(empty).response.type, 4);
});

test('una solicitud ya revisada no se puede volver a revisar', () => {
  const done = message([{ name: 'Estado', value: '✅ Aceptada' }]);
  const { response, effect } = decide(click(`wl:ok:${APPLICANT}`, ADMIN, done));
  assert.equal(response.type, 4);
  assert.match(response.data.content, /ya fue revisada/);
  assert.equal(effect, undefined);
});

test('botones raros o fuera del servidor no hacen nada', () => {
  for (const id of ['wl:ok:abc', 'otra:cosa', '', 'wl:borrar:123456789', `wl:ok:${APPLICANT}:x`]) {
    assert.equal(decide(click(id, ADMIN)).effect, undefined, id);
  }
  const dm = { type: 3, data: { custom_id: `wl:ok:${APPLICANT}` }, user: { id: '1' } };
  assert.match(decide(dm).response.data.content, /dentro del servidor/);
});

test('botones y mensajes privados', () => {
  const [row] = reviewComponents(APPLICANT);
  assert.deepEqual(row.components.map((b) => b.custom_id), [`wl:ok:${APPLICANT}`, `wl:no:${APPLICANT}`]);
  assert.ok(row.components.every((b) => b.custom_id.length <= 100));
  assert.match(decisionDm({ kind: 'accept' }).embeds[0].title, /aceptada/);
  const no = decisionDm({ kind: 'reject', motivo: 'x'.repeat(900), siteUrl: 'https://panama-rp.onrender.com' });
  assert.match(no.embeds[0].description, /onrender\.com\/solicitud/);
  assert.ok(no.embeds[0].description.length < 600);
  assert.equal(BOT_PERMISSIONS, '268520448');
  assert.equal(BOT_TOKEN_RE.test(['a'.repeat(24), 'b'.repeat(6), 'c'.repeat(38)].join('.')), true, 'token de mentira con la forma de uno real');
  assert.equal(BOT_TOKEN_RE.test('https://discord.com/api/webhooks/1/abc'), false);
});

test('el bot llama a las rutas correctas de Discord', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, ...opts });
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (url.endsWith('/roles') && opts.method === 'GET') return json(200, [{ id: '111', name: 'Ciudadano' }, { id: '222', name: 'Staff Panamá' }]);
    if (url.endsWith('/users/@me/channels')) return json(200, { id: '333' });
    if (url.includes('/members/') && opts.method === 'PUT') return { ok: true, status: 204, json: async () => null };
    return json(200, { id: '1' });
  };
  const b = createDiscordBot({ token: 'T.O.K', apiBase: 'https://x/api', fetchImpl: fakeFetch });

  assert.deepEqual(await b.resolveRoles('g1', ['ciudadano', '444444444']), ['111', '444444444']);
  assert.deepEqual(await b.resolveRoles('g1', ['Staff Panama']), ['222'], 'sin importar tildes ni mayúsculas');
  assert.equal(calls.filter((c) => c.url.endsWith('/roles')).length, 1, 'los roles se guardan en caché');
  assert.deepEqual(await b.resolveRoles('g1', ['555555555']), ['555555555']);

  const r = await b.addRole('g1', APPLICANT, '111', 'Whitelist aceptada por staffeo');
  assert.equal(r.ok, true);
  const put = calls.at(-1);
  assert.equal(put.url, `https://x/api/guilds/g1/members/${APPLICANT}/roles/111`);
  assert.equal(put.headers.Authorization, 'Bot T.O.K');
  assert.equal(decodeURIComponent(put.headers['X-Audit-Log-Reason']), 'Whitelist aceptada por staffeo');

  await b.dm(APPLICANT, { content: 'hola' });
  assert.equal(calls.at(-2).url, 'https://x/api/users/@me/channels');
  assert.equal(calls.at(-1).url, 'https://x/api/channels/333/messages');

  await b.followup('app1', 'tok', { content: 'x' });
  assert.equal(calls.at(-1).headers.Authorization, undefined, 'las respuestas a clics no usan el token del bot');

  const down = createDiscordBot({ token: 't', apiBase: 'https://x', fetchImpl: async () => { throw new Error('caído'); } });
  const res = await down.postMessage('1', {});
  assert.equal(res.ok, false);
  assert.equal(res.status, 0);
});
