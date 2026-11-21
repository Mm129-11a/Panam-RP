// Comandos de barra (/) del bot de Panamá RP. Usan la MISMA base de datos que el panel web:
// si tienes $4,000 en el bot, tienes $4,000 en la web; un arresto hecho aquí sale en tu expediente.
import * as P from './panel.js';

const T = { SUB: 1, STRING: 3, INTEGER: 4, USER: 6 };
const opt = (type, name, description, extra = {}) => ({ type, name, description, ...extra });

export function buildCommands(jobs) {
  const jobChoices = Object.entries(jobs).map(([value, j]) => ({ name: j.name, value }));
  return [
    { name: 'cedula', description: 'Muestra tu cédula (la Policía puede ver la de otra persona)', options: [opt(T.USER, 'usuario', 'De quién (solo Policía)')] },
    { name: 'banco', description: 'Tu saldo en el banco y en efectivo' },
    { name: 'depositar', description: 'Pasa efectivo a tu cuenta del banco', options: [opt(T.INTEGER, 'monto', 'Cuánto', { required: true, min_value: 1, max_value: P.MONEY.maxMove })] },
    { name: 'retirar', description: 'Saca dinero del banco a efectivo', options: [opt(T.INTEGER, 'monto', 'Cuánto', { required: true, min_value: 1, max_value: P.MONEY.maxMove })] },
    {
      name: 'transferir', description: 'Envía dinero del banco a otra persona',
      options: [opt(T.USER, 'usuario', 'A quién', { required: true }), opt(T.INTEGER, 'monto', 'Cuánto', { required: true, min_value: 1, max_value: P.MONEY.maxMove }), opt(T.STRING, 'nota', 'Motivo (opcional)', { max_length: 80 })],
    },
    { name: 'multas', description: 'Tus multas (pendientes y pagadas)' },
    { name: 'pagar', description: 'Paga una multa desde tu banco', options: [opt(T.INTEGER, 'multa', 'Número de la multa (sale en /multas)', { required: true, min_value: 1 })] },
    {
      name: 'turno', description: 'Tu turno de trabajo',
      options: [
        opt(T.SUB, 'iniciar', 'Empieza tu turno', { options: [opt(T.STRING, 'trabajo', 'Qué trabajo', { required: true, choices: jobChoices })] }),
        opt(T.SUB, 'terminar', 'Termina tu turno y cobra'),
        opt(T.SUB, 'estado', 'Cuánto llevas en tu turno'),
      ],
    },
    {
      name: 'multar', description: '(Policía en turno) Pone una multa',
      options: [opt(T.USER, 'usuario', 'A quién', { required: true }), opt(T.INTEGER, 'monto', 'Monto', { required: true, min_value: P.MONEY.fineMin, max_value: P.MONEY.fineMax }), opt(T.STRING, 'motivo', 'Motivo', { required: true, max_length: 200 })],
    },
    {
      name: 'arrestar', description: '(Policía en turno) Registra un arresto',
      options: [opt(T.USER, 'usuario', 'A quién', { required: true }), opt(T.INTEGER, 'minutos', 'Tiempo en celda', { required: true, min_value: 1, max_value: P.ARREST_MAX_MIN }), opt(T.STRING, 'cargos', 'Cargos', { required: true, max_length: 300 })],
    },
    { name: 'antecedentes', description: '(Policía en turno) Multas y arrestos de una persona', options: [opt(T.USER, 'usuario', 'De quién', { required: true })] },
    { name: 'servidor', description: 'Estado del servidor de ER:LC (jugadores y código)' },
  ];
}

// Compara los comandos registrados con los nuestros (para no registrarlos en cada arranque).
export function sameCommands(remote, local) {
  const norm = (list) => JSON.stringify((list || []).map((c) => ({ n: c.name, d: c.description, o: normOpts(c.options) })).sort((a, b) => a.n.localeCompare(b.n)));
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

const money = (n) => `$${Number(n || 0).toLocaleString('es-PA')}`;
const hm = (min) => `${Math.floor(min / 60)}h ${min % 60}m`;
const COLORS = { blue: 0x3a6af0, red: 0xe0262f, green: 0x22c55e, gold: 0xf5b942, gray: 0x6b7280 };
const priv = (content, embeds) => ({ private: { content, embeds: embeds || [] } });
const fail = (msg) => priv(`❌ ${msg}`);
const ageOf = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return ''; const n = new Date(); let a = n.getUTCFullYear() - +m[1]; if (n.getUTCMonth() + 1 < +m[2] || (n.getUTCMonth() + 1 === +m[2] && n.getUTCDate() < +m[3])) a--; return a; };

