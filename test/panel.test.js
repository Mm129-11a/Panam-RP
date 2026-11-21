import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectSqlite, migrate } from '../lib/db.js';
import { JOBS, configureJobs, jobsFor } from '../lib/jobs.js';
import * as P from '../lib/panel.js';

const NOW = Date.UTC(2026, 10, 21, 18, 0, 0);
const ANA = { id: '1001', name: 'ana' };
const BETO = { id: '1002', name: 'beto' };
const POLI = { id: '1003', name: 'poli' };
const RBX = { id: 4815162342, name: 'Ana_RP' };
const person = (over = {}) => ({ nombre: 'Ana', apellidos: 'Pérez Gómez', nacimiento: '1995-03-10', genero: 'Femenino', sangre: 'O+', nacionalidad: 'Panameña', ...over });

async function fresh() {
  const db = await connectSqlite(':memory:');
  await migrate(db);
  await migrate(db); // se puede correr dos veces sin romper nada
  return db;
}
async function citizen(db, user, over = {}, seed = 0.42) {
  let i = 0;
  return P.createCharacter(db, { user, roblox: { id: Number(user.id), name: `${user.name}_rbx` }, input: person({ nombre: user.name[0].toUpperCase() + user.name.slice(1), ...over }), now: NOW, rng: () => ((seed + (i++) * 0.137) % 1) });
}
const rejects = async (fn, status, re) => {
  await assert.rejects(fn, (err) => { assert.equal(err.status, status, err.message); if (re) assert.match(err.message, re); return true; });
};

test('cédula: se crea una vez, con número válido y cuenta abierta', async () => {
  const db = await fresh();
  const c = await P.createCharacter(db, { user: ANA, roblox: RBX, input: person(), now: NOW });
  assert.match(c.cedula, /^(\d|13)-\d{3}-\d{4}$/);
  assert.equal(c.roblox_name, 'Ana_RP');
  assert.deepEqual(await P.getAccount(db, ANA.id), { efectivo: P.MONEY.startEfectivo, banco: P.MONEY.startBanco });
  await rejects(() => P.createCharacter(db, { user: ANA, roblox: RBX, input: person(), now: NOW }), 409, /Ya tienes/);
  const ext = await citizen(db, BETO, { nacionalidad: 'Colombiana' });
  assert.match(ext.cedula, /^E-8-\d{5}$/);
  await rejects(() => P.createCharacter(db, { user: POLI, roblox: RBX, input: person({ nombre: '1234', nacimiento: '2015-01-01' }), now: NOW }), 400);
  const tx = await P.listTransactions(db, ANA.id);
  assert.equal(tx[0].kind, 'apertura');
});

test('dos personas no pueden tener la misma cédula (se genera otra)', async () => {
  const db = await fresh();
  const a = await citizen(db, ANA, {}, 0.3);
  const b = await citizen(db, BETO, {}, 0.3); // mismo azar al principio → choca y prueba otro número
  assert.notEqual(a.cedula, b.cedula);
});

test('banco: depositar, retirar y nunca quedar en negativo', async () => {
  const db = await fresh();
  await citizen(db, ANA);
  assert.deepEqual(await P.moveMoney(db, ANA.id, 'depositar', 500, NOW), { efectivo: 1500, banco: 8500 });
  assert.deepEqual(await P.moveMoney(db, ANA.id, 'retirar', '1000', NOW), { efectivo: 2500, banco: 7500 });
  await rejects(() => P.moveMoney(db, ANA.id, 'depositar', 999999, NOW), 400, /efectivo/);
  await rejects(() => P.moveMoney(db, ANA.id, 'retirar', -5, NOW), 400);
  await rejects(() => P.moveMoney(db, ANA.id, 'retirar', 1.5, NOW), 400);
  await rejects(() => P.moveMoney(db, ANA.id, 'robar', 5, NOW), 400);
  await rejects(() => P.moveMoney(db, BETO.id, 'depositar', 5, NOW), 409, /cédula/);
  assert.deepEqual(await P.getAccount(db, ANA.id), { efectivo: 2500, banco: 7500 });
});

