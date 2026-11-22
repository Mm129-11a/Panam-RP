import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectSqlite, migrate } from '../lib/db.js';
import { JOBS } from '../lib/jobs.js';
import * as P from '../lib/panel.js';
import { buildCommands, handleCommand, sameCommands, readOptions } from '../lib/commands.js';
import { createErlc, parsePlayer } from '../lib/erlc.js';

const NOW = Date.UTC(2026, 10, 21, 18);
const ANA = { id: '1001', name: 'ana' };
const POLI = { id: '1003', name: 'poli' };
async function setup() {
  const db = await connectSqlite(':memory:');
  await migrate(db);
  return db;
}
const person = (n) => ({ nombre: n, apellidos: 'Pérez', nacimiento: '1995-03-10', genero: 'Femenino', sangre: 'O+', nacionalidad: 'Panameña' });
async function citizen(db, u, n) { return P.createCharacter(db, { user: u, roblox: { id: Number(u.id), name: `${n}_rbx` }, input: person(n), now: NOW }); }
const cmd = (user, name, options = [], resolvedUsers = {}) => ({
  type: 2, guild_id: 'g', application_id: 'app', token: 't',
  member: { user: { id: user.id, username: user.name }, roles: [] },
  data: { name, options, resolved: { users: resolvedUsers } },
});
const ctx = (db, extra = {}) => ({ db, jobs: [], JOBS, isCitizen: true, robloxAvatar: async () => 'https://tr.rbxcdn.com/x', erlc: null, siteUrl: 'https://panama-rp.onrender.com', verifyInGame: null, ...extra });

test('los comandos cumplen las reglas de Discord', () => {
  const list = buildCommands(JOBS);
  const names = new Set();
  const check = (opts = []) => {
    let optionalSeen = false;
    for (const o of opts) {
      assert.match(o.name, /^[-_a-z0-9]{1,32}$/);
      assert.ok(o.description.length >= 1 && o.description.length <= 100, o.description);
      if (o.type !== 1) { if (!o.required) optionalSeen = true; else assert.equal(optionalSeen, false, `${o.name}: obligatorias primero`); }
      check(o.options);
    }
  };
  for (const c of list) {
    assert.match(c.name, /^[-_a-z0-9]{1,32}$/);
    assert.ok(c.description.length <= 100, c.name);
    assert.ok(!names.has(c.name)); names.add(c.name);
    check(c.options);
  }
  assert.ok(list.length <= 100);
  assert.equal(sameCommands(list, JSON.parse(JSON.stringify(list))), true);
  const changed = JSON.parse(JSON.stringify(list)); changed[0].description = 'otra';
  assert.equal(sameCommands(list, changed), false);
  assert.deepEqual(readOptions({ options: [{ type: 1, name: 'iniciar', options: [{ name: 'trabajo', type: 3, value: 'policia' }] }] }), { sub: 'iniciar', o: { trabajo: 'policia' }, users: {} });
});

test('banco, depósitos y transferencias desde Discord (misma base que la web)', async () => {
  const db = await setup();
  let r = await handleCommand(cmd(ANA, 'banco'), ctx(db));
  assert.match(r.private.content, /Aún no tienes cuenta/);
  await citizen(db, ANA, 'Ana');
  await citizen(db, POLI, 'Poli');
  r = await handleCommand(cmd(ANA, 'banco'), ctx(db));
  assert.equal(r.private.embeds[0].fields[0].value, '$8,000');
  r = await handleCommand(cmd(ANA, 'depositar', [{ name: 'monto', type: 4, value: 500 }]), ctx(db));
  assert.match(r.private.content, /Depositaste \$500/);
  assert.equal((await P.getAccount(db, ANA.id)).banco, 8500, 'lo mismo que ve el panel');
  r = await handleCommand(cmd(ANA, 'transferir', [{ name: 'usuario', type: 6, value: POLI.id }, { name: 'monto', type: 4, value: 1000 }]), ctx(db));
  assert.match(r.private.content, /Enviaste \$1,000 a \*\*Poli Pérez/);
  r = await handleCommand(cmd(ANA, 'retirar', [{ name: 'monto', type: 4, value: 999999 }]), ctx(db));
  assert.match(r.private.content, /^❌/);
  r = await handleCommand(cmd(ANA, 'banco'), ctx(db, { isCitizen: false }));
  assert.match(r.private.content, /whitelist/);
});

test('cédula: la tuya en público; la de otro solo la Policía', async () => {
  const db = await setup();
  await citizen(db, ANA, 'Ana');
  await citizen(db, POLI, 'Poli');
  let r = await handleCommand(cmd(ANA, 'cedula'), ctx(db));
  assert.equal(r.public.embeds[0].thumbnail.url, 'https://tr.rbxcdn.com/x');
  assert.equal(r.public.embeds[0].fields[0].value, 'Ana Pérez');
  r = await handleCommand(cmd(ANA, 'cedula', [{ name: 'usuario', type: 6, value: POLI.id }]), ctx(db));
  assert.match(r.private.content, /Solo la Policía/);
  r = await handleCommand(cmd(POLI, 'cedula', [{ name: 'usuario', type: 6, value: ANA.id }]), ctx(db, { jobs: ['policia'] }));
  assert.match(r.public.embeds[0].description, /revisó la cédula/);
});

