// Los comandos que ya tenía el bot (los 41 de antes), con el MISMO nombre y las mismas opciones.
// Ahora los contesta la web y usan la misma base de datos: el dinero de /balance es el del panel,
// el DNI es la cédula de la web, y las multas y arrestos salen en el expediente.
import crypto from 'node:crypto';
import * as P from './panel.js';
import { hasPolice } from './jobs.js';
import { parseDate } from './commands.js';
import { makeCode, hasCode, fetchRobloxProfile, LINK_TTL } from './robloxlink.js';

export const OLD_NAMES = ['sugerir', 'ayuda', 'antecedentes', 'entorno', 'bloquear-ticket', 'desbloquear-ticket', 'reclamar',
  'cerrar-ticket', 'logs', 'alerta', 'anon', 'anon-mensaje', 'verificar', 'balance', 'depositar', 'retirar', 'transferir',
  'cobrar-salario', 'top', 'dni', 'licencia', 'multa', 'vehiculo', 'server', 'erlc', 'staff', 'mod', 'casino', 'shop',
  'ticket', 'admin', 'inventario', 'banda', 'robar', 'blacklist', 'decir', 'social', 'arrestar', 'salario-configurar',
  'ver-salarios', 'config'];

// Botones y ventanas de estos comandos (custom_id empieza así)
export const COMPONENT_RE = /^(v|t|anon|shop|g|rob|srv|bl|soc|mod|robm):/;

const COLOR = { blue: 0x3a6af0, green: 0x22c55e, red: 0xef4444, gold: 0xf5b942, gray: 0x6b7280, purple: 0x8b5cf6 };
const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;
const VIEW = 1n << 10n; const SEND = 1n << 11n; const HISTORY = 1n << 16n; const ATTACH = 1n << 15n; const EMBED = 1n << 14n;

// ─── Configuración (/config) ───
export const CONFIG = {
  rol: {
    verificado: 'Se da al verificar la cuenta de Roblox (/verificar)',
    preso: 'Se da mientras alguien está arrestado (/arrestar)',
    fundacion: 'Fundación (puede usar /blacklist)',
  },
  roles: {
    admin: 'Administración (comandos de admin)',
    staff: 'Staff (moderación, tickets, aprobaciones)',
    policia: 'Policía: arrestos, antecedentes y juicios',
    transito: 'ATT: la única que pone multas',
    jueces: 'Jueces (aceptan o rechazan juicios y denuncias)',
    abogados: 'Abogados y fiscales (toman los casos)',
    tickets: 'Quién ve los tickets (si está vacío, el staff)',
  },
  canal: {
    logs: 'Registro de acciones del bot',
    sugerencias: 'Sugerencias (/sugerir)',
    entorno: 'Reportes de entorno (/entorno)',
    anon: 'Mensajes anónimos (/anon)',
    social: 'Redes sociales (/social)',
    blacklist: 'Blacklists (/blacklist)',
    robos: 'Robos para aprobar (/robar)',
    bandas: 'Propuestas de bandas (/banda crear)',
    servidor: 'Apertura y cierre del servidor (/server)',
    moderacion: 'Moderaciones (/mod)',
    alertas: 'Cambios de alerta (/alerta)',
    vehiculos: 'Registros de vehículos (/vehiculo)',
    multas: 'Multas (/multa)',
    arrestos: 'Arrestos y antecedentes',
    jueces: 'Buzón de los jueces (denuncias y juicios)',
    abogados: 'Casos para abogados y fiscales',
    tickets: 'Botón para abrir tickets (se publica al configurarlo)',
    verificacion: 'Botón de verificación de Roblox (se publica al configurarlo)',
  },
  imagen: {
    logo: 'Logo en los mensajes del bot',
    tienda: 'Imagen de la tienda',
    servidor_abierto: 'Imagen al abrir el servidor',
    servidor_cerrado: 'Imagen al cerrar el servidor',
    tickets: 'Imagen del panel de tickets',
  },
  texto: {
    nombre: 'Nombre del servidor',
    codigo_erlc: 'Código para entrar al servidor de ER:LC',
    armas_1: 'Armas permitidas en alerta máxima (1)',
    armas_2: 'Armas permitidas en alerta media (2)',
    armas_3: 'Armas permitidas en alerta normal (3)',
    ticket_bienvenida: 'Mensaje al abrir un ticket',
  },
};
const DEFAULT_TEXT = {
  nombre: 'Panamá RP',
  armas_1: 'Todo el armamento autorizado para las fuerzas del orden, incluidos rifles y equipo táctico.',
  armas_2: 'Armas cortas para todas las unidades; rifles solo para unidades especiales.',
  armas_3: 'Armas cortas y no letales. Rifles solo con autorización del mando.',
  ticket_bienvenida: 'Gracias por abrir un ticket. Cuéntanos tu caso y el staff te atenderá pronto.',
};

// Roles de Panamá RP (se pueden cambiar con /config roles)
export const DEFAULT_ROLES = {
  policia: ['1560736880872525836', '1560736880872525835', '1565913556535353444'], // Policía Nacional, Aeronaval, Senafront
  transito: ['1560736880478130184'], // ATT
  jueces: ['1571295277472678009'],
  abogados: ['1565913945980801064'], // Abogados y fiscales
};

export async function getCfg(db, tipo, clave) {
  const row = await db.one('SELECT valor FROM bot_config WHERE clave = $1', [`${tipo}.${clave}`]);
  if (!row) return tipo === 'texto' ? DEFAULT_TEXT[clave] || '' : tipo === 'roles' ? [...(DEFAULT_ROLES[clave] || [])] : '';
  if (tipo === 'roles') { try { return JSON.parse(row.valor); } catch { return []; } }
  return row.valor;
}
async function setCfg(db, tipo, clave, valor) {
  const v = tipo === 'roles' ? JSON.stringify(valor) : String(valor);
  await db.run('INSERT INTO bot_config (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor', [`${tipo}.${clave}`, v]);
}

// ─── Utilidades ───
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const money = (n) => `$${Number(n || 0).toLocaleString('es-PA')}`;
const priv = (content, extra = {}) => ({ private: { content, ...extra } });
const fail = (msg) => priv(`❌ ${msg}`);
const ok = (msg) => priv(`✅ ${msg}`);
const fecha = (ms) => `<t:${Math.floor(ms / 1000)}:f>`;
const hace = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const isUrl = (u) => /^https:\/\/\S+$/i.test(String(u || ''));
const isImage = (u) => isUrl(u) && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u);
const plate = (p) => String(p || '').toUpperCase().replace(/\s+/g, '').slice(0, 12);
const digits = (s) => { const m = /(\d{1,9})/.exec(String(s || '')); return m ? Number(m[1]) : NaN; };

// Lee el comando: subcomando, opciones y adjuntos
function read(data) {
  let sub = null;
  let list = data?.options || [];
  if (list[0]?.type === 1) { sub = list[0].name; list = list[0].options || []; }
  const o = Object.fromEntries(list.map((x) => [x.name, x.value]));
  const res = data?.resolved || {};
  const file = (id) => (id ? res.attachments?.[id]?.url || null : null);
  const user = (id) => (id ? res.users?.[id] || { id } : null);
  return { sub, o, file, user };
}

// Quién es quién (admin, staff, policía) según permisos y roles configurados
export async function who(ctx) {
  const roles = ctx.roles || [];
  let perms = 0n;
  try { perms = BigInt(ctx.permissions || '0'); } catch { perms = 0n; }
  const lists = await Promise.all(['admin', 'staff', 'policia', 'transito', 'jueces', 'abogados'].map((k) => getCfg(ctx.db, 'roles', k)));
  const [adminList, staffList, policeList, attList, judgeList, lawyerList] = lists;
  const has = (list) => list.some((r) => roles.includes(r));
  const admin = Boolean(perms & ADMINISTRATOR) || Boolean(perms & MANAGE_GUILD) || has(adminList);
  const staff = admin || has(staffList) || has(ctx.staffRoles || []);
  const police = has(policeList) || hasPolice(ctx.jobs || []); // arrestos, antecedentes, juicios
  const att = has(attList) || (ctx.jobs || []).includes('transito'); // multas (solo la ATT)
  const judge = has(judgeList);
  const lawyer = has(lawyerList);
  // ver expedientes de otros: cuerpos de seguridad, justicia y staff
  const records = police || att || judge || lawyer || staff;
  return { admin, staff, police: police || admin, att, judge: judge || admin, lawyer, records, owner: Boolean(perms & ADMINISTRATOR) };
}

export async function log(ctx, tipo, targetId, detalle) {
  try {
    await ctx.db.run('INSERT INTO bot_logs (tipo, actor_id, target_id, detalle, created_at) VALUES ($1, $2, $3, $4, $5)', [tipo, ctx.me.id, targetId || null, clip(detalle, 500), ctx.now()]);
    const ch = await getCfg(ctx.db, 'canal', 'logs');
    if (ch) await ctx.api('POST', `/channels/${ch}/messages`, { embeds: [{ color: COLOR.gray, description: clip(`**${tipo}** · <@${ctx.me.id}>${targetId ? ` → <@${targetId}>` : ''}\n${detalle}`, 4000), timestamp: new Date(ctx.now()).toISOString() }], allowed_mentions: { parse: [] } });
  } catch { /* el registro nunca debe tumbar un comando */ }
}

// Publica en el canal configurado; si no hay, en el canal donde se usó el comando
async function post(ctx, canalClave, body) {
  const ch = (canalClave && await getCfg(ctx.db, 'canal', canalClave)) || ctx.channelId;
  const r = await ctx.api('POST', `/channels/${ch}/messages`, { allowed_mentions: { parse: [] }, ...body });
  return r.ok ? { channelId: ch, id: r.data?.id } : null;
}

const nameOf = (c, fallback) => (c ? `${c.nombre} ${c.apellidos}` : fallback);
async function charOf(db, id) { return P.getCharacter(db, id); }

// Nacionalidad escrita libre → opción de la cédula
const NAC = [[/panam/i, 'Panameña'], [/colomb/i, 'Colombiana'], [/venez/i, 'Venezolana'], [/costa ?ric/i, 'Costarricense'], [/nicar/i, 'Nicaragüense'], [/mex/i, 'Mexicana'], [/estado|usa|eeuu|ee\. ?uu|americ/i, 'Estadounidense'], [/espa/i, 'Española']];
export const nationality = (t) => NAC.find(([re]) => re.test(String(t || '')))?.[1] || 'Otra';

// Adjuntos que esperan a que se llene una ventana (robo, blacklist, social)
const stash = new Map();
function keep(value) {
  const id = crypto.randomBytes(5).toString('hex');
  stash.set(id, { ...value, t: Date.now() });
  for (const [k, v] of stash) if (Date.now() - v.t > LINK_TTL) stash.delete(k);
  return id;
}
const pending = new Map(); // verificación: discordId → { id, name, code, t }

// ─── Ventanas (modales) ───
const input = (custom_id, label, { style = 1, required = true, max = 200, placeholder, value } = {}) => ({
  type: 1, components: [{ type: 4, custom_id, label, style, required, max_length: max, ...(placeholder ? { placeholder } : {}), ...(value ? { value } : {}) }],
});
const modal = (custom_id, title, rows) => ({ custom_id, title: clip(title, 45), components: rows });

// Si el comando abre una ventana, se devuelve aquí (Discord pide responder con la ventana enseguida)
export function commandModal(interaction, ctx) {
  const name = interaction.data?.name;
  const { sub, o, file } = read(interaction.data);
  if (name === 'verificar') return modal('v:user', 'Verificar cuenta de Roblox', [input('usuario', 'Tu usuario de Roblox', { max: 20, placeholder: 'Tu usuario, no el nombre visible' })]);
  if (name === 'anon') {
    return modal('anon:m', 'Mensaje anónimo', [
      input('mensaje', 'Mensaje', { style: 2, max: 1800 }),
      input('archivos', 'Enlaces de archivos (uno por línea, máx. 5)', { style: 2, required: false, max: 1000 }),
    ]);
  }
  if (name === 'robar') {
    const id = keep({ evidencia: file(o.evidencia), user: ctx.me.id });
    return modal(`robm:${id}`, 'Formulario de robo', [
      input('lugar', 'Lugar del robo', { max: 100 }),
      input('participantes', 'Participantes', { max: 200, required: false }),
      input('descripcion', 'Qué pasó', { style: 2, max: 1000 }),
    ]);
  }
  if (name === 'blacklist') {
    const id = keep({ evidencia: file(o.evidencia), user: ctx.me.id });
    return modal(`bl:m:${id}`, 'Blacklist oficial', [
      input('sujeto', 'Usuario o ID de Discord', { max: 100 }),
      input('roblox', 'Usuario de Roblox', { max: 50, required: false }),
      input('razon', 'Razón', { style: 2, max: 1000 }),
      input('duracion', 'Duración (ej: Permanente, 30 días)', { max: 50, required: false }),
    ]);
  }
  if (name === 'social') {
    const id = keep({ imagen: file(o.imagen), user: ctx.me.id });
    return modal(`soc:m:${id}`, 'Publicar en redes', [
      input('titulo', 'Título', { max: 100 }),
      input('enlace', 'Enlace del vídeo o directo', { max: 300, placeholder: 'https://…' }),
      input('descripcion', 'Descripción', { style: 2, max: 500, required: false }),
    ]);
  }
  if (name === 'mod' && sub === 'editar') {
    const id = digits(o.id_moderacion);
    if (!Number.isSafeInteger(id)) return null;
    return modal(`mod:edit:${id}`, `Editar moderación #${id}`, [
      input('razon', 'Nueva razón', { style: 2, max: 500 }),
      input('tipo', 'Tipo (verbal, warn o sancion)', { max: 10, required: false }),
    ]);
  }
  return null;
}

