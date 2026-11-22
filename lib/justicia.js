// Denuncias y juicios de Panamá RP.
// Ciudadano denuncia (o la Policía manda un juicio) → los jueces aceptan o rechazan →
// si lo aceptan, lo toman un fiscal y un abogado (uno de cada, el primero que llega).
import { getCfg, who, log } from './oldbot.js';

export const JUSTICE_RE = /^(den|jz|cs):/;
const COLOR = { gold: 0xf5b942, green: 0x22c55e, red: 0xef4444, blue: 0x3a6af0, purple: 0x8b5cf6 };
const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const priv = (content, extra = {}) => ({ private: { content, ...extra } });
const fail = (m) => priv(`❌ ${m}`);
const ok = (m) => priv(`✅ ${m}`);

// Denuncias más comunes (botones)
export const DENUNCIAS = [
  ['robo', 'Robo', '💰'], ['agresion', 'Agresión', '👊'], ['amenazas', 'Amenazas', '⚠️'], ['estafa', 'Estafa', '🎭'],
  ['danos', 'Daños a la propiedad', '🏚️'], ['acoso', 'Acoso', '🚫'], ['vehiculo', 'Robo de vehículo', '🚗'], ['otra', 'Otra', '📝'],
];
const TIPO = Object.fromEntries(DENUNCIAS.map(([k, n]) => [k, n]));

export function denunciaButtons() {
  const btn = ([k, n, e]) => ({ type: 2, style: k === 'otra' ? 1 : 2, label: n, emoji: { name: e }, custom_id: `den:t:${k}` });
  return [
    { type: 1, components: DENUNCIAS.slice(0, 4).map(btn) },
    { type: 1, components: DENUNCIAS.slice(4).map(btn) },
  ];
}
export function denunciaPanel() {
  return {
    embeds: [{ title: '⚖️ Poner una denuncia', color: COLOR.blue, description: 'Elige qué quieres denunciar. Llenas un formulario corto y tu denuncia llega a los **jueces**.\nSi no está en la lista, toca **Otra**.' }],
    components: denunciaButtons(),
  };
}

const input = (custom_id, label, { style = 1, required = true, max = 200, placeholder } = {}) => ({
  type: 1, components: [{ type: 4, custom_id, label, style, required, max_length: max, ...(placeholder ? { placeholder } : {}) }],
});

// Juicios desde /arrestar usuario: se guarda lo del arresto para llenar la ventana
const arrests = new Map();
export function rememberArrest(id, data) {
  arrests.set(String(id), { ...data, t: Date.now() });
  for (const [k, x] of arrests) if (Date.now() - x.t > 6 * 3600_000) arrests.delete(k);
}
export const trialButton = (arrestId) => ({ type: 1, components: [{ type: 2, style: 1, label: 'Enviar a juicio', emoji: { name: '⚖️' }, custom_id: `jz:arr:${arrestId}` }] });

