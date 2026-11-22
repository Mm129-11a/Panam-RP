// Comandos de barra (/) del bot de Panamá RP. Usan la MISMA base de datos que el panel web:
// si tienes $4,000 en el bot, tienes $4,000 en la web; un arresto hecho aquí sale en tu expediente.
import * as P from './panel.js';
import { OPTIONS } from './whitelist.js';
import { hasPolice, paysFor } from './jobs.js';

const T = { SUB: 1, STRING: 3, INTEGER: 4, USER: 6 };
const opt = (type, name, description, extra = {}) => ({ type, name, description, ...extra });

export function buildCommands(jobs) {
  const jobChoices = Object.entries(jobs).map(([value, j]) => ({ name: j.name, value }));
  return [
    { name: 'cedula', description: 'Muestra tu cédula (la Policía puede ver la de otra persona)', options: [opt(T.USER, 'usuario', 'De quién (solo Policía)')] },
    {
      name: 'crear-cedula', description: 'Crea tu cédula (usa tu cuenta de Roblox vinculada)',
      options: [
        opt(T.STRING, 'nombre', 'Nombre de tu personaje', { required: true, max_length: 40 }),
        opt(T.STRING, 'apellidos', 'Apellidos de tu personaje', { required: true, max_length: 40 }),
        opt(T.STRING, 'nacimiento', 'Fecha de nacimiento (DD/MM/AAAA)', { required: true, max_length: 10 }),
        opt(T.STRING, 'sexo', 'Sexo', { required: true, choices: OPTIONS.genero.map((v) => ({ name: v, value: v })) }),
        opt(T.STRING, 'sangre', 'Tipo de sangre', { required: true, choices: OPTIONS.sangre.map((v) => ({ name: v, value: v })) }),
        opt(T.STRING, 'nacionalidad', 'Nacionalidad', { required: true, choices: OPTIONS.nacionalidad.map((v) => ({ name: v, value: v })) }),
      ],
    },
    {
      name: 'banco', description: 'Tu cuenta del banco (la misma de la web)',
      options: [
        opt(T.SUB, 'ver', 'Tu saldo en el banco y en efectivo'),
        opt(T.SUB, 'depositar', 'Pasa efectivo a tu cuenta del banco', { options: [opt(T.INTEGER, 'monto', 'Cuánto', { required: true, min_value: 1, max_value: P.MONEY.maxMove })] }),
        opt(T.SUB, 'retirar', 'Saca dinero del banco a efectivo', { options: [opt(T.INTEGER, 'monto', 'Cuánto', { required: true, min_value: 1, max_value: P.MONEY.maxMove })] }),
        opt(T.SUB, 'transferir', 'Envía dinero del banco a otra persona', {
          options: [opt(T.USER, 'usuario', 'A quién', { required: true }), opt(T.INTEGER, 'monto', 'Cuánto', { required: true, min_value: 1, max_value: P.MONEY.maxMove }), opt(T.STRING, 'nota', 'Motivo (opcional)', { max_length: 80 })],
        }),
      ],
    },
    { name: 'multas', description: 'Tus multas (pendientes y pagadas)' },
    { name: 'pagar', description: 'Paga una multa desde tu banco', options: [opt(T.INTEGER, 'multa', 'Número de la multa (sale en /multas)', { required: true, min_value: 1 })] },
    {
      name: 'turno', description: 'Tu turno de trabajo',
      options: [
        opt(T.SUB, 'iniciar', 'Empieza tu turno', { options: [opt(T.STRING, 'trabajo', 'Qué trabajo', { required: true, choices: jobChoices })] }),
        opt(T.SUB, 'terminar', 'Termina tu turno'),
        opt(T.SUB, 'estado', 'Cuánto llevas en tu turno'),
      ],
    },
    {
      name: 'policia', description: 'Herramientas de la Policía en turno (salen en el expediente web)',
      options: [
        opt(T.SUB, 'multar', 'Pone una multa (solo ATT)', {
          options: [opt(T.USER, 'usuario', 'A quién', { required: true }), opt(T.INTEGER, 'monto', 'Monto', { required: true, min_value: P.MONEY.fineMin, max_value: P.MONEY.fineMax }), opt(T.STRING, 'motivo', 'Motivo', { required: true, max_length: 200 })],
        }),
        opt(T.SUB, 'arrestar', 'Registra un arresto', {
          options: [opt(T.USER, 'usuario', 'A quién', { required: true }), opt(T.INTEGER, 'minutos', 'Tiempo en celda', { required: true, min_value: 1, max_value: P.ARREST_MAX_MIN }), opt(T.STRING, 'cargos', 'Cargos', { required: true, max_length: 300 })],
        }),
        opt(T.SUB, 'antecedentes', 'Multas y arrestos de una persona', { options: [opt(T.USER, 'usuario', 'De quién', { required: true })] }),
      ],
    },
    { name: 'servidor', description: 'Estado del servidor de ER:LC (jugadores y código)' },
  ];
}

