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
  assert.match(ext.cedula, /^E-8-\d{5,6}$/);
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

test('turnos: uno a la vez, solo con el rol, y solo registran el tiempo (el pago lo hace el bot)', async () => {
  const db = await fresh();
  await citizen(db, POLI);
  await rejects(() => P.startShift(db, POLI.id, 'policia', { jobs: JOBS, allowed: [], now: NOW }), 403, /rol/);
  await rejects(() => P.startShift(db, POLI.id, 'piloto', { jobs: JOBS, allowed: ['piloto'], now: NOW }), 400);
  const s = await P.startShift(db, POLI.id, 'policia', { jobs: JOBS, allowed: ['policia'], now: NOW });
  assert.equal(s.job, 'policia');
  await rejects(() => P.startShift(db, POLI.id, 'policia', { jobs: JOBS, allowed: ['policia'], now: NOW + 1 }), 409, /abierto/);
  const end = await P.endShift(db, POLI.id, { jobs: JOBS, now: NOW + 90 * 60_000 });
  assert.deepEqual(end, { job: 'policia', name: 'Policía Nacional', minutes: 90, paid: 0 });
  assert.equal((await P.getAccount(db, POLI.id)).banco, P.MONEY.startBanco, 'no paga nada');
  await rejects(() => P.endShift(db, POLI.id, { jobs: JOBS, now: NOW }), 409);
  await P.startShift(db, POLI.id, 'policia', { jobs: JOBS, allowed: ['policia'], now: NOW });
  await P.endShift(db, POLI.id, { jobs: JOBS, now: NOW + 10 * 3600_000 });
  assert.deepEqual(await P.shiftStats(db, POLI.id, NOW - 1), { turnos: 2, minutos: 690, pagado: 0 });
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

  // Multas: solo la ATT en turno (la Policía no puede)
  await rejects(() => P.issueFine(db, POLI.id, { cedula: ana.cedula, motivo: 'Exceso de velocidad', monto: 750 }, NOW), 403, /ATT/);
  const ATT = { id: '1009', name: 'att' };
  await citizen(db, ATT, { nombre: 'Tito', apellidos: 'Tránsito' }, 0.91);
  await P.startShift(db, ATT.id, 'transito', { jobs: JOBS, allowed: ['transito'], now: NOW });
  assert.equal((await P.searchCitizens(db, ATT.id, 'ANA pér')).length, 1, 'la ATT también busca');
  const f = await P.issueFine(db, ATT.id, { cedula: ana.cedula, motivo: 'Exceso de velocidad', monto: '750' }, NOW);
  assert.deepEqual(f, { a: 'Ana Pérez Gómez', cedula: ana.cedula, monto: 750 });
  await rejects(() => P.issueFine(db, ATT.id, { cedula: ana.cedula, motivo: 'x', monto: 750 }, NOW), 400);
  await rejects(() => P.issueFine(db, ATT.id, { cedula: ana.cedula, motivo: 'Abuso', monto: 9_999_999 }, NOW), 400);
  const me = await P.getCharacter(db, ATT.id);
  await rejects(() => P.issueFine(db, ATT.id, { cedula: me.cedula, motivo: 'Autoexamen', monto: 100 }, NOW), 400, /ti mismo/);

  const a = await P.registerArrest(db, POLI.id, { cedula: ana.cedula, cargos: 'Robo a mano armada', minutos: 30 }, NOW);
  assert.equal(a.minutos, 30);
  await rejects(() => P.registerArrest(db, POLI.id, { cedula: ana.cedula, cargos: 'Robo', minutos: 500 }, NOW), 400);

  const row = (await P.searchCitizens(db, POLI.id, ana.cedula))[0];
  assert.equal(row.multas, 1);
  assert.equal(row.arrestos, 1);
  const act = await P.officerActivity(db, POLI.id);
  assert.equal((await P.officerActivity(db, ATT.id)).fines[0].monto, 750);
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

test('trabajos según los roles de Discord (uno por rol, por ID)', () => {
  const ID = { pn: '1560736880872525836', aero: '1560736880872525835', sena: '1565913556535353444', att: '1560736880478130184', bomb: '1560736880872525834' };
  const roles = [{ id: ID.pn, name: 'Policía Nacional' }, { id: ID.aero, name: 'Aeronaval' }, { id: '4', name: 'Staff' }, { id: '5', name: 'Oficial de prensa' }, { id: '6', name: 'Paramédicos' }];
  assert.deepEqual(jobsFor([ID.aero], roles), ['aeronaval'], 'solo el rol que tiene');
  assert.deepEqual(jobsFor([ID.pn, ID.sena, ID.att, ID.bomb], roles), ['policia', 'senafront', 'transito', 'bomberos', 'mecanico']);
  assert.deepEqual(jobsFor([ID.att], roles), ['transito', 'mecanico'], 'la ATT también es mecánico');
  assert.deepEqual(jobsFor(['4', '5', '6'], roles), [], 'sin rol de trabajo no hay trabajos (no se adivina por el nombre)');
  assert.deepEqual(jobsFor([], roles), []);
  const custom = configureJobs('bomberos=Staff;nada=algo');
  assert.deepEqual(jobsFor(['4'], roles, custom), ['bomberos'], 'JOB_ROLES puede agregar nombres');
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
  assert.deepEqual(await P.getUserRoblox(db, BETO.id), { id: '55', name: 'Beto_RBX', verified: false, verifiedAt: null });
  await P.setRoblox(db, BETO, { id: 55, name: 'Beto_RBX' }, NOW, { verified: true });
  assert.equal((await P.getUserRoblox(db, BETO.id)).verified, true);
  await P.setRoblox(db, BETO, { id: 55, name: 'Beto_RBX' }, NOW + 1);
  assert.equal((await P.getUserRoblox(db, BETO.id)).verified, true, 'la misma cuenta sigue verificada');
  await P.setRoblox(db, BETO, { id: 66, name: 'Otra' }, NOW + 2);
  assert.equal((await P.getUserRoblox(db, BETO.id)).verified, false, 'otra cuenta no hereda la verificación');
});

test('vincular Roblox: código en la descripción', async () => {
  const { makeCode, hasCode } = await import('../lib/robloxlink.js');
  let i = 0;
  const code = makeCode(() => [3, 10, 21][i++ % 3]);
  assert.equal(code, 'PRP LUZ COCO CORAL');
  assert.equal(hasCode('Hola! prp-luz-coco-coral 🌴 juego Panamá RP', code), true);
  assert.equal(hasCode('PRP  LUZ\nCOCO   CORAL', code), true);
  assert.equal(hasCode('PRP LUZ COCO', code), false);
  assert.equal(hasCode('XPRP LUZ COCO CORALES', code), false, 'no vale como parte de otra palabra');
  assert.equal(hasCode('', code), false);
});


test('inmobiliaria: se paga con el banco; ya no hay concesionario (los carros son los del bot)', async () => {
  const M = await import('../lib/market.js');
  const db = await fresh();
  await citizen(db, ANA);
  assert.equal((await M.listCatalog(db)).length, 0, 'empieza vacío: lo llenan los admins');
  await rejects(() => M.saveItem(db, { tipo: 'avion', nombre: 'x', precio: -1 }), 400);
  await rejects(() => M.saveItem(db, { tipo: 'vehiculo', nombre: 'Moto deportiva', precio: 12000 }), 400);
  // un carro que quedó del concesionario de antes: no sale ni se puede comprar
  const old = await db.one("INSERT INTO catalog (tipo, nombre, precio, created_at) VALUES ('vehiculo', 'Sedán viejo', 1000, $1) RETURNING id", [NOW]);
  await M.saveItem(db, { tipo: 'casa', nombre: 'Mansión', precio: 650000, stock: '' }, NOW);
  await M.saveItem(db, { tipo: 'casa', nombre: 'Casa en la playa', precio: 180000, stock: 1 }, NOW);
  const cat = await M.listCatalog(db);
  assert.deepEqual(cat.map((x) => x.tipo), ['casa', 'casa']);
  assert.equal(cat.find((x) => x.nombre === 'Mansión').stock, null, 'vacío = sin límite');
  await rejects(() => M.buy(db, ANA.id, { id: old.id }, { now: NOW }), 404);
  await rejects(() => M.buy(db, ANA.id, { id: cat.find((x) => x.nombre === 'Mansión').id }, { now: NOW }), 400, /suficiente/);
  await db.run('UPDATE accounts SET banco = 500000 WHERE discord_id = $1', [ANA.id]);
  const playa = cat.find((x) => x.nombre === 'Casa en la playa');
  const casa = await M.buy(db, ANA.id, { id: playa.id }, { now: NOW });
  assert.match(casa.bought.direccion, /calle/);
  assert.equal(casa.account.banco, 500000 - playa.precio);
  assert.equal((await M.listCatalog(db)).find((x) => x.id === playa.id).stock, 0, 'baja el stock');
  await rejects(() => M.buy(db, ANA.id, { id: playa.id }, { now: NOW }), 409, /agotó/);
  // foto: solo imágenes de verdad
  await rejects(() => M.setImage(db, playa.id, 'data:image/png;base64,aGVsbG8gd29ybGQgdGhpcyBpcyBub3QgYW4gaW1hZ2UgYXQgYWxsIGJ1dCBsb25nIGVub3VnaCB0byBwYXNzIHRoZSBzaXplIGNoZWNrIGZvciBzdXJl'), 400);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]).toString('base64');
  await M.setImage(db, playa.id, `data:image/png;base64,${png}`, NOW);
  assert.match((await M.listCatalog(db)).find((x) => x.id === playa.id).imagen, /^\/img\/catalogo\/\d+/);
  assert.equal((await M.getImage(db, playa.id)).mime, 'image/png');
  await M.removeItem(db, playa.id);
  assert.equal((await M.listCatalog(db)).some((x) => x.id === playa.id), false);
  // carros: los que registró con /vehiculo registrar del bot
  for (const [placa, modelo] of [['AB1234', 'Hilux'], ['CD-567', 'Civic']]) {
    await db.run("INSERT INTO vehicles (placa, discord_id, marca, modelo, color, created_at) VALUES ($1, $2, 'Toyota', $3, 'Rojo', $4)", [placa, ANA.id, modelo, NOW]);
  }
  const mine = await M.myAssets(db, ANA.id);
  assert.equal(mine.vehicles.length, 2);
  assert.equal(mine.properties.length, 1);
  const r = { bought: { placa: 'AB1234' } };

  // la Policía o la ATT la encuentran por la placa y ven su ficha
  const ATT = { id: '1009', name: 'att' };
  await citizen(db, ATT, { nombre: 'Tito', apellidos: 'Tránsito' }, 0.91);
  await P.startShift(db, ATT.id, 'transito', { jobs: JOBS, allowed: ['transito'], now: NOW });
  const found = await P.searchCitizens(db, ATT.id, r.bought.placa.toLowerCase());
  assert.equal(found.length, 1);
  assert.ok(found[0].placas.includes(r.bought.placa));
  const rec = await P.citizenRecord(db, ATT.id, found[0].cedula);
  assert.equal(rec.vehiculos.length, 2);
  assert.equal(rec.propiedades.length, 1);
  assert.equal(rec.persona.discord_id, undefined, 'no expone el ID de Discord');
  await rejects(() => P.citizenRecord(db, ANA.id, found[0].cedula), 403);
});