// Botones que abren ventana (tipo de denuncia, rechazar con motivo)
export function justiceModal(interaction) {
  const id = String(interaction.data?.custom_id || '');
  if (interaction.type !== 3) return null;
  const d = /^den:t:(\w+)$/.exec(id);
  if (d && TIPO[d[1]]) {
    const otra = d[1] === 'otra';
    return {
      custom_id: `den:m:${d[1]}`, title: clip(otra ? 'Denuncia' : `Denuncia: ${TIPO[d[1]]}`, 45),
      components: [
        ...(otra ? [input('tipo', 'Qué quieres denunciar', { max: 80 })] : []),
        input('denunciado', 'Nombre del denunciado', { max: 80, placeholder: 'Nombre del personaje (o "Desconocido")' }),
        input('denunciante', 'Tu nombre (quien denuncia)', { max: 80 }),
        input('hechos', otra ? 'Qué pasó (con lugar y hora)' : 'Qué pasó', { style: 2, max: 1500 }),
        ...(otra ? [] : [input('lugar', 'Lugar, fecha y hora', { max: 150 })]),
        input('pruebas', 'Pruebas (enlaces o testigos)', { style: 2, max: 800, required: false }),
      ],
    };
  }
  const arr = /^jz:arr:(\d+)$/.exec(id);
  if (arr) {
    const a = arrests.get(arr[1]) || {};
    const pre = (v, n) => (v ? { value: clip(v, n) } : {});
    return {
      custom_id: `jz:a:${arr[1]}`, title: `Enviar a juicio (arresto #${arr[1]})`,
      components: [
        { type: 1, components: [{ type: 4, custom_id: 'acusado', label: 'Nombre del acusado', style: 1, required: true, max_length: 80, ...pre(a.nombre, 80) }] },
        input('edad', 'Edad del acusado', { max: 3, placeholder: 'Ej: 25' }),
        { type: 1, components: [{ type: 4, custom_id: 'acusacion', label: 'De qué se le acusa', style: 1, required: true, max_length: 200, ...pre(a.razon, 200) }] },
        input('hechos', 'Hechos (qué pasó, lugar y hora)', { style: 2, max: 1500 }),
        { type: 1, components: [{ type: 4, custom_id: 'pruebas', label: 'Pruebas (enlaces, testigos, cámaras…)', style: 2, required: false, max_length: 800, ...pre(a.evidencia, 800) }] },
      ],
    };
  }
  const no = /^cs:no:(\d+)$/.exec(id);
  if (no) return { custom_id: `cs:nom:${no[1]}`, title: `Rechazar caso #${no[1]}`, components: [input('motivo', 'Motivo del rechazo', { style: 2, max: 500 })] };
  return null;
}

function caseEmbed(c, extra = {}) {
  const estado = { pendiente: '🕒 Esperando juez', aceptado: '⚖️ Aceptado por el juez', rechazado: '❌ Rechazado', listo: '✅ Listo para juicio' }[c.estado] || c.estado;
  return {
    title: `${c.origen === 'juicio' ? '🚔 Juicio' : '📝 Denuncia'} #${c.id} · ${c.tipo}`,
    color: c.estado === 'rechazado' ? COLOR.red : c.estado === 'listo' ? COLOR.green : c.estado === 'aceptado' ? COLOR.purple : COLOR.gold,
    fields: [
      { name: 'Acusado', value: clip(`${c.acusado}${c.acusado_id ? ` (<@${c.acusado_id}>)` : ''}`, 1024), inline: true },
      ...(c.edad ? [{ name: 'Edad', value: clip(c.edad, 10), inline: true }] : []),
      { name: c.origen === 'juicio' ? 'Oficial' : 'Denunciante', value: clip(`${c.denunciante || '—'} (<@${c.autor_id}>)`, 1024), inline: true },
      { name: 'Acusación', value: clip(c.acusacion, 1024) },
      ...(c.descripcion ? [{ name: 'Hechos', value: clip(c.descripcion, 1024) }] : []),
      ...(c.lugar ? [{ name: 'Lugar, fecha y hora', value: clip(c.lugar, 1024), inline: true }] : []),
      { name: 'Pruebas', value: clip(c.pruebas || '—', 1024) },
      { name: 'Juez', value: c.juez_id ? `<@${c.juez_id}>` : '—', inline: true },
      { name: 'Fiscal', value: c.fiscal_id ? `<@${c.fiscal_id}>` : '—', inline: true },
      { name: 'Abogado defensor', value: c.abogado_id ? `<@${c.abogado_id}>` : '—', inline: true },
      ...(c.motivo ? [{ name: 'Motivo del rechazo', value: clip(c.motivo, 1024) }] : []),
    ],
    footer: { text: estado },
    timestamp: new Date(Number(c.updated_at || c.created_at)).toISOString(),
    ...extra,
  };
}