// Compara los comandos registrados con los nuestros (para no registrarlos en cada arranque).
export function sameCommands(remote, local) {
  const norm = (list) => JSON.stringify((list || []).map((c) => ({ n: c.name, d: c.description, p: c.default_member_permissions ?? null, o: normOpts(c.options) })).sort((a, b) => a.n.localeCompare(b.n)));
  function normOpts(o) {
    return (o || []).map((x) => ({
      t: x.type, n: x.name, d: x.description, r: Boolean(x.required), min: x.min_value ?? null, max: x.max_value ?? null, ml: x.max_length ?? null,
      c: (x.choices || []).map((c) => `${c.name}=${c.value}`), o: normOpts(x.options),
    }));
  }
  return norm(remote) === norm(local);
}

// Lee las opciones del comando (incluye subcomandos).
export function readOptions(data) {
  let sub = null;
  let list = data?.options || [];
  if (list[0]?.type === T.SUB) { sub = list[0].name; list = list[0].options || []; }
  const o = Object.fromEntries(list.map((x) => [x.name, x.value]));
  return { sub, o, users: data?.resolved?.users || {} };
}

export function parseDate(text) {
  const t = String(text || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : t;
}

function cedulaEmbed(c, avatar, description, url) {
  return {
    title: '🪪 Cédula de identidad · Panamá RP', color: 0x3a6af0, url, description,
    ...(avatar ? { thumbnail: { url: avatar } } : {}),
    fields: [
      { name: 'Nombre', value: `${c.nombre} ${c.apellidos}`, inline: true },
      { name: 'N.º de cédula', value: `\`${c.cedula}\``, inline: true },
      { name: 'Nacimiento', value: `${c.nacimiento} (${ageOf(c.nacimiento)} años)`, inline: true },
      { name: 'Sexo', value: c.genero, inline: true },
      { name: 'Sangre', value: c.sangre, inline: true },
      { name: 'Nacionalidad', value: c.nacionalidad, inline: true },
      { name: 'Roblox', value: c.roblox_name, inline: true },
    ],
    footer: { text: 'Documento de rol (IC) · mírala completa en el panel' },
  };
}

const money = (n) => `$${Number(n || 0).toLocaleString('es-PA')}`;
const hm = (min) => `${Math.floor(min / 60)}h ${min % 60}m`;
const COLORS = { blue: 0x3a6af0, red: 0xe0262f, green: 0x22c55e, gold: 0xf5b942, gray: 0x6b7280 };
const priv = (content, embeds) => ({ private: { content, embeds: embeds || [] } });
const fail = (msg) => priv(`❌ ${msg}`);
const ageOf = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return ''; const n = new Date(); let a = n.getUTCFullYear() - +m[1]; if (n.getUTCMonth() + 1 < +m[2] || (n.getUTCMonth() + 1 === +m[2] && n.getUTCDate() < +m[3])) a--; return a; };