// Botones que abren ventana
export function componentModal(interaction) {
  const id = String(interaction.data?.custom_id || '');
  if (interaction.type !== 3) return null;
  if (id === 't:open') return modal('t:new', 'Abrir ticket', [input('motivo', '¿En qué te ayudamos?', { style: 2, max: 500 })]);
  if (id === 'anon:open') {
    return modal('anon:m', 'Mensaje anónimo', [
      input('mensaje', 'Mensaje', { style: 2, max: 1800 }),
      input('archivos', 'Enlaces de archivos (uno por línea, máx. 5)', { style: 2, required: false, max: 1000 }),
    ]);
  }
  if (id === 'v:open') return modal('v:user', 'Verificar cuenta de Roblox', [input('usuario', 'Tu usuario de Roblox', { max: 20 })]);
  const rob = /^rob:ok:(\d+)$/.exec(id);
  if (rob) return modal(`rob:amt:${rob[1]}`, `Aprobar robo #${rob[1]}`, [input('monto', 'Botín en efectivo ($)', { max: 9, placeholder: 'Ej: 5000' })]);
  return null;
}

// Autocompletar la "clave" de /config
export function autocomplete(interaction) {
  const { sub } = read(interaction.data);
  const focused = (interaction.data?.options?.[0]?.options || []).find((x) => x.focused);
  const q = String(focused?.value || '').toLowerCase();
  const groups = sub === 'resetear' ? Object.keys(CONFIG) : [sub];
  const out = [];
  for (const g of groups) {
    for (const [k, d] of Object.entries(CONFIG[g] || {})) {
      const value = sub === 'resetear' ? `${g}.${k}` : k;
      if (!q || value.includes(q) || d.toLowerCase().includes(q)) out.push({ name: clip(`${value} — ${d}`, 100), value });
    }
  }
  return out.slice(0, 25);
}

// ─── Comandos ───
export async function runOld(interaction, ctx) {
  const name = interaction.data?.name;
  const { sub, o, file, user } = read(interaction.data);
  const me = ctx.me;
  const db = ctx.db;
  const rank = await who(ctx);
  const target = o.usuario ? user(o.usuario) : null;
  const panel = `${ctx.siteUrl}/panel`;

  try {
    switch (name) {
      case 'ayuda': return await ayuda(ctx);

      // ─── Economía (mismo dinero que la web) ───
      case 'balance': {
        const acc = await P.getAccount(db, me.id);
        if (!acc) return fail(`Aún no tienes cuenta. Crea tu DNI con **/dni crear** o en ${panel}`);
        return priv('', { embeds: [{ title: '🏦 Tu saldo', color: COLOR.green, fields: [
          { name: '💵 Efectivo', value: money(acc.efectivo), inline: true },
          { name: '🏦 Banco', value: money(acc.banco), inline: true },
          { name: '💰 Total', value: money(acc.efectivo + acc.banco), inline: true },
        ], footer: { text: 'Es el mismo saldo de la web (Mi panel → Banco)' } }] });
      }
      case 'depositar':
      case 'retirar': {
        const acc = await P.moveMoney(db, me.id, name, o.monto);
        return ok(`${name === 'depositar' ? 'Depositaste' : 'Retiraste'} ${money(o.monto)}. Efectivo: ${money(acc.efectivo)} · Banco: ${money(acc.banco)}`);
      }
      case 'transferir': {
        if (!target) return fail('Elige a quién.');
        const to = await charOf(db, target.id);
        if (!to) return fail(`<@${target.id}> aún no tiene DNI.`);
        const r = await P.transfer(db, me.id, to.cedula, o.monto, 'Transferencia por Discord');
        return { private: { content: `✅ Enviaste ${money(o.monto)} a ${r.to}. Te quedan ${money(r.account.banco)} en el banco.` }, public: { content: `💸 <@${me.id}> le transfirió **${money(o.monto)}** a <@${target.id}>.`, allowed_mentions: { users: [target.id] } } };
      }
      case 'top': {
        const rows = await db.query(
          `SELECT a.discord_id, a.efectivo + a.banco AS total, c.nombre, c.apellidos FROM accounts a
           LEFT JOIN characters c ON c.discord_id = a.discord_id ORDER BY total DESC LIMIT 10`, [],
        );
        if (!rows.length) return fail('Aún no hay nadie con cuenta.');
        const medal = ['🥇', '🥈', '🥉'];
        return { private: { content: '✅ Listo' }, public: { embeds: [{ title: '💰 Los más ricos de Panamá RP', color: COLOR.gold, description: rows.map((r, i) => `${medal[i] || `**${i + 1}.**`} <@${r.discord_id}>${r.nombre ? ` (${r.nombre} ${r.apellidos})` : ''} — **${money(r.total)}**`).join('\n') }] } };
      }
      case 'admin': {
        if (!rank.admin) return fail('Solo la administración.');
        if (!target) return fail('Elige a quién.');
        const n = Math.trunc(Number(o.monto));
        if (!Number.isSafeInteger(n) || n === 0 || Math.abs(n) > 100_000_000) return fail('Monto no válido.');
        const r = n > 0
          ? await db.run('UPDATE accounts SET banco = banco + $1 WHERE discord_id = $2', [n, target.id])
          : await db.run('UPDATE accounts SET banco = banco - $1 WHERE discord_id = $2 AND banco >= $1', [-n, target.id]);
        if (!r.rowCount) return fail(n > 0 ? `<@${target.id}> aún no tiene cuenta (necesita DNI).` : 'No tiene tanto en el banco.');
        await db.run("INSERT INTO transactions (discord_id, kind, amount, other_id, note, created_at) VALUES ($1, 'admin', $2, $3, 'Ajuste de la administración', $4)", [target.id, n, me.id, ctx.now()]);
        await log(ctx, 'admin dar_dinero', target.id, money(n));
        return ok(`${n > 0 ? 'Le diste' : 'Le quitaste'} ${money(Math.abs(n))} a <@${target.id}> (banco).`);
      }
      case 'cobrar-salario': return await cobrarSalario(ctx);
      case 'salario-configurar': {
        if (!rank.admin) return fail('Solo la administración.');
        const n = Math.trunc(Number(o.monto));
        const h = o.cooldown_horas == null ? 24 : Math.trunc(Number(o.cooldown_horas));
        if (!Number.isSafeInteger(n) || Math.abs(n) > 10_000_000) return fail('Monto no válido.');
        if (!Number.isSafeInteger(h) || h < 1 || h > 24 * 30) return fail('Las horas deben ir de 1 a 720.');
        if (n === 0) { await db.run('DELETE FROM salaries WHERE role_id = $1', [String(o.rol)]); return ok(`Quitaste el salario de <@&${o.rol}>.`); }
        await db.run('INSERT INTO salaries (role_id, monto, cooldown_h, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (role_id) DO UPDATE SET monto = EXCLUDED.monto, cooldown_h = EXCLUDED.cooldown_h, updated_at = EXCLUDED.updated_at', [String(o.rol), n, h, ctx.now()]);
        await log(ctx, 'salario', null, `<@&${o.rol}> ${money(n)} cada ${h} h`);
        return ok(`<@&${o.rol}>: ${n > 0 ? 'sueldo' : 'impuesto'} de ${money(Math.abs(n))} cada ${h} h.`);
      }
      case 'ver-salarios': {
        const rows = await db.query('SELECT role_id, monto, cooldown_h FROM salaries ORDER BY monto DESC', []);
        if (!rows.length) return fail('No hay salarios configurados. Usa /salario-configurar.');
        return priv('', { embeds: [{ title: '💼 Salarios e impuestos', color: COLOR.blue, description: rows.map((r) => `<@&${r.role_id}> — ${r.monto > 0 ? '🟢 sueldo' : '🔴 impuesto'} **${money(Math.abs(r.monto))}** cada ${r.cooldown_h} h`).join('\n') }] });
      }
      case 'casino': return await casino(ctx, sub, o);
      case 'shop': return await shop(ctx, sub, o, rank);
      case 'inventario': return await inventario(ctx, sub, o, target);
      case 'banda': return await banda(ctx, sub, o, file, target);

      // ─── Identidad y documentos (la cédula de la web) ───
      case 'dni': return await dni(ctx, sub, o, target, rank);
      case 'licencia': return await licencia(ctx, sub, o, target, rank);
      case 'vehiculo': return await vehiculo(ctx, sub, o, file, rank);

      // ─── Policía (sale en el expediente web) ───
      case 'multa': return await multa(ctx, sub, o, file, target, rank);
      case 'arrestar': return await arrestar(ctx, sub, o, file, target, rank);
      case 'antecedentes': return await antecedentes(ctx, sub, o, file, target, rank);
      case 'entorno': {
        const r = await post(ctx, 'entorno', { embeds: [{ title: `🚨 Entorno: ${clip(o.accion, 30).toUpperCase()}`, color: COLOR.red, fields: [
          { name: 'Código postal', value: String(o.codigo_postal), inline: true },
          { name: 'Reporta', value: `<@${me.id}>`, inline: true },
          { name: 'Descripción', value: clip(o.descripcion, 1024) },
          { name: 'Sujeto', value: clip(o.descripcion_sujeto, 1024) },
        ], timestamp: new Date(ctx.now()).toISOString() }] });
        return r ? ok('Entorno reportado.') : fail('No pude publicar el reporte (revisa /config canal entorno).');
      }
      case 'alerta': return await alerta(ctx, sub, o, rank);

      // ─── Comunidad ───
      case 'sugerir': {
        const texto = clip(o.sugerencia, 1800);
        const r = await post(ctx, 'sugerencias', { embeds: [{ author: { name: me.name }, title: '💡 Nueva sugerencia', description: texto, color: COLOR.gold, timestamp: new Date(ctx.now()).toISOString() }] });
        if (!r) return fail('No pude publicar la sugerencia (revisa /config canal sugerencias).');
        await db.run('INSERT INTO suggestions (discord_id, texto, message_id, created_at) VALUES ($1, $2, $3, $4)', [me.id, texto, r.id, ctx.now()]);
        for (const e of ['✅', '❌']) await ctx.api('PUT', `/channels/${r.channelId}/messages/${r.id}/reactions/${encodeURIComponent(e)}/@me`);
        return ok('Sugerencia enviada.');
      }
      case 'anon-mensaje': {
        const links = [o.archivo_1, o.archivo_2, o.archivo_3, o.archivo_4, o.archivo_5].filter(isUrl);
        return await anonPost(ctx, o.mensaje, links);
      }
      case 'decir': {
        if (!rank.admin) return fail('Solo la administración.');
        const r = await ctx.api('POST', `/channels/${o.canal}/messages`, { content: clip(o.mensaje, 2000), allowed_mentions: { parse: [] } });
        if (!r.ok) return fail('No pude escribir en ese canal (revisa los permisos del bot).');
        await log(ctx, 'decir', null, `<#${o.canal}>: ${o.mensaje}`);
        return ok('Mensaje enviado.');
      }
      case 'staff': return await staff(ctx, sub, o, user, rank);
      case 'mod': return await mod(ctx, sub, o, file, target, rank, user);
      case 'logs': {
        if (!rank.admin) return fail('Solo la administración.');
        const n = Math.min(50, Math.max(1, Math.trunc(Number(o.limite) || 15)));
        const rows = await db.query('SELECT tipo, actor_id, target_id, detalle, created_at FROM bot_logs ORDER BY id DESC LIMIT $1', [n]);
        if (!rows.length) return fail('Aún no hay registros.');
        return priv('', { embeds: [{ title: `📜 Últimos ${rows.length} registros`, color: COLOR.gray, description: clip(rows.map((r) => `${hace(r.created_at)} **${r.tipo}** · <@${r.actor_id}>${r.target_id ? ` → <@${r.target_id}>` : ''} — ${clip(r.detalle, 120)}`).join('\n'), 4000) }] });
      }

      // ─── Tickets ───
      case 'ticket': return await (sub === 'cerrar' ? closeTicket(ctx, null, rank) : claimTicket(ctx, o.ticket_id, rank));
      case 'reclamar': return await claimTicket(ctx, o.ticket_id, rank);
      case 'cerrar-ticket': return await closeTicket(ctx, null, rank);
      case 'bloquear-ticket':
      case 'desbloquear-ticket': {
        if (!rank.staff) return fail('Solo el staff.');
        const t = await findTicket(db, o.ticket_id);
        if (!t) return fail('No encontré ese ticket.');
        const lock = name === 'bloquear-ticket';
        await db.run('UPDATE tickets SET locked = $1, lock_reason = $2 WHERE id = $3', [lock ? 1 : 0, lock ? clip(o.razon, 200) : null, t.id]);
        if (t.channel_id) await ctx.api('POST', `/channels/${t.channel_id}/messages`, { content: lock ? `🔒 Ticket bloqueado por <@${me.id}>: ${clip(o.razon, 200)}` : `🔓 Ticket desbloqueado por <@${me.id}>.`, allowed_mentions: { parse: [] } });
        await log(ctx, name, t.owner_id, `Ticket #${t.id}${lock ? `: ${o.razon}` : ''}`);
        return ok(`Ticket #${t.id} ${lock ? 'bloqueado' : 'desbloqueado'}.`);
      }

      // ─── Servidor y ER:LC ───
      case 'server': return await server(ctx, sub, o, rank);
      case 'erlc': return await erlcCmd(ctx, sub, o, rank);

      case 'config': return await config(ctx, sub, o, rank);
      default: return fail('Ese comando no existe.');
    }
  } catch (err) {
    if (err instanceof P.PanelError) return fail(err.fields ? `${err.message} ${Object.values(err.fields).join(' ')}` : err.message);
    throw err;
  }
}

