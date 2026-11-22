// Concesionario (carros) e inmobiliaria (casas) del panel. Se paga con el banco.
// El carro comprado queda registrado con placa (sale en /vehiculo y en el buscador de la Policía/ATT).
import crypto from 'node:crypto';
import { PanelError } from './panel.js';
import { isUniqueViolation } from './db.js';

export const COLORS = ['Blanco', 'Negro', 'Gris', 'Plata', 'Rojo', 'Azul', 'Verde', 'Amarillo', 'Naranja', 'Vino'];
const BARRIOS = ['Casco Viejo', 'San Francisco', 'Bella Vista', 'El Cangrejo', 'Costa del Este', 'Punta Pacífica', 'Albrook', 'Clayton', 'Obarrio', 'Chanis', 'Betania', 'Condado del Rey'];

const CAT_SQL = 'SELECT id, tipo, nombre, detalle, precio, imagen, stock FROM catalog WHERE activo = 1 ORDER BY tipo, precio, id';
// Lo que está a la venta (lo ponen los admins desde el panel → Administración → Stock)
export async function listCatalog(db) {
  return db.query(CAT_SQL, []);
}

export async function myAssets(db, discordId) {
  const [vehicles, properties] = await Promise.all([
    db.query('SELECT placa, marca, modelo, color, created_at FROM vehicles WHERE discord_id = $1 ORDER BY created_at DESC', [discordId]),
    db.query('SELECT id, nombre, direccion, precio, created_at FROM properties WHERE discord_id = $1 ORDER BY created_at DESC', [discordId]),
  ]);
  return { vehicles, properties };
}

// Placa estilo Panamá: dos letras y cuatro números (AB1234)
export function newPlate(randomInt = crypto.randomInt) {
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  return `${L[randomInt(L.length)]}${L[randomInt(L.length)]}${String(randomInt(10000)).padStart(4, '0')}`;
}