// ctx: { db, jobs (de la persona), JOBS, isCitizen, robloxAvatar(name), erlc, siteUrl, verifyInGame }
export async function handleCommand(interaction, ctx) {
  const name = interaction?.data?.name;
  const user = interaction?.member?.user || interaction?.user;
  if (!user?.id || !interaction.guild_id) return fail('Usa los comandos dentro del servidor de Panamá RP.');
  const { sub, o, users } = readOptions(interaction.data);
  const me = { id: user.id, name: user.global_name || user.username || '' };
  const panelUrl = `${ctx.siteUrl}/panel`;
  const isPolice = ctx.jobs.includes('policia');

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
      if (!c) return fail(who === me ? `Aún no tienes cédula. Créala en ${panelUrl}` : `<@${who.id}> no tiene cédula.`);
      const avatar = await ctx.robloxAvatar(c.roblox_name);
      return {
        private: { content: '✅ Listo' },
        public: { embeds: [{
          title: '🪪 Cédula de identidad · Panamá RP', color: COLORS.blue, ...(avatar ? { thumbnail: { url: avatar } } : {}),
          description: who === me ? `<@${me.id}> muestra su cédula.` : `<@${me.id}> revisó la cédula de <@${who.id}>.`,
          fields: [
            { name: 'Nombre', value: `${c.nombre} ${c.apellidos}`, inline: true },
            { name: 'N.º de cédula', value: `\`${c.cedula}\``, inline: true },
            { name: 'Nacimiento', value: `${c.nacimiento} (${ageOf(c.nacimiento)} años)`, inline: true },
            { name: 'Sexo', value: c.genero, inline: true },
            { name: 'Sangre', value: c.sangre, inline: true },
            { name: 'Nacionalidad', value: c.nacionalidad, inline: true },
            { name: 'Roblox', value: c.roblox_name, inline: true },
          ],
          footer: { text: 'Documento de rol (IC)' },
        }], allowed_mentions: { parse: [] } },
      };
    }

    if (name === 'banco') {
      const acc = await P.getAccount(ctx.db, me.id);
      if (!acc) return fail(`Aún no tienes cuenta. Crea tu cédula en ${panelUrl}`);
      const fines = (await P.listFines(ctx.db, me.id)).filter((f) => f.estado === 'pendiente');
      return priv('', [{ title: '🏦 Tu cuenta', color: COLORS.green, fields: [
        { name: 'Banco', value: money(acc.banco), inline: true },
        { name: 'Efectivo', value: money(acc.efectivo), inline: true },
        { name: 'Multas pendientes', value: fines.length ? `${fines.length} · ${money(fines.reduce((a, f) => a + Number(f.monto), 0))}` : 'Ninguna', inline: true },
      ], footer: { text: 'Lo mismo que ves en el panel web' } }]);
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
        return priv(r.tooShort ? `⏹️ Turno de ${r.minutes} min: muy corto para cobrar (mínimo 5).` : `⏹️ Turno de **${hm(r.minutes)}** terminado. Cobraste **${money(r.paid)}**${r.capped ? ' (tope de 4 h)' : ''}.`);
      }
      const s = await P.activeShift(ctx.db, me.id);
      if (!s) return priv('No tienes un turno abierto. Empieza con `/turno iniciar`.');
      const min = Math.floor((Date.now() - s.started_at) / 60000);
      return priv(`⏱️ Llevas **${hm(min)}** de turno como **${ctx.JOBS[s.job]?.name || s.job}**.`);
    }

    if (name === 'multar' || name === 'arrestar' || name === 'antecedentes') {
      if (!isPolice) return fail('Necesitas el rol de Policía.');
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

    return fail('Ese comando no existe.');
  } catch (err) {
    if (err instanceof P.PanelError) return fail(err.message);
    throw err;
  }
}