function ayuda(ctx) {
  const lines = [
    '**💵 Economía:** /balance · /depositar · /retirar · /transferir · /cobrar-salario · /top · /casino · /shop · /inventario',
    '**🪪 Documentos:** /dni crear|ver · /licencia · /vehiculo · /verificar',
    '**🚓 Policía:** /multa · /arrestar · /antecedentes · /entorno · /alerta',
    '**👥 Comunidad:** /sugerir · /anon · /anon-mensaje · /social · /banda · /robar · /staff calificar',
    '**🎫 Tickets:** /ticket · /reclamar · /cerrar-ticket · /bloquear-ticket · /desbloquear-ticket',
    '**🛡️ Staff:** /mod · /blacklist · /server · /erlc · /logs · /decir · /admin · /salario-configurar · /config',
    '**🌐 Web:** /crear-cedula · /cedula · /banco · /multas · /pagar · /turno · /policia · /servidor · /panel',
  ];
  return priv('', { embeds: [{ title: '📖 Comandos de Panamá RP', color: COLOR.blue, description: `${lines.join('\n')}\n\nTodo usa la misma cuenta que la web: ${ctx.siteUrl}/panel` }] });
}

async function cobrarSalario(ctx) {
  const { db, me } = ctx;
  if (!(await P.getAccount(db, me.id))) return fail('Necesitas DNI para cobrar (usa /dni crear).');
  const rows = await db.query('SELECT role_id, monto, cooldown_h FROM salaries', []);
  const mine = rows.filter((r) => (ctx.roles || []).includes(r.role_id));
  if (!mine.length) return fail('Ninguno de tus roles tiene salario.');
  const now = ctx.now();
  const lines = [];
  let total = 0;
  for (const r of mine) {
    const last = await db.one('SELECT last_at FROM salary_claims WHERE discord_id = $1 AND role_id = $2', [me.id, r.role_id]);
    const next = (last?.last_at || 0) + r.cooldown_h * 3600_000;
    if (now < next) { lines.push(`⏳ <@&${r.role_id}>: podrás cobrar ${hace(next)}`); continue; }
    await db.tx(async (t) => {
      let n = Number(r.monto);
      if (n > 0) await t.run('UPDATE accounts SET banco = banco + $1 WHERE discord_id = $2', [n, me.id]);
      else {
        const acc = await t.one('SELECT banco FROM accounts WHERE discord_id = $1', [me.id]);
        n = -Math.min(-n, Number(acc?.banco || 0));
        if (n) await t.run('UPDATE accounts SET banco = banco + $1 WHERE discord_id = $2', [n, me.id]);
      }
      if (n) await t.run("INSERT INTO transactions (discord_id, kind, amount, note, created_at) VALUES ($1, $2, $3, $4, $5)", [me.id, n > 0 ? 'salario' : 'impuesto', n, 'Por rol de Discord', now]);
      await t.run('INSERT INTO salary_claims (discord_id, role_id, last_at) VALUES ($1, $2, $3) ON CONFLICT (discord_id, role_id) DO UPDATE SET last_at = EXCLUDED.last_at', [me.id, r.role_id, now]);
      total += n;
      lines.push(`${n >= 0 ? '🟢' : '🔴'} <@&${r.role_id}>: ${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`);
    });
  }
  const acc = await P.getAccount(db, me.id);
  return priv('', { embeds: [{ title: '💼 Cobro de salarios', color: total >= 0 ? COLOR.green : COLOR.red, description: lines.join('\n'), footer: { text: `Total: ${total >= 0 ? '+' : '−'}${money(Math.abs(total))} · Banco: ${money(acc.banco)}` } }] });
}

// ─── Casino (con el efectivo) ───
async function casino(ctx, sub, o) {
  const { db, me } = ctx;
  const bet = Math.trunc(Number(o.monto));
  const min = sub === 'tragaperras' ? 50 : 1;
  if (!Number.isSafeInteger(bet) || bet < min || bet > 1_000_000) return fail(`La apuesta va de ${money(min)} a ${money(1_000_000)}.`);
  const rand = ctx.randomInt || crypto.randomInt;
  let win = 0; let text = '';
  if (sub === 'coinflip') {
    const res = rand(2) === 0 ? 'cara' : 'cruz';
    win = res === o.cara_o_cruz ? bet * 2 : 0;
    text = `🪙 Salió **${res}**.`;
  } else if (sub === 'dados') {
    const n = Math.trunc(Number(o.numero));
    if (!(n >= 1 && n <= 6)) return fail('Elige un número del 1 al 6.');
    const res = rand(6) + 1;
    win = res === n ? bet * 5 : 0;
    text = `🎲 Salió el **${res}** (elegiste ${n}).`;
  } else if (sub === 'tragaperras') {
    const SYM = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣'];
    const r = [rand(6), rand(6), rand(6)].map((i) => SYM[i]);
    const count = (s) => r.filter((x) => x === s).length;
    if (r[0] === r[1] && r[1] === r[2]) win = bet * 10;
    else if (count('💎') === 2 || count('7️⃣') === 2) win = bet * 3;
    text = `🎰 | ${r.join(' | ')} |`;
  } else return fail('Juego no válido.');
  const out = await db.tx(async (t) => {
    const r = await t.run('UPDATE accounts SET efectivo = efectivo - $1 WHERE discord_id = $2 AND efectivo >= $1', [bet, me.id]);
    if (!r.rowCount) throw new P.PanelError(400, (await t.one('SELECT 1 AS x FROM accounts WHERE discord_id = $1', [me.id])) ? 'No tienes tanto efectivo (usa /retirar).' : 'Necesitas DNI para jugar (usa /dni crear).');
    if (win) await t.run('UPDATE accounts SET efectivo = efectivo + $1 WHERE discord_id = $2', [win, me.id]);
    await t.run("INSERT INTO transactions (discord_id, kind, amount, note, created_at) VALUES ($1, 'casino', $2, $3, $4)", [me.id, win - bet, `Casino: ${sub}`, ctx.now()]);
    return t.one('SELECT efectivo FROM accounts WHERE discord_id = $1', [me.id]);
  });
  return { private: { content: '✅ Listo' }, public: { embeds: [{ title: '🎲 Casino', color: win ? COLOR.green : COLOR.red, description: `<@${me.id}> apostó **${money(bet)}**\n${text}\n${win ? `🎉 ¡Ganó **${money(win)}**!` : '😢 Perdió la apuesta.'}`, footer: { text: `Efectivo: ${money(out.efectivo)}` } }] } };
}

