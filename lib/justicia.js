// Denuncias y juicios de Panamá RP (se ponen desde el panel web).
// Ciudadano denuncia (o Abogados y fiscales crean un juicio) → les llega por DM a los jueces → uno acepta o rechaza →
// si acepta, les llega por DM a Abogados y fiscales → entra un fiscal y un abogado (uno de cada).
import { PanelError } from './panel.js';
import { getCfg, who, log } from './oldbot.js';

export const JUSTICE_RE = /^cs:/;
const COLOR = { gold: 0xf5b942, green: 0x22c55e, red: 0xef4444, purple: 0x8b5cf6 };
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const priv = (content, extra = {}) => ({ private: { content, ...extra } });
const fail = (m) => priv(`❌ ${m}`);
const ok = (m) => priv(`✅ ${m}`);

// Denuncias más comunes (botones del panel)
export const DENUNCIAS = [
  ['robo', 'Robo', '💰'], ['agresion', 'Agresión', '👊'], ['amenazas', 'Amenazas', '⚠️'], ['estafa', 'Estafa', '🎭'],
  ['danos', 'Daños a la propiedad', '🏚️'], ['acoso', 'Acoso', '🚫'], ['vehiculo', 'Robo de vehículo', '🚗'], ['otra', 'Otra', '📝'],
];
const TIPO = Object.fromEntries(DENUNCIAS.map(([k, n]) => [k, n]));

export function caseEmbed(c) {
  const estado = { pendiente: '🕒 Esperando juez', aceptado: '⚖️ Aceptado por el juez · buscando fiscal y abogado', rechazado: '❌ Rechazado', listo: '✅ Listo para juicio' }[c.estado] || c.estado;
  return {
    title: `${c.origen === 'juicio' ? '🚔 Juicio' : '📝 Denuncia'} #${c.id} · ${clip(c.tipo, 80)}`,
    color: c.estado === 'rechazado' ? COLOR.red : c.estado === 'listo' ? COLOR.green : c.estado === 'aceptado' ? COLOR.purple : COLOR.gold,
    fields: [
      { name: 'Acusado', value: clip(`${c.acusado}${c.acusado_id ? ` (<@${c.acusado_id}>)` : ''}`, 1024), inline: true },
      ...(c.edad ? [{ name: 'Edad', value: clip(c.edad, 10), inline: true }] : []),
      { name: c.origen === 'juicio' ? 'Presentado por' : 'Denunciante', value: clip(`${c.denunciante || '—'} (<@${c.autor_id}>)`, 1024), inline: true },
      { name: 'Acusación', value: clip(c.acusacion, 1024) },
      ...(c.descripcion ? [{ name: 'Hechos', value: clip(c.descripcion, 1024) }] : []),
      ...(c.lugar ? [{ name: 'Lugar, fecha y hora', value: clip(c.lugar, 1024), inline: true }] : []),
      { name: 'Pruebas', value: clip(c.pruebas || '—', 1024) },
      { name: 'Juez', value: c.juez_id ? `<@${c.juez_id}>` : '—', inline: true },
      { name: 'Fiscal', value: c.fiscal_id ? `<@${c.fiscal_id}>` : '—', inline: true },
      { name: 'Abogado defensor', value: c.abogado_id ? `<@${c.abogado_id}>` : '—', inline: true },
      ...(c.motivo ? [{ name: 'Motivo del rechazo', value: clip(c.motivo, 1024) }] : []),
    ],
    footer: { text: `Panamá RP · ${estado}` },
    timestamp: new Date(Number(c.updated_at || c.created_at)).toISOString(),
  };
}
const judgeButtons = (id) => [{ type: 1, components: [
  { type: 2, style: 3, label: 'Aceptar', emoji: { name: '⚖️' }, custom_id: `cs:ok:${id}` },
  { type: 2, style: 4, label: 'Rechazar', custom_id: `cs:no:${id}` },
] }];
const lawyerButtons = (c) => {
  const full = Boolean(c.fiscal_id && c.abogado_id) || c.estado !== 'aceptado';
  return [{ type: 1, components: [
    { type: 2, style: 3, label: 'Aceptar caso', emoji: { name: '💼' }, custom_id: `cs:take:${c.id}`, disabled: full },
    { type: 2, style: 2, label: 'Rechazar caso', custom_id: `cs:pass:${c.id}`, disabled: full },
  ] }];
};