test('transferencias por cédula', async () => {
  const db = await fresh();
  await citizen(db, ANA);
  const beto = await citizen(db, BETO, {}, 0.9);
  const r = await P.transfer(db, ANA.id, beto.cedula.toLowerCase(), 3000, 'Renta del local', NOW);
  assert.equal(r.to, 'Beto Pérez Gómez');
  assert.equal(r.account.banco, 5000);
  assert.equal((await P.getAccount(db, BETO.id)).banco, 11000);
  await rejects(() => P.transfer(db, ANA.id, beto.cedula, 999999, '', NOW), 400, /banco/);
  await rejects(() => P.transfer(db, ANA.id, '0-000-0000', 5, '', NOW), 404);
  const mine = await P.getCharacter(db, ANA.id);
  await rejects(() => P.transfer(db, ANA.id, mine.cedula, 5, '', NOW), 400, /ti mismo/);
  const t = await P.listTransactions(db, BETO.id);
  assert.equal(t[0].amount, 3000);
  assert.equal(t[0].other_nombre, 'Ana');
  assert.equal(t[0].note, 'Renta del local');
});

test('turnos: uno a la vez, solo con el rol, y paga al terminar', async () => {
  const db = await fresh();
  await citizen(db, POLI);
  await rejects(() => P.startShift(db, POLI.id, 'policia', { jobs: JOBS, allowed: [], now: NOW }), 403, /rol/);
  await rejects(() => P.startShift(db, POLI.id, 'piloto', { jobs: JOBS, allowed: ['piloto'], now: NOW }), 400);
  const s = await P.startShift(db, POLI.id, 'policia', { jobs: JOBS, allowed: ['policia'], now: NOW });
  assert.equal(s.job, 'policia');
  await rejects(() => P.startShift(db, POLI.id, 'policia', { jobs: JOBS, allowed: ['policia'], now: NOW + 1 }), 409, /abierto/);
  const end = await P.endShift(db, POLI.id, { jobs: JOBS, now: NOW + 90 * 60_000 });
  assert.deepEqual(end, { job: 'policia', minutes: 90, paid: 1800, capped: false, tooShort: false });
  assert.equal((await P.getAccount(db, POLI.id)).banco, P.MONEY.startBanco + 1800);
  await rejects(() => P.endShift(db, POLI.id, { jobs: JOBS, now: NOW }), 409);

  await P.startShift(db, POLI.id, 'policia', { jobs: JOBS, allowed: ['policia'], now: NOW });
  assert.equal((await P.endShift(db, POLI.id, { jobs: JOBS, now: NOW + 2 * 60_000 })).paid, 0, 'menos de 5 min no paga');
  await P.startShift(db, POLI.id, 'policia', { jobs: JOBS, allowed: ['policia'], now: NOW });
  const long = await P.endShift(db, POLI.id, { jobs: JOBS, now: NOW + 10 * 3600_000 });
  assert.equal(long.paid, 4800, 'tope de 4 horas');
  assert.equal(long.capped, true);
  assert.deepEqual(await P.shiftStats(db, POLI.id, NOW - 1), { turnos: 3, minutos: 692, pagado: 6600 });
});

test('policía: buscar, multar y arrestar solo en turno', async () => {
  const db = await fresh();
  const ana = await citizen(db, ANA);
  await citizen(db, POLI, { nombre: 'Poli', apellidos: 'Martínez' }, 0.77);
  await rejects(() => P.searchCitizens(db, POLI.id, 'ana'), 403, /turno/);
  await P.startShift(db, POLI.id, 'policia', { jobs: JOBS, allowed: ['policia'], now: NOW });

  const found = await P.searchCitizens(db, POLI.id, 'ANA pér');
  assert.equal(found.length, 1);
  assert.equal(found[0].cedula, ana.cedula);
  assert.equal(found[0].discord_id, undefined, 'no expone el ID de Discord');
  assert.equal((await P.searchCitizens(db, POLI.id, ana.cedula.toLowerCase())).length, 1);
  assert.equal((await P.searchCitizens(db, POLI.id, '%_%')).length, 0, 'los comodines no listan a todos');
  await rejects(() => P.searchCitizens(db, POLI.id, 'a'), 400);

  const f = await P.issueFine(db, POLI.id, { cedula: ana.cedula, motivo: 'Exceso de velocidad', monto: '750' }, NOW);
  assert.deepEqual(f, { a: 'Ana Pérez Gómez', cedula: ana.cedula, monto: 750 });
  await rejects(() => P.issueFine(db, POLI.id, { cedula: ana.cedula, motivo: 'x', monto: 750 }, NOW), 400);
  await rejects(() => P.issueFine(db, POLI.id, { cedula: ana.cedula, motivo: 'Abuso', monto: 9_999_999 }, NOW), 400);
  const me = await P.getCharacter(db, POLI.id);
  await rejects(() => P.issueFine(db, POLI.id, { cedula: me.cedula, motivo: 'Autoexamen', monto: 100 }, NOW), 400, /ti mismo/);

  const a = await P.registerArrest(db, POLI.id, { cedula: ana.cedula, cargos: 'Robo a mano armada', minutos: 30 }, NOW);
  assert.equal(a.minutos, 30);
  await rejects(() => P.registerArrest(db, POLI.id, { cedula: ana.cedula, cargos: 'Robo', minutos: 500 }, NOW), 400);

  const row = (await P.searchCitizens(db, POLI.id, ana.cedula))[0];
  assert.equal(row.multas, 1);
  assert.equal(row.arrestos, 1);
  const act = await P.officerActivity(db, POLI.id);
  assert.equal(act.fines[0].monto, 750);
  assert.equal(act.arrests[0].cargos, 'Robo a mano armada');
  const arrests = await P.listArrests(db, ANA.id);
  assert.equal(arrests[0].officer_name, 'Poli Martínez');

  // la ciudadana paga la multa desde el banco
  const [fine] = await P.listFines(db, ANA.id);
  assert.equal(fine.estado, 'pendiente');
  const acc = await P.payFine(db, ANA.id, fine.id, NOW);
  assert.equal(acc.banco, P.MONEY.startBanco - 750);
  await rejects(() => P.payFine(db, ANA.id, fine.id, NOW), 404, /pagada/);
  await rejects(() => P.payFine(db, POLI.id, fine.id, NOW), 404); // no se pueden pagar multas ajenas
  assert.equal((await P.listFines(db, ANA.id))[0].estado, 'pagada');
});