// ─── Tienda e inventario ───
async function shop(ctx, sub, o, rank) {
  const { db } = ctx;
  if (sub === 'agregar') {
    if (!rank.admin) return fail('Solo la administración.');
    const precio = Math.trunc(Number(o.precio));
    if (!Number.isSafeInteger(precio) || precio < 1 || precio > 100_000_000) return fail('Precio no válido.');
    const r = await db.one('INSERT INTO shop_items (nombre, precio, descripcion, emoji, role_id, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [clip(o.nombre, 60), precio, clip(o.descripcion, 200), o.emoji ? clip(o.emoji, 40) : null, o.rol ? String(o.rol) : null, ctx.now()]);
    await log(ctx, 'tienda agregar', null, `#${r.id} ${o.nombre} ${money(precio)}`);
    return ok(`Artículo #${r.id} agregado: ${o.nombre} (${money(precio)}).`);
  }
  if (sub === 'eliminar') {
    if (!rank.admin) return fail('Solo la administración.');
    const r = await db.run('UPDATE shop_items SET activo = 0 WHERE id = $1 AND activo = 1', [Math.trunc(Number(o.id_articulo))]);
    return r.rowCount ? ok('Artículo eliminado de la tienda.') : fail('Ese artículo no existe.');
  }
  const items = await db.query('SELECT id, nombre, precio, descripcion, emoji, role_id FROM shop_items WHERE activo = 1 ORDER BY precio, id LIMIT 25', []);
  if (!items.length) return fail('La tienda está vacía. La administración agrega artículos con /shop agregar.');
  const img = await getCfg(db, 'imagen', 'tienda');
  return priv('', {
    embeds: [{ title: '🛒 Tienda de Panamá RP', color: COLOR.purple, description: items.map((i) => `${i.emoji || '📦'} **${i.nombre}** — ${money(i.precio)} \`#${i.id}\`\n${i.descripcion}${i.role_id ? ` · da <@&${i.role_id}>` : ''}`).join('\n\n').slice(0, 4000), ...(isUrl(img) ? { image: { url: img } } : {}), footer: { text: 'Se paga con tu banco' } }],
    components: [{ type: 1, components: [{ type: 3, custom_id: 'shop:buy', placeholder: 'Elige qué comprar', options: items.map((i) => ({ label: clip(i.nombre, 100), value: String(i.id), description: clip(`${money(i.precio)} · ${i.descripcion}`, 100), ...(i.emoji && !/^<a?:/.test(i.emoji) && [...i.emoji].length <= 4 ? { emoji: { name: i.emoji } } : {}) })) }] }],
  });
}

async function inventario(ctx, sub, o, target) {
  const { db, me } = ctx;
  if (sub === 'transferir') {
    if (!target) return fail('Elige a quién.');
    if (target.id === me.id) return fail('No puedes dártelo a ti mismo.');
    const r = await db.run('UPDATE inventory SET discord_id = $1 WHERE id = $2 AND discord_id = $3', [target.id, Math.trunc(Number(o.id_instancia)), me.id]);
    if (!r.rowCount) return fail('No tienes ese artículo (mira el número en /inventario ver).');
    await log(ctx, 'inventario transferir', target.id, `#${o.id_instancia}`);
    return { private: { content: '✅ Artículo transferido.' }, public: { content: `📦 <@${me.id}> le dio un artículo a <@${target.id}>.`, allowed_mentions: { users: [target.id] } } };
  }
  const rows = await db.query('SELECT id, nombre, created_at FROM inventory WHERE discord_id = $1 ORDER BY id DESC LIMIT 40', [me.id]);
  if (!rows.length) return fail('Tu inventario está vacío. Compra en /shop ver.');
  return priv('', { embeds: [{ title: '🎒 Tu inventario', color: COLOR.purple, description: rows.map((r) => `\`#${r.id}\` **${r.nombre}** · ${hace(r.created_at)}`).join('\n') }] });
}

// ─── Bandas ───
async function myGang(db, id) {
  return db.one("SELECT g.id, g.nombre, g.logo, g.leader_id, g.caja FROM gang_members m JOIN gangs g ON g.id = m.gang_id WHERE m.discord_id = $1 AND g.estado = 'activa'", [id]);
}
async function banda(ctx, sub, o, file, target) {
  const { db, me } = ctx;
  if (sub === 'crear') {
    if (await myGang(db, me.id)) return fail('Ya estás en una banda.');
    const nombre = clip(o.nombre, 40).trim();
    if (nombre.length < 3) return fail('El nombre es muy corto.');
    if (await db.one('SELECT id FROM gangs WHERE LOWER(nombre) = LOWER($1)', [nombre])) return fail('Ya existe una banda con ese nombre.');
    const logo = file(o.logo);
    const g = await db.one('INSERT INTO gangs (nombre, logo, leader_id, created_at) VALUES ($1, $2, $3, $4) RETURNING id', [nombre, logo, me.id, ctx.now()]);
    const r = await post(ctx, 'bandas', {
      embeds: [{ title: `🏴 Propuesta de banda #${g.id}`, color: COLOR.gold, description: `**${nombre}**\nLíder: <@${me.id}>`, ...(logo ? { thumbnail: { url: logo } } : {}) }],
      components: [{ type: 1, components: [{ type: 2, style: 3, label: 'Aprobar', custom_id: `g:ok:${g.id}` }, { type: 2, style: 4, label: 'Rechazar', custom_id: `g:no:${g.id}` }] }],
    });
    return r ? ok('Propuesta enviada al staff. Te avisaremos cuando la revisen.') : fail('No pude enviar la propuesta (revisa /config canal bandas).');
  }
  const g = await myGang(db, me.id);
  if (!g) return fail('No estás en ninguna banda. Crea una con /banda crear.');
  if (sub === 'info') {
    const members = await db.query('SELECT discord_id FROM gang_members WHERE gang_id = $1', [g.id]);
    return priv('', { embeds: [{ title: `🏴 ${g.nombre}`, color: COLOR.gold, ...(g.logo ? { thumbnail: { url: g.logo } } : {}), fields: [
      { name: 'Líder', value: `<@${g.leader_id}>`, inline: true }, { name: 'Caja', value: money(g.caja), inline: true },
      { name: `Miembros (${members.length})`, value: clip(members.map((m) => `<@${m.discord_id}>`).join(' '), 1024) },
    ] }] });
  }
  if (sub === 'caja') {
    const n = Math.trunc(Number(o.monto));
    if (!Number.isSafeInteger(n) || n < 1 || n > 100_000_000) return fail('Monto no válido.');
    if (o.accion === 'retirar' && g.leader_id !== me.id) return fail('Solo el líder puede sacar de la caja.');
    await db.tx(async (t) => {
      if (o.accion === 'depositar') {
        const r = await t.run('UPDATE accounts SET efectivo = efectivo - $1 WHERE discord_id = $2 AND efectivo >= $1', [n, me.id]);
        if (!r.rowCount) throw new P.PanelError(400, 'No tienes tanto efectivo.');
        await t.run('UPDATE gangs SET caja = caja + $1 WHERE id = $2', [n, g.id]);
      } else {
        const r = await t.run('UPDATE gangs SET caja = caja - $1 WHERE id = $2 AND caja >= $1', [n, g.id]);
        if (!r.rowCount) throw new P.PanelError(400, 'La caja no tiene tanto.');
        const a = await t.run('UPDATE accounts SET efectivo = efectivo + $1 WHERE discord_id = $2', [n, me.id]);
        if (!a.rowCount) throw new P.PanelError(400, 'Necesitas DNI para recibir dinero.');
      }
      await t.run("INSERT INTO transactions (discord_id, kind, amount, note, created_at) VALUES ($1, 'banda', $2, $3, $4)", [me.id, o.accion === 'depositar' ? -n : n, `Caja de ${g.nombre}`, ctx.now()]);
    });
    return ok(`${o.accion === 'depositar' ? 'Depositaste' : 'Retiraste'} ${money(n)} ${o.accion === 'depositar' ? 'en' : 'de'} la caja de ${g.nombre}.`);
  }
  if (sub === 'invitar') {
    if (g.leader_id !== me.id) return fail('Solo el líder puede invitar.');
    if (!target) return fail('Elige a quién.');
    if (await myGang(db, target.id)) return fail('Esa persona ya está en una banda.');
    return { private: { content: '✅ Invitación enviada.' }, public: { content: `🏴 <@${target.id}>, <@${me.id}> te invita a la banda **${g.nombre}**.`, allowed_mentions: { users: [target.id] }, components: [{ type: 1, components: [{ type: 2, style: 3, label: 'Unirme', custom_id: `g:join:${g.id}:${target.id}` }] }] } };
  }
  return fail('Opción no válida.');
}

// ─── DNI = cédula de la web ───
async function dni(ctx, sub, o, target, rank) {
  const { db, me } = ctx;
  if (sub === 'crear') {
    if (await charOf(db, me.id)) return fail('Ya tienes DNI. Míralo con /dni ver.');
    let roblox = ctx.robloxFor ? await ctx.robloxFor(me.id) : null;
    if (!roblox && o.roblox_user) {
      const found = await ctx.lookupRoblox(String(o.roblox_user)).catch(() => null);
      if (!found) return fail('Ese usuario de Roblox no existe.');
      roblox = { id: found.id, name: found.name };
    }
    if (!roblox) return fail('Pon tu usuario en **roblox_user** o verifícate primero con /verificar.');
    const est = Math.trunc(Number(o.estatura_cm));
    if (!(est >= 100 && est <= 230)) return fail('La estatura debe ir de 100 a 230 cm.');
    const c = await P.createCharacter(db, { user: me, roblox, input: {
      nombre: o.nombre, apellidos: o.apellidos, nacimiento: parseDate(o.fecha_nacimiento), genero: o.sexo, sangre: o.tipo_sangre, nacionalidad: nationality(o.nacionalidad),
    } });
    await db.run('UPDATE characters SET estatura = $1 WHERE discord_id = $2', [est, me.id]);
    await log(ctx, 'dni crear', me.id, c.cedula);
    const avatar = await ctx.robloxAvatar(c.roblox_name);
    return { private: { content: `✅ ¡DNI creado! Tu número es **${c.cedula}** y ya tienes cuenta en el banco. Mírala en ${ctx.siteUrl}/panel#perfil` }, public: { embeds: [dniEmbed({ ...c, estatura: est }, avatar, `<@${me.id}> sacó su DNI.`, ctx.siteUrl)] } };
  }
  if (sub === 'admin_borrar') {
    if (!rank.admin) return fail('Solo la administración.');
    if (!target) return fail('Elige a quién.');
    const r = await db.run('DELETE FROM characters WHERE discord_id = $1', [target.id]);
    await db.run('DELETE FROM licenses WHERE discord_id = $1', [target.id]);
    await log(ctx, 'dni borrar', target.id, 'DNI eliminado');
    return r.rowCount ? ok(`DNI de <@${target.id}> eliminado. Puede crear uno nuevo.`) : fail('Esa persona no tiene DNI.');
  }
  const whom = target && target.id !== me.id ? target : me;
  if (whom !== me && !rank.records) return fail('Solo la Policía, la ATT, la justicia y el staff pueden ver el DNI de otra persona.');
  const c = await charOf(db, whom.id);
  if (!c) return fail(whom === me ? 'Aún no tienes DNI. Créalo con /dni crear.' : `<@${whom.id}> no tiene DNI.`);
  const avatar = await ctx.robloxAvatar(c.roblox_name);
  const row = await db.one('SELECT estatura FROM characters WHERE discord_id = $1', [whom.id]);
  return { private: { content: '✅ Listo' }, public: { embeds: [dniEmbed({ ...c, estatura: row?.estatura }, avatar, whom === me ? `<@${me.id}> muestra su DNI.` : `<@${me.id}> revisó el DNI de <@${whom.id}>.`, ctx.siteUrl)] } };
}
function dniEmbed(c, avatar, description, site) {
  return {
    title: '🪪 Documento de identidad · Panamá RP', color: COLOR.blue, url: `${site}/panel#perfil`, description,
    ...(avatar ? { thumbnail: { url: avatar } } : {}),
    fields: [
      { name: 'Nombre', value: `${c.nombre} ${c.apellidos}`, inline: true },
      { name: 'N.º', value: `\`${c.cedula}\``, inline: true },
      { name: 'Nacimiento', value: c.nacimiento, inline: true },
      { name: 'Sexo', value: c.genero, inline: true },
      { name: 'Sangre', value: c.sangre, inline: true },
      { name: 'Nacionalidad', value: c.nacionalidad, inline: true },
      ...(c.estatura ? [{ name: 'Estatura', value: `${c.estatura} cm`, inline: true }] : []),
      { name: 'Roblox', value: c.roblox_name, inline: true },
    ],
    footer: { text: 'Documento de rol · mírala completa en el panel web' },
  };
}

async function licencia(ctx, sub, o, target, rank) {
  const { db, me } = ctx;
  const TIPOS = { conducir: '🚗 Conducir', armas: '🔫 Armas' };
  if (sub === 'registrar') {
    if (!(await charOf(db, me.id))) return fail('Necesitas DNI (usa /dni crear).');
    if (o.tipo === 'armas') {
      const recent = await db.one("SELECT COUNT(*) AS n FROM arrests WHERE discord_id = $1 AND created_at > $2", [me.id, ctx.now() - 7 * 86400_000]);
      if (Number(recent?.n) > 0) return fail('No puedes sacar licencia de armas con arrestos en los últimos 7 días.');
    }
    if (await db.one('SELECT 1 AS x FROM licenses WHERE discord_id = $1 AND tipo = $2', [me.id, o.tipo])) return fail('Ya tienes esa licencia.');
    await db.run('INSERT INTO licenses (discord_id, tipo, created_at) VALUES ($1, $2, $3)', [me.id, o.tipo, ctx.now()]);
    await log(ctx, 'licencia', me.id, o.tipo);
    return ok(`Licencia de ${TIPOS[o.tipo] || o.tipo} tramitada.`);
  }
  if (sub === 'revocar') {
    const r = await db.run('DELETE FROM licenses WHERE discord_id = $1 AND tipo = $2', [me.id, o.tipo]);
    return r.rowCount ? ok('Licencia revocada.') : fail('No tenías esa licencia.');
  }
  const whom = target || me;
  if (whom.id !== me.id && !rank.records) return fail('Solo la Policía, la ATT, la justicia y el staff pueden ver licencias de otros.');
  const rows = await db.query('SELECT tipo, created_at FROM licenses WHERE discord_id = $1', [whom.id]);
  return priv('', { embeds: [{ title: '📄 Licencias', color: COLOR.blue, description: `<@${whom.id}>\n${rows.length ? rows.map((r) => `${TIPOS[r.tipo] || r.tipo} — desde ${fecha(r.created_at)}`).join('\n') : 'Sin licencias vigentes.'}` }] });
}

async function vehiculo(ctx, sub, o, file, rank) {
  const { db, me } = ctx;
  if (sub === 'registrar') {
    const c = await charOf(db, me.id);
    const placa = plate(o.placa);
    if (!/^[A-Z0-9-]{3,12}$/.test(placa)) return fail('Placa no válida (ej: ABC-123).');
    if (await db.one('SELECT 1 AS x FROM vehicles WHERE placa = $1', [placa])) return fail('Esa placa ya está registrada.');
    const rbx = o.roblox || (ctx.robloxFor ? (await ctx.robloxFor(me.id))?.name : null) || c?.roblox_name || null;
    const imagen = file(o.imagen);
    await db.run('INSERT INTO vehicles (placa, discord_id, marca, modelo, color, imagen, propietario, roblox, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [placa, me.id, clip(o.marca, 40), clip(o.modelo, 40), clip(o.color, 30), imagen, clip(o.propietario || nameOf(c, me.name), 80), rbx ? clip(rbx, 40) : null, ctx.now()]);
    await post(ctx, 'vehiculos', { embeds: [vehEmbed({ placa, marca: o.marca, modelo: o.modelo, color: o.color, imagen, propietario: o.propietario || nameOf(c, me.name), roblox: rbx, discord_id: me.id }, '🚗 Vehículo registrado')] });
    await log(ctx, 'vehiculo registrar', me.id, placa);
    return ok(`Vehículo **${placa}** registrado.`);
  }
  if (sub === 'buscar') {
    const v = await db.one('SELECT * FROM vehicles WHERE placa = $1', [plate(o.placa)]);
    return v ? priv('', { embeds: [vehEmbed(v, `🔎 Placa ${v.placa}`)] }) : fail('No hay ningún vehículo con esa placa.');
  }
  if (sub === 'listar') {
    const rows = await db.query('SELECT placa, marca, modelo, color FROM vehicles WHERE discord_id = $1 ORDER BY created_at DESC', [me.id]);
    return rows.length ? priv('', { embeds: [{ title: '🚗 Tus vehículos', color: COLOR.blue, description: rows.map((v) => `\`${v.placa}\` ${v.marca} ${v.modelo} (${v.color})`).join('\n') }] }) : fail('No tienes vehículos registrados.');
  }
  if (sub === 'eliminar') {
    if (!rank.admin) return fail('Solo la administración.');
    const r = await db.run('DELETE FROM vehicles WHERE placa = $1', [plate(o.placa)]);
    if (r.rowCount) await log(ctx, 'vehiculo eliminar', null, plate(o.placa));
    return r.rowCount ? ok('Vehículo eliminado.') : fail('No hay ningún vehículo con esa placa.');
  }
  return fail('Opción no válida.');
}
function vehEmbed(v, title) {
  return { title, color: COLOR.blue, fields: [
    { name: 'Placa', value: `\`${v.placa}\``, inline: true }, { name: 'Vehículo', value: `${v.marca} ${v.modelo}`, inline: true }, { name: 'Color', value: String(v.color), inline: true },
    { name: 'Propietario', value: `${v.propietario || '—'} (<@${v.discord_id}>)`, inline: true }, { name: 'Roblox', value: v.roblox || '—', inline: true },
  ], ...(v.imagen ? { image: { url: v.imagen } } : {}) };
}

// ─── Policía ───
async function officer(ctx) {
  const c = await charOf(ctx.db, ctx.me.id);
  return nameOf(c, ctx.me.name || 'Oficial');
}
async function multa(ctx, sub, o, file, target, rank) {
  const { db, me } = ctx;
  if (sub === 'agregar') {
    if (!rank.att) return fail('Solo la ATT puede poner multas.');
    if (!target) return fail('Elige a quién.');
    if (target.id === me.id) return fail('No puedes multarte a ti mismo.');
    const n = Math.trunc(Number(o.monto));
    if (!Number.isSafeInteger(n) || n < 1 || n > 10_000_000) return fail('Monto no válido.');
    const motivo = clip(o.articulos || 'Multa administrativa', 200);
    const ev = file(o.evidencia);
    const r = await db.one('INSERT INTO fines (discord_id, officer_id, officer_name, motivo, monto, articulos, matricula, evidencia, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
      [target.id, me.id, await officer(ctx), motivo, n, o.articulos || null, o.matricula ? plate(o.matricula) : null, ev, ctx.now()]);
    const embed = { title: `🧾 Multa #${r.id}`, color: COLOR.gold, description: `<@${me.id}> multó a <@${target.id}>`, fields: [
      { name: 'Monto', value: money(n), inline: true }, { name: 'Artículos', value: clip(o.articulos || '—', 1024), inline: true },
      ...(o.matricula ? [{ name: 'Placa', value: plate(o.matricula), inline: true }] : []), ...(o.roblox_user ? [{ name: 'Roblox', value: clip(o.roblox_user, 50), inline: true }] : []),
    ], ...(ev ? { image: { url: ev } } : {}), footer: { text: 'Se paga en la web (Mi perfil → Multas) o con /pagar' } };
    await post(ctx, 'multas', { embeds: [embed] });
    await log(ctx, 'multa', target.id, `#${r.id} ${money(n)} ${motivo}`);
    return { private: { content: `✅ Multa #${r.id} registrada (sale en su expediente web).` }, public: { content: `<@${target.id}>`, embeds: [embed], allowed_mentions: { users: [target.id] } } };
  }
  if (sub === 'eliminar') {
    if (!rank.admin) return fail('Solo la administración.');
    const r = await db.run('DELETE FROM fines WHERE id = $1 AND discord_id = $2', [Math.trunc(Number(o.multa_id)), target?.id]);
    if (r.rowCount) await log(ctx, 'multa eliminar', target?.id, `#${o.multa_id}`);
    return r.rowCount ? ok('Multa eliminada.') : fail('No encontré esa multa para esa persona.');
  }
  const whom = target || me;
  if (whom.id !== me.id && !rank.records) return fail('Solo la Policía, la ATT, la justicia y el staff pueden ver multas de otros.');
  const rows = await db.query("SELECT id, motivo, monto, officer_name, created_at FROM fines WHERE discord_id = $1 AND estado = 'pendiente' ORDER BY created_at DESC LIMIT 20", [whom.id]);
  const total = rows.reduce((a, r) => a + Number(r.monto), 0);
  return priv('', { embeds: [{ title: '🧾 Multas pendientes', color: rows.length ? COLOR.gold : COLOR.green, description: `<@${whom.id}>\n${rows.length ? rows.map((r) => `\`#${r.id}\` **${money(r.monto)}** — ${clip(r.motivo, 80)} · ${r.officer_name} · ${hace(r.created_at)}`).join('\n') : 'Sin multas pendientes. ✨'}`, ...(rows.length ? { footer: { text: `Total: ${money(total)} · Se pagan con /pagar o en la web` } } : {}) }] });
}

async function arrestar(ctx, sub, o, file, target, rank) {
  const { db, me } = ctx;
  if (!rank.police) return fail('Solo la Policía (Policía Nacional, Aeronaval o Senafront).');
  if (!target) return fail('Elige a quién.');
  const preso = await getCfg(db, 'rol', 'preso');
  if (sub === 'liberar') {
    const r = await db.run("UPDATE arrests SET released_at = $1 WHERE discord_id = $2 AND tipo = 'arresto' AND released_at IS NULL", [ctx.now(), target.id]);
    if (preso) await ctx.api('DELETE', `/guilds/${ctx.guildId}/members/${target.id}/roles/${preso}`);
    await log(ctx, 'liberar', target.id, 'Liberado');
    return r.rowCount ? { private: { content: '✅ Liberado.' }, public: { content: `🔓 <@${target.id}> fue liberado por <@${me.id}>.`, allowed_mentions: { users: [target.id] } } } : fail('Esa persona no estaba presa.');
  }
  if (target.id === me.id) return fail('No puedes arrestarte a ti mismo.');
  const min = Math.min(P.ARREST_MAX_MIN, Math.max(1, Math.trunc(Number(o.minutos) || 10)));
  const razon = clip(o.razon || 'Sin especificar', 300);
  const ev = file(o.evidencia);
  const r = await db.one("INSERT INTO arrests (discord_id, officer_id, officer_name, cargos, minutos, tipo, evidencia, roblox, created_at) VALUES ($1, $2, $3, $4, $5, 'arresto', $6, $7, $8) RETURNING id",
    [target.id, me.id, await officer(ctx), razon, min, ev, o.roblox_user ? clip(o.roblox_user, 50) : null, ctx.now()]);
  if (preso) await ctx.api('PUT', `/guilds/${ctx.guildId}/members/${target.id}/roles/${preso}`);
  const embed = { title: `🚔 Arresto #${r.id}`, color: COLOR.red, description: `<@${me.id}> arrestó a <@${target.id}>`, fields: [
    { name: 'Tiempo', value: `${min} min (sale ${hace(ctx.now() + min * 60_000)})`, inline: true }, { name: 'Motivo', value: razon, inline: true },
    ...(o.roblox_user ? [{ name: 'Roblox', value: clip(o.roblox_user, 50), inline: true }] : []),
  ], ...(ev ? { image: { url: ev } } : {}) };
  await post(ctx, 'arrestos', { embeds: [embed] });
  await log(ctx, 'arresto', target.id, `${min} min: ${razon}`);
  return {
    private: { content: `✅ Arresto #${r.id} registrado (sale en su expediente web).` },
    public: { content: `<@${target.id}>`, embeds: [embed], allowed_mentions: { users: [target.id] } },
  };
}

async function antecedentes(ctx, sub, o, file, target, rank) {
  const { db, me } = ctx;
  if (sub === 'agregar') {
    if (!rank.police) return fail('Solo la Policía (Policía Nacional, Aeronaval o Senafront).');
    if (!target) return fail('Elige a quién.');
    const ev = file(o.evidencia);
    const r = await db.one("INSERT INTO arrests (discord_id, officer_id, officer_name, cargos, minutos, tipo, descripcion, sentencia, evidencia, roblox, created_at) VALUES ($1, $2, $3, $4, 0, 'antecedente', $5, $6, $7, $8, $9) RETURNING id",
      [target.id, me.id, clip(o.oficial || await officer(ctx), 80), clip(o.delito || 'Sin especificar', 300), o.descripcion ? clip(o.descripcion, 1000) : null, o.sentencia ? clip(o.sentencia, 200) : null, ev, o.roblox_user ? clip(o.roblox_user, 50) : null, ctx.now()]);
    await post(ctx, 'arrestos', { embeds: [{ title: `📁 Antecedente #${r.id}`, color: COLOR.red, description: `<@${target.id}> · registrado por <@${me.id}>`, fields: [
      { name: 'Delito', value: clip(o.delito || '—', 1024), inline: true }, { name: 'Sentencia', value: clip(o.sentencia || '—', 1024), inline: true },
      ...(o.descripcion ? [{ name: 'Detalles', value: clip(o.descripcion, 1024) }] : []),
    ], ...(ev ? { image: { url: ev } } : {}) }] });
    await log(ctx, 'antecedente', target.id, `#${r.id} ${o.delito || ''}`);
    return ok(`Antecedente #${r.id} registrado (sale en su expediente web).`);
  }
  if (sub === 'eliminar') {
    if (!rank.admin) return fail('Solo la administración.');
    const r = await db.run('DELETE FROM arrests WHERE id = $1 AND discord_id = $2', [Math.trunc(Number(o.antecedente_id)), target?.id]);
    if (r.rowCount) await log(ctx, 'antecedente eliminar', target?.id, `#${o.antecedente_id}`);
    return r.rowCount ? ok('Antecedente eliminado.') : fail('No encontré ese antecedente para esa persona.');
  }
  const whom = target || me;
  if (whom.id !== me.id && !rank.records) return fail('Solo la Policía, la ATT, la justicia y el staff pueden ver antecedentes de otros.');
  const rows = await db.query('SELECT id, tipo, cargos, minutos, sentencia, officer_name, created_at FROM arrests WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 20', [whom.id]);
  const fines = await db.one("SELECT COUNT(*) AS n, COALESCE(SUM(monto), 0) AS s FROM fines WHERE discord_id = $1 AND estado = 'pendiente'", [whom.id]);
  return priv('', { embeds: [{ title: '📁 Historial criminal', color: rows.length ? COLOR.red : COLOR.green, description: clip(`<@${whom.id}>\n${rows.length ? rows.map((r) => `\`#${r.id}\` ${r.tipo === 'arresto' ? `🚔 **Arresto** (${r.minutos} min)` : '📁 **Antecedente**'} — ${clip(r.cargos, 80)}${r.sentencia ? ` · ${clip(r.sentencia, 60)}` : ''} · ${r.officer_name} · ${hace(r.created_at)}`).join('\n') : 'Sin antecedentes. ✨'}`, 4000), footer: { text: `Multas pendientes: ${fines.n} (${money(fines.s)})` } }] });
}

async function alerta(ctx, sub, o, rank) {
  const { db, me } = ctx;
  const NIV = { 1: ['🔴', 'Máxima'], 2: ['🟠', 'Media'], 3: ['🟢', 'Normal'] };
  if (sub === 'cambiar') {
    if (!rank.admin) return fail('Solo la administración.');
    const n = Math.trunc(Number(o.nivel));
    if (!NIV[n]) return fail('Nivel no válido.');
    await setCfg(db, 'texto', 'alerta_nivel', n);
    await setCfg(db, 'texto', 'alerta_razon', clip(o.razon, 300));
    await setCfg(db, 'texto', 'alerta_desde', ctx.now());
    const embed = { title: `${NIV[n][0]} Nivel de alerta: ${NIV[n][1]} (${n})`, color: n === 1 ? COLOR.red : n === 2 ? COLOR.gold : COLOR.green, description: `**Razón:** ${clip(o.razon, 300)}\n**Armamento:** ${await getCfg(db, 'texto', `armas_${n}`)}`, footer: { text: `Cambiado por ${me.name}` } };
    await post(ctx, 'alertas', { embeds: [embed] });
    await log(ctx, 'alerta', null, `Nivel ${n}: ${o.razon}`);
    return ok(`Alerta cambiada a ${NIV[n][1]}.`);
  }
  const n = Number(await getCfg(db, 'texto', 'alerta_nivel')) || 3;
  if (sub === 'armamento') return priv('', { embeds: [{ title: `🔫 Armamento permitido · alerta ${NIV[n][1]}`, color: COLOR.blue, description: [1, 2, 3].map((k) => `${NIV[k][0]} **${NIV[k][1]} (${k})**${k === n ? ' ← ahora' : ''}\n${'' + (DEFAULT_TEXT[`armas_${k}`])}`).join('\n\n').replace(/.+/s, (s) => s) }] });
  const razon = await getCfg(db, 'texto', 'alerta_razon');
  const desde = Number(await getCfg(db, 'texto', 'alerta_desde')) || 0;
  return priv('', { embeds: [{ title: `${NIV[n][0]} Nivel de alerta: ${NIV[n][1]} (${n})`, color: n === 1 ? COLOR.red : n === 2 ? COLOR.gold : COLOR.green, description: `${razon ? `**Razón:** ${razon}\n` : ''}${desde ? `Desde ${hace(desde)}\n` : ''}**Armamento:** ${await getCfg(db, 'texto', `armas_${n}`)}` }] });
}

// ─── Mensajes anónimos ───
async function anonPost(ctx, mensaje, links = []) {
  const text = clip(String(mensaje || '').trim(), 3800);
  if (text.length < 2) return fail('Escribe el mensaje.');
  const files = links.filter(isUrl).slice(0, 5);
  const img = files.find(isImage);
  const r = await post(ctx, 'anon', { embeds: [{ title: '🕵️ Mensaje anónimo', color: COLOR.gray, description: text, ...(img ? { image: { url: img } } : {}), ...(files.length ? { fields: [{ name: 'Archivos', value: files.map((f, i) => `[Archivo ${i + 1}](${f})`).join(' · ') }] } : {}), timestamp: new Date(ctx.now()).toISOString() }] });
  if (!r) return fail('No pude publicar el mensaje (revisa /config canal anon).');
  // queda registrado solo para la administración (/logs), por si alguien abusa
  try { await ctx.db.run("INSERT INTO bot_logs (tipo, actor_id, detalle, created_at) VALUES ('anon', $1, $2, $3)", [ctx.me.id, clip(text, 300), ctx.now()]); } catch { /* sin registro */ }
  return ok('Mensaje anónimo publicado.');
}

// ─── Staff y moderación ───
async function staff(ctx, sub, o, user, rank) {
  const { db, me } = ctx;
  const since = ctx.now() - 7 * 86400_000;
  if (sub === 'calificar') {
    const st = user(o.staff);
    if (!st) return fail('Elige a quién.');
    if (st.id === me.id) return fail('No puedes calificarte a ti mismo.');
    const n = Math.trunc(Number(o.estrellas));
    if (!(n >= 1 && n <= 5)) return fail('De 1 a 5 estrellas.');
    if (await db.one('SELECT 1 AS x FROM staff_ratings WHERE staff_id = $1 AND rater_id = $2 AND created_at > $3', [st.id, me.id, ctx.now() - 86400_000])) return fail('Ya calificaste a esa persona hoy.');
    await db.run('INSERT INTO staff_ratings (staff_id, rater_id, estrellas, comentario, created_at) VALUES ($1, $2, $3, $4, $5)', [st.id, me.id, n, o.comentario ? clip(o.comentario, 300) : null, ctx.now()]);
    return ok(`Calificaste a <@${st.id}> con ${'⭐'.repeat(n)}.`);
  }
  if (sub === 'top') {
    const rows = await db.query('SELECT staff_id, AVG(estrellas) AS prom, COUNT(*) AS n FROM staff_ratings WHERE created_at > $1 GROUP BY staff_id ORDER BY prom DESC, n DESC LIMIT 10', [since]);
    if (!rows.length) return fail('Aún no hay calificaciones esta semana.');
    return priv('', { embeds: [{ title: '🏆 Top staff de la semana', color: COLOR.gold, description: rows.map((r, i) => `**${i + 1}.** <@${r.staff_id}> — ${Number(r.prom).toFixed(1)} ⭐ (${r.n} votos)`).join('\n') }] });
  }
  const st = o.staff ? user(o.staff) : me;
  const all = await db.one('SELECT AVG(estrellas) AS prom, COUNT(*) AS n FROM staff_ratings WHERE staff_id = $1', [st.id]);
  const week = await db.one('SELECT AVG(estrellas) AS prom, COUNT(*) AS n FROM staff_ratings WHERE staff_id = $1 AND created_at > $2', [st.id, since]);
  const mods = await db.one('SELECT COUNT(*) AS n FROM moderations WHERE mod_id = $1', [st.id]);
  const tickets = await db.one('SELECT COUNT(*) AS n FROM tickets WHERE claimed_by = $1', [st.id]);
  const avg = (x) => (Number(x.n) ? `${Number(x.prom).toFixed(1)} ⭐ (${x.n})` : '—');
  return priv('', { embeds: [{ title: '📊 Estadísticas de staff', color: COLOR.blue, description: `<@${st.id}>`, fields: [
    { name: 'Calificación (semana)', value: avg(week), inline: true }, { name: 'Calificación (total)', value: avg(all), inline: true },
    { name: 'Moderaciones', value: String(mods.n), inline: true }, { name: 'Tickets atendidos', value: String(tickets.n), inline: true },
  ] }] });
}

async function mod(ctx, sub, o, file, target, rank, user) {
  const { db, me } = ctx;
  if (!rank.staff) return fail('Solo el staff.');
  const TIPO = { verbal: '🗣️ Verbal Warn', warn: '⚠️ Warn', sancion: '⛔ Sanción grave', ban: '🔨 Ban' };
  if (sub === 'warn') {
    if (!target) return fail('Elige a quién.');
    const rbx = o.roblox_name || (await db.one('SELECT roblox_name FROM users WHERE discord_id = $1', [target.id]))?.roblox_name || null;
    const ev = file(o.evidencia);
    const r = await db.one('INSERT INTO moderations (discord_id, mod_id, tipo, razon, roblox, evidencia, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id', [target.id, me.id, o.tipo, clip(o.razon, 500), rbx, ev, ctx.now()]);
    const total = await db.one("SELECT COUNT(*) AS n FROM moderations WHERE discord_id = $1 AND tipo <> 'ban'", [target.id]);
    const embed = { title: `${TIPO[o.tipo] || o.tipo} · #${r.id}`, color: o.tipo === 'sancion' ? COLOR.red : COLOR.gold, fields: [
      { name: 'Usuario', value: `<@${target.id}>${rbx ? ` (${rbx})` : ''}`, inline: true }, { name: 'Staff', value: `<@${me.id}>`, inline: true },
      { name: 'Total de advertencias', value: String(total.n), inline: true }, { name: 'Razón', value: clip(o.razon, 1024) },
    ], ...(ev ? { image: { url: ev } } : {}), timestamp: new Date(ctx.now()).toISOString() };
    await post(ctx, 'moderacion', { embeds: [embed] });
    if (ctx.dm) await ctx.dm(target.id, { embeds: [{ ...embed, title: `Recibiste una moderación en Panamá RP: ${TIPO[o.tipo] || o.tipo}` }] }).catch(() => {});
    await log(ctx, `mod ${o.tipo}`, target.id, o.razon);
    return ok(`Moderación #${r.id} aplicada a <@${target.id}>.`);
  }
  if (sub === 'ban') {
    if (!target) return fail('Elige a quién.');
    if (target.id === me.id) return fail('No puedes banearte a ti mismo.');
    const days = Math.max(0, Math.trunc(Number(o.duracion) || 0));
    const until = days ? ctx.now() + days * 86400_000 : null;
    if (ctx.dm) await ctx.dm(target.id, { content: `🔨 Fuiste baneado de Panamá RP${days ? ` por ${days} día(s)` : ' permanentemente'}.\n**Razón:** ${clip(o.razon, 500)}` }).catch(() => {});
    const r = await ctx.api('PUT', `/guilds/${ctx.guildId}/bans/${target.id}`, { delete_message_seconds: 0 }, { reason: clip(`${me.name}: ${o.razon}`, 400) });
    if (!r.ok) return fail(r.code === 50013 ? 'El bot no tiene permiso para banear a esa persona (su rol está por encima).' : `Discord no dejó banear (error ${r.status}).`);
    await db.run('INSERT INTO bans (discord_id, mod_id, roblox, razon, until_at, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (discord_id) DO UPDATE SET mod_id = EXCLUDED.mod_id, roblox = EXCLUDED.roblox, razon = EXCLUDED.razon, until_at = EXCLUDED.until_at, created_at = EXCLUDED.created_at',
      [target.id, me.id, clip(o.roblox_name, 50), clip(o.razon, 500), until, ctx.now()]);
    await db.run("INSERT INTO moderations (discord_id, mod_id, tipo, razon, roblox, created_at) VALUES ($1, $2, 'ban', $3, $4, $5)", [target.id, me.id, clip(o.razon, 500), clip(o.roblox_name, 50), ctx.now()]);
    await post(ctx, 'moderacion', { embeds: [{ title: '🔨 Ban', color: COLOR.red, fields: [
      { name: 'Usuario', value: `<@${target.id}> (${clip(o.roblox_name, 50)})`, inline: true }, { name: 'Staff', value: `<@${me.id}>`, inline: true },
      { name: 'Duración', value: days ? `${days} día(s) · hasta ${fecha(until)}` : 'Permanente', inline: true }, { name: 'Razón', value: clip(o.razon, 1024) },
    ] }] });
    await log(ctx, 'ban', target.id, `${days ? `${days} días` : 'permanente'}: ${o.razon}`);
    return ok(`<@${target.id}> baneado${days ? ` por ${days} día(s)` : ' permanentemente'}.`);
  }
  if (sub === 'unban') {
    const id = String(o.id_usuario || '').replace(/\D/g, '');
    if (!/^\d{15,22}$/.test(id)) return fail('Pon el ID de Discord (solo números).');
    const r = await ctx.api('DELETE', `/guilds/${ctx.guildId}/bans/${id}`, undefined, { reason: `Desbaneado por ${me.name}` });
    await db.run('DELETE FROM bans WHERE discord_id = $1', [id]);
    if (!r.ok && r.code !== 10026) return fail(`Discord no dejó desbanear (error ${r.status}).`);
    await log(ctx, 'unban', id, 'Desbaneado');
    return ok(r.ok ? `<@${id}> desbaneado.` : 'Esa persona no estaba baneada.');
  }
  if (sub === 'clearwarns') {
    if (!target) return fail('Elige a quién.');
    const r = await db.run("DELETE FROM moderations WHERE discord_id = $1 AND tipo <> 'ban'", [target.id]);
    await log(ctx, 'clearwarns', target.id, `${r.rowCount} advertencias`);
    return ok(`Se borraron ${r.rowCount} advertencia(s) de <@${target.id}>.`);
  }
  if (sub === 'historial') {
    if (!target) return fail('Elige a quién.');
    const rows = await db.query('SELECT id, tipo, razon, mod_id, created_at FROM moderations WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 25', [target.id]);
    return priv('', { embeds: [{ title: '📋 Historial de moderación', color: rows.length ? COLOR.gold : COLOR.green, description: clip(`<@${target.id}>\n${rows.length ? rows.map((r) => `\`#${r.id}\` ${TIPO[r.tipo] || r.tipo} — ${clip(r.razon, 90)} · <@${r.mod_id}> · ${hace(r.created_at)}`).join('\n') : 'Sin moderaciones. ✨'}`, 4000) }] });
  }
  if (sub === 'editar') return fail('Escribe un número de moderación válido (sale en /mod historial).');
  return fail('Opción no válida.');
}

// ─── Tickets ───
async function findTicket(db, ref) {
  const id = digits(ref);
  if (Number.isSafeInteger(id)) return db.one('SELECT * FROM tickets WHERE id = $1', [id]);
  return null;
}
async function claimTicket(ctx, ref, rank) {
  if (!rank.staff) return fail('Solo el staff puede reclamar tickets.');
  const t = ref ? await findTicket(ctx.db, ref) : await ctx.db.one("SELECT * FROM tickets WHERE channel_id = $1 AND estado = 'abierto'", [ctx.channelId]);
  if (!t || t.estado !== 'abierto') return fail('No encontré ese ticket abierto.');
  if (t.claimed_by && t.claimed_by !== ctx.me.id) return fail(`Ese ticket ya lo atiende <@${t.claimed_by}>.`);
  await ctx.db.run('UPDATE tickets SET claimed_by = $1 WHERE id = $2', [ctx.me.id, t.id]);
  if (t.channel_id) await ctx.api('POST', `/channels/${t.channel_id}/messages`, { content: `🙋 <@${ctx.me.id}> atenderá este ticket, <@${t.owner_id}>.`, allowed_mentions: { users: [t.owner_id] } });
  await log(ctx, 'ticket reclamar', t.owner_id, `#${t.id}`);
  return ok(`Reclamaste el ticket #${t.id}.`);
}
async function closeTicket(ctx, ref, rank) {
  const t = ref ? await findTicket(ctx.db, ref) : await ctx.db.one("SELECT * FROM tickets WHERE channel_id = $1 AND estado = 'abierto'", [ctx.channelId]);
  if (!t || t.estado !== 'abierto') return fail('Usa este comando dentro del canal del ticket.');
  if (!rank.staff && t.owner_id !== ctx.me.id) return fail('Solo el staff o quien abrió el ticket pueden cerrarlo.');
  if (t.locked) return fail(`Este ticket está bloqueado${t.lock_reason ? `: ${t.lock_reason}` : ''}. Desbloquéalo con /desbloquear-ticket.`);
  await ctx.db.run("UPDATE tickets SET estado = 'cerrado', closed_at = $1 WHERE id = $2", [ctx.now(), t.id]);
  if (t.channel_id) {
    await ctx.api('POST', `/channels/${t.channel_id}/messages`, { content: `🔒 Ticket cerrado por <@${ctx.me.id}>. Este canal se borrará en 5 segundos.`, allowed_mentions: { parse: [] } });
    const ch = t.channel_id;
    (ctx.later || setTimeout)(() => { ctx.api('DELETE', `/channels/${ch}`).catch(() => {}); }, 5000);
  }
  await log(ctx, 'ticket cerrar', t.owner_id, `#${t.id}`);
  return ok(`Ticket #${t.id} cerrado.`);
}
async function openTicket(ctx, motivo) {
  const { db, me } = ctx;
  const open = await db.one("SELECT id, channel_id FROM tickets WHERE owner_id = $1 AND estado = 'abierto'", [me.id]);
  if (open) return fail(`Ya tienes un ticket abierto: <#${open.channel_id}>`);
  const t = await db.one('INSERT INTO tickets (owner_id, motivo, created_at) VALUES ($1, $2, $3) RETURNING id', [me.id, clip(motivo, 500), ctx.now()]);
  const here = await ctx.api('GET', `/channels/${ctx.channelId}`);
  const parent = here.ok ? here.data?.parent_id : null;
  const seers = [...new Set([...(await getCfg(db, 'roles', 'tickets')), ...(await getCfg(db, 'roles', 'staff')), ...(ctx.staffRoles || [])])];
  const allow = String(VIEW | SEND | HISTORY | ATTACH | EMBED);
  const ch = await ctx.api('POST', `/guilds/${ctx.guildId}/channels`, {
    name: `ticket-${String(t.id).padStart(4, '0')}`, type: 0, ...(parent ? { parent_id: parent } : {}), topic: clip(`Ticket de ${me.name}: ${motivo}`, 1000),
    permission_overwrites: [
      { id: ctx.guildId, type: 0, deny: String(VIEW) },
      { id: me.id, type: 1, allow },
      ...(ctx.botId ? [{ id: ctx.botId, type: 1, allow: String(VIEW | SEND | HISTORY | EMBED) }] : []),
      ...seers.map((r) => ({ id: r, type: 0, allow })),
    ],
  });
  if (!ch.ok) {
    await db.run('DELETE FROM tickets WHERE id = $1', [t.id]);
    return fail(ch.code === 50013 ? 'El bot no tiene permiso para crear canales (necesita "Gestionar canales").' : `No pude crear el ticket (error ${ch.status}).`);
  }
  await db.run('UPDATE tickets SET channel_id = $1 WHERE id = $2', [ch.data.id, t.id]);
  const img = await getCfg(db, 'imagen', 'tickets');
  await ctx.api('POST', `/channels/${ch.data.id}/messages`, {
    content: `<@${me.id}>${seers.length ? ` ${seers.map((r) => `<@&${r}>`).join(' ')}` : ''}`,
    allowed_mentions: { users: [me.id], roles: seers },
    embeds: [{ title: `🎫 Ticket #${t.id}`, color: COLOR.blue, description: `${await getCfg(db, 'texto', 'ticket_bienvenida')}\n\n**Motivo:** ${clip(motivo, 1000)}`, ...(isUrl(img) ? { thumbnail: { url: img } } : {}) }],
    components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Reclamar', emoji: { name: '🙋' }, custom_id: `t:claim:${t.id}` }, { type: 2, style: 4, label: 'Cerrar', emoji: { name: '🔒' }, custom_id: `t:close:${t.id}` }] }],
  });
  await log(ctx, 'ticket abrir', me.id, `#${t.id}: ${motivo}`);
  return ok(`Tu ticket: <#${ch.data.id}>`);
}

// ─── Servidor ───
async function server(ctx, sub, o, rank) {
  const { db, me } = ctx;
  if (!rank.staff) return fail('Solo el staff.');
  if (sub === 'cerrar') {
    await db.run("UPDATE server_sessions SET estado = 'cerrado' WHERE estado <> 'cerrado'", []);
    const img = await getCfg(db, 'imagen', 'servidor_cerrado');
    await post(ctx, 'servidor', { embeds: [{ title: '🔴 Servidor cerrado', color: COLOR.red, description: `El servidor de ${await getCfg(db, 'texto', 'nombre')} está cerrado. ¡Gracias por rolear!`, ...(isUrl(img) ? { image: { url: img } } : {}), footer: { text: `Cerrado por ${me.name}` } }] });
    await log(ctx, 'server cerrar', null, 'Servidor cerrado');
    return ok('Servidor cerrado y anunciado.');
  }
  const sv = Math.trunc(Number(o.staff_votos)); const pv = Math.trunc(Number(o.publico_votos));
  if (!(sv >= 0 && sv <= 50 && pv >= 0 && pv <= 200)) return fail('Votos no válidos (staff 0-50, público 0-200).');
  await db.run("UPDATE server_sessions SET estado = 'cerrado' WHERE estado = 'votando'", []);
  const s = await db.one('INSERT INTO server_sessions (staff_needed, public_needed, created_at) VALUES ($1, $2, $3) RETURNING id', [sv, pv, ctx.now()]);
  const r = await post(ctx, 'servidor', voteMessage({ id: s.id, staff_needed: sv, public_needed: pv }, 0, 0, await getCfg(db, 'texto', 'nombre')));
  if (!r) return fail('No pude publicar la votación (revisa /config canal servidor).');
  await db.run('UPDATE server_sessions SET channel_id = $1, message_id = $2 WHERE id = $3', [r.channelId, r.id, s.id]);
  if (sv === 0 && pv === 0) await openServer(ctx, { ...s, channel_id: r.channelId, message_id: r.id });
  await log(ctx, 'server abrir', null, `Votación: ${sv} staff, ${pv} público`);
  return ok('Votación de apertura publicada.');
}
function voteMessage(s, staffVotes, publicVotes, nombre) {
  const bar = (a, b) => `${a}/${b} ${b ? '▰'.repeat(Math.min(10, Math.round((a / b) * 10))) + '▱'.repeat(Math.max(0, 10 - Math.round((a / b) * 10))) : ''}`;
  return {
    embeds: [{ title: `🗳️ ¿Abrimos ${nombre}?`, color: COLOR.gold, description: 'Vota para abrir el servidor. Cuando se llegue a los votos necesarios se abrirá.', fields: [
      { name: '🛡️ Staff', value: bar(staffVotes, s.staff_needed), inline: true }, { name: '👥 Público', value: bar(publicVotes, s.public_needed), inline: true },
    ] }],
    components: [{ type: 1, components: [{ type: 2, style: 3, label: 'Votar', emoji: { name: '✅' }, custom_id: `srv:vote:${s.id}` }] }],
  };
}
async function openServer(ctx, s) {
  const { db } = ctx;
  await db.run("UPDATE server_sessions SET estado = 'abierto' WHERE id = $1", [s.id]);
  let code = await getCfg(db, 'texto', 'codigo_erlc');
  if (!code && ctx.erlc) { try { code = (await ctx.erlc.status()).codigo || ''; } catch { /* sin ER:LC */ } }
  const img = await getCfg(db, 'imagen', 'servidor_abierto');
  await ctx.api('POST', `/channels/${s.channel_id}/messages`, { allowed_mentions: { parse: [] }, embeds: [{ title: '🟢 ¡Servidor abierto!', color: COLOR.green, description: `${await getCfg(db, 'texto', 'nombre')} está abierto. ¡A rolear!${code ? `\n\n**Código:** \`${code}\`` : ''}`, ...(isUrl(img) ? { image: { url: img } } : {}) }] });
}

async function erlcCmd(ctx, sub, o, rank) {
  if (sub === 'set_key') {
    if (!rank.admin) return fail('Solo la administración.');
    const key = String(o.api_key || '').trim();
    if (!/^[\w-]{10,200}$/.test(key)) return fail('Esa llave no parece válida.');
    await setCfg(ctx.db, 'secreto', 'erlc_key', key);
    if (ctx.setErlcKey) ctx.setErlcKey(key);
    await log(ctx, 'erlc set_key', null, 'Llave de ER:LC cambiada');
    return ok('Llave de ER:LC guardada. Prueba con /erlc jugadores.');
  }
  if (!ctx.erlc) return fail('Falta la llave de ER:LC. La administración la pone con /erlc set_key.');
  if (sub === 'jugadores') {
    const s = await ctx.erlc.status();
    if (!s.encendido) return fail('El servidor de ER:LC está apagado.');
    const list = await ctx.erlc.players();
    return priv('', { embeds: [{ title: `🎮 ${s.nombre || 'ER:LC'} · ${s.jugadores}/${s.maximo}`, color: COLOR.green, description: clip(list.length ? list.map((p) => `• ${p.name}${p.team ? ` · ${p.team}` : ''}`).join('\n') : 'No hay nadie conectado.', 4000), footer: { text: s.codigo ? `Código: ${s.codigo}` : '' } }] });
  }
  if (!rank.admin) return fail('Solo la administración.');
  if (sub === 'comando') {
    await ctx.erlc.command(o.cmd);
    await log(ctx, 'erlc comando', null, o.cmd);
    return ok(`Comando enviado: \`${clip(o.cmd, 150)}\``);
  }
  const kind = sub === 'kills' ? 'kills' : 'entradas';
  const rows = (await ctx.erlc.logs(kind)).slice(-15).reverse();
  if (!rows.length) return fail('No hay registros recientes.');
  const line = (r) => (kind === 'kills'
    ? `${hace((r.Timestamp || 0) * 1000)} **${String(r.Killer || '').split(':')[0]}** ➜ ${String(r.Killed || '').split(':')[0]}`
    : `${hace((r.Timestamp || 0) * 1000)} ${r.Join ? '🟢 entró' : '🔴 salió'} **${String(r.Player || '').split(':')[0]}**`);
  return priv('', { embeds: [{ title: kind === 'kills' ? '💀 Kills recientes' : '📜 Entradas y salidas', color: COLOR.gray, description: clip(rows.map(line).join('\n'), 4000) }] });
}

// ─── /config ───
async function config(ctx, sub, o, rank) {
  const { db } = ctx;
  if (!rank.admin) return fail('Solo la administración.');
  const label = (tipo, clave) => CONFIG[tipo]?.[clave];
  if (sub === 'ver') {
    const cats = o.categoria ? [{ roles: ['rol', 'roles'], canales: ['canal'], imagenes: ['imagen'], textos: ['texto'] }[o.categoria]].flat() : Object.keys(CONFIG);
    const fields = [];
    for (const tipo of cats) {
      const lines = [];
      for (const clave of Object.keys(CONFIG[tipo])) {
        const v = await getCfg(db, tipo, clave);
        const shown = tipo === 'rol' ? (v ? `<@&${v}>` : '—') : tipo === 'roles' ? (v.length ? v.map((r) => `<@&${r}>`).join(' ') : '—') : tipo === 'canal' ? (v ? `<#${v}>` : '—') : (v ? clip(v, 60) : '—');
        lines.push(`\`${clave}\`: ${shown}`);
      }
      fields.push({ name: { rol: '🎭 Roles', roles: '👥 Listas de roles', canal: '📢 Canales', imagen: '🖼️ Imágenes', texto: '📝 Textos' }[tipo], value: clip(lines.join('\n'), 1024) });
    }
    return priv('', { embeds: [{ title: '⚙️ Configuración del bot', color: COLOR.blue, fields }] });
  }
  if (sub === 'resetear') {
    const [tipo, clave] = String(o.clave || '').split('.');
    if (!label(tipo, clave)) return fail('Esa opción no existe.');
    await db.run('DELETE FROM bot_config WHERE clave = $1', [`${tipo}.${clave}`]);
    await log(ctx, 'config resetear', null, o.clave);
    return ok(`\`${o.clave}\` vuelve a su valor por defecto.`);
  }
  const tipo = { rol: 'rol', roles: 'roles', canal: 'canal', imagen: 'imagen', texto: 'texto' }[sub];
  if (!tipo || !label(tipo, o.clave)) return fail('Esa opción no existe. Elige una de la lista.');
  if (tipo === 'roles') {
    const list = await getCfg(db, 'roles', o.clave);
    let next = list;
    if (o.accion === 'limpiar') next = [];
    else if (!o.rol) return fail('Elige el rol.');
    else if (o.accion === 'agregar') next = [...new Set([...list, String(o.rol)])];
    else if (o.accion === 'quitar') next = list.filter((r) => r !== String(o.rol));
    await setCfg(db, 'roles', o.clave, next);
    await log(ctx, 'config roles', null, `${o.clave}: ${o.accion}`);
    return ok(`Lista \`${o.clave}\`: ${next.length ? next.map((r) => `<@&${r}>`).join(' ') : 'vacía'}.`);
  }
  const value = tipo === 'rol' ? o.rol : tipo === 'canal' ? o.canal : tipo === 'imagen' ? o.url : o.valor;
  if (tipo === 'imagen' && !isUrl(value)) return fail('El enlace debe empezar con https://');
  await setCfg(db, tipo, o.clave, clip(value, 500));
  // Canales con botones: al configurarlos se publica el panel ahí mismo
  const PANEL = { tickets: 'tickets', verificacion: 'verificacion' };
  if (tipo === 'canal' && PANEL[o.clave]) {
    const body = panelMessage(o.clave, await getCfg(db, 'imagen', 'tickets'));
    const r = await ctx.api('POST', `/channels/${value}/messages`, { allowed_mentions: { parse: [] }, ...body });
    await log(ctx, 'config canal', null, `${o.clave} = <#${value}>`);
    return r.ok ? ok(`Listo: publiqué los botones de **${o.clave}** en <#${value}>.`) : fail(`Guardé el canal, pero no pude escribir en <#${value}> (revisa los permisos del bot).`);
  }
  await log(ctx, `config ${tipo}`, null, `${o.clave} = ${clip(value, 80)}`);
  const shown = tipo === 'rol' ? `<@&${value}>` : tipo === 'canal' ? `<#${value}>` : `\`${clip(value, 80)}\``;
  return ok(`\`${o.clave}\` ahora es ${shown}.`);
}

// ─── Botones, menús y ventanas ───
export async function runComponent(interaction, ctx) {
  const id = String(interaction.data?.custom_id || '');
  const { db, me } = ctx;
  const rank = await who(ctx);
  const field = (name) => {
    for (const row of interaction.data?.components || []) for (const c of row.components || []) if (c.custom_id === name) return String(c.value || '');
    return '';
  };
  try {
    // Verificación de Roblox (la misma cuenta vinculada de la web)
    if (id === 'v:user') {
      const found = await ctx.lookupRoblox(field('usuario').trim()).catch(() => null);
      if (!found) return fail('No encontré ese usuario de Roblox. Escribe tu usuario (no el nombre visible).');
      const code = makeCode();
      pending.set(me.id, { id: String(found.id), name: found.name, code, t: ctx.now() });
      return priv(`🔗 **Vincula tu cuenta @${found.name}**\n1. Pega este código en la **descripción ("Acerca de")** de tu perfil de Roblox y guárdala:\n\`\`\`${code}\`\`\`2. Vuelve y toca **Comprobar**.`, {
        components: [{ type: 1, components: [
          { type: 2, style: 5, label: 'Abrir mi perfil', url: `https://www.roblox.com/users/${found.id}/profile` },
          { type: 2, style: 3, label: 'Comprobar', custom_id: 'v:check' },
        ] }],
      });
    }
    if (id === 'v:check') {
      const p = pending.get(me.id);
      if (!p || ctx.now() - p.t > LINK_TTL) return fail('El código caducó. Usa /verificar otra vez.');
      const profile = await (ctx.fetchProfile || fetchRobloxProfile)(p.id).catch(() => null);
      if (!profile) return fail('Roblox no responde ahora. Intenta en un momento.');
      if (!hasCode(profile.description, p.code)) return fail('Todavía no veo el código en tu descripción. Guárdala y espera unos segundos.');
      pending.delete(me.id);
      await P.setRoblox(db, me, { id: p.id, name: p.name }, ctx.now(), { verified: true });
      const role = await getCfg(db, 'rol', 'verificado');
      if (role) await ctx.api('PUT', `/guilds/${ctx.guildId}/members/${me.id}/roles/${role}`, undefined, { reason: 'Verificado con Roblox' });
      await log(ctx, 'verificar', me.id, `Roblox ${p.name}`);
      return ok(`¡Cuenta verificada: **${p.name}**! Ya puedes borrar el código de tu descripción.${role ? ` Te di <@&${role}>.` : ''}`);
    }

    // Tickets
    if (id === 't:new') return await openTicket(ctx, field('motivo'));
    let m = /^t:(claim|close):(\d+)$/.exec(id);
    if (m) return await (m[1] === 'claim' ? claimTicket(ctx, m[2], rank) : closeTicket(ctx, m[2], rank));

    if (id === 'anon:m') return await anonPost(ctx, field('mensaje'), field('archivos').split(/\s+/).filter(Boolean));

    // Tienda
    if (id === 'shop:buy') {
      const item = await db.one('SELECT id, nombre, precio, role_id FROM shop_items WHERE id = $1 AND activo = 1', [Math.trunc(Number(interaction.data?.values?.[0]))]);
      if (!item) return fail('Ese artículo ya no está.');
      const inst = await db.tx(async (t) => {
        const r = await t.run('UPDATE accounts SET banco = banco - $1 WHERE discord_id = $2 AND banco >= $1', [item.precio, me.id]);
        if (!r.rowCount) throw new P.PanelError(400, (await t.one('SELECT 1 AS x FROM accounts WHERE discord_id = $1', [me.id])) ? 'No tienes suficiente en el banco.' : 'Necesitas DNI para comprar.');
        await t.run("INSERT INTO transactions (discord_id, kind, amount, note, created_at) VALUES ($1, 'compra', $2, $3, $4)", [me.id, -item.precio, `Tienda: ${item.nombre}`, ctx.now()]);
        return t.one('INSERT INTO inventory (discord_id, item_id, nombre, created_at) VALUES ($1, $2, $3, $4) RETURNING id', [me.id, item.id, item.nombre, ctx.now()]);
      });
      if (item.role_id) await ctx.api('PUT', `/guilds/${ctx.guildId}/members/${me.id}/roles/${item.role_id}`, undefined, { reason: `Compra: ${item.nombre}` });
      await log(ctx, 'compra', me.id, `${item.nombre} ${money(item.precio)}`);
      return ok(`Compraste **${item.nombre}** por ${money(item.precio)} (\`#${inst.id}\` en tu inventario).${item.role_id ? ` Te di <@&${item.role_id}>.` : ''}`);
    }

    // Bandas
    m = /^g:(ok|no):(\d+)$/.exec(id);
    if (m) {
      if (!rank.staff) return fail('Solo el staff.');
      const g = await db.one("SELECT id, nombre, leader_id FROM gangs WHERE id = $1 AND estado = 'pendiente'", [Number(m[2])]);
      if (!g) return fail('Esa propuesta ya fue revisada.');
      if (m[1] === 'ok') {
        if (await myGang(db, g.leader_id)) return fail('El líder ya está en otra banda.');
        await db.run("UPDATE gangs SET estado = 'activa' WHERE id = $1", [g.id]);
        await db.run('INSERT INTO gang_members (discord_id, gang_id, joined_at) VALUES ($1, $2, $3) ON CONFLICT (discord_id) DO UPDATE SET gang_id = EXCLUDED.gang_id', [g.leader_id, g.id, ctx.now()]);
      } else {
        await db.run("UPDATE gangs SET estado = 'rechazada', nombre = nombre || ' #' || id WHERE id = $1", [g.id]);
      }
      await editSource(ctx, interaction, `${m[1] === 'ok' ? '✅ Aprobada' : '❌ Rechazada'} por <@${me.id}>`);
      if (ctx.dm) await ctx.dm(g.leader_id, { content: `🏴 Tu banda **${g.nombre}** fue ${m[1] === 'ok' ? 'aprobada. ¡Invita a tu gente con /banda invitar!' : 'rechazada por el staff.'}` }).catch(() => {});
      await log(ctx, `banda ${m[1] === 'ok' ? 'aprobada' : 'rechazada'}`, g.leader_id, g.nombre);
      return ok(`Banda ${m[1] === 'ok' ? 'aprobada' : 'rechazada'}.`);
    }
    m = /^g:join:(\d+):(\d+)$/.exec(id);
    if (m) {
      if (m[2] !== me.id) return fail('Esta invitación no es para ti.');
      if (await myGang(db, me.id)) return fail('Ya estás en una banda.');
      const g = await db.one("SELECT id, nombre FROM gangs WHERE id = $1 AND estado = 'activa'", [Number(m[1])]);
      if (!g) return fail('Esa banda ya no existe.');
      await db.run('INSERT INTO gang_members (discord_id, gang_id, joined_at) VALUES ($1, $2, $3) ON CONFLICT (discord_id) DO UPDATE SET gang_id = EXCLUDED.gang_id', [me.id, g.id, ctx.now()]);
      await editSource(ctx, interaction, `✅ <@${me.id}> se unió a **${g.nombre}**`);
      return ok(`¡Te uniste a **${g.nombre}**!`);
    }

    // Robos
    m = /^robm:(\w+)$/.exec(id);
    if (m) {
      const s = stash.get(m[1]);
      const r = await db.one('INSERT INTO robberies (discord_id, descripcion, evidencia, created_at) VALUES ($1, $2, $3, $4) RETURNING id', [me.id, clip(`${field('lugar')} · ${field('participantes')} · ${field('descripcion')}`, 1500), s?.evidencia || null, ctx.now()]);
      stash.delete(m[1]);
      const sent = await post(ctx, 'robos', {
        embeds: [{ title: `💰 Robo #${r.id} para aprobar`, color: COLOR.gold, fields: [
          { name: 'Quién', value: `<@${me.id}>`, inline: true }, { name: 'Lugar', value: clip(field('lugar'), 1024), inline: true },
          { name: 'Participantes', value: clip(field('participantes') || '—', 1024), inline: true }, { name: 'Qué pasó', value: clip(field('descripcion'), 1024) },
        ], ...(s?.evidencia ? { image: { url: s.evidencia } } : {}) }],
        components: [{ type: 1, components: [{ type: 2, style: 3, label: 'Aprobar', custom_id: `rob:ok:${r.id}` }, { type: 2, style: 4, label: 'Rechazar', custom_id: `rob:no:${r.id}` }] }],
      });
      return sent ? ok('Robo enviado al staff para aprobación.') : fail('No pude enviar el robo (revisa /config canal robos).');
    }
    m = /^rob:(no|amt):(\d+)$/.exec(id);
    if (m) {
      if (!rank.staff) return fail('Solo el staff.');
      const rob = await db.one("SELECT id, discord_id FROM robberies WHERE id = $1 AND estado = 'pendiente'", [Number(m[2])]);
      if (!rob) return fail('Ese robo ya fue revisado.');
      if (m[1] === 'no') {
        await db.run("UPDATE robberies SET estado = 'rechazado', staff_id = $1 WHERE id = $2", [me.id, rob.id]);
        await editSource(ctx, interaction, `❌ Rechazado por <@${me.id}>`);
        if (ctx.dm) await ctx.dm(rob.discord_id, { content: `💰 Tu robo #${rob.id} fue rechazado por el staff.` }).catch(() => {});
        return ok('Robo rechazado.');
      }
      const n = Math.trunc(Number(field('monto').replace(/[^\d]/g, '')));
      if (!Number.isSafeInteger(n) || n < 1 || n > 10_000_000) return fail('Pon un monto válido.');
      const a = await db.run('UPDATE accounts SET efectivo = efectivo + $1 WHERE discord_id = $2', [n, rob.discord_id]);
      if (!a.rowCount) return fail('Esa persona no tiene DNI (no puede recibir dinero).');
      await db.run("UPDATE robberies SET estado = 'aprobado', monto = $1, staff_id = $2 WHERE id = $3", [n, me.id, rob.id]);
      await db.run("INSERT INTO transactions (discord_id, kind, amount, note, created_at) VALUES ($1, 'robo', $2, 'Botín aprobado por el staff', $3)", [rob.discord_id, n, ctx.now()]);
      await editSource(ctx, interaction, `✅ Aprobado por <@${me.id}> · botín ${money(n)}`);
      if (ctx.dm) await ctx.dm(rob.discord_id, { content: `💰 Tu robo #${rob.id} fue aprobado. Recibiste ${money(n)} en efectivo.` }).catch(() => {});
      await log(ctx, 'robo aprobado', rob.discord_id, money(n));
      return ok(`Robo aprobado: ${money(n)} en efectivo para <@${rob.discord_id}>.`);
    }

    // Blacklist (Fundación)
    m = /^bl:m:(\w+)$/.exec(id);
    if (m) {
      if (!rank.owner && !(ctx.roles || []).includes(await getCfg(db, 'rol', 'fundacion'))) return fail('Solo la Fundación.');
      const s = stash.get(m[1]);
      stash.delete(m[1]);
      const sujeto = field('sujeto');
      const uid = (/\d{15,22}/.exec(sujeto) || [])[0];
      const r = await post(ctx, 'blacklist', { embeds: [{ title: '⛔ BLACKLIST OFICIAL', color: 0x111111, fields: [
        { name: 'Sujeto', value: clip(uid ? `<@${uid}> (${uid})` : sujeto, 1024), inline: true }, { name: 'Roblox', value: clip(field('roblox') || '—', 1024), inline: true },
        { name: 'Duración', value: clip(field('duracion') || 'Permanente', 1024), inline: true }, { name: 'Razón', value: clip(field('razon'), 1024) },
      ], ...(s?.evidencia ? { image: { url: s.evidencia } } : {}), footer: { text: `Emitida por ${me.name}` }, timestamp: new Date(ctx.now()).toISOString() }] });
      await log(ctx, 'blacklist', uid || null, `${sujeto}: ${field('razon')}`);
      return r ? ok('Blacklist publicada.') : fail('No pude publicarla (revisa /config canal blacklist).');
    }

    // Redes sociales
    m = /^soc:m:(\w+)$/.exec(id);
    if (m) {
      const s = stash.get(m[1]);
      stash.delete(m[1]);
      const link = field('enlace').trim();
      if (!isUrl(link)) return fail('El enlace debe empezar con https://');
      const r = await post(ctx, 'social', { content: link, embeds: [{ author: { name: me.name }, title: clip(field('titulo'), 256), url: link, color: COLOR.purple, description: clip(field('descripcion'), 1000) || undefined, ...(s?.imagen ? { image: { url: s.imagen } } : {}) }] });
      return r ? ok('Publicado en redes.') : fail('No pude publicarlo (revisa /config canal social).');
    }

    // Editar moderación
    m = /^mod:edit:(\d+)$/.exec(id);
    if (m) {
      if (!rank.staff) return fail('Solo el staff.');
      const tipo = field('tipo').trim().toLowerCase();
      if (tipo && !['verbal', 'warn', 'sancion'].includes(tipo)) return fail('El tipo debe ser verbal, warn o sancion.');
      const r = await db.run(`UPDATE moderations SET razon = $1, edited_at = $2${tipo ? ', tipo = $4' : ''} WHERE id = $3`, tipo ? [clip(field('razon'), 500), ctx.now(), Number(m[1]), tipo] : [clip(field('razon'), 500), ctx.now(), Number(m[1])]);
      if (r.rowCount) await log(ctx, 'mod editar', null, `#${m[1]}`);
      return r.rowCount ? ok(`Moderación #${m[1]} editada.`) : fail('Esa moderación no existe.');
    }

    // Votos para abrir el servidor
    m = /^srv:vote:(\d+)$/.exec(id);
    if (m) {
      const s = await db.one('SELECT * FROM server_sessions WHERE id = $1', [Number(m[1])]);
      if (!s || s.estado !== 'votando') return fail('Esta votación ya terminó.');
      try {
        await db.run('INSERT INTO server_votes (session_id, discord_id, staff) VALUES ($1, $2, $3)', [s.id, me.id, rank.staff ? 1 : 0]);
      } catch { return fail('Ya votaste.'); }
      const v = await db.one('SELECT SUM(staff) AS st, COUNT(*) - SUM(staff) AS pu FROM server_votes WHERE session_id = $1', [s.id]);
      const st = Number(v.st) || 0; const pu = Number(v.pu) || 0;
      if (s.channel_id && s.message_id) await ctx.api('PATCH', `/channels/${s.channel_id}/messages/${s.message_id}`, voteMessage(s, st, pu, await getCfg(db, 'texto', 'nombre')));
      if (st >= s.staff_needed && pu >= s.public_needed) await openServer(ctx, s);
      return ok('¡Voto registrado!');
    }
  } catch (err) {
    if (err instanceof P.PanelError) return fail(err.message);
    throw err;
  }
  return fail('Este botón es del sistema anterior y ya no funciona. Pide al staff que publique el panel nuevo con /panel.');
}

// Marca el mensaje del botón como revisado (sin botones)
export async function editSource(ctx, interaction, note) {
  const msg = interaction.message;
  if (!msg?.id || !interaction.channel_id) return;
  const embeds = (msg.embeds || []).map((e) => ({ ...e, footer: { text: note.replace(/<@\d+>/g, (x) => x) } }));
  await ctx.api('PATCH', `/channels/${interaction.channel_id}/messages/${msg.id}`, { content: msg.content ? `${msg.content}\n${note}` : note, embeds, components: [], allowed_mentions: { parse: [] } });
}

// /panel (nuevo, admin): publica los botones de tickets, verificación o anónimos
export function panelMessage(tipo, img) {
  if (tipo === 'tickets') return { embeds: [{ title: '🎫 Soporte de Panamá RP', color: COLOR.blue, description: '¿Necesitas ayuda del staff? Abre un ticket y te atendemos.', ...(isUrl(img) ? { image: { url: img } } : {}) }], components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Abrir ticket', emoji: { name: '🎫' }, custom_id: 't:open' }] }] };
  if (tipo === 'verificacion') return { embeds: [{ title: '🔗 Verificación', color: COLOR.green, description: 'Vincula tu cuenta de Roblox para tener acceso. Toca el botón y sigue los pasos.' }], components: [{ type: 1, components: [{ type: 2, style: 3, label: 'Verificarme', emoji: { name: '✅' }, custom_id: 'v:open' }] }] };
  if (tipo === 'anonimo') return { embeds: [{ title: '🕵️ Mensajes anónimos', color: COLOR.gray, description: 'Toca el botón para publicar un mensaje anónimo.' }], components: [{ type: 1, components: [{ type: 2, style: 2, label: 'Escribir mensaje anónimo', emoji: { name: '✉️' }, custom_id: 'anon:open' }] }] };
  return null;
}

// Tareas cada minuto: desbanear cuando se cumple el tiempo y quitar el rol de preso
export async function housekeeping(ctx) {
  const now = ctx.now();
  const bans = await ctx.db.query('SELECT discord_id FROM bans WHERE until_at IS NOT NULL AND until_at <= $1', [now]);
  for (const b of bans) {
    await ctx.api('DELETE', `/guilds/${ctx.guildId}/bans/${b.discord_id}`, undefined, { reason: 'Terminó el tiempo del ban' });
    await ctx.db.run('DELETE FROM bans WHERE discord_id = $1', [b.discord_id]);
  }
  const preso = await getCfg(ctx.db, 'rol', 'preso');
  const done = await ctx.db.query("SELECT id, discord_id FROM arrests WHERE tipo = 'arresto' AND released_at IS NULL AND created_at + minutos * 60000 <= $1", [now]);
  for (const a of done) {
    await ctx.db.run('UPDATE arrests SET released_at = $1 WHERE id = $2', [now, a.id]);
    if (preso) await ctx.api('DELETE', `/guilds/${ctx.guildId}/members/${a.discord_id}/roles/${preso}`, undefined, { reason: 'Cumplió su tiempo' });
  }
}