async function getCase(db, id) { return db.one('SELECT * FROM cases WHERE id = $1', [Number(id)]); }

// Manda el caso por DM a todas las personas con esos roles y guarda los mensajes
async function sendDMs(env, c, kind, roleIds, components, intro, skip = []) {
  const people = (await env.membersWithRoles(roleIds)).filter((id) => !skip.includes(id));
  let sent = 0;
  for (const userId of people) {
    const r = await env.dm(userId, { content: intro, embeds: [caseEmbed(c)], components }).catch(() => null);
    if (!r?.ok || !r.data?.id) continue;
    sent += 1;
    await env.db.run(
      'INSERT INTO case_msgs (case_id, kind, user_id, channel_id, message_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (case_id, kind, user_id) DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id',
      [c.id, kind, userId, r.data.channel_id, r.data.id],
    );
  }
  return { people: people.length, sent };
}
// Actualiza todos los DMs de ese caso (para que nadie más pueda aceptar lo que ya se tomó)
async function refreshDMs(env, c, kind, components, { only = null, content } = {}) {
  const rows = only
    ? await env.db.query('SELECT channel_id, message_id FROM case_msgs WHERE case_id = $1 AND kind = $2 AND user_id = $3', [c.id, kind, only])
    : await env.db.query('SELECT channel_id, message_id FROM case_msgs WHERE case_id = $1 AND kind = $2', [c.id, kind]);
  for (const m of rows) await env.api('PATCH', `/channels/${m.channel_id}/messages/${m.message_id}`, { ...(content ? { content } : {}), embeds: [caseEmbed(c)], components }).catch(() => {});
}
const notify = (env, userId, content) => (userId ? env.dm(userId, { content }).catch(() => null) : null);

// ─── Desde el panel web ───
// env: { db, dm(userId, payload), api(method, route, body), membersWithRoles(roleIds), now() }
export async function submitCase(env, author, data) {
  const { db } = env;
  const origen = data.origen === 'juicio' ? 'juicio' : 'denuncia';
  const open = await db.one("SELECT COUNT(*) AS n FROM cases WHERE autor_id = $1 AND estado = 'pendiente'", [author.id]);
  if (Number(open?.n) >= 5) throw new PanelError(429, 'Ya tienes 5 casos esperando juez. Espera a que los revisen.');
  let tipo; let acusacion; let edad = null; let acusadoId = null;
  const errors = {};
  const acusado = clip(data.acusado, 80);
  const hechos = clip(data.hechos, 1500);
  if (acusado.length < 2) errors.acusado = 'Escribe el nombre.';
  if (hechos.length < 10) errors.hechos = 'Cuenta qué pasó (al menos 10 letras).';
  if (origen === 'denuncia') {
    if (!TIPO[data.tipo]) throw new PanelError(400, 'Elige el tipo de denuncia.');
    tipo = data.tipo === 'otra' ? clip(data.otro, 80) : TIPO[data.tipo];
    if (data.tipo === 'otra' && tipo.length < 3) errors.otro = 'Escribe qué quieres denunciar.';
    acusacion = tipo;
    if (clip(data.denunciante, 80).length < 2) errors.denunciante = 'Escribe tu nombre.';
  } else {
    acusacion = clip(data.acusacion, 200);
    tipo = clip(acusacion, 80);
    if (acusacion.length < 3) errors.acusacion = 'Escribe de qué se le acusa.';
    edad = String(data.edad ?? '').replace(/\D/g, '');
    if (!edad || Number(edad) < 1 || Number(edad) > 120) errors.edad = 'Edad del 1 al 120.';
    if (data.cedula) {
      const t = await db.one('SELECT discord_id FROM characters WHERE cedula = $1', [clip(data.cedula, 20).toUpperCase()]);
      if (!t) errors.cedula = 'No hay nadie con esa cédula.';
      else acusadoId = t.discord_id;
    }
  }
  if (Object.keys(errors).length) throw new PanelError(400, 'Revisa los campos marcados.', errors);

  const now = env.now();
  const row = await db.one(
    `INSERT INTO cases (origen, tipo, autor_id, denunciante, acusado, acusado_id, edad, acusacion, descripcion, pruebas, lugar, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING id`,
    [origen, tipo, author.id, clip(data.denunciante || author.name, 80), acusado, acusadoId, edad, acusacion, hechos, clip(data.pruebas, 800) || null, clip(data.lugar, 150) || null, now],
  );
  const c = await getCase(db, row.id);
  const judges = await getCfg(db, 'roles', 'jueces');
  const r = await sendDMs(env, c, 'juez', judges, judgeButtons(c.id), `⚖️ **Nuevo ${origen === 'juicio' ? 'juicio' : 'caso de denuncia'} para revisar.** Acepta o rechaza:`, [author.id]);
  if (!r.sent) {
    await db.run('DELETE FROM cases WHERE id = $1', [c.id]);
    throw new PanelError(503, r.people ? 'No pude mandarle el mensaje a ningún juez (tienen los DM cerrados).' : 'No encontré a nadie con el rol de Jueces.');
  }
  return { id: c.id, jueces: r.sent };
}

