// Lógica del panel de ciudadano: cédula, banco, turnos de trabajo y herramientas de policía.
// Todas las funciones reciben `db` (lib/db.js). El dinero son dólares enteros; las fechas, milisegundos.
import { isUniqueViolation } from './db.js';
import { validateCharacter } from './whitelist.js';
import { SHIFT } from './jobs.js';

export const MONEY = {
  startEfectivo: 2000,
  startBanco: 8000,
  maxMove: 1_000_000,
  fineMin: 50,
  fineMax: 50_000,
};
export const ARREST_MAX_MIN = 120;

export class PanelError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const int = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,9}$/.test(v.trim()) ? Number(v) : NaN);
function amount(v, min, max, label = 'monto') {
  const n = int(v);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new PanelError(400, `El ${label} debe estar entre $${min.toLocaleString('es-PA')} y $${max.toLocaleString('es-PA')}.`);
  return n;
}

// ─── Usuarios y solicitudes ───
export async function touchUser(db, user, now = Date.now()) {
  await db.run(
    `INSERT INTO users (discord_id, discord_name, avatar, created_at, last_login) VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (discord_id) DO UPDATE SET discord_name = $2, avatar = $3, last_login = $4`,
    [user.id, String(user.name || '').slice(0, 64), user.avatar || null, now],
  );
}

export async function saveApplication(db, { user, roblox, data, score }, now = Date.now()) {
  await setRoblox(db, user, roblox, now);
  await db.run(
    'INSERT INTO applications (discord_id, roblox_id, roblox_name, data, score, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [user.id, String(roblox.id), roblox.name, JSON.stringify(data), JSON.stringify(score), now],
  );
}

export async function latestApplication(db, discordId) {
  const row = await db.one('SELECT roblox_id, roblox_name, data FROM applications WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 1', [discordId]);
  if (!row) return null;
  let data = {};
  try { data = JSON.parse(row.data); } catch { data = {}; }
  return { roblox: { id: row.roblox_id, name: row.roblox_name }, personaje: data.personaje || null };
}

export async function setApplicationStatus(db, discordId, estado) {
  await db.run(
    `UPDATE applications SET estado = $1 WHERE id = (SELECT id FROM applications WHERE discord_id = $2 ORDER BY created_at DESC LIMIT 1)`,
    [estado, discordId],
  );
}

// ─── Cédula ───
function randomCedula(nacionalidad, rng = Math.random) {
  const n = (min, max) => min + Math.floor(rng() * (max - min + 1));
  if (nacionalidad !== 'Panameña') return `E-8-${n(10000, 99999)}`;
  const provincias = [1, 2, 3, 4, 5, 6, 7, 8, 8, 8, 9, 13]; // la 8 (Panamá) sale más
  return `${provincias[n(0, provincias.length - 1)]}-${n(100, 999)}-${n(1000, 9999)}`;
}

export async function getCharacter(db, discordId) {
  return db.one(
    'SELECT cedula, nombre, apellidos, nacimiento, genero, sangre, nacionalidad, roblox_id, roblox_name, created_at FROM characters WHERE discord_id = $1',
    [discordId],
  );
}

