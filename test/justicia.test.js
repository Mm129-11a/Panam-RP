import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectSqlite, migrate } from '../lib/db.js';
import * as P from '../lib/panel.js';
import { submitCase, runJustice, justiceModal, listMyCases } from '../lib/justicia.js';
import { mirrorOldCommand } from '../lib/mirror.js';

const NOW = Date.UTC(2026, 10, 21, 22);
const ROLE = { pn: '1560736880872525836', att: '1560736880478130184', juez: '1571295277472678009', abog: '1565913945980801064' };
const MEMBERS = { 2001: [ROLE.juez], 2002: [ROLE.juez], 3001: [ROLE.abog], 3002: [ROLE.abog], 3003: [ROLE.abog], 1003: [ROLE.pn] };

async function setup() { const db = await connectSqlite(':memory:'); await migrate(db); return db; }
function env(db) {
  const dms = []; const edits = []; let n = 0;
  return {
    db, dms, edits, now: () => NOW,
    membersWithRoles: async (roles) => Object.entries(MEMBERS).filter(([, r]) => r.some((x) => roles.includes(x))).map(([id]) => id),
    dm: async (to, payload) => { n += 1; dms.push({ to, payload }); return { ok: true, data: { id: `msg${n}`, channel_id: `dm${to}` } }; },
    api: async (method, route, body) => { edits.push({ method, route, body }); return { ok: true, data: {} }; },
  };
}
// Contexto de un botón apretado en un DM
const ctxOf = (e, id) => ({ ...e, me: { id, name: `u${id}` }, roles: MEMBERS[id] || [], permissions: '0', jobs: [], staffRoles: [], channelId: `dm${id}`, guildId: 'G' });
const btn = (custom_id) => ({ type: 3, data: { custom_id } });
const modalSubmit = (custom_id, fields) => ({ type: 5, data: { custom_id, components: Object.entries(fields).map(([k, v]) => ({ type: 1, components: [{ type: 4, custom_id: k, value: v }] })) } });

test('denuncia desde la web → DM a los jueces → fiscal y abogado por DM (uno de cada)', async () => {
  const db = await setup();
  const e = env(db);
  const ANA = { id: '1001', name: 'ana' };
  await assert.rejects(() => submitCase(e, ANA, { origen: 'denuncia', tipo: 'robo', acusado: 'J', hechos: 'corto' }), (err) => Boolean(err.status === 400 && err.fields.acusado && err.fields.hechos));
  await assert.rejects(() => submitCase(e, ANA, { origen: 'denuncia', tipo: 'otra', otro: '', acusado: 'Juan', denunciante: 'Ana', hechos: 'Me robó el celular en la plaza' }), (err) => Boolean(err.fields?.otro));
  const r = await submitCase(e, ANA, { origen: 'denuncia', tipo: 'robo', acusado: 'Juan Pérez', denunciante: 'Ana Gómez', hechos: 'Me robó el celular en la plaza central', lugar: 'Plaza, 9 pm', pruebas: 'Testigos' });
  assert.equal(r.jueces, 2);
  assert.deepEqual(e.dms.map((d) => d.to).sort(), ['2001', '2002']);
  assert.equal(e.dms[0].payload.components[0].components[0].custom_id, `cs:ok:${r.id}`);

  // alguien sin rol de juez no puede
  let out = await runJustice(btn(`cs:ok:${r.id}`), ctxOf(e, '3001'));
  assert.match(out.private.content, /Solo los jueces/);
  out = await runJustice(btn(`cs:ok:${r.id}`), ctxOf(e, '2001'));
  assert.match(out.private.content, /aceptado.*3 abogado/);
  assert.ok(e.edits.some((x) => x.route === '/channels/dm2002/messages/msg2' && x.body.components.length === 0), 'al otro juez se le quitan los botones');
  assert.ok(e.dms.some((d) => d.to === '1001' && /aceptado/.test(d.payload.content)), 'avisa a quien denunció');
  out = await runJustice(btn(`cs:ok:${r.id}`), ctxOf(e, '2002'));
  assert.match(out.private.content, /Otro juez ya revisó/);

  out = await runJustice(btn(`cs:take:${r.id}`), ctxOf(e, '3001'));
  assert.equal(out.private.components[0].components.length, 2);
  const before = e.edits.length;
  out = await runJustice(btn(`cs:as:fis:${r.id}`), ctxOf(e, '3001'));
  assert.match(out.private.content, /como \*\*fiscal\*\*/);
  const judgeEdits = e.edits.slice(before).filter((x) => x.route.startsWith('/channels/dm200'));
  assert.equal(judgeEdits.length, 1, 'solo se actualiza el mensaje del juez que aceptó');
  assert.equal(judgeEdits[0].route, '/channels/dm2001/messages/msg1');
  assert.match(judgeEdits[0].body.content, /<@3001> aceptó el caso .* como \*\*fiscal\*\*/);
  out = await runJustice(btn(`cs:as:fis:${r.id}`), ctxOf(e, '3002'));
  assert.match(out.private.content, /Ya hay un fiscal/);
  out = await runJustice(btn(`cs:take:${r.id}`), ctxOf(e, '3002'));
  assert.equal(out.private.components[0].components[0].disabled, true, 'fiscal sale ocupado');
  out = await runJustice(btn(`cs:as:abo:${r.id}`), ctxOf(e, '3001'));
  assert.match(out.private.content, /fiscal y abogado/);
  out = await runJustice(btn(`cs:as:abo:${r.id}`), ctxOf(e, '3002'));
  assert.match(out.private.content, /abogado defensor/);
  const c = (await listMyCases(db, ANA.id))[0];
  assert.equal(c.estado, 'listo');
  assert.equal(c.fiscal_id, '3001');
  assert.equal(c.abogado_id, '3002');
  out = await runJustice(btn(`cs:take:${r.id}`), ctxOf(e, '3003'));
  assert.match(out.private.content, /ya tiene fiscal y abogado/);
});