test('las solicitudes se guardan y sirven para llenar la cédula', async () => {
  const db = await fresh();
  await P.saveApplication(db, { user: ANA, roblox: RBX, data: { personaje: person(), respuestas: {} }, score: { correct: 4, total: 4 } }, NOW);
  await P.saveApplication(db, { user: ANA, roblox: { id: 9, name: 'Ana_Nueva' }, data: { personaje: person({ nombre: 'Anita' }) }, score: {} }, NOW + 1000);
  const last = await P.latestApplication(db, ANA.id);
  assert.equal(last.roblox.name, 'Ana_Nueva');
  assert.equal(last.personaje.nombre, 'Anita');
  await P.setApplicationStatus(db, ANA.id, 'aceptada');
  const rows = await db.query('SELECT estado FROM applications ORDER BY created_at');
  assert.deepEqual(rows.map((r) => r.estado), ['pendiente', 'aceptada']);
  assert.equal(await P.latestApplication(db, BETO.id), null);
});

test('trabajos según los roles de Discord', () => {
  const roles = [{ id: '1', name: '🚓 | Policía Nacional' }, { id: '2', name: 'Paramédicos' }, { id: '3', name: 'Taller Mecánico' }, { id: '4', name: 'Staff' }];
  assert.deepEqual(jobsFor(['1', '4'], roles), ['policia']);
  assert.deepEqual(jobsFor(['2', '3'], roles), ['ems', 'mecanico']);
  assert.deepEqual(jobsFor([], roles), []);
  const custom = configureJobs('policia=Staff;nada=algo;ems=');
  assert.deepEqual(jobsFor(['4'], roles, custom), ['policia']);
  assert.deepEqual(custom.ems.roles, JOBS.ems.roles, 'un valor vacío no borra los nombres por defecto');
});

test('historial de turnos, ranking y Roblox vinculado', async () => {
  const db = await fresh();
  await citizen(db, ANA);
  await citizen(db, POLI, { nombre: 'Poli' }, 0.77);
  for (const [u, mins] of [[ANA, 30], [POLI, 120], [ANA, 45]]) {
    await P.startShift(db, u.id, 'policia', { jobs: JOBS, allowed: ['policia'], now: NOW });
    await P.endShift(db, u.id, { jobs: JOBS, now: NOW + mins * 60_000 });
  }
  const hist = await P.listShifts(db, ANA.id);
  assert.equal(hist.length, 2);
  assert.equal(hist[0].minutes + hist[1].minutes, 75);
  const rank = await P.shiftRanking(db, NOW - 1);
  assert.deepEqual(rank.map((r) => [r.nombre, r.minutos, r.turnos]), [['Poli', 120, 1], ['Ana', 75, 2]]);
  assert.equal(rank[0]._id, POLI.id);
  assert.equal(await P.getUserRoblox(db, BETO.id), null);
  await P.setRoblox(db, BETO, { id: 55, name: 'Beto_RBX' });
  assert.deepEqual(await P.getUserRoblox(db, BETO.id), { id: '55', name: 'Beto_RBX' });
});