export async function createCharacter(db, { user, roblox, input, now = Date.now(), rng = Math.random }) {
  if (await getCharacter(db, user.id)) throw new PanelError(409, 'Ya tienes una cédula.');
  const { ok, errors, personaje } = validateCharacter(input, { now: new Date(now) });
  if (!ok) throw new PanelError(400, 'Revisa los campos marcados.', errors);
  if (!roblox?.id || !roblox?.name) throw new PanelError(400, 'Falta tu usuario de Roblox.', { roblox: 'Verifica tu usuario de Roblox.' });
  await touchUser(db, user, now);
  for (let i = 0; i < 12; i++) {
    const cedula = randomCedula(personaje.nacionalidad, rng);
    try {
      await db.tx(async (t) => {
        await t.run(
          `INSERT INTO characters (discord_id, cedula, nombre, apellidos, nacimiento, genero, sangre, nacionalidad, roblox_id, roblox_name, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
          [user.id, cedula, personaje.nombre, personaje.apellidos, personaje.nacimiento, personaje.genero, personaje.sangre, personaje.nacionalidad, String(roblox.id), roblox.name, now],
        );
        const acc = await t.run('INSERT INTO accounts (discord_id, efectivo, banco) VALUES ($1, $2, $3) ON CONFLICT (discord_id) DO NOTHING', [user.id, MONEY.startEfectivo, MONEY.startBanco]);
        if (acc.rowCount) await t.run("INSERT INTO transactions (discord_id, kind, amount, note, created_at) VALUES ($1, 'apertura', $2, 'Cuenta abierta', $3)", [user.id, MONEY.startBanco, now]);
      });
      return getCharacter(db, user.id);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      if (await getCharacter(db, user.id)) throw new PanelError(409, 'Ya tienes una cédula.');
      // número repetido: se prueba otro
    }
  }
  throw new PanelError(500, 'No se pudo generar la cédula. Intenta de nuevo.');
}

// ─── Banco ───
export async function getAccount(db, discordId) {
  return db.one('SELECT efectivo, banco FROM accounts WHERE discord_id = $1', [discordId]);
}

async function requireAccount(db, discordId) {
  const acc = await getAccount(db, discordId);
  if (!acc) throw new PanelError(409, 'Primero crea tu cédula para abrir tu cuenta.');
  return acc;
}

// Depositar (efectivo → banco) o retirar (banco → efectivo). Un solo UPDATE: no se puede quedar en negativo.
export async function moveMoney(db, discordId, kind, value, now = Date.now()) {
  await requireAccount(db, discordId);
  const n = amount(value, 1, MONEY.maxMove);
  const sql = kind === 'depositar'
    ? 'UPDATE accounts SET efectivo = efectivo - $1, banco = banco + $1 WHERE discord_id = $2 AND efectivo >= $1'
    : kind === 'retirar'
      ? 'UPDATE accounts SET banco = banco - $1, efectivo = efectivo + $1 WHERE discord_id = $2 AND banco >= $1'
      : null;
  if (!sql) throw new PanelError(400, 'Operación no válida.');
  return db.tx(async (t) => {
    const r = await t.run(sql, [n, discordId]);
    if (!r.rowCount) throw new PanelError(400, kind === 'depositar' ? 'No tienes tanto efectivo.' : 'No tienes tanto en el banco.');
    await t.run('INSERT INTO transactions (discord_id, kind, amount, created_at) VALUES ($1, $2, $3, $4)', [discordId, kind, kind === 'depositar' ? n : -n, now]);
    return t.one('SELECT efectivo, banco FROM accounts WHERE discord_id = $1', [discordId]);
  });
}

export async function transfer(db, fromId, cedula, value, note, now = Date.now()) {
  await requireAccount(db, fromId);
  const n = amount(value, 1, MONEY.maxMove);
  const ced = clean(cedula, 20).toUpperCase();
  const to = await db.one('SELECT discord_id, nombre, apellidos FROM characters WHERE cedula = $1', [ced]);
  if (!to) throw new PanelError(404, 'No hay nadie con esa cédula.');
  if (to.discord_id === fromId) throw new PanelError(400, 'No puedes transferirte a ti mismo.');
  const nota = clean(note, 80) || null;
  return db.tx(async (t) => {
    const out = await t.run('UPDATE accounts SET banco = banco - $1 WHERE discord_id = $2 AND banco >= $1', [n, fromId]);
    if (!out.rowCount) throw new PanelError(400, 'No tienes tanto en el banco.');
    const inn = await t.run('UPDATE accounts SET banco = banco + $1 WHERE discord_id = $2', [n, to.discord_id]);
    if (!inn.rowCount) throw new PanelError(409, 'Esa persona aún no tiene cuenta.');
    await t.run("INSERT INTO transactions (discord_id, kind, amount, other_id, note, created_at) VALUES ($1, 'transferencia', $2, $3, $4, $5)", [fromId, -n, to.discord_id, nota, now]);
    await t.run("INSERT INTO transactions (discord_id, kind, amount, other_id, note, created_at) VALUES ($1, 'transferencia', $2, $3, $4, $5)", [to.discord_id, n, fromId, nota, now]);
    return { to: `${to.nombre} ${to.apellidos}`, account: await t.one('SELECT efectivo, banco FROM accounts WHERE discord_id = $1', [fromId]) };
  });
}

export async function listTransactions(db, discordId, limit = 15) {
  return db.query(
    `SELECT t.kind, t.amount, t.note, t.created_at, c.nombre AS other_nombre, c.apellidos AS other_apellidos
     FROM transactions t LEFT JOIN characters c ON c.discord_id = t.other_id
     WHERE t.discord_id = $1 ORDER BY t.created_at DESC, t.id DESC LIMIT $2`,
    [discordId, limit],
  );
}

// ─── Multas y arrestos ───
export async function listFines(db, discordId) {
  return db.query('SELECT id, officer_name, motivo, monto, estado, created_at, paid_at FROM fines WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 30', [discordId]);
}

export async function payFine(db, discordId, fineId, now = Date.now()) {
  const id = int(fineId);
  if (!Number.isSafeInteger(id)) throw new PanelError(400, 'Multa no válida.');
  return db.tx(async (t) => {
    const fine = await t.one("SELECT id, monto FROM fines WHERE id = $1 AND discord_id = $2 AND estado = 'pendiente'", [id, discordId]);
    if (!fine) throw new PanelError(404, 'Esa multa no existe o ya está pagada.');
    const r = await t.run('UPDATE accounts SET banco = banco - $1 WHERE discord_id = $2 AND banco >= $1', [fine.monto, discordId]);
    if (!r.rowCount) throw new PanelError(400, 'No tienes suficiente en el banco para pagarla.');
    const upd = await t.run("UPDATE fines SET estado = 'pagada', paid_at = $1 WHERE id = $2 AND estado = 'pendiente'", [now, id]);
    if (!upd.rowCount) throw new PanelError(409, 'Esa multa ya se pagó.');
    await t.run("INSERT INTO transactions (discord_id, kind, amount, note, created_at) VALUES ($1, 'multa', $2, 'Pago de multa', $3)", [discordId, -fine.monto, now]);
    return t.one('SELECT efectivo, banco FROM accounts WHERE discord_id = $1', [discordId]);
  });
}

export async function listArrests(db, discordId) {
  return db.query('SELECT officer_name, cargos, minutos, created_at FROM arrests WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 30', [discordId]);
}

// ─── Turnos ───
export async function activeShift(db, discordId) {
  return db.one('SELECT id, job, started_at FROM shifts WHERE discord_id = $1 AND ended_at IS NULL', [discordId]);
}

export async function startShift(db, discordId, job, { jobs, allowed, now = Date.now(), verify = null }) {
  if (!jobs[job]) throw new PanelError(400, 'Ese trabajo no existe.');
  if (!allowed.includes(job)) throw new PanelError(403, 'No tienes el rol de ese trabajo en Discord.');
  const me = await getCharacter(db, discordId);
  if (!me) throw new PanelError(409, 'Primero crea tu cédula.');
  if (await activeShift(db, discordId)) throw new PanelError(409, 'Ya tienes un turno abierto.');
  if (verify) await verify(me); // p. ej. comprobar que está dentro del servidor de ER:LC
  try {
    await db.run('INSERT INTO shifts (discord_id, job, started_at) VALUES ($1, $2, $3)', [discordId, job, now]);
  } catch (err) {
    if (isUniqueViolation(err)) throw new PanelError(409, 'Ya tienes un turno abierto.');
    throw err;
  }
  return activeShift(db, discordId);
}

// Termina el turno y paga al banco según los minutos (con tope).
export async function endShift(db, discordId, { jobs, now = Date.now() }) {
  return db.tx(async (t) => {
    const s = await t.one('SELECT id, job, started_at FROM shifts WHERE discord_id = $1 AND ended_at IS NULL', [discordId]);
    if (!s) throw new PanelError(409, 'No tienes un turno abierto.');
    const minutes = Math.max(0, Math.floor((now - s.started_at) / 60_000));
    const paidMinutes = Math.min(minutes, SHIFT.maxMinutes);
    const rate = jobs[s.job]?.payPerHour || 0;
    const paid = minutes >= SHIFT.minMinutes ? Math.round((paidMinutes / 60) * rate) : 0;
    const r = await t.run('UPDATE shifts SET ended_at = $1, minutes = $2, paid = $3 WHERE id = $4 AND ended_at IS NULL', [now, minutes, paid, s.id]);
    if (!r.rowCount) throw new PanelError(409, 'Ese turno ya terminó.');
    if (paid > 0) {
      await t.run('UPDATE accounts SET banco = banco + $1 WHERE discord_id = $2', [paid, discordId]);
      await t.run("INSERT INTO transactions (discord_id, kind, amount, note, created_at) VALUES ($1, 'salario', $2, $3, $4)", [discordId, paid, `Turno de ${jobs[s.job]?.name || s.job}`, now]);
    }
    return { job: s.job, minutes, paid, capped: minutes > SHIFT.maxMinutes, tooShort: minutes < SHIFT.minMinutes };
  });
}

export async function shiftStats(db, discordId, since) {
  const row = await db.one(
    'SELECT COUNT(*) AS turnos, CAST(COALESCE(SUM(minutes), 0) AS BIGINT) AS minutos, CAST(COALESCE(SUM(paid), 0) AS BIGINT) AS pagado FROM shifts WHERE discord_id = $1 AND ended_at IS NOT NULL AND started_at >= $2',
    [discordId, since],
  );
  return { turnos: Number(row?.turnos || 0), minutos: Number(row?.minutos || 0), pagado: Number(row?.pagado || 0) };
}

// Historial de turnos y ranking de la semana
export async function listShifts(db, discordId, limit = 20) {
  return db.query('SELECT job, started_at, ended_at, minutes, paid FROM shifts WHERE discord_id = $1 AND ended_at IS NOT NULL ORDER BY started_at DESC LIMIT $2', [discordId, limit]);
}

export async function shiftRanking(db, since, limit = 10) {
  const rows = await db.query(
    `SELECT s.discord_id, c.nombre, c.apellidos, CAST(SUM(s.minutes) AS BIGINT) AS minutos, COUNT(*) AS turnos
     FROM shifts s JOIN characters c ON c.discord_id = s.discord_id
     WHERE s.ended_at IS NOT NULL AND s.started_at >= $1
     GROUP BY s.discord_id, c.nombre, c.apellidos ORDER BY minutos DESC LIMIT $2`,
    [since, limit],
  );
  return rows.map(({ discord_id: id, ...r }) => ({ ...r, minutos: Number(r.minutos), turnos: Number(r.turnos), _id: id }));
}

// Usuario de Roblox vinculado (antes de tener cédula)
export async function setRoblox(db, user, roblox, now = Date.now()) {
  await touchUser(db, user, now);
  await db.run('UPDATE users SET roblox_id = $1, roblox_name = $2 WHERE discord_id = $3', [String(roblox.id), roblox.name, user.id]);
}

export async function getUserRoblox(db, discordId) {
  const row = await db.one('SELECT roblox_id, roblox_name FROM users WHERE discord_id = $1', [discordId]);
  return row?.roblox_name ? { id: row.roblox_id, name: row.roblox_name } : null;
}

// ─── Policía ───
const officerName = (c) => `${c.nombre} ${c.apellidos}`;

async function requireOnDuty(db, officerId) {
  const shift = await activeShift(db, officerId);
  if (!shift || shift.job !== 'policia') throw new PanelError(403, 'Inicia tu turno de Policía para usar esto.');
  const me = await getCharacter(db, officerId);
  if (!me) throw new PanelError(409, 'Primero crea tu cédula.');
  return me;
}

export async function searchCitizens(db, officerId, q) {
  await requireOnDuty(db, officerId);
  const text = clean(q, 40);
  if (text.length < 2) throw new PanelError(400, 'Escribe al menos 2 letras o una cédula.');
  const like = `%${text.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const rows = await db.query(
    `SELECT c.discord_id, c.cedula, c.nombre, c.apellidos, c.nacimiento, c.nacionalidad, c.roblox_name,
       (SELECT COUNT(*) FROM fines f WHERE f.discord_id = c.discord_id AND f.estado = 'pendiente') AS multas,
       (SELECT COUNT(*) FROM arrests a WHERE a.discord_id = c.discord_id) AS arrestos
     FROM characters c
     WHERE UPPER(c.cedula) = $1 OR LOWER(c.nombre || ' ' || c.apellidos) LIKE $2 ESCAPE '\\' OR LOWER(c.roblox_name) LIKE $2 ESCAPE '\\'
     ORDER BY c.apellidos, c.nombre LIMIT 10`,
    [text.toUpperCase(), like],
  );
  return rows.map(({ discord_id: _id, ...r }) => ({ ...r, multas: Number(r.multas), arrestos: Number(r.arrestos) }));
}

async function findTarget(db, officerId, cedula) {
  const ced = clean(cedula, 20).toUpperCase();
  const target = await db.one('SELECT discord_id, nombre, apellidos, cedula FROM characters WHERE cedula = $1', [ced]);
  if (!target) throw new PanelError(404, 'No hay nadie con esa cédula.');
  if (target.discord_id === officerId) throw new PanelError(400, 'No puedes hacerte esto a ti mismo.');
  return target;
}

export async function issueFine(db, officerId, { cedula, motivo, monto }, now = Date.now()) {
  const me = await requireOnDuty(db, officerId);
  const target = await findTarget(db, officerId, cedula);
  const m = clean(motivo, 200);
  if (m.length < 3) throw new PanelError(400, 'Escribe el motivo de la multa.', { motivo: 'Escribe el motivo.' });
  const n = amount(monto, MONEY.fineMin, MONEY.fineMax, 'monto de la multa');
  await db.run(
    'INSERT INTO fines (discord_id, officer_id, officer_name, motivo, monto, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [target.discord_id, officerId, officerName(me), m, n, now],
  );
  return { a: `${target.nombre} ${target.apellidos}`, cedula: target.cedula, monto: n };
}

export async function registerArrest(db, officerId, { cedula, cargos, minutos }, now = Date.now()) {
  const me = await requireOnDuty(db, officerId);
  const target = await findTarget(db, officerId, cedula);
  const c = clean(cargos, 300);
  if (c.length < 3) throw new PanelError(400, 'Escribe los cargos.', { cargos: 'Escribe los cargos.' });
  const min = amount(minutos, 1, ARREST_MAX_MIN, 'tiempo');
  await db.run(
    'INSERT INTO arrests (discord_id, officer_id, officer_name, cargos, minutos, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [target.discord_id, officerId, officerName(me), c, min, now],
  );
  return { a: `${target.nombre} ${target.apellidos}`, cedula: target.cedula, minutos: min };
}

export async function officerActivity(db, officerId) {
  const fines = await db.query(
    `SELECT f.monto, f.motivo, f.created_at, c.nombre, c.apellidos, c.cedula FROM fines f JOIN characters c ON c.discord_id = f.discord_id
     WHERE f.officer_id = $1 ORDER BY f.created_at DESC LIMIT 8`, [officerId],
  );
  const arrests = await db.query(
    `SELECT a.minutos, a.cargos, a.created_at, c.nombre, c.apellidos, c.cedula FROM arrests a JOIN characters c ON c.discord_id = a.discord_id
     WHERE a.officer_id = $1 ORDER BY a.created_at DESC LIMIT 8`, [officerId],
  );
  return { fines, arrests };
}