test('vincular Roblox con Discord: toma la cuenta de Roblox de las conexiones', async () => {
  const { robloxFromConnections } = await import('../lib/robloxlink.js');
  assert.equal(robloxFromConnections(null), null);
  assert.equal(robloxFromConnections([{ type: 'steam', id: '1', name: 'x', verified: true }]), null, 'sin Roblox conectado');
  assert.equal(robloxFromConnections([{ type: 'roblox', id: '55', name: 'Ana_RP', verified: false }]), null, 'sin verificar no cuenta');
  assert.equal(robloxFromConnections([{ type: 'roblox', id: '55', name: 'Ana_RP', verified: true, revoked: true }]), null, 'quitada no cuenta');
  assert.equal(robloxFromConnections([{ type: 'roblox', id: 'abc', name: 'Ana_RP', verified: true }]), null, 'ID raro no cuenta');
  assert.deepEqual(robloxFromConnections([{ type: 'twitch', id: '9', name: 'a', verified: true }, { type: 'roblox', id: '4815162342', name: 'Ana_RP', verified: true }]), { id: '4815162342', name: 'Ana_RP' });
});

test('fotos de los trabajos: dibujo de fábrica o la que suben los admins', async () => {
  const M = await import('../lib/market.js');
  const db = await fresh();
  const keys = ['policia', 'bomberos'];
  assert.deepEqual(await M.jobImages(db, keys), { policia: '/img/trabajos/policia.svg', bomberos: '/img/trabajos/bomberos.svg' });
  await rejects(() => M.setJobImage(db, 'policia', 'data:image/gif;base64,R0lGODlh'), 400);
  await rejects(() => M.setJobImage(db, 'policia', `data:image/png;base64,${Buffer.alloc(300, 1).toString('base64')}`), 400, /válida/);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]).toString('base64');
  await M.setJobImage(db, 'policia', `data:image/png;base64,${png}`, NOW);
  const imgs = await M.jobImages(db, keys);
  assert.equal(imgs.policia, `/img/trabajo/policia?v=${NOW}`);
  assert.equal(imgs.bomberos, '/img/trabajos/bomberos.svg');
  assert.equal((await M.getJobImage(db, 'policia')).mime, 'image/png');
  await M.removeJobImage(db, 'policia');
  assert.equal((await M.jobImages(db, keys)).policia, '/img/trabajos/policia.svg', 'al quitarla vuelve el dibujo');
});