test('policía: multar y arrestar desde Discord sale en el expediente web', async () => {
  const db = await setup();
  await citizen(db, ANA, 'Ana');
  await citizen(db, POLI, 'Poli');
  const multa = (who, extra) => handleCommand(cmd(who, 'multar', [{ name: 'usuario', type: 6, value: ANA.id }, { name: 'monto', type: 4, value: 700 }, { name: 'motivo', type: 3, value: 'Exceso de velocidad' }]), ctx(db, extra));
  // Multas: solo la ATT (la Policía no puede)
  assert.match((await multa(POLI)).private.content, /Solo la ATT/);
  assert.match((await multa(POLI, { jobs: ['policia'] })).private.content, /Solo la ATT/);
  assert.match((await multa(POLI, { jobs: ['transito'] })).private.content, /turno de ATT/);
  await P.startShift(db, POLI.id, 'transito', { jobs: JOBS, allowed: ['transito'], now: NOW });
  const ok = await multa(POLI, { jobs: ['transito'] });
  assert.equal(ok.public.embeds[0].fields[0].value, '$700');
  assert.deepEqual(ok.public.allowed_mentions, { users: [ANA.id] });
  await P.endShift(db, POLI.id, { jobs: JOBS, now: NOW + 10 * 60_000 });
  await P.startShift(db, POLI.id, 'policia', { jobs: JOBS, allowed: ['policia'], now: NOW + 11 * 60_000 });
  const arr = await handleCommand(cmd(POLI, 'arrestar', [{ name: 'usuario', type: 6, value: ANA.id }, { name: 'minutos', type: 4, value: 15 }, { name: 'cargos', type: 3, value: 'Robo' }]), ctx(db, { jobs: ['policia'] }));
  assert.equal(arr.public.embeds[0].title, '🚔 Arresto');
  // lo ve la persona en la web
  assert.equal((await P.listFines(db, ANA.id))[0].monto, 700);
  assert.equal((await P.listArrests(db, ANA.id))[0].cargos, 'Robo');
  // y paga con /pagar
  const fineId = (await P.listFines(db, ANA.id))[0].id;
  const paid = await handleCommand(cmd(ANA, 'pagar', [{ name: 'multa', type: 4, value: fineId }]), ctx(db));
  assert.match(paid.private.content, /pagada/);
  const ante = await handleCommand(cmd(POLI, 'antecedentes', [{ name: 'usuario', type: 6, value: ANA.id }]), ctx(db, { jobs: ['policia'] }));
  assert.equal(ante.private.embeds[0].fields[2].value, '1');
});

test('turno desde Discord y comprobación de ER:LC', async () => {
  const db = await setup();
  await citizen(db, POLI, 'Poli');
  const start = (extra) => handleCommand(cmd(POLI, 'turno', [{ type: 1, name: 'iniciar', options: [{ name: 'trabajo', type: 3, value: 'policia' }] }]), ctx(db, { jobs: ['policia'], ...extra }));
  const outside = async () => { throw new P.PanelError(409, 'Entra al servidor de ER:LC'); };
  assert.match((await start({ verifyInGame: outside })).private.content, /Entra al servidor/);
  assert.equal(await P.activeShift(db, POLI.id), null, 'no abrió turno');
  const r = await start({ verifyInGame: async () => {} });
  assert.match(r.public.content, /entró en servicio como \*\*Policía/);
  assert.match((await handleCommand(cmd(POLI, 'turno', [{ type: 1, name: 'estado' }]), ctx(db))).private.content, /Llevas/);
  assert.match((await handleCommand(cmd(POLI, 'turno', [{ type: 1, name: 'terminar' }]), ctx(db))).private.content, /muy corto|cobraste/i);
});

test('API de ER:LC: jugadores, estado y caché', async () => {
  assert.deepEqual(parsePlayer('Santi_RP2:4815162342'), { name: 'Santi_RP2', id: '4815162342' });
  assert.equal(parsePlayer('raro'), null);
  let calls = 0;
  const fake = async (url, opts) => {
    calls++;
    assert.equal(opts.headers['Server-Key'], 'k');
    if (url.endsWith('/server')) return new Response(JSON.stringify({ Name: 'Panamá RP', CurrentPlayers: 12, MaxPlayers: 40, JoinKey: 'PANAMARP' }), { status: 200 });
    return new Response(JSON.stringify([{ Player: 'Santi_RP2:4815162342', Team: 'Police' }, { Player: 'Otro:1', Team: 'Civilian' }]), { status: 200 });
  };
  const e = createErlc({ key: 'k', fetchImpl: fake });
  assert.deepEqual(await e.status(), { encendido: true, nombre: 'Panamá RP', jugadores: 12, maximo: 40, codigo: 'PANAMARP' });
  assert.equal(await e.isInServer({ id: '4815162342' }), true);
  assert.equal(await e.isInServer({ name: 'santi_rp2' }), true);
  assert.equal(await e.isInServer({ id: '9', name: 'Nadie' }), false);
  assert.equal(calls, 2, 'la lista de jugadores se guarda unos segundos');
  const bad = createErlc({ key: 'k', fetchImpl: async () => new Response('no', { status: 403 }) });
  await assert.rejects(() => bad.status(), /llave/);
  const off = createErlc({ key: 'k', fetchImpl: async () => new Response('{}', { status: 422 }) });
  assert.deepEqual(await off.status(), { encendido: false });
  assert.deepEqual(await off.players(), []);
  const r = await handleCommand({ type: 2, guild_id: 'g', member: { user: { id: '1' }, roles: [] }, data: { name: 'servidor' } }, { db: null, jobs: [], JOBS, isCitizen: false, erlc: e, siteUrl: '' });
  assert.equal(r.public.embeds[0].fields[0].value, '12/40');
});