export async function listMyCases(db, userId) {
  return db.query(
    `SELECT id, origen, tipo, estado, acusado, motivo, juez_id, fiscal_id, abogado_id, created_at, updated_at
     FROM cases WHERE autor_id = $1 ORDER BY id DESC LIMIT 20`, [userId],
  );
}

// ─── Botones de los DM (jueces, abogados y fiscales) ───
export function justiceModal(interaction) {
  const id = String(interaction.data?.custom_id || '');
  const no = interaction.type === 3 && /^cs:no:(\d+)$/.exec(id);
  if (!no) return null;
  return { custom_id: `cs:nom:${no[1]}`, title: `Rechazar caso #${no[1]}`, components: [{ type: 1, components: [{ type: 4, custom_id: 'motivo', label: 'Motivo del rechazo', style: 2, required: true, max_length: 500 }] }] };
}

export async function runJustice(interaction, ctx) {
  const id = String(interaction.data?.custom_id || '');
  const { db, me } = ctx;
  const m = /^cs:(ok|nom|take|pass|as):(?:(fis|abo):)?(\d+)$/.exec(id);
  if (!m) return null;
  const [, action, role, caseId] = m;
  const field = (name) => {
    for (const row of interaction.data?.components || []) for (const c of row.components || []) if (c.custom_id === name) return String(c.value || '').trim();
    return '';
  };
  const rank = await who(ctx);
  const c = await getCase(db, caseId);
  if (!c) return fail('Ese caso ya no existe.');

  // Juez: aceptar → les llega a Abogados y fiscales por DM
  if (action === 'ok') {
    if (!rank.judge) return fail('Solo los jueces pueden aceptar casos.');
    const r = await db.run("UPDATE cases SET estado = 'aceptado', juez_id = $1, updated_at = $2 WHERE id = $3 AND estado = 'pendiente'", [me.id, ctx.now(), c.id]);
    if (!r.rowCount) return fail('Otro juez ya revisó este caso.');
    const now = await getCase(db, c.id);
    await refreshDMs(ctx, now, 'juez', []);
    const lawyers = await getCfg(db, 'roles', 'abogados');
    const sent = await sendDMs(ctx, now, 'abog', lawyers, lawyerButtons(now), `💼 **El juez <@${me.id}> aceptó un caso.** Se necesita un fiscal y un abogado defensor:`, [now.autor_id, me.id, now.acusado_id].filter(Boolean));
    notify(ctx, c.autor_id, `⚖️ Tu ${c.origen === 'juicio' ? 'juicio' : 'denuncia'} #${c.id} fue **aceptado** por un juez. Ahora lo tomarán un fiscal y un abogado.`);
    await log(ctx, 'caso aceptado', c.autor_id, `#${c.id}`);
    return ok(`Caso #${c.id} aceptado. Se les avisó por DM a ${sent.sent} abogado(s) y fiscal(es).`);
  }
  // Juez: rechazar con motivo
  if (action === 'nom') {
    if (!rank.judge) return fail('Solo los jueces pueden rechazar casos.');
    const motivo = clip(field('motivo'), 500) || 'Sin motivo';
    const r = await db.run("UPDATE cases SET estado = 'rechazado', juez_id = $1, motivo = $2, updated_at = $3 WHERE id = $4 AND estado = 'pendiente'", [me.id, motivo, ctx.now(), c.id]);
    if (!r.rowCount) return fail('Otro juez ya revisó este caso.');
    await refreshDMs(ctx, await getCase(db, c.id), 'juez', []);
    notify(ctx, c.autor_id, `❌ Tu ${c.origen === 'juicio' ? 'juicio' : 'denuncia'} #${c.id} fue **rechazado** por un juez.\n**Motivo:** ${motivo}`);
    await log(ctx, 'caso rechazado', c.autor_id, `#${c.id}: ${motivo}`);
    return ok(`Caso #${c.id} rechazado.`);
  }

  // Abogados y fiscales
  if (!rank.lawyer) return fail('Solo quienes tienen el rol de Abogados y fiscales.');
  if (c.estado !== 'aceptado') return fail(c.estado === 'listo' ? 'Este caso ya tiene fiscal y abogado.' : 'Este caso no está disponible.');
  if (action === 'pass') return ok(`No tomaste el caso #${c.id}. Otros abogados y fiscales todavía pueden aceptarlo.`);
  if (action === 'take') {
    if (c.fiscal_id === me.id || c.abogado_id === me.id) return fail('Ya estás en este caso.');
    return priv(`💼 **Caso #${c.id}** · ¿Cuál es tu cargo?`, {
      components: [{ type: 1, components: [
        { type: 2, style: 1, label: c.fiscal_id ? 'Fiscal (ocupado)' : 'Soy fiscal', emoji: { name: '⚖️' }, custom_id: `cs:as:fis:${c.id}`, disabled: Boolean(c.fiscal_id) },
        { type: 2, style: 1, label: c.abogado_id ? 'Abogado (ocupado)' : 'Soy abogado defensor', emoji: { name: '🛡️' }, custom_id: `cs:as:abo:${c.id}`, disabled: Boolean(c.abogado_id) },
      ] }],
    });
  }
  // Elegir cargo: atómico (si dos lo intentan a la vez, solo uno entra)
  const col = role === 'fis' ? 'fiscal_id' : 'abogado_id';
  const other = role === 'fis' ? 'abogado_id' : 'fiscal_id';
  const r = await db.run(`UPDATE cases SET ${col} = $1, updated_at = $2 WHERE id = $3 AND estado = 'aceptado' AND ${col} IS NULL AND (${other} IS NULL OR ${other} <> $1)`, [me.id, ctx.now(), c.id]);
  if (!r.rowCount) {
    const now = await getCase(db, c.id);
    if (now[other] === me.id) return fail('No puedes ser fiscal y abogado en el mismo caso.');
    return fail(role === 'fis' ? 'Ya hay un fiscal en este caso.' : 'Ya hay un abogado defensor en este caso.');
  }
  let now = await getCase(db, c.id);
  if (now.fiscal_id && now.abogado_id) {
    await db.run("UPDATE cases SET estado = 'listo', updated_at = $1 WHERE id = $2", [ctx.now(), c.id]);
    now = await getCase(db, c.id);
    const msg = `✅ El caso #${now.id} ya está listo: juez <@${now.juez_id}>, fiscal <@${now.fiscal_id}> y abogado defensor <@${now.abogado_id}>.`;
    for (const u of new Set([now.autor_id, now.juez_id, now.fiscal_id, now.abogado_id])) notify(ctx, u, msg);
  }
  await refreshDMs(ctx, now, 'abog', lawyerButtons(now));
  // al juez que aceptó el caso (solo a él) se le actualiza su mensaje
  const cargo = role === 'fis' ? 'fiscal' : 'abogado defensor';
  await refreshDMs(ctx, now, 'juez', [], {
    only: now.juez_id,
    content: now.estado === 'listo'
      ? `✅ **Caso #${now.id} listo:** fiscal <@${now.fiscal_id}> y abogado defensor <@${now.abogado_id}>.`
      : `🆕 <@${me.id}> aceptó el caso #${now.id} como **${cargo}**. Falta ${now.fiscal_id ? 'el abogado defensor' : 'el fiscal'}.`,
  });
  await log(ctx, role === 'fis' ? 'fiscal' : 'abogado', null, `#${now.id}`);
  return ok(`Entraste al caso #${now.id} como **${role === 'fis' ? 'fiscal' : 'abogado defensor'}**.`);
}