test('juicio de la Policía y rechazo del juez con motivo', async () => {
  const db = await setup();
  const e = env(db);
  const POLI = { id: '1003', name: 'poli' };
  await assert.rejects(() => submitCase(e, POLI, { origen: 'juicio', acusado: 'María', edad: 'x', acusacion: 'Robo', hechos: 'Robó la joyería del centro' }), (err) => Boolean(err.fields?.edad));
  const r = await submitCase(e, POLI, { origen: 'juicio', acusado: 'María Castillo', edad: '26', acusacion: 'Robo a mano armada', hechos: 'Robó la joyería del centro a las 10 pm', denunciante: 'Poli Martínez' });
  const fields = e.dms[0].payload.embeds[0].fields.map((f) => f.name);
  assert.ok(fields.includes('Edad') && fields.includes('Presentado por') && fields.includes('Acusación'));
  assert.equal(justiceModal(btn(`cs:no:${r.id}`)).custom_id, `cs:nom:${r.id}`);
  const out = await runJustice(modalSubmit(`cs:nom:${r.id}`, { motivo: 'Faltan pruebas' }), ctxOf(e, '2002'));
  assert.match(out.private.content, /rechazado/);
  assert.ok(e.dms.some((d) => d.to === '1003' && /Faltan pruebas/.test(d.payload.content)));
});

test('sin jueces avisa y no deja el caso a medias', async () => {
  const db = await setup();
  const e = { ...env(db), membersWithRoles: async () => [] };
  await assert.rejects(() => submitCase(e, { id: '1001', name: 'ana' }, { origen: 'denuncia', tipo: 'robo', acusado: 'Juan', denunciante: 'Ana', hechos: 'Me robó el celular en la plaza' }), /rol de Jueces/);
  assert.equal((await listMyCases(db, '1001')).length, 0);
});