test('/crear-cedula usa el Roblox vinculado y sale igual en la web', async () => {
  const db = await setup();
  const opts = [
    { name: 'nombre', type: 3, value: 'Ana' }, { name: 'apellidos', type: 3, value: 'Pérez Gómez' },
    { name: 'nacimiento', type: 3, value: '10/03/1995' }, { name: 'sexo', type: 3, value: 'Femenino' },
    { name: 'sangre', type: 3, value: 'O+' }, { name: 'nacionalidad', type: 3, value: 'Panameña' },
  ];
  let linked = null;
  const extra = { robloxFor: async () => linked };
  let r = await handleCommand(cmd(ANA, 'crear-cedula', opts), ctx(db, extra));
  assert.match(r.private.content, /vincula tu cuenta de Roblox/);
  assert.equal(await P.getCharacter(db, ANA.id), null);

  linked = { id: 555, name: 'AnaRbx', verified: true };
  r = await handleCommand(cmd(ANA, 'crear-cedula', opts), ctx(db, extra));
  assert.match(r.private.content, /Cédula creada/);
  assert.match(r.public.embeds[0].description, /sacó su cédula/);
  const c = await P.getCharacter(db, ANA.id);
  assert.equal(c.nacimiento, '1995-03-10');
  assert.equal(c.roblox_name, 'AnaRbx');
  assert.equal(Number(c.roblox_id), 555);
  assert.ok(await P.getAccount(db, ANA.id), 'abre la cuenta del banco');

  r = await handleCommand(cmd(ANA, 'crear-cedula', opts), ctx(db, extra));
  assert.match(r.private.content, /Ya tienes cédula/);

  const bad = opts.map((o) => (o.name === 'nacimiento' ? { ...o, value: '31/02/2030' } : o));
  r = await handleCommand(cmd(POLI, 'crear-cedula', bad), ctx(db, extra));
  assert.match(r.private.content, /^❌/);
});

test('/banco y /policia agrupan los comandos (sin chocar con los del bot viejo)', async () => {
  const { COMMAND_NAMES } = await import('../lib/commands.js');
  const viejos = ['sugerir', 'ayuda', 'antecedentes', 'entorno', 'bloquear-ticket', 'desbloquear-ticket', 'reclamar', 'cerrar-ticket', 'logs', 'alerta', 'anon', 'anon-mensaje', 'verificar', 'balance', 'depositar', 'retirar', 'transferir', 'cobrar-salario', 'top', 'dni', 'licencia', 'multa', 'vehiculo', 'server', 'erlc', 'staff', 'mod', 'casino', 'shop', 'ticket', 'admin', 'inventario', 'banda', 'robar', 'blacklist', 'decir', 'social', 'arrestar', 'salario-configurar', 'ver-salarios', 'config'];
  const nombres = buildCommands(JOBS).map((c) => c.name);
  assert.deepEqual([...nombres].sort(), [...COMMAND_NAMES].sort());
  assert.deepEqual(nombres.filter((n) => viejos.includes(n)), []);

  const db = await setup();
  await citizen(db, ANA, 'Ana');
  await citizen(db, POLI, 'Poli');
  const sub = (name, options) => [{ type: 1, name, options }];
  let r = await handleCommand(cmd(ANA, 'banco', sub('retirar', [{ name: 'monto', type: 4, value: 500 }])), ctx(db));
  assert.match(r.private.content, /500/);
  assert.equal((await P.getAccount(db, ANA.id)).efectivo, P.MONEY.startEfectivo + 500);
  r = await handleCommand(cmd(ANA, 'banco', sub('ver', [])), ctx(db));
  assert.ok(r.private.embeds || r.public, 'muestra el saldo');
  await P.startShift(db, POLI.id, 'policia', { jobs: JOBS, allowed: ['policia'], now: Date.now() });
  r = await handleCommand(cmd(POLI, 'policia', sub('arrestar', [{ name: 'usuario', type: 6, value: ANA.id }, { name: 'minutos', type: 4, value: 10 }, { name: 'cargos', type: 3, value: 'Robo' }])), ctx(db, { jobs: ['policia'] }));
  assert.match(r.private.content, /Arresto registrado/);
  assert.equal((await P.listArrests(db, ANA.id)).length, 1);
});