export async function buy(db, discordId, { id, color }, { now = Date.now(), randomInt = crypto.randomInt } = {}) {
  const item = await db.one('SELECT id, tipo, nombre, detalle, precio, stock FROM catalog WHERE id = $1 AND activo = 1', [Number(id)]);
  if (!item) throw new PanelError(404, 'Ese artículo ya no está a la venta.');
  if (item.stock !== null && item.stock !== undefined && Number(item.stock) <= 0) throw new PanelError(409, 'Se agotó. Vuelve cuando haya en stock.');
  const me = await db.one('SELECT nombre, apellidos, roblox_name FROM characters WHERE discord_id = $1', [discordId]);
  if (!me) throw new PanelError(409, 'Primero crea tu cédula.');
  if (item.tipo === 'vehiculo' && !COLORS.includes(color)) throw new PanelError(400, 'Elige el color.', { color: 'Elige el color.' });
  for (let i = 0; i < 20; i++) {
    try {
      return await db.tx(async (t) => {
        const r = await t.run('UPDATE accounts SET banco = banco - $1 WHERE discord_id = $2 AND banco >= $1', [item.precio, discordId]);
        if (!r.rowCount) throw new PanelError(400, `No tienes suficiente en el banco (cuesta $${Number(item.precio).toLocaleString('es-PA')}).`);
        // stock: solo baja si queda (dos compras a la vez → solo una se lleva el último)
        const st = await t.run('UPDATE catalog SET stock = stock - 1 WHERE id = $1 AND stock IS NOT NULL AND stock > 0', [item.id]);
        if (item.stock !== null && item.stock !== undefined && !st.rowCount) throw new PanelError(409, 'Se agotó justo ahora.');
        await t.run("INSERT INTO transactions (discord_id, kind, amount, note, created_at) VALUES ($1, 'compra', $2, $3, $4)", [discordId, -item.precio, `${item.tipo === 'vehiculo' ? 'Concesionario' : 'Inmobiliaria'}: ${item.nombre}`, now]);
        let bought;
        if (item.tipo === 'vehiculo') {
          const placa = newPlate(randomInt);
          await t.run('INSERT INTO vehicles (placa, discord_id, marca, modelo, color, propietario, roblox, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [placa, discordId, 'Concesionario', item.nombre, color, `${me.nombre} ${me.apellidos}`, me.roblox_name, now]);
          bought = { tipo: 'vehiculo', nombre: item.nombre, placa, color, precio: item.precio };
        } else {
          const direccion = `${BARRIOS[randomInt(BARRIOS.length)]}, calle ${1 + randomInt(80)}, casa ${1 + randomInt(300)}`;
          const p = await t.one('INSERT INTO properties (discord_id, catalog_id, nombre, direccion, precio, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [discordId, item.id, item.nombre, direccion, item.precio, now]);
          bought = { tipo: 'casa', nombre: item.nombre, direccion, id: p.id, precio: item.precio };
        }
        return { bought, account: await t.one('SELECT efectivo, banco FROM accounts WHERE discord_id = $1', [discordId]) };
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err; // placa repetida: se prueba otra
    }
  }
  throw new PanelError(500, 'No se pudo completar la compra. Intenta de nuevo.');
}

// ─── Administración del catálogo (admins) ───
const clean = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export async function saveItem(db, input, now = Date.now()) {
  const tipo = input.tipo === 'casa' ? 'casa' : input.tipo === 'vehiculo' ? 'vehiculo' : null;
  const nombre = clean(input.nombre, 60);
  const detalle = clean(input.detalle, 140);
  const precio = Math.trunc(Number(input.precio));
  const stock = input.stock === '' || input.stock === null || input.stock === undefined ? null : Math.trunc(Number(input.stock));
  const errors = {};
  if (!tipo) errors.tipo = 'Elige carro o casa.';
  if (nombre.length < 2) errors.nombre = 'Escribe el nombre.';
  if (!Number.isSafeInteger(precio) || precio < 1 || precio > 100_000_000) errors.precio = 'Precio de $1 a $100,000,000.';
  if (stock !== null && (!Number.isSafeInteger(stock) || stock < 0 || stock > 100_000)) errors.stock = 'Stock de 0 a 100,000 (vacío = sin límite).';
  if (Object.keys(errors).length) throw new PanelError(400, 'Revisa los campos marcados.', errors);
  if (input.id) {
    const r = await db.run('UPDATE catalog SET tipo = $1, nombre = $2, detalle = $3, precio = $4, stock = $5 WHERE id = $6 AND activo = 1', [tipo, nombre, detalle, precio, stock, Number(input.id)]);
    if (!r.rowCount) throw new PanelError(404, 'Ese artículo ya no existe.');
    return Number(input.id);
  }
  const row = await db.one('INSERT INTO catalog (tipo, nombre, detalle, precio, stock, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [tipo, nombre, detalle, precio, stock, now]);
  return Number(row.id);
}
export async function removeItem(db, id) {
  const r = await db.run('UPDATE catalog SET activo = 0 WHERE id = $1 AND activo = 1', [Number(id)]);
  if (!r.rowCount) throw new PanelError(404, 'Ese artículo ya no existe.');
}

// Foto: data URL de una imagen JPG/PNG/WebP (el navegador la achica antes de subirla)
const MAGIC = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
export async function setImage(db, id, dataUrl, now = Date.now()) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new PanelError(400, 'La foto debe ser JPG, PNG o WebP.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 100 || buf.length > 900_000) throw new PanelError(400, 'La foto es muy grande (máximo 900 KB).');
  if (!MAGIC[m[1]].every((b, i) => buf[i] === b)) throw new PanelError(400, 'Ese archivo no es una imagen válida.');
  if (!(await db.one('SELECT id FROM catalog WHERE id = $1 AND activo = 1', [Number(id)]))) throw new PanelError(404, 'Ese artículo ya no existe.');
  await db.run('INSERT INTO catalog_images (catalog_id, mime, data, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (catalog_id) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at', [Number(id), m[1], m[2], now]);
  await db.run('UPDATE catalog SET imagen = $1 WHERE id = $2', [`/img/catalogo/${Number(id)}?v=${now}`, Number(id)]);
}
export async function getImage(db, id) {
  const row = await db.one('SELECT mime, data FROM catalog_images WHERE catalog_id = $1', [Number(id)]);
  return row ? { mime: row.mime, body: Buffer.from(row.data, 'base64') } : null;
}
