import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectSqlite, migrate } from '../lib/db.js';
import * as P from '../lib/panel.js';
import { runOld, runComponent, commandModal, autocomplete, housekeeping, nationality, OLD_NAMES } from '../lib/oldbot.js';

const NOW = Date.UTC(2026, 10, 21, 20);
const ROLE = { pn: '1560736880872525836', att: '1560736880478130184', juez: '1571295277472678009', abog: '1565913945980801064' };
const ADMIN_PERMS = String(1n << 3n);

async function setup() {
  const db = await connectSqlite(':memory:');
  await migrate(db);
  return db;
}
function fakeApi() {
  const calls = [];
  let n = 0;
  const api = async (method, route, body) => { calls.push({ method, route, body }); n += 1; return { ok: true, status: 200, data: { id: `m${n}`, parent_id: null } }; };
  return { api, calls };
}
const user = (id, name) => ({ id, name, username: name });
function ctxFor(db, me, extra = {}) {
  const { api, calls } = extra.fake || fakeApi();
  const dms = [];
  return {
    db, api, calls, dms, me, roles: [], permissions: '0', guildId: 'G', channelId: 'C1', botId: 'BOT', jobs: [], staffRoles: [],
    siteUrl: 'https://panama-rp.onrender.com', now: () => NOW,
    lookupRoblox: async (name) => ({ id: 777, name, avatar: null }), robloxFor: async () => null, robloxAvatar: async () => null,
    dm: async (to, payload) => { dms.push({ to, payload }); return { ok: true }; },
    erlc: null, ...extra,
  };
}
// Interacción de comando: name, sub, opciones
function cmd(name, sub, options = [], resolved = {}) {
  const opts = sub ? [{ type: 1, name: sub, options }] : options;
  return { type: 2, data: { name, options: opts, resolved } };
}
const o = (name, value, type = 3) => ({ name, value, type });
const modalSubmit = (custom_id, fields) => ({ type: 5, data: { custom_id, components: Object.entries(fields).map(([k, v]) => ({ type: 1, components: [{ type: 4, custom_id: k, value: v }] })) } });
const button = (custom_id) => ({ type: 3, data: { custom_id }, message: { id: 'src', embeds: [] }, channel_id: 'C1' });

const ANA = user('1001', 'ana');
const POLI = user('1003', 'poli');
const ATT = user('1004', 'att');
const JUEZ = user('1005', 'juez');
const FIS = user('1006', 'fiscal');
const ABO = user('1007', 'abogado');
const ADMIN = user('1008', 'admin');

async function dniCrear(db, who) {
  return runOld(cmd('dni', 'crear', [o('nombre', who.name[0].toUpperCase() + who.name.slice(1)), o('apellidos', 'Pérez'), o('fecha_nacimiento', '10/03/1995'), o('tipo_sangre', 'O+'), o('sexo', 'Femenino'), o('estatura_cm', 170, 4), o('nacionalidad', 'panameño'), o('roblox_user', `${who.name}_rbx`)]), ctxFor(db, who));
}

test('los 41 comandos de antes están todos', () => {
  assert.equal(OLD_NAMES.length, 41);
  assert.equal(nationality('Panameño'), 'Panameña');
  assert.equal(nationality('de Marte'), 'Otra');
});

test('/dni crear es la cédula de la web y /balance el mismo banco', async () => {
  const db = await setup();
  const r = await dniCrear(db, ANA);
  assert.match(r.private.content, /DNI creado/);
  const c = await P.getCharacter(db, ANA.id);
  assert.equal(c.nacimiento, '1995-03-10');
  assert.equal(c.nacionalidad, 'Panameña');
  assert.equal((await db.one('SELECT estatura FROM characters WHERE discord_id = $1', [ANA.id])).estatura, 170);
  let b = await runOld(cmd('balance'), ctxFor(db, ANA));
  assert.equal(b.private.embeds[0].fields[1].value, `$${P.MONEY.startBanco.toLocaleString('es-PA')}`);
  await runOld(cmd('retirar', null, [o('monto', 500, 4)]), ctxFor(db, ANA));
  assert.equal((await P.getAccount(db, ANA.id)).efectivo, P.MONEY.startEfectivo + 500);
  // /dni ver de otra persona: solo cuerpos de seguridad, justicia o staff
  await dniCrear(db, POLI);
  b = await runOld(cmd('dni', 'ver', [o('usuario', ANA.id, 6)]), ctxFor(db, POLI));
  assert.match(b.private.content, /Solo la Policía/);
  b = await runOld(cmd('dni', 'ver', [o('usuario', ANA.id, 6)]), ctxFor(db, POLI, { roles: [ROLE.pn] }));
  assert.match(b.public.embeds[0].description, /revisó el DNI/);
  // transferir por usuario (mismo banco)
  b = await runOld(cmd('transferir', null, [o('usuario', POLI.id, 6), o('monto', 1000, 4)]), ctxFor(db, ANA));
  assert.match(b.private.content, /Enviaste/);
  assert.equal((await P.getAccount(db, POLI.id)).banco, P.MONEY.startBanco + 1000);
});