// ctx: { db, jobs (de la persona), JOBS, isCitizen, robloxAvatar(name), erlc, siteUrl, verifyInGame }
// Nombres de los comandos de esta web (los del bot viejo se dejan para el bot viejo)
export const COMMAND_NAMES = ['cedula', 'crear-cedula', 'banco', 'multas', 'pagar', 'turno', 'policia', 'servidor'];
export const COMMAND_LIST = '/crear-cedula, /cedula, /banco (ver, depositar, retirar, transferir), /multas, /pagar, /turno, /policia (multar, arrestar, antecedentes) y /servidor';

export async function handleCommand(interaction, ctx) {
  let name = interaction?.data?.name;
  const user = interaction?.member?.user || interaction?.user;
  if (!user?.id || !interaction.guild_id) return fail('Usa los comandos dentro del servidor de Panamá RP.');
  const { sub, o, users } = readOptions(interaction.data);
  // /banco depositar → depositar, /policia arrestar → arrestar (el resto del código usa esos nombres)
  if ((name === 'banco' && sub && sub !== 'ver') || (name === 'policia' && sub)) name = sub;
  const me = { id: user.id, name: user.global_name || user.username || '' };
  const panelUrl = `${ctx.siteUrl}/panel`;
  const isPolice = hasPolice(ctx.jobs);

  try {
    if (name === 'servidor') {
      if (!ctx.erlc) return fail('El servidor de ER:LC aún no está conectado (falta ERLC_API_KEY en Render).');
      const s = await ctx.erlc.status();
      if (!s.encendido) return { private: { content: '✅ Listo' }, public: { embeds: [{ title: '🔴 Servidor de ER:LC apagado', description: 'Ahora mismo no hay nadie en el servidor.', color: COLORS.gray }] } };
      return {
        private: { content: '✅ Listo' },
        public: { embeds: [{ title: `🟢 ${s.nombre || 'Panamá RP'}`, color: COLORS.green, fields: [
          { name: 'Jugadores', value: `${s.jugadores}/${s.maximo}`, inline: true },
          { name: 'Código', value: s.codigo ? `\`${s.codigo}\`` : '—', inline: true },
        ] }] },
      };
    }

    if (!ctx.isCitizen) return fail(`Necesitas la whitelist aceptada. Hazla en ${ctx.siteUrl}/solicitud`);
    const target = o.usuario ? { id: String(o.usuario), name: users[o.usuario]?.global_name || users[o.usuario]?.username || '' } : null;

    if (name === 'cedula') {
      const who = target && target.id !== me.id ? target : me;
      if (who !== me && !isPolice) return fail('Solo la Policía puede ver la cédula de otra persona.');
      const c = await P.getCharacter(ctx.db, who.id);
      if (!c) return fail(who === me ? `Aún no tienes cédula. Créala con /crear-cedula o en ${panelUrl}` : `<@${who.id}> no tiene cédula.`);
      const avatar = await ctx.robloxAvatar(c.roblox_name);
      const text = who === me ? `<@${me.id}> muestra su cédula.` : `<@${me.id}> revisó la cédula de <@${who.id}>.`;
      return { private: { content: '✅ Listo' }, public: { embeds: [cedulaEmbed(c, avatar, text, `${panelUrl}#perfil`)], allowed_mentions: { parse: [] } } };
    }

    if (name === 'crear-cedula') {
      if (await P.getCharacter(ctx.db, me.id)) return fail('Ya tienes cédula. Muéstrala con /cedula.');
      const roblox = ctx.robloxFor ? await ctx.robloxFor(me.id) : null;
      if (!roblox) return fail(`Primero vincula tu cuenta de Roblox en ${panelUrl} (Mi perfil → Vincular). Así sale tu avatar en la cédula.`);
      const c = await P.createCharacter(ctx.db, {
        user: me, roblox,
        input: { nombre: o.nombre, apellidos: o.apellidos, nacimiento: parseDate(o.nacimiento), genero: o.sexo, sangre: o.sangre, nacionalidad: o.nacionalidad },
      });
      const avatar = await ctx.robloxAvatar(c.roblox_name);
      return {
        private: { content: `✅ ¡Cédula creada! Tu número es **${c.cedula}**. También abriste tu cuenta del banco. Mírala en ${panelUrl}#perfil` },
        public: { embeds: [cedulaEmbed(c, avatar, `<@${me.id}> sacó su cédula.`, `${panelUrl}#perfil`)], allowed_mentions: { parse: [] } },
      };
    }

    if (name === 'banco') {
      const acc = await P.getAccount(ctx.db, me.id);
      if (!acc) return fail(`Aún no tienes cuenta. Crea tu cédula en ${panelUrl}`);
      const fines = (await P.listFines(ctx.db, me.id)).filter((f) => f.estado === 'pendiente');
      const pays = paysFor(await P.listSalaries(ctx.db), ctx.roles || [], ctx.guildRoles || []);
      return priv('', [{ title: '🏦 Tu cuenta', color: COLORS.green, fields: [
        { name: 'Banco', value: money(acc.banco), inline: true },
        { name: 'Efectivo', value: money(acc.efectivo), inline: true },
        { name: 'Multas pendientes', value: fines.length ? `${fines.length} · ${money(fines.reduce((a, f) => a + Number(f.monto), 0))}` : 'Ninguna', inline: true },
        ...(pays.length ? [{ name: '💼 Lo que ganas', value: pays.map((x) => `${x.icon} ${x.name}: **${x.monto < 0 ? '−' : '+'}${money(Math.abs(x.monto))}** cada ${x.cooldown_h} h`).join('\n').slice(0, 1024) }] : []),
      ], footer: { text: pays.length ? 'El sueldo se cobra con /cobrar-salario · Lo mismo que ves en el panel web' : 'Lo mismo que ves en el panel web' } }]);
    }

    if (name === 'depositar' || name === 'retirar') {
      const acc = await P.moveMoney(ctx.db, me.id, name, o.monto);
      return priv(`✅ ${name === 'depositar' ? 'Depositaste' : 'Retiraste'} ${money(o.monto)}. Banco: **${money(acc.banco)}** · Efectivo: **${money(acc.efectivo)}**`);
    }

    if (name === 'transferir') {
      if (target.id === me.id) return fail('No puedes transferirte a ti mismo.');
      const to = await P.getCharacter(ctx.db, target.id);
      if (!to) return fail(`<@${target.id}> no tiene cédula, así que no tiene cuenta.`);
      const r = await P.transfer(ctx.db, me.id, to.cedula, o.monto, o.nota);
      return priv(`✅ Enviaste ${money(o.monto)} a **${r.to}**. Tu banco: **${money(r.account.banco)}**`);
    }

    if (name === 'multas') {
      const fines = await P.listFines(ctx.db, me.id);
      if (!fines.length) return priv('👌 No tienes multas.');
      return priv('', [{ title: '🧾 Tus multas', color: COLORS.gold, description: fines.slice(0, 15).map((f) => `**#${f.id}** · ${money(f.monto)} · ${f.motivo} — ${f.estado === 'pendiente' ? '⏳ pendiente' : '✅ pagada'}`).join('\n'), footer: { text: 'Paga con /pagar multa:<número> o en el panel' } }]);
    }

    if (name === 'pagar') {
      const acc = await P.payFine(ctx.db, me.id, o.multa);
      return priv(`✅ Multa #${o.multa} pagada. Tu banco: **${money(acc.banco)}**`);
    }

    if (name === 'turno') {
      if (sub === 'iniciar') {
        await P.startShift(ctx.db, me.id, o.trabajo, { jobs: ctx.JOBS, allowed: ctx.jobs, verify: ctx.verifyInGame });
        const j = ctx.JOBS[o.trabajo];
        return { private: { content: `✅ Turno de **${j.name}** iniciado. Termínalo con \`/turno terminar\`.` }, public: { content: `${j.icon} <@${me.id}> entró en servicio como **${j.name}**.`, allowed_mentions: { parse: [] } } };
      }
      if (sub === 'terminar') {
        const r = await P.endShift(ctx.db, me.id, { jobs: ctx.JOBS });
        return priv(`⏹️ Turno de **${hm(r.minutes)}** como **${r.name}** terminado y registrado.`);
      }
      const s = await P.activeShift(ctx.db, me.id);
      if (!s) return priv('No tienes un turno abierto. Empieza con `/turno iniciar`.');
      const min = Math.floor((Date.now() - s.started_at) / 60000);
      return priv(`⏱️ Llevas **${hm(min)}** de turno como **${ctx.JOBS[s.job]?.name || s.job}**.`);
    }

    if (name === 'multar' || name === 'arrestar' || name === 'antecedentes') {
      // Multas: solo la ATT. Arrestos: la Policía. Antecedentes: las dos.
      const isAtt = ctx.jobs.includes('transito');
      if (name === 'multar' && !isAtt) return fail('Solo la ATT puede poner multas.');
      if (name === 'arrestar' && !isPolice) return fail('Necesitas el rol de Policía.');
      if (name === 'antecedentes' && !isPolice && !isAtt) return fail('Necesitas el rol de Policía o de ATT.');
      const c = await P.getCharacter(ctx.db, target.id);
      if (!c) return fail(`<@${target.id}> no tiene cédula.`);
      if (name === 'antecedentes') {
        await P.searchCitizens(ctx.db, me.id, c.cedula); // comprueba que estás en turno
        const [fines, arrests] = await Promise.all([P.listFines(ctx.db, target.id), P.listArrests(ctx.db, target.id)]);
        const pend = fines.filter((f) => f.estado === 'pendiente');
        return priv('', [{ title: `📋 Antecedentes de ${c.nombre} ${c.apellidos}`, color: COLORS.blue, fields: [
          { name: 'Cédula', value: `\`${c.cedula}\``, inline: true },
          { name: 'Multas pendientes', value: pend.length ? `${pend.length} · ${money(pend.reduce((a, f) => a + Number(f.monto), 0))}` : 'Ninguna', inline: true },
          { name: 'Arrestos', value: String(arrests.length), inline: true },
          ...(arrests.length ? [{ name: 'Últimos arrestos', value: arrests.slice(0, 5).map((a) => `• ${a.cargos} (${a.minutos} min)`).join('\n') }] : []),
        ] }]);
      }
      if (name === 'multar') {
        const f = await P.issueFine(ctx.db, me.id, { cedula: c.cedula, motivo: o.motivo, monto: o.monto });
        return {
          private: { content: `✅ Multa puesta a ${f.a}.` },
          public: { embeds: [{ title: '🚨 Multa', color: COLORS.gold, description: `<@${me.id}> multó a <@${target.id}>`, fields: [
            { name: 'Monto', value: money(f.monto), inline: true }, { name: 'Motivo', value: String(o.motivo).slice(0, 200), inline: true },
          ], footer: { text: 'Se paga con /pagar o en el panel web' } }], allowed_mentions: { users: [target.id] }, content: `<@${target.id}>` },
        };
      }
      const a = await P.registerArrest(ctx.db, me.id, { cedula: c.cedula, cargos: o.cargos, minutos: o.minutos });
      return {
        private: { content: `✅ Arresto registrado: ${a.a}.` },
        public: { embeds: [{ title: '🚔 Arresto', color: COLORS.red, description: `<@${me.id}> arrestó a <@${target.id}>`, fields: [
          { name: 'Tiempo', value: `${a.minutos} min`, inline: true }, { name: 'Cargos', value: String(o.cargos).slice(0, 300), inline: true },
        ] }], allowed_mentions: { users: [target.id] }, content: `<@${target.id}>` },
      };
    }

    return fail(`/${name} no es un comando de la web. Los de la web son: ${COMMAND_LIST}.`);
  } catch (err) {
    if (err instanceof P.PanelError) return fail(err.fields ? `${err.message} ${Object.values(err.fields).join(' ')}` : err.message);
    throw err;
  }
}
