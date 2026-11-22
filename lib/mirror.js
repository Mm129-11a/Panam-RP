// Espejo de los comandos de antes: cuando alguien usa /arrestar, /multa, /antecedentes, /dni, /licencia o
// /vehiculo con el bot de antes, la web SOLO LEE lo que se puso y lo guarda para que salga en el panel.
// También /salario-configurar: la web muestra cuánto gana cada trabajo (el cobro lo sigue haciendo el bot).
// No contesta nada ni cambia esos comandos: los sigue contestando el bot de antes, como siempre.
// El dinero (/balance, /depositar…) no se copia: el bot de antes tiene su propio saldo.
import * as P from './panel.js';
import { parseDate } from './commands.js';
import { who, nationality } from './oldbot.js';
import { setVehicleImage, sniffImage } from './market.js';

// Canal de arrestos y roles que se dan (Panamá RP)
export const ARREST_CHANNEL = '1565454456278229032';
export const ARREST_ROLE = '1561567066484510821';
export const RECORD_ROLE = '1561567122721603656'; // antecedentes

const giveRole = (ctx, userId, roleId, reason) => ctx.api('PUT', `/guilds/${ctx.guildId}/members/${userId}/roles/${roleId}`, undefined, { reason }).catch(() => null);

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const plate = (p) => String(p || '').toUpperCase().replace(/\s+/g, '').slice(0, 12);

function read(data) {
  let sub = null;
  let list = data?.options || [];
  if (list[0]?.type === 1) { sub = list[0].name; list = list[0].options || []; }
  const o = Object.fromEntries(list.map((x) => [x.name, x.value]));
  const file = (id) => (id ? data?.resolved?.attachments?.[id]?.url || null : null);
  const att = (id) => (id ? data?.resolved?.attachments?.[id] || null : null);
  const user = (id) => (id ? data?.resolved?.users?.[id] || { id } : null);
  return { sub, o, file, att, user };
}

async function officerName(db, me) {
  const c = await P.getCharacter(db, me.id);
  return c ? `${c.nombre} ${c.apellidos}` : me.name || 'Oficial';
}