test('multas: solo la ATT; arrestos: la Policía (y salen en la web)', async () => {
  const db = await setup();
  await dniCrear(db, ANA);
  const multa = (who, roles) => runOld(cmd('multa', 'agregar', [o('usuario', ANA.id, 6), o('monto', 800, 4), o('articulos', 'Art. 12 exceso de velocidad')]), ctxFor(db, who, { roles }));
  assert.match((await multa(POLI, [ROLE.pn])).private.content, /Solo la ATT/);
  assert.match((await multa(ADMIN, [])).private.content, /Solo la ATT/);
  const ok = await multa(ATT, [ROLE.att]);
  assert.match(ok.private.content, /Multa #\d+ registrada/);
  assert.equal((await P.listFines(db, ANA.id))[0].monto, 800);

  const arr = (who, roles) => runOld(cmd('arrestar', 'usuario', [o('usuario', ANA.id, 6), o('razon', 'Robo a mano armada'), o('minutos', 20, 4)]), ctxFor(db, who, { roles }));
  assert.match((await arr(ATT, [ROLE.att])).private.content, /Solo la Policía/);
  const a = await arr(POLI, [ROLE.pn]);
  assert.match(a.private.content, /Arresto #\d+ registrado/);
  const list = await P.listArrests(db, ANA.id);
  assert.equal(list[0].cargos, 'Robo a mano armada');

  // pasa el tiempo → queda libre
  const fake = fakeApi();
  await housekeeping({ db, api: fake.api, guildId: 'G', now: () => NOW + 21 * 60_000 });
  assert.ok((await db.one('SELECT released_at FROM arrests WHERE discord_id = $1', [ANA.id])).released_at);
});

test('casino, tienda, config y verificación', async () => {
  const db = await setup();
  await dniCrear(db, ANA);
  const ganar = await runOld(cmd('casino', 'coinflip', [o('monto', 100, 4), o('cara_o_cruz', 'cara')]), ctxFor(db, ANA, { randomInt: () => 0 }));
  assert.match(ganar.public.embeds[0].description, /Ganó/);
  assert.equal((await P.getAccount(db, ANA.id)).efectivo, P.MONEY.startEfectivo + 100);
  const mucho = await runOld(cmd('casino', 'coinflip', [o('monto', 999999, 4), o('cara_o_cruz', 'cara')]), ctxFor(db, ANA));
  assert.match(mucho.private.content, /No tienes tanto efectivo/);

  const admin = ctxFor(db, ADMIN, { permissions: ADMIN_PERMS });
  assert.match((await runOld(cmd('shop', 'agregar', [o('nombre', 'Radio'), o('precio', 300, 4), o('descripcion', 'Para la Policía')]), ctxFor(db, ANA))).private.content, /Solo la administración/);
  await runOld(cmd('shop', 'agregar', [o('nombre', 'Radio'), o('precio', 300, 4), o('descripcion', 'Para la Policía')]), admin);
  const tienda = await runOld(cmd('shop', 'ver'), ctxFor(db, ANA));
  const itemId = tienda.private.components[0].components[0].options[0].value;
  const compra = await runComponent({ type: 3, data: { custom_id: 'shop:buy', values: [itemId] } }, ctxFor(db, ANA));
  assert.match(compra.private.content, /Compraste/);
  assert.equal((await P.getAccount(db, ANA.id)).banco, P.MONEY.startBanco - 300);

  assert.ok(autocomplete({ type: 4, data: { options: [{ type: 1, name: 'canal', options: [{ name: 'clave', value: 'jue', focused: true }] }] } }).some((c) => c.value === 'jueces'));
  assert.equal(commandModal(cmd('verificar'), { me: ANA }).custom_id, 'v:user');
  const v = await runComponent(modalSubmit('v:user', { usuario: 'Ana_RBX' }), ctxFor(db, ANA));
  const code = /```(.+?)```/s.exec(v.private.content)[1];
  let r = await runComponent(button('v:check'), ctxFor(db, ANA, { fetchProfile: async () => ({ description: 'hola' }) }));
  assert.match(r.private.content, /Todavía no veo/);
  r = await runComponent(button('v:check'), ctxFor(db, ANA, { fetchProfile: async () => ({ description: `mi código ${code}` }) }));
  assert.match(r.private.content, /verificada/);
  assert.equal((await P.getUserRoblox(db, ANA.id)).verified, true);
});
