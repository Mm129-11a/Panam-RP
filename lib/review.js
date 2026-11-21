// Revisión de solicitudes de whitelist desde Discord (botones Aceptar / Rechazar).
// Discord manda cada clic a /api/discord/interactions firmado con la clave pública de la app;
// aquí se verifica la firma y se decide qué responder. Lo que habla con la API de Discord
// (dar rol, mandar MD…) está en createDiscordBot, abajo.
import crypto from 'node:crypto';

// Permisos que pide el bot: ver canales, enviar mensajes, insertar enlaces, leer historial, gestionar roles.
export const BOT_PERMISSIONS = String(1024 + 2048 + 16384 + 65536 + 268435456);
const ADMINISTRATOR = 1n << 3n;
const MANAGE_ROLES = 1n << 28n;

export const COLORS = { accepted: 0x22c55e, rejected: 0xb91c1c };
const SNOWFLAKE = /^\d{5,25}$/;
const EPHEMERAL = 64;

// ─── Firma de Discord (Ed25519) ───
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
export function publicKeyFromHex(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex.trim())) return null;
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(hex.trim(), 'hex')]), format: 'der', type: 'spki' });
}

export function verifyInteraction({ key, signature, timestamp, body, now = Date.now() }) {
  if (!key || !Buffer.isBuffer(body)) return false;
  if (typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  if (typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false; // evita reenviar clics viejos
  try {
    return crypto.verify(null, Buffer.concat([Buffer.from(timestamp), body]), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

// ─── Botones ───
export function reviewComponents(applicantId) {
  return [{
    type: 1,
    components: [
      { type: 2, style: 3, label: 'Aceptar', emoji: { name: '✅' }, custom_id: `wl:ok:${applicantId}` },
      { type: 2, style: 4, label: 'Rechazar', emoji: { name: '✖️' }, custom_id: `wl:no:${applicantId}` },
    ],
  }];
}

function parseCustomId(id) {
  const m = /^wl:(ok|no|motivo):(\d{5,25})$/.exec(typeof id === 'string' ? id : '');
  return m ? { action: m[1], applicantId: m[2] } : null;
}

// Staff = tiene uno de los roles configurados, o es admin / puede gestionar roles.
export function isStaff(member, staffRoleIds = []) {
  if (!member || !Array.isArray(member.roles)) return false;
  let perms = 0n;
  try { perms = BigInt(member.permissions || '0'); } catch { perms = 0n; }
  if (perms & ADMINISTRATOR) return true;
  if (staffRoleIds.length) return member.roles.some((r) => staffRoleIds.includes(r));
  return Boolean(perms & MANAGE_ROLES);
}

const isReviewed = (message) => Boolean(message?.embeds?.[0]?.fields?.some((f) => f.name === 'Estado'));

function clip(text, max) {
  const t = String(text).replace(/@(everyone|here)/gi, '@​$1').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// Copia el embed original (sin los campos internos que añade Discord) y le pone el estado.
function reviewedEmbed(original, { color, estado }) {
  const e = original || {};
  const out = { title: e.title || 'Solicitud de whitelist', color };
  if (e.description) out.description = e.description;
  if (e.thumbnail?.url) out.thumbnail = { url: e.thumbnail.url };
  if (e.footer?.text) out.footer = { text: e.footer.text };
  if (e.timestamp) out.timestamp = e.timestamp;
  const fields = (Array.isArray(e.fields) ? e.fields : [])
    .filter((f) => f && f.name !== 'Estado')
    .slice(0, 24)
    .map((f) => ({ name: f.name, value: f.value, ...(f.inline ? { inline: true } : {}) }));
  out.fields = [{ name: 'Estado', value: estado }, ...fields];
  return out;
}

const ephemeral = (content) => ({ type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } });

function findInput(components, id) {
  for (const c of components || []) {
    if (c?.custom_id === id && typeof c.value === 'string') return c.value;
    const inner = findInput(c?.components || (c?.component ? [c.component] : []), id);
    if (inner !== null) return inner;
  }
  return null;
}

// Decide la respuesta a un clic. Devuelve { response, effect } — effect es lo que el servidor
// debe hacer después de responder (dar rol, avisar por MD).
export function decide(interaction, { staffRoleIds = [], now = Date.now() } = {}) {
  const t = interaction?.type;
  if (t === 1) return { response: { type: 1 } }; // PING de Discord al guardar la URL

  const parsed = parseCustomId(interaction?.data?.custom_id);
  if ((t !== 3 && t !== 5) || !parsed) return { response: ephemeral('Este botón ya no es válido.') };
  if (!interaction.guild_id || !interaction.member) return { response: ephemeral('Esto solo funciona dentro del servidor.') };
  if (!isStaff(interaction.member, staffRoleIds)) return { response: ephemeral('Solo el staff puede revisar solicitudes.') };
  if (isReviewed(interaction.message)) return { response: ephemeral('Esta solicitud ya fue revisada.') };

  const staff = interaction.member.user || {};
  const when = `<t:${Math.floor(now / 1000)}:R>`;
  const { action, applicantId } = parsed;
  const base = interaction.message?.embeds?.[0];

  if (t === 3 && action === 'no') {
    return {
      response: {
        type: 9,
        data: {
          custom_id: `wl:motivo:${applicantId}`,
          title: 'Rechazar solicitud',
          components: [{
            type: 1,
            components: [{
              type: 4, custom_id: 'motivo', style: 2, label: 'Motivo (se lo enviaremos por MD)',
              min_length: 3, max_length: 400, required: true,
              placeholder: 'Ej: respuestas muy cortas, no leyó la normativa…',
            }],
          }],
        },
      },
    };
  }

  if (t === 3 && action === 'ok') {
    return {
      response: {
        type: 7,
        data: {
          content: `Solicitud de <@${applicantId}> · ✅ Aceptada`,
          embeds: [reviewedEmbed(base, { color: COLORS.accepted, estado: `✅ **Aceptada** por <@${staff.id}> ${when}` })],
          components: [],
          allowed_mentions: { parse: [] },
        },
      },
      effect: { kind: 'accept', applicantId, guildId: interaction.guild_id, staffId: staff.id, staffName: staff.username || '' },
    };
  }

  if (t === 5 && action === 'motivo') {
    const motivo = clip(findInput(interaction.data.components, 'motivo') || '', 400);
    if (motivo.length < 3) return { response: ephemeral('Escribe un motivo.') };
    return {
      response: {
        type: 7,
        data: {
          content: `Solicitud de <@${applicantId}> · ❌ Rechazada`,
          embeds: [reviewedEmbed(base, { color: COLORS.rejected, estado: `❌ **Rechazada** por <@${staff.id}> ${when}\n**Motivo:** ${motivo}` })],
          components: [],
          allowed_mentions: { parse: [] },
        },
      },
      effect: { kind: 'reject', applicantId, guildId: interaction.guild_id, staffId: staff.id, staffName: staff.username || '', motivo },
    };
  }

  return { response: ephemeral('Este botón ya no es válido.') };
}

// Mensajes privados para la persona que hizo la solicitud.
export function decisionDm({ kind, motivo, siteUrl }) {
  if (kind === 'accept') {
    return {
      embeds: [{
        title: '✅ Tu whitelist fue aceptada',
        description: '¡Bienvenido a **Panamá RP**! Ya tienes acceso al servidor. Lee la normativa y nos vemos en la ciudad.',
        color: COLORS.accepted,
      }],
      allowed_mentions: { parse: [] },
    };
  }
  return {
    embeds: [{
      title: '❌ Tu whitelist fue rechazada',
      description: `**Motivo:** ${clip(motivo || 'Sin motivo.', 400)}\n\nPuedes volver a intentarlo en 24 horas${siteUrl ? ` en ${siteUrl}/solicitud` : ''}.`,
      color: COLORS.rejected,
    }],
    allowed_mentions: { parse: [] },
  };
}

// ─── Límites de Discord (429) ───
// Discord responde 429 cuando se hacen demasiadas peticiones. Si pide esperar poco, se espera y
// se reintenta; si es un bloqueo de Cloudflare a la IP del servidor, no sirve esperar aquí.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function readResponse(r) {
  const text = r.status === 204 ? '' : await r.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  const h = (k) => (typeof r.headers?.get === 'function' ? r.headers.get(k) : null);
  let limit = null;
  if (r.status === 429) {
    const wait = Number(data?.retry_after ?? h('retry-after'));
    limit = {
      retryAfter: Number.isFinite(wait) ? wait : null,
      global: Boolean(data?.global) || h('x-ratelimit-global') === 'true',
      scope: h('x-ratelimit-scope') || '',
      cloudflare: !data && /1015|cloudflare|banned|rate limited/i.test(text),
    };
  }
  return { ok: r.ok, status: r.status, code: data?.code ?? null, data, limit };
}

export function describeLimit(limit) {
  if (!limit) return '';
  if (limit.cloudflare) return 'Discord bloqueó temporalmente la IP del servidor (Cloudflare)';
  const parts = [limit.global ? 'límite global' : 'límite'];
  if (limit.scope) parts.push(`tipo ${limit.scope}`);
  if (limit.retryAfter !== null) parts.push(`esperar ${limit.retryAfter}s`);
  return parts.join(', ');
}

// Hace la petición con hasta 2 reintentos si Discord pide esperar 5 s o menos.
export async function discordRequest(fetchImpl, url, opts = {}) {
  for (let attempt = 1; ; attempt++) {
    let r;
    try {
      r = await fetchImpl(url, { ...opts, signal: AbortSignal.timeout(8000) });
    } catch (err) {
      return { ok: false, status: 0, code: null, data: null, limit: null, error: err.message };
    }
    const res = await readResponse(r);
    const wait = res.limit?.retryAfter;
    if (res.status === 429 && attempt < 3 && !res.limit.cloudflare && wait !== null && wait <= 5) {
      await sleep(Math.ceil(wait * 1000) + 150);
      continue;
    }
    return res;
  }
}

// Compara nombres de rol sin importar mayúsculas, tildes, emojis ni signos ("🪪 Ciudadano Registrado" = "ciudadano registrado.").
export function normRoleName(name) {
  return String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ').trim();
}
export function matchRole(roles, wanted) {
  const w = normRoleName(wanted);
  if (!w) return null;
  const exact = roles.filter((r) => normRoleName(r.name) === w);
  if (exact.length) return exact[0];
  const partial = roles.filter((r) => r.name !== '@everyone' && normRoleName(r.name).includes(w));
  return partial.length === 1 ? partial[0] : null; // solo si no hay duda
}

// ─── API de Discord con el token del bot ───
export const BOT_TOKEN_RE = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/;

export function createDiscordBot({ token, apiBase = 'https://discord.com/api/v10', fetchImpl = fetch }) {
  async function call(method, route, body, { reason, auth = true } = {}) {
    const headers = {};
    if (auth) headers.Authorization = `Bot ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(reason).slice(0, 500);
    return discordRequest(fetchImpl, `${apiBase}${route}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  const roleCache = new Map();
  return {
    call,
    postMessage: (channelId, payload) => call('POST', `/channels/${channelId}/messages`, payload),
    addRole: (guildId, userId, roleId, reason) => call('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, undefined, { reason }),
    async dm(userId, payload) {
      const ch = await call('POST', '/users/@me/channels', { recipient_id: userId });
      if (!ch.ok) return ch;
      return call('POST', `/channels/${ch.data.id}/messages`, payload);
    },
    followup: (appId, interactionToken, payload) => call('POST', `/webhooks/${appId}/${interactionToken}`, payload, { auth: false }),
    // Acepta IDs o nombres de rol ("Ciudadano"). Los nombres se buscan una vez y se guardan 10 min.
    async resolveRoles(guildId, list) {
      const wanted = list.map((x) => String(x).trim()).filter(Boolean);
      if (!wanted.length) return [];
      if (wanted.every((x) => SNOWFLAKE.test(x))) return wanted;
      let hit = roleCache.get(guildId);
      if (!hit || Date.now() > hit.until) {
        const r = await call('GET', `/guilds/${guildId}/roles`);
        if (!r.ok || !Array.isArray(r.data)) return wanted.filter((x) => SNOWFLAKE.test(x));
        hit = { roles: r.data, until: Date.now() + 10 * 60_000 };
        roleCache.set(guildId, hit);
      }
      return wanted.map((x) => (SNOWFLAKE.test(x) ? x : matchRole(hit.roles, x)?.id)).filter(Boolean);
    },
    // Todos los roles del servidor [{id, name}] (misma caché de 10 min)
    async guildRoles(guildId) {
      let hit = roleCache.get(guildId);
      if (!hit || Date.now() > hit.until) {
        const r = await call('GET', `/guilds/${guildId}/roles`);
        if (!r.ok || !Array.isArray(r.data)) return hit?.roles || [];
        hit = { roles: r.data, until: Date.now() + 10 * 60_000 };
        roleCache.set(guildId, hit);
      }
      return hit.roles.map((ro) => ({ id: ro.id, name: ro.name }));
    },
    // Nombres de los roles del servidor (para avisar cuando un nombre no coincide)
    roleNames: (guildId) => (roleCache.get(guildId)?.roles || []).filter((r) => r.name !== '@everyone').map((r) => r.name),
  };
}

// Discord exige que un bot se haya conectado al gateway al menos una vez antes de mandar mensajes.
// Se conecta, se identifica y se desconecta (no queda encendido).
export function touchGateway(token, { url = 'wss://gateway.discord.gg/?v=10&encoding=json', timeoutMs = 15_000 } = {}) {
  return new Promise((resolve) => {
    if (typeof WebSocket !== 'function') return resolve({ ok: false, reason: 'sin WebSocket' });
    let ws; let hb; let done = false;
    const finish = (ok, reason) => {
      if (done) return;
      done = true;
      clearInterval(hb); clearTimeout(timer);
      try { ws?.close(1000); } catch { /* ya cerrado */ }
      resolve({ ok, reason });
    };
    const timer = setTimeout(() => finish(false, 'tiempo agotado'), timeoutMs);
    try { ws = new WebSocket(url); } catch (err) { return finish(false, err.message); }
    ws.addEventListener('message', (ev) => {
      try { // un error aquí no debe tumbar el servidor
        const m = JSON.parse(ev.data);
        if (m.op === 10) {
          hb = setInterval(() => { try { ws.send(JSON.stringify({ op: 1, d: null })); } catch { /* cerrado */ } }, m.d?.heartbeat_interval || 40_000);
          ws.send(JSON.stringify({ op: 2, d: { token, intents: 0, properties: { os: 'linux', browser: 'panama-rp', device: 'panama-rp' } } }));
        } else if (m.op === 0 && m.t === 'READY') {
          finish(true);
        } else if (m.op === 9) {
          finish(false, 'sesión inválida');
        }
      } catch (err) {
        finish(false, err.message);
      }
    });
    ws.addEventListener('close', (ev) => finish(false, ev.code === 4004 ? 'token del bot inválido' : `cerrado (${ev.code})`));
    ws.addEventListener('error', () => finish(false, 'error de conexión'));
  });
}