// Devuelve un texto corto de lo que guardó (o null si no aplica)
export async function mirrorOldCommand(interaction, ctx) {
  const name = interaction.data?.name;
  if (!['arrestar', 'multa', 'antecedentes', 'dni', 'licencia', 'vehiculo', 'salario-configurar'].includes(name)) return null;
  const { db, me } = ctx;
  // la misma interacción no se guarda dos veces
  if (await db.one("SELECT 1 AS x FROM bot_logs WHERE tipo = 'espejo' AND detalle = $1", [String(interaction.id)])) return null;
  await db.run("INSERT INTO bot_logs (tipo, actor_id, detalle, created_at) VALUES ('espejo', $1, $2, $3)", [me.id, String(interaction.id), ctx.now()]);

  const { sub, o, file, att, user } = read(interaction.data);
  const target = o.usuario ? user(o.usuario) : null;
  const rank = await who(ctx);
  const now = ctx.now();

  if (name === 'arrestar' && rank.police && target && target.id !== me.id) {
    if (sub === 'usuario') {
      const min = Math.min(P.ARREST_MAX_MIN, Math.max(1, Math.trunc(Number(o.minutos) || 10)));
      await db.run("INSERT INTO arrests (discord_id, officer_id, officer_name, cargos, minutos, tipo, evidencia, roblox, created_at) VALUES ($1, $2, $3, $4, $5, 'arresto', $6, $7, $8)",
        [target.id, me.id, await officerName(db, me), clip(o.razon || 'Sin especificar', 300), min, file(o.evidencia), o.roblox_user ? clip(o.roblox_user, 50) : null, now]);
      return `arresto de ${target.id} (${min} min)`;
    }
    if (sub === 'liberar') {
      await db.run("UPDATE arrests SET released_at = $1 WHERE discord_id = $2 AND tipo = 'arresto' AND released_at IS NULL", [now, target.id]);
      return `liberado ${target.id}`;
    }
  }

  if (name === 'multa' && sub === 'agregar' && rank.att && target && target.id !== me.id) {
    const n = Math.trunc(Number(o.monto));
    if (!Number.isSafeInteger(n) || n < 1 || n > 10_000_000) return null;
    await db.run('INSERT INTO fines (discord_id, officer_id, officer_name, motivo, monto, articulos, matricula, evidencia, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [target.id, me.id, await officerName(db, me), clip(o.articulos || 'Multa administrativa', 200), n, o.articulos ? clip(o.articulos, 300) : null, o.matricula ? plate(o.matricula) : null, file(o.evidencia), now]);
    return `multa de $${n} a ${target.id}`;
  }

  if (name === 'antecedentes' && sub === 'agregar' && rank.police && target) {
    await db.run("INSERT INTO arrests (discord_id, officer_id, officer_name, cargos, minutos, tipo, descripcion, sentencia, evidencia, roblox, created_at) VALUES ($1, $2, $3, $4, 0, 'antecedente', $5, $6, $7, $8, $9)",
      [target.id, me.id, clip(o.oficial || await officerName(db, me), 80), clip(o.delito || 'Sin especificar', 300), o.descripcion ? clip(o.descripcion, 1000) : null, o.sentencia ? clip(o.sentencia, 200) : null, file(o.evidencia), o.roblox_user ? clip(o.roblox_user, 50) : null, now]);
    await giveRole(ctx, target.id, RECORD_ROLE, 'Antecedentes (/antecedentes)');
    return `antecedente de ${target.id}`;
  }

  if (name === 'dni') {
    if (sub === 'crear' && !(await P.getCharacter(db, me.id))) {
      let roblox = ctx.robloxFor ? await ctx.robloxFor(me.id) : null;
      if (!roblox && o.roblox_user) {
        const found = await ctx.lookupRoblox(String(o.roblox_user)).catch(() => null);
        if (found) roblox = { id: found.id, name: found.name };
      }
      if (!roblox) return null;
      try {
        const c = await P.createCharacter(db, { user: me, roblox, input: {
          nombre: o.nombre, apellidos: o.apellidos, nacimiento: parseDate(o.fecha_nacimiento), genero: o.sexo, sangre: o.tipo_sangre, nacionalidad: nationality(o.nacionalidad),
        } });
        const est = Math.trunc(Number(o.estatura_cm));
        if (est >= 100 && est <= 230) await db.run('UPDATE characters SET estatura = $1 WHERE discord_id = $2', [est, me.id]);
        return `cédula ${c.cedula} para ${me.id}`;
      } catch (err) {
        if (err instanceof P.PanelError) return null; // datos que la web no acepta: no se copia
        throw err;
      }
    }
    if (sub === 'admin_borrar' && rank.admin && target) {
      await db.run('DELETE FROM characters WHERE discord_id = $1', [target.id]);
      await db.run('DELETE FROM licenses WHERE discord_id = $1', [target.id]);
      return `cédula borrada de ${target.id}`;
    }
    return null;
  }

  if (name === 'licencia' && (o.tipo === 'conducir' || o.tipo === 'armas')) {
    if (sub === 'registrar' && (await P.getCharacter(db, me.id))) {
      await db.run('INSERT INTO licenses (discord_id, tipo, created_at) VALUES ($1, $2, $3) ON CONFLICT (discord_id, tipo) DO NOTHING', [me.id, o.tipo, now]);
      return `licencia ${o.tipo} de ${me.id}`;
    }
    if (sub === 'revocar') {
      await db.run('DELETE FROM licenses WHERE discord_id = $1 AND tipo = $2', [me.id, o.tipo]);
      return `licencia ${o.tipo} revocada de ${me.id}`;
    }
  }

  if (name === 'vehiculo') {
    if (sub === 'registrar') {
      const placa = plate(o.placa);
      if (!/^[A-Z0-9-]{3,12}$/.test(placa) || await db.one('SELECT 1 AS x FROM vehicles WHERE placa = $1', [placa])) return null;
      const c = await P.getCharacter(db, me.id);
      await db.run('INSERT INTO vehicles (placa, discord_id, marca, modelo, color, imagen, propietario, roblox, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [placa, me.id, clip(o.marca, 40), clip(o.modelo, 40), clip(o.color, 30), null, clip(o.propietario || (c ? `${c.nombre} ${c.apellidos}` : me.name), 80), clip(o.roblox || c?.roblox_name || '', 40) || null, now]);
      const foto = await savePhoto(ctx, placa, att(o.imagen)).catch(() => false);
      return `vehículo ${placa} de ${me.id}${foto ? ' (con foto)' : ''}`;
    }
    if (sub === 'eliminar' && rank.admin) {
      await db.run('DELETE FROM vehicles WHERE placa = $1', [plate(o.placa)]);
      await db.run('DELETE FROM vehicle_images WHERE placa = $1', [plate(o.placa)]);
      return `vehículo ${plate(o.placa)} eliminado`;
    }
  }
  // /salario-configurar rol monto cooldown_horas (solo admins): se guarda para mostrar cuánto gana cada trabajo
  if (name === 'salario-configurar' && (rank.admin || ctx.webAdmin) && o.rol) {
    const n = Math.trunc(Number(o.monto));
    const h = o.cooldown_horas == null ? 24 : Math.trunc(Number(o.cooldown_horas));
    if (!Number.isSafeInteger(n) || Math.abs(n) > 100_000_000 || !Number.isSafeInteger(h) || h < 1 || h > 24 * 365) return null;
    if (n === 0) {
      await db.run('DELETE FROM salaries WHERE role_id = $1', [String(o.rol)]);
      return `sin salario el rol ${o.rol}`;
    }
    await db.run('INSERT INTO salaries (role_id, monto, cooldown_h, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (role_id) DO UPDATE SET monto = EXCLUDED.monto, cooldown_h = EXCLUDED.cooldown_h, updated_at = EXCLUDED.updated_at', [String(o.rol), n, h, now]);
    return `salario del rol ${o.rol}: ${n} cada ${h} h`;
  }
  return null;
}

// Baja la foto del carro (más pequeña, por el proxy de Discord) y la guarda: el enlace de Discord caduca.
async function savePhoto(ctx, placa, a) {
  if (!a?.url) return false;
  const get = ctx.fetch || globalThis.fetch;
  const tries = [];
  if (a.proxy_url && a.width && a.height) {
    const w = Math.min(800, Number(a.width));
    const h = Math.max(1, Math.round((Number(a.height) * w) / Number(a.width)));
    tries.push(`${a.proxy_url}${a.proxy_url.includes('?') ? '&' : '?'}width=${w}&height=${h}`);
  }
  if (!a.size || a.size <= 900_000) tries.push(a.url);
  for (const url of tries) {
    try {
      const r = await get(url, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = sniffImage(buf);
      if (mime && (await setVehicleImage(ctx.db, placa, mime, buf, ctx.now()))) return true;
    } catch { /* se prueba el siguiente */ }
  }
  return false;
}