test('espejo: /arrestar y /multa del bot de antes salen en la web sin contestar nada', async () => {
  const db = await setup();
  const e = env(db);
  const base = (id, name, sub, options, roles) => [{ id, type: 2, data: { name, options: [{ type: 1, name: sub, options }], resolved: { users: { 1001: { id: '1001', username: 'ana' } } } } }, { ...ctxOf(e, roles === 'att' ? '1004' : '1003'), roles: roles === 'att' ? [ROLE.att] : [ROLE.pn], robloxFor: async () => null, lookupRoblox: async (n) => ({ id: 5, name: n }) }];
  let [i, ctx] = base('i1', 'arrestar', 'usuario', [{ name: 'usuario', type: 6, value: '1001' }, { name: 'razon', type: 3, value: 'Robo' }, { name: 'minutos', type: 4, value: 30 }]);
  assert.match(await mirrorOldCommand(i, ctx), /arresto/);
  assert.equal(await mirrorOldCommand(i, ctx), null, 'la misma interacción no se guarda dos veces');
  assert.equal((await P.listArrests(db, '1001'))[0].cargos, 'Robo');
  assert.ok(!e.edits.some((x) => x.route.endsWith('/roles/1561567066484510821')), 'el rol de arrestado de /arrestar lo maneja el bot de antes');
  // antecedentes → rol de antecedentes
  [i, ctx] = base('i1b', 'antecedentes', 'agregar', [{ name: 'usuario', type: 6, value: '1001' }, { name: 'delito', type: 3, value: 'Hurto' }]);
  assert.match(await mirrorOldCommand(i, ctx), /antecedente/);
  assert.ok(e.edits.some((x) => x.method === 'PUT' && x.route === '/guilds/G/members/1001/roles/1561567122721603656'), 'le da el rol de antecedentes');
  // arrestos de la web: al cumplir el tiempo se quita el rol (si no queda otro de la web corriendo); los de /arrestar no
  const { housekeeping } = await import('../lib/oldbot.js');
  await db.run("INSERT INTO arrests (discord_id, officer_id, officer_name, cargos, minutos, origen, created_at) VALUES ('1001', '1003', 'Poli', 'Robo', 30, 'web', $1)", [NOW]);
  await db.run("INSERT INTO arrests (discord_id, officer_id, officer_name, cargos, minutos, origen, created_at) VALUES ('1001', '1003', 'Poli', 'Evasión', 60, 'web', $1)", [NOW]);
  const del = () => e.edits.filter((x) => x.method === 'DELETE' && x.route === '/guilds/G/members/1001/roles/1561567066484510821').length;
  await housekeeping({ db, api: e.api, guildId: 'G', now: () => NOW + 31 * 60_000 });
  assert.equal(del(), 0, 'el de 30 min terminó pero queda el de 60: el rol se queda');
  await housekeeping({ db, api: e.api, guildId: 'G', now: () => NOW + 61 * 60_000 });
  assert.equal(del(), 1, 'terminó el último de la web: se quita el rol');
  // multa: solo la ATT
  [i, ctx] = base('i2', 'multa', 'agregar', [{ name: 'usuario', type: 6, value: '1001' }, { name: 'monto', type: 4, value: 500 }, { name: 'articulos', type: 3, value: 'Art. 5' }]);
  assert.equal(await mirrorOldCommand(i, ctx), null, 'la Policía no pone multas');
  [i, ctx] = base('i3', 'multa', 'agregar', [{ name: 'usuario', type: 6, value: '1001' }, { name: 'monto', type: 4, value: 500 }, { name: 'articulos', type: 3, value: 'Art. 5' }], 'att');
  assert.match(await mirrorOldCommand(i, ctx), /multa/);
  assert.equal((await P.listFines(db, '1001'))[0].monto, 500);
  // /dni crear → cédula en la web
  const dni = { id: 'i4', type: 2, data: { name: 'dni', options: [{ type: 1, name: 'crear', options: [
    { name: 'nombre', value: 'Ana' }, { name: 'apellidos', value: 'Gómez' }, { name: 'fecha_nacimiento', value: '10/03/1995' }, { name: 'tipo_sangre', value: 'O+' },
    { name: 'sexo', value: 'Femenino' }, { name: 'estatura_cm', value: 165 }, { name: 'nacionalidad', value: 'panameña' }, { name: 'roblox_user', value: 'Ana_rbx' }] }] } };
  assert.match(await mirrorOldCommand(dni, { ...ctxOf(e, '1001'), robloxFor: async () => null, lookupRoblox: async (n) => ({ id: 5, name: n }) }), /cédula/);
  assert.equal((await P.getCharacter(db, '1001')).roblox_name, 'Ana_rbx');
  // otros comandos (dinero, casino…) no se tocan
  assert.equal(await mirrorOldCommand({ id: 'i5', type: 2, data: { name: 'balance', options: [] } }, ctxOf(e, '1001')), null);
});
