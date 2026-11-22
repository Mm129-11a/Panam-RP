// Concesionario (carros) e inmobiliaria (casas) del panel. Se paga con el banco.
// El carro comprado queda registrado con placa (sale en /vehiculo y en el buscador de la Policía/ATT).
import crypto from 'node:crypto';
import { PanelError } from './panel.js';
import { isUniqueViolation } from './db.js';

export const COLORS = ['Blanco', 'Negro', 'Gris', 'Plata', 'Rojo', 'Azul', 'Verde', 'Amarillo', 'Naranja', 'Vino'];
const BARRIOS = ['Casco Viejo', 'San Francisco', 'Bella Vista', 'El Cangrejo', 'Costa del Este', 'Punta Pacífica', 'Albrook', 'Clayton', 'Obarrio', 'Chanis', 'Betania', 'Condado del Rey'];

// Lista inicial (se puede cambiar después)
const DEFAULT_CATALOG = [
  ['vehiculo', 'Hatchback urbano', 'Económico y fácil de estacionar', 15000],
  ['vehiculo', 'Sedán compacto', 'El clásico para la ciudad', 18000],
  ['vehiculo', 'Moto deportiva', 'Rápida y ágil en el tráfico', 12000],
  ['vehiculo', 'Minivan', 'Para la familia o el negocio', 30000],
  ['vehiculo', 'SUV familiar', 'Espaciosa y cómoda', 38000],
  ['vehiculo', 'Pickup 4x4', 'Para el trabajo y el campo', 45000],
  ['vehiculo', 'Deportivo', 'Alto rendimiento', 95000],
  ['vehiculo', 'Todoterreno de lujo', 'Lo mejor en confort y potencia', 120000],
  ['casa', 'Apartamento en el centro', '1 recámara · cerca de todo', 60000],
  ['casa', 'Casa en las afueras', '3 recámaras · patio', 95000],
  ['casa', 'Local comercial', 'Para abrir tu negocio', 140000],
  ['casa', 'Casa en la playa', '3 recámaras · frente al mar', 180000],
  ['casa', 'Penthouse con vista al Canal', '4 recámaras · terraza', 320000],
  ['casa', 'Mansión', '6 recámaras · piscina y seguridad', 650000],
];

export async function listCatalog(db, now = Date.now()) {
  let rows = await db.query('SELECT id, tipo, nombre, detalle, precio, imagen FROM catalog WHERE activo = 1 ORDER BY tipo, precio, id', []);
  if (!rows.length && !(await db.one('SELECT id FROM catalog LIMIT 1', []))) {
    for (const [tipo, nombre, detalle, precio] of DEFAULT_CATALOG) {
      await db.run('INSERT INTO catalog (tipo, nombre, detalle, precio, created_at) VALUES ($1, $2, $3, $4, $5)', [tipo, nombre, detalle, precio, now]);
    }
    rows = await db.query('SELECT id, tipo, nombre, detalle, precio, imagen FROM catalog WHERE activo = 1 ORDER BY tipo, precio, id', []);
  }
  return rows;
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
  const item = await db.one('SELECT id, tipo, nombre, detalle, precio FROM catalog WHERE id = $1 AND activo = 1', [Number(id)]);
  if (!item) throw new PanelError(404, 'Ese artículo ya no está a la venta.');
  const me = await db.one('SELECT nombre, apellidos, roblox_name FROM characters WHERE discord_id = $1', [discordId]);
  if (!me) throw new PanelError(409, 'Primero crea tu cédula.');
  if (item.tipo === 'vehiculo' && !COLORS.includes(color)) throw new PanelError(400, 'Elige el color.', { color: 'Elige el color.' });
  for (let i = 0; i < 20; i++) {
    try {
      return await db.tx(async (t) => {
        const r = await t.run('UPDATE accounts SET banco = banco - $1 WHERE discord_id = $2 AND banco >= $1', [item.precio, discordId]);
        if (!r.rowCount) throw new PanelError(400, `No tienes suficiente en el banco (cuesta $${Number(item.precio).toLocaleString('es-PA')}).`);
        await t.run("INSERT INTO transactions (discord_id, kind, amount, note, created_at) VALUES ($1, 'compra', $2, $3, $4)", [discordId, -item.precio, `${item.tipo === 'vehiculo' ? 'Concesionario' : 'Inmobiliaria'}: ${item.nombre}`, now]);
        let bought;
        if (item.tipo === 'vehiculo') {
          const placa = newPlate(randomInt);
          await t.run('INSERT INTO vehicles (placa, discord_id, marca, modelo, color, propietario, roblox, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [placa, discordId, 'Concesionario', item.nombre, color, `${me.nombre} ${me.apellidos}`, me.roblox_name, now]);
          bought = { tipo: 'vehiculo', nombre: item.nombre, placa, color };
        } else {
          const direccion = `${BARRIOS[randomInt(BARRIOS.length)]}, calle ${1 + randomInt(80)}, casa ${1 + randomInt(300)}`;
          const p = await t.one('INSERT INTO properties (discord_id, catalog_id, nombre, direccion, precio, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [discordId, item.id, item.nombre, direccion, item.precio, now]);
          bought = { tipo: 'casa', nombre: item.nombre, direccion, id: p.id };
        }
        return { bought, account: await t.one('SELECT efectivo, banco FROM accounts WHERE discord_id = $1', [discordId]) };
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err; // placa repetida: se prueba otra
    }
  }
  throw new PanelError(500, 'No se pudo completar la compra. Intenta de nuevo.');
}
