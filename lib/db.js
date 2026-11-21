// Base de datos de Panamá RP.
// Producción: Postgres (Neon) con el paquete "pg". Pruebas: SQLite integrado en Node.
// Las consultas usan $1, $2…; montos y fechas son enteros (dólares y milisegundos).

const TABLES = (ID) => [
  `CREATE TABLE IF NOT EXISTS users (
     discord_id TEXT PRIMARY KEY,
     discord_name TEXT NOT NULL,
     avatar TEXT,
     roblox_id TEXT,
     roblox_name TEXT,
     created_at BIGINT NOT NULL,
     last_login BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS applications (
     id ${ID},
     discord_id TEXT NOT NULL,
     roblox_id TEXT NOT NULL,
     roblox_name TEXT NOT NULL,
     data TEXT NOT NULL,
     score TEXT NOT NULL,
     estado TEXT NOT NULL DEFAULT 'pendiente',
     created_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS characters (
     discord_id TEXT PRIMARY KEY,
     cedula TEXT NOT NULL UNIQUE,
     nombre TEXT NOT NULL,
     apellidos TEXT NOT NULL,
     nacimiento TEXT NOT NULL,
     genero TEXT NOT NULL,
     sangre TEXT NOT NULL,
     nacionalidad TEXT NOT NULL,
     roblox_id TEXT NOT NULL,
     roblox_name TEXT NOT NULL,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS accounts (
     discord_id TEXT PRIMARY KEY,
     efectivo BIGINT NOT NULL DEFAULT 0 CHECK (efectivo >= 0),
     banco BIGINT NOT NULL DEFAULT 0 CHECK (banco >= 0))`,
  `CREATE TABLE IF NOT EXISTS transactions (
     id ${ID},
     discord_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     amount BIGINT NOT NULL,
     other_id TEXT,
     note TEXT,
     created_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS shifts (
     id ${ID},
     discord_id TEXT NOT NULL,
     job TEXT NOT NULL,
     started_at BIGINT NOT NULL,
     ended_at BIGINT,
     minutes INTEGER,
     paid BIGINT)`,
  // Un solo turno abierto por persona (lo garantiza la base de datos)
  'CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open ON shifts (discord_id) WHERE ended_at IS NULL',
  `CREATE TABLE IF NOT EXISTS fines (
     id ${ID},
     discord_id TEXT NOT NULL,
     officer_id TEXT NOT NULL,
     officer_name TEXT NOT NULL,
     motivo TEXT NOT NULL,
     monto BIGINT NOT NULL CHECK (monto > 0),
     estado TEXT NOT NULL DEFAULT 'pendiente',
     created_at BIGINT NOT NULL,
     paid_at BIGINT)`,
  `CREATE TABLE IF NOT EXISTS arrests (
     id ${ID},
     discord_id TEXT NOT NULL,
     officer_id TEXT NOT NULL,
     officer_name TEXT NOT NULL,
     cargos TEXT NOT NULL,
     minutos INTEGER NOT NULL,
     created_at BIGINT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS shifts_user ON shifts (discord_id, started_at)',
  'CREATE INDEX IF NOT EXISTS fines_user ON fines (discord_id, estado)',
  'CREATE INDEX IF NOT EXISTS arrests_user ON arrests (discord_id)',
  'CREATE INDEX IF NOT EXISTS tx_user ON transactions (discord_id, created_at)',
  'CREATE INDEX IF NOT EXISTS apps_user ON applications (discord_id)',
];

export async function migrate(db) {
  const ID = db.dialect === 'pg' ? 'BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  for (const sql of TABLES(ID)) await db.run(sql);
}

// ¿El error es por un valor repetido (clave única)?
export function isUniqueViolation(err) {
  return Boolean(err && (err.code === '23505' || /UNIQUE constraint failed/i.test(err.message || '')));
}

// ─── Postgres (Neon) ───
export async function connectPostgres(url) {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // BIGINT → número
  // El TLS se configura aquí (verificando el certificado), no con los parámetros de la URL.
  const u = new URL(url);
  const noTls = u.searchParams.get('sslmode') === 'disable';
  for (const k of ['sslmode', 'channel_binding', 'sslrootcert', 'sslcert', 'sslkey']) u.searchParams.delete(k);
  const pool = new pg.Pool({
    connectionString: u.toString(),
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000, // Neon gratis se duerme: despertarlo tarda un poco
    ssl: noTls ? false : { rejectUnauthorized: true },
  });
  pool.on('error', (e) => console.error('[db]', e.message));
  const wrap = (c) => ({
    async query(sql, params = []) { return (await c.query(sql, params)).rows; },
    async one(sql, params = []) { return (await c.query(sql, params)).rows[0] || null; },
    async run(sql, params = []) { const r = await c.query(sql, params); return { rowCount: r.rowCount, rows: r.rows }; },
  });
  return {
    dialect: 'pg',
    ...wrap(pool),
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const out = await fn(wrap(c));
        await c.query('COMMIT');
        return out;
      } catch (err) {
        try { await c.query('ROLLBACK'); } catch { /* conexión caída */ }
        throw err;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

// ─── SQLite (solo pruebas) ───
export async function connectSqlite(file = ':memory:') {
  const { DatabaseSync } = await import('node:sqlite');
  const d = new DatabaseSync(file);
  const prep = (sql) => d.prepare(sql.replace(/\$(\d+)/g, '?$1'));
  const norm = (params) => params.map((p) => (p === undefined ? null : p));
  const returnsRows = (sql) => /^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql);
  const plain = (rows) => rows.map((r) => ({ ...r }));
  const api = {
    async query(sql, params = []) { return plain(prep(sql).all(...norm(params))); },
    async one(sql, params = []) { return (await api.query(sql, params))[0] || null; },
    async run(sql, params = []) {
      if (returnsRows(sql)) { const rows = await api.query(sql, params); return { rowCount: rows.length, rows }; }
      const r = prep(sql).run(...norm(params));
      return { rowCount: Number(r.changes), rows: [] };
    },
  };
  let chain = Promise.resolve(); // una transacción a la vez
  return {
    dialect: 'sqlite',
    ...api,
    tx(fn) {
      const next = chain.then(async () => {
        d.exec('BEGIN IMMEDIATE');
        try { const out = await fn(api); d.exec('COMMIT'); return out; } catch (err) { d.exec('ROLLBACK'); throw err; }
      });
      chain = next.catch(() => {});
      return next;
    },
    async close() { d.close(); },
  };
}