const judgeButtons = (id) => [{ type: 1, components: [
  { type: 2, style: 3, label: 'Aceptar', emoji: { name: '⚖️' }, custom_id: `cs:ok:${id}` },
  { type: 2, style: 4, label: 'Rechazar', custom_id: `cs:no:${id}` },
] }];
const lawyerButtons = (c) => [{ type: 1, components: [
  { type: 2, style: 3, label: 'Aceptar caso', emoji: { name: '💼' }, custom_id: `cs:take:${c.id}`, disabled: Boolean(c.fiscal_id && c.abogado_id) },
  { type: 2, style: 2, label: 'Rechazar caso', custom_id: `cs:pass:${c.id}`, disabled: Boolean(c.fiscal_id && c.abogado_id) },
] }];

async function getCase(db, id) { return db.one('SELECT * FROM cases WHERE id = $1', [Number(id)]); }

// Crea el caso y lo manda al buzón de los jueces
async function fileCase(ctx, data) {
  const { db } = ctx;
  const channel = await getCfg(db, 'canal', 'jueces');
  if (!channel) return fail('Todavía no está configurado el buzón de los jueces. Avisa al staff (/config canal jueces).');
  const now = ctx.now();
  const row = await db.one(
    `INSERT INTO cases (origen, tipo, autor_id, denunciante, acusado, acusado_id, edad, acusacion, descripcion, pruebas, lugar, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING id`,
    [data.origen, data.tipo, ctx.me.id, data.denunciante, data.acusado, data.acusadoId || null, data.edad || null, data.acusacion, data.descripcion || null, data.pruebas || null, data.lugar || null, now],
  );
  const c = await getCase(db, row.id);
  const judges = await getCfg(db, 'roles', 'jueces');
  const r = await ctx.api('POST', `/channels/${channel}/messages`, {
    content: judges.length ? `${judges.map((x) => `<@&${x}>`).join(' ')} nuevo caso para revisar` : 'Nuevo caso para revisar',
    allowed_mentions: { roles: judges },
    embeds: [caseEmbed(c)],
    components: judgeButtons(c.id),
  });
  if (!r.ok) {
    await db.run('DELETE FROM cases WHERE id = $1', [c.id]);
    return fail('No pude mandarlo a los jueces (el bot no puede escribir en ese canal).');
  }
  await db.run('UPDATE cases SET juez_channel = $1, juez_msg = $2 WHERE id = $3', [channel, r.data.id, c.id]);
  await log(ctx, data.origen === 'juicio' ? 'juicio enviado' : 'denuncia', data.acusadoId || null, `#${c.id} ${data.tipo}: ${data.acusado}`);
  return ok(`${data.origen === 'juicio' ? `Juicio #${c.id} enviado` : `Denuncia #${c.id} enviada`} a los jueces. Te avisaremos por mensaje privado cuando lo revisen.`);
}

async function editCaseMessage(ctx, channel, msg, c, components) {
  if (!channel || !msg) return;
  await ctx.api('PATCH', `/channels/${channel}/messages/${msg}`, { embeds: [caseEmbed(c)], components, allowed_mentions: { parse: [] } });
}
const notify = (ctx, userId, content) => (ctx.dm && userId ? ctx.dm(userId, { content }).catch(() => {}) : null);

// Ventanas enviadas y botones
export async function runJustice(interaction, ctx) {
  const id = String(interaction.data?.custom_id || '');
  const { db, me } = ctx;
  const field = (name) => {
    for (const row of interaction.data?.components || []) for (const c of row.components || []) if (c.custom_id === name) return String(c.value || '').trim();
    return '';
  };

  // Denuncia de un ciudadano
  let m = /^den:m:(\w+)$/.exec(id);
  if (m) {
    const tipo = m[1] === 'otra' ? clip(field('tipo') || 'Otra', 80) : TIPO[m[1]] || 'Denuncia';
    if (field('denunciado').length < 2 || field('hechos').length < 10) return fail('Escribe el nombre del denunciado y cuenta qué pasó (al menos 10 letras).');
    return fileCase(ctx, {
      origen: 'denuncia', tipo, denunciante: clip(field('denunciante'), 80), acusado: clip(field('denunciado'), 80),
      acusacion: tipo, descripcion: clip(field('hechos'), 1500), lugar: clip(field('lugar'), 150), pruebas: clip(field('pruebas'), 800),
    });
  }

  // Juicio de la Policía (botón "Enviar a juicio" de /arrestar usuario)
  m = /^jz:a:(\d+)$/.exec(id);
  if (m) {
    const rank = await who(ctx);
    if (!rank.police) return fail('Solo la Policía (Policía Nacional, Aeronaval o Senafront) puede mandar juicios.');
    const arrest = await db.one('SELECT discord_id FROM arrests WHERE id = $1', [Number(m[1])]);
    if (await db.one("SELECT id FROM cases WHERE origen = 'juicio' AND acusado_id = $1 AND autor_id = $2 AND created_at > $3", [arrest?.discord_id || '-', me.id, ctx.now() - 60_000])) return fail('Ya mandaste este juicio.');
    const s = { acusadoId: arrest?.discord_id || null };
    const edad = field('edad').replace(/\D/g, '');
    if (!edad || Number(edad) < 1 || Number(edad) > 120) return fail('Pon la edad del acusado (solo números).');
    const c = await db.one('SELECT nombre, apellidos FROM characters WHERE discord_id = $1', [me.id]);
    return fileCase(ctx, {
      origen: 'juicio', tipo: clip(field('acusacion'), 80), denunciante: c ? `${c.nombre} ${c.apellidos}` : me.name,
      acusado: clip(field('acusado'), 80), acusadoId: s?.acusadoId || null, edad, acusacion: clip(field('acusacion'), 200),
      descripcion: clip(field('hechos'), 1500), pruebas: clip(field('pruebas'), 800),
    });
  }

  m = /^cs:(ok|nom|take|pass|as):(?:(fis|abo):)?(\d+)$/.exec(id);
  if (!m) return null;
  const [, action, role, caseId] = m;
  const rank = await who(ctx);
  const c = await getCase(db, caseId);
  if (!c) return fail('Ese caso ya no existe.');

  // Juez: aceptar
  if (action === 'ok') {
    if (!rank.judge) return fail('Solo los jueces pueden aceptar casos.');
    const r = await db.run("UPDATE cases SET estado = 'aceptado', juez_id = $1, updated_at = $2 WHERE id = $3 AND estado = 'pendiente'", [me.id, ctx.now(), c.id]);
    if (!r.rowCount) return fail('Otro juez ya revisó este caso.');
    const now = await getCase(db, c.id);
    await editCaseMessage(ctx, c.juez_channel, c.juez_msg, now, []);
    const channel = await getCfg(db, 'canal', 'abogados');
    const lawyers = await getCfg(db, 'roles', 'abogados');
    let sent = null;
    if (channel) {
      sent = await ctx.api('POST', `/channels/${channel}/messages`, {
        content: `${lawyers.map((x) => `<@&${x}>`).join(' ')} el juez <@${me.id}> aceptó un caso. Se necesita **un fiscal** y **un abogado defensor**.`,
        allowed_mentions: { roles: lawyers },
        embeds: [caseEmbed(now)],
        components: lawyerButtons(now),
      });
      if (sent.ok) await db.run('UPDATE cases SET abog_channel = $1, abog_msg = $2 WHERE id = $3', [channel, sent.data.id, c.id]);
    }
    notify(ctx, c.autor_id, `⚖️ Tu ${c.origen === 'juicio' ? 'juicio' : 'denuncia'} #${c.id} fue **aceptado** por un juez. Ahora lo tomarán un fiscal y un abogado.`);
    await log(ctx, 'caso aceptado', c.autor_id, `#${c.id}`);
    return ok(`Caso #${c.id} aceptado.${sent?.ok ? ' Ya se avisó a los abogados y fiscales.' : ' ⚠️ No hay canal de abogados configurado (/config canal abogados).'}`);
  }

  // Juez: rechazar con motivo
  if (action === 'nom') {
    if (!rank.judge) return fail('Solo los jueces pueden rechazar casos.');
    const motivo = clip(field('motivo'), 500) || 'Sin motivo';
    const r = await db.run("UPDATE cases SET estado = 'rechazado', juez_id = $1, motivo = $2, updated_at = $3 WHERE id = $4 AND estado = 'pendiente'", [me.id, motivo, ctx.now(), c.id]);
    if (!r.rowCount) return fail('Otro juez ya revisó este caso.');
    await editCaseMessage(ctx, c.juez_channel, c.juez_msg, await getCase(db, c.id), []);
    notify(ctx, c.autor_id, `❌ Tu ${c.origen === 'juicio' ? 'juicio' : 'denuncia'} #${c.id} fue **rechazado** por un juez.\n**Motivo:** ${motivo}`);
    await log(ctx, 'caso rechazado', c.autor_id, `#${c.id}: ${motivo}`);
    return ok(`Caso #${c.id} rechazado.`);
  }

  // Abogados y fiscales
  if (!rank.lawyer) return fail('Solo quienes tienen el rol de Abogados y fiscales.');
  if (c.estado !== 'aceptado') return fail(c.estado === 'listo' ? 'Este caso ya tiene fiscal y abogado.' : 'Este caso no está disponible.');
  if (action === 'pass') {
    await log(ctx, 'caso rechazado por abogado', null, `#${c.id}`);
    return ok(`No tomaste el caso #${c.id}. Otros abogados y fiscales todavía pueden aceptarlo.`);
  }
  if (action === 'take') {
    if (c.fiscal_id === me.id || c.abogado_id === me.id) return fail('Ya estás en este caso.');
    return priv(`💼 **Caso #${c.id}** · ¿Cuál es tu cargo?`, {
      components: [{ type: 1, components: [
        { type: 2, style: 1, label: c.fiscal_id ? 'Fiscal (ocupado)' : 'Soy fiscal', emoji: { name: '⚖️' }, custom_id: `cs:as:fis:${c.id}`, disabled: Boolean(c.fiscal_id) },
        { type: 2, style: 1, label: c.abogado_id ? 'Abogado (ocupado)' : 'Soy abogado defensor', emoji: { name: '🛡️' }, custom_id: `cs:as:abo:${c.id}`, disabled: Boolean(c.abogado_id) },
      ] }],
    });
  }
  if (action === 'as') {
    const col = role === 'fis' ? 'fiscal_id' : 'abogado_id';
    const other = role === 'fis' ? 'abogado_id' : 'fiscal_id';
    // atómico: solo entra si el puesto sigue libre (dos personas a la vez → solo una gana)
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
      if (now.juez_channel) {
        await ctx.api('POST', `/channels/${now.juez_channel}/messages`, {
          content: `✅ Caso #${now.id} listo: juez <@${now.juez_id}>, fiscal <@${now.fiscal_id}>, abogado <@${now.abogado_id}>.`,
          allowed_mentions: { users: [now.juez_id, now.fiscal_id, now.abogado_id] },
        });
      }
      for (const u of [now.autor_id, now.juez_id]) notify(ctx, u, `✅ El caso #${now.id} ya tiene fiscal (<@${now.fiscal_id}>) y abogado defensor (<@${now.abogado_id}>).`);
    }
    await editCaseMessage(ctx, now.abog_channel, now.abog_msg, now, lawyerButtons(now));
    await editCaseMessage(ctx, now.juez_channel, now.juez_msg, now, []);
    await log(ctx, role === 'fis' ? 'fiscal' : 'abogado', null, `#${now.id}`);
    return ok(`Entraste al caso #${now.id} como **${role === 'fis' ? 'fiscal' : 'abogado defensor'}**.`);
  }
  return null;
}
