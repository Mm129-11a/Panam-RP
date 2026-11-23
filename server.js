// Panamá Roleplay — servidor web
// Sirve la página, el inicio de sesión con Discord y los contadores en vivo.
import express from 'express';
import cookieSession from 'cookie-session';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  securityHeaders, rateLimit, methodGuard, isSameOrigin, safeEqual, clientIp,
} from './lib/security.js';
import {
  OPTIONS, publicSections, validateApplication, scoreApplication, buildWebhookPayload, ROBLOX_USER_RE, WEBHOOK_RE,
} from './lib/whitelist.js';
import {
  BOT_PERMISSIONS, BOT_TOKEN_RE, createDiscordBot, describeLimit, discordRequest, decide, decisionDm, publicKeyFromHex, reviewComponents, touchGateway, verifyInteraction,
} from './lib/review.js';
import { createRelayFetch, createSmartFetch } from './lib/relay.js';
import os from 'node:os';
import { connectPostgres, connectSqlite, migrate } from './lib/db.js';
import { configureJobs, jobsFor, publicJobs, SHIFT, hasPolice, jobPay, paysFor } from './lib/jobs.js';
import * as panel from './lib/panel.js';
import { buildCommands, COMMAND_LIST, COMMAND_NAMES, handleCommand, sameCommands } from './lib/commands.js';
import { startGateway } from './lib/gateway.js';
import * as market from './lib/market.js';
import { runOld, runComponent, housekeeping, getCfg as botCfg } from './lib/oldbot.js';
import { JUSTICE_RE, justiceModal, runJustice, submitCase, listMyCases, DENUNCIAS } from './lib/justicia.js';
import { mirrorOldCommand, ARREST_CHANNEL, ARREST_ROLE } from './lib/mirror.js';
import { createErlc } from './lib/erlc.js';
import { fetchRobloxProfile, hasCode, LINK_TTL, makeCode, robloxFromConnections } from './lib/robloxlink.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ─── Configuración ───
const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ORIGIN = new URL(BASE_URL).origin;
const HTTPS = ORIGIN.startsWith('https://');
const ON_RENDER = process.env.RENDER === 'true';
const IS_PROD = process.env.NODE_ENV === 'production' || ON_RENDER;
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `${BASE_URL}/auth/discord/callback`;
const INVITE_CODE = /^[A-Za-z0-9-]{2,32}$/.test(process.env.DISCORD_INVITE_CODE || '') ? process.env.DISCORD_INVITE_CODE : 'fgRGQPbJF3';
const GUILD_ID = /^\d{5,25}$/.test(process.env.DISCORD_GUILD_ID || '') ? process.env.DISCORD_GUILD_ID : '';
const API = 'https://discord.com/api/v10';
const OAUTH_MAX_AGE = 10 * 60 * 1000; // el intento de login caduca a los 10 minutos
// Canal de Discord donde llegan las solicitudes de whitelist (webhook del canal).
const WEBHOOK_URL = WEBHOOK_RE.test(process.env.WHITELIST_WEBHOOK_URL || '') ? process.env.WHITELIST_WEBHOOK_URL : '';
// Botones Aceptar/Rechazar: el bot de la misma app publica la solicitud y Discord nos avisa de cada clic.
const BOT_TOKEN_RAW = (process.env.DISCORD_BOT_TOKEN || '').trim();
const BOT_TOKEN = BOT_TOKEN_RE.test(BOT_TOKEN_RAW) ? BOT_TOKEN_RAW : '';
const PUBLIC_KEY = publicKeyFromHex(process.env.DISCORD_PUBLIC_KEY || '');
const WHITELIST_ROLE = (process.env.WHITELIST_ROLE || '').trim(); // nombre o ID del rol que se da al aceptar
const CHANNEL_ID = /^\d{5,25}$/.test(process.env.WHITELIST_CHANNEL_ID || '') ? process.env.WHITELIST_CHANNEL_ID : ''; // opcional
const STAFF_ROLES = (process.env.STAFF_ROLES || '').split(',').map((r) => r.trim()).filter(Boolean);
const RESUBMIT_WAIT = 24 * 60 * 60 * 1000;
const DATABASE_URL = process.env.DATABASE_URL || '';
const JOBS = configureJobs(process.env.JOB_ROLES || '');
// ER:LC: con la llave del servidor privado se ven los jugadores y se comprueba que estés dentro al iniciar turno
const ERLC_KEY = (process.env.ERLC_API_KEY || '').trim();
const ERLC_REQUIRE_INGAME = (process.env.ERLC_TURNO_EN_JUEGO || 'si').toLowerCase() !== 'no';
// Vincular Roblox con un código en el perfil (ROBLOX_VINCULAR=no para solo comprobar que el usuario existe)
const ROBLOX_LINK_REQUIRED = (process.env.ROBLOX_VINCULAR || 'si').toLowerCase() !== 'no';
// Cómo llegan los comandos y botones: 'gateway' (por defecto: conexión permanente; el bot viejo sigue
// funcionando a la vez) o 'url' (Interactions Endpoint URL; el bot viejo deja de recibir sus comandos).
const DISCORD_MODE = /^url$/i.test(process.env.DISCORD_INTERACCIONES || '') ? 'url' : 'gateway';
const HOME_GUILD = GUILD_ID || '1560736880478130178'; // servidor de Discord de Panamá RP
// Puente a Discord (otro servicio en otra región) para cuando Discord bloquea la IP de Render.
const RELAY_URL = /^https?:\/\/[\w.-]+(:\d+)?$/.test((process.env.RELAY_URL || '').replace(/\/$/, '')) ? process.env.RELAY_URL.replace(/\/$/, '') : '';
const RELAY_SECRET = process.env.RELAY_SECRET || ''; // una solicitud cada 24 h por cuenta
// Páginas a las que se puede volver tras iniciar sesión (lista cerrada: evita redirecciones a otras webs).
const RETURN_PATHS = ['/', '/solicitud', '/panel'];

// Sin un secreto fuerte cualquiera podría falsificar sesiones: en producción no arranca.
if (IS_PROD && SESSION_SECRET.length < 32) {
  console.error('ERROR: falta SESSION_SECRET (mínimo 32 caracteres). El servidor no arranca sin él.');
  process.exit(1);
}

app.disable('x-powered-by');
app.set('trust proxy', 1);

// ─── Protecciones generales ───
const ipSourcesSeen = new Set();
const ipOf = (req) => {
  const { ip, source } = clientIp(req, { behindRender: ON_RENDER });
  if (!ipSourcesSeen.has(source)) { ipSourcesSeen.add(source); console.log(`[seguridad] IP del visitante tomada de: ${source}`); }
  return ip;
};
app.use(securityHeaders({ https: HTTPS }));
const PANEL_POSTS = ['/cedula', '/banco/mover', '/banco/transferir', '/multas/pagar', '/turno/iniciar', '/turno/terminar', '/policia/multa', '/policia/arresto', '/tienda/comprar', '/justicia/denuncia', '/justicia/juicio', '/admin/catalogo/guardar', '/admin/catalogo/quitar'];
app.use(methodGuard(['/logout', '/api/solicitud', '/api/discord/interactions', '/api/roblox/vincular', '/api/roblox/comprobar', ...PANEL_POSTS.map((p) => `/api/panel${p}`)]));
app.use(rateLimit({ windowMs: 60_000, max: 300, keyFn: ipOf }));

const authLimit = rateLimit({
  windowMs: 10 * 60_000, max: 30, keyFn: ipOf,
  message: 'Demasiados intentos de inicio de sesión. Espera unos minutos.',
});
const apiLimit = rateLimit({ windowMs: 60_000, max: 60, keyFn: ipOf });
const robloxLimit = rateLimit({ windowMs: 60_000, max: 30, keyFn: ipOf, message: 'Demasiadas búsquedas. Espera un minuto.' });
const submitLimit = rateLimit({ windowMs: 60 * 60_000, max: 10, keyFn: ipOf, message: 'Demasiados envíos. Intenta más tarde.' });
const noStore = (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); };

// ─── Sesión (cookie firmada) ───
// __Host- impide que otro subdominio la sobrescriba; httpOnly impide leerla desde JavaScript.
app.use(cookieSession({
  name: HTTPS ? '__Host-prp' : 'prp_session',
  keys: [SESSION_SECRET || 'solo-para-desarrollo-local'],
  httpOnly: true,
  secure: HTTPS,
  sameSite: 'lax',
  path: '/',
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 días
}));

const loginConfigured = () => Boolean(CLIENT_ID && CLIENT_SECRET);
const relay = RELAY_URL && RELAY_SECRET.length >= 32 ? createRelayFetch({ relayUrl: RELAY_URL, secret: RELAY_SECRET }) : null;
// Todas las llamadas a Discord pasan por aquí: directo y, si la IP está bloqueada, por el puente.
const dfetch = createSmartFetch({
  direct: fetch,
  relay,
  onBan: (min) => console.log(`[puente] Discord bloquea la IP principal: se usa el puente durante ${min} min`),
  onOdd: (info) => console.log(`[puente] 429 raro por la IP principal (por el puente sí entra): ${info}`),
});
const discordFetch = (url, opts = {}) => dfetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
const bot = BOT_TOKEN ? createDiscordBot({ token: BOT_TOKEN, apiBase: API, fetchImpl: dfetch }) : null;
// La llave de ER:LC viene de Render (ERLC_API_KEY) o de /erlc set_key (guardada en la base de datos)
let erlc = ERLC_KEY ? createErlc({ key: ERLC_KEY }) : null;
function setErlcKey(key) { erlc = key ? createErlc({ key }) : null; }

// Antes de iniciar un turno: si hay llave de ER:LC, la persona debe estar dentro del servidor.
async function verifyInGame(character) {
  if (!erlc || !ERLC_REQUIRE_INGAME) return;
  let inside;
  try {
    inside = await erlc.isInServer({ id: character.roblox_id, name: character.roblox_name });
  } catch (err) {
    console.error('[erlc]', err.message); // si la API de ER:LC falla, no se bloquea a nadie
    return;
  }
  if (!inside) throw new panel.PanelError(409, `Entra al servidor de ER:LC con tu cuenta (${character.roblox_name}) para iniciar el turno.`);
}

// Estado del servidor de ER:LC sin hacer esperar a nadie (máx. 1,5 s)
async function erlcStatus() {
  if (!erlc) return null;
  return Promise.race([erlc.status().catch(() => null), new Promise((r) => setTimeout(() => r(null), 1500))]);
}

// ─── Inicio de sesión con Discord ───
app.get('/auth/discord', authLimit, noStore, (req, res) => {
  const next = RETURN_PATHS.includes(req.query.next) ? req.query.next : '/';
  if (!loginConfigured()) return res.redirect(`${next}?login=noconfig`);
  // ?para=roblox: ya con sesión, pide ver las conexiones de Discord para vincular Roblox en un toque
  const kind = req.query.para === 'roblox' && req.session.user ? 'roblox' : 'login';
  if (req.session.user && kind === 'login') return res.redirect(next);
  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauth = { state, t: Date.now(), next, kind };
  const params = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: kind === 'roblox' ? 'identify connections' : (GUILD_ID ? 'identify guilds' : 'identify'), state, prompt: 'none',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', authLimit, noStore, async (req, res) => {
  const { code, state, error } = req.query;
  const saved = req.session.oauth;
  req.session.oauth = null; // un intento de login solo se puede usar una vez
  const forRoblox = saved?.kind === 'roblox';
  const back = (result) => {
    const to = saved && RETURN_PATHS.includes(saved.next) ? saved.next : '/';
    res.redirect(forRoblox ? `${to}?roblox=${result}${to === '/panel' ? '#perfil' : ''}` : `${to}?login=${result}`);
  };

  if (error || typeof code !== 'string' || !code || code.length > 256) return back('cancel');
  if (!saved || typeof saved.state !== 'string' || Date.now() - Number(saved.t) > OAUTH_MAX_AGE
      || !safeEqual(typeof state === 'string' ? state : '', saved.state)) {
    return back('error');
  }

  try {
    const tokenRes = await discordFetch(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code',
        code, redirect_uri: REDIRECT_URI,
      }),
    });
    if (tokenRes.status === 429) { console.error('[login] token 429'); return back('busy'); }
    if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
    const { access_token } = await tokenRes.json();
    if (typeof access_token !== 'string') throw new Error('token inválido');
    const auth = { headers: { Authorization: `Bearer ${access_token}` } };

    const userRes = await discordFetch(`${API}/users/@me`, auth);
    if (!userRes.ok) throw new Error(`user ${userRes.status}`);
    const u = await userRes.json();
    if (!/^\d{5,25}$/.test(String(u.id))) throw new Error('usuario inválido');

    if (forRoblox) {
      // Vincular Roblox con la cuenta conectada en Discord (tiene que ser la misma cuenta de Discord)
      if (!req.session.user || String(u.id) !== req.session.user.id) return back('otra');
      const cRes = await discordFetch(`${API}/users/@me/connections`, auth);
      const found = robloxFromConnections(cRes.ok ? await cRes.json() : null);
      if (!found) return back('none');
      const profile = await fetchRobloxProfile(found.id).catch(() => null);
      const name = profile?.name || found.name;
      if (!ROBLOX_USER_RE.test(name)) return back('none');
      const pic = await lookupRoblox(name).catch(() => null);
      const roblox = { id: found.id, name, avatar: pic && String(pic.id) === found.id ? pic.avatar || null : null };
      req.session.rbxVerified = { ...roblox, t: Date.now() };
      req.session.rbxLink = null;
      const store = await getDb();
      if (store) await panel.setRoblox(store, req.session.user, roblox, Date.now(), { verified: true }).catch((e) => console.error('[db] vincular:', e.message));
      return back('ok');
    }

    if (GUILD_ID) {
      const guildsRes = await discordFetch(`${API}/users/@me/guilds`, auth);
      const guilds = guildsRes.ok ? await guildsRes.json() : [];
      if (!Array.isArray(guilds) || !guilds.some((g) => g && g.id === GUILD_ID)) return back('guild');
    }

    const avatar = /^(a_)?[0-9a-f]{32}$/.test(String(u.avatar || ''))
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;
    const name = String(u.global_name || u.username || 'Usuario').slice(0, 64);
    req.session.user = { id: String(u.id), name, username: String(u.username || '').slice(0, 64), avatar };
    back('ok');
  } catch (err) {
    console.error('[login]', err.message); // nunca se registran tokens ni secretos
    back('error');
  }
});

// Cerrar sesión: solo con POST desde nuestra propia web (evita que otra web te desconecte).
app.post('/logout', noStore, (req, res) => {
  if (!isSameOrigin(req, ORIGIN)) return res.status(403).type('text').send('Solicitud no permitida');
  req.session = null;
  res.status(204).end();
});
app.get('/logout', (req, res) => res.redirect('/'));

// ─── API ───
const sentRecently = (req) => Date.now() - Number(req.session?.submittedAt || 0) < RESUBMIT_WAIT;
// Solicitudes en cola: cuentan como enviadas mientras sigan en la cola o ya se hayan entregado.
// Si el servidor se reinició y la cola se perdió, se deja volver a enviar.
const deliveredFromQueue = new Set();
function queuedState(req) {
  const t = Number(req.session?.queuedAt || 0);
  const id = req.session?.user?.id;
  if (!t || !id || Date.now() - t >= RESUBMIT_WAIT) return null;
  if (queue.some((q) => q.applicantId === id)) return 'pendiente';
  return deliveredFromQueue.has(id) ? 'entregada' : 'perdida';
}
const recentlySubmitted = (req) => sentRecently(req) || ['pendiente', 'entregada'].includes(queuedState(req));
// Roles de una persona en el servidor de Discord (con el bot). Se guarda 1 min.
const memberCache = new Map();
async function memberInfo(userId) {
  if (!bot || !userId) return null;
  const hit = memberCache.get(userId);
  if (hit && Date.now() < hit.until) return hit.info;
  let info = null;
  const r = await bot.call('GET', `/guilds/${HOME_GUILD}/members/${userId}`);
  if (r.ok && Array.isArray(r.data?.roles)) info = { inGuild: true, roles: r.data.roles };
  else if (r.code === 10007) info = { inGuild: false, roles: [] };
  if (memberCache.size > 5000) memberCache.clear();
  if (info) memberCache.set(userId, { info, until: Date.now() + 60_000 });
  return info;
}

// ¿Ya tiene la whitelist? = tiene el rol WHITELIST_ROLE en Discord.
const wlCache = new Map(); // decisiones recientes del staff (para no esperar a la caché)
async function whitelistStatus(userId) {
  if (!bot || !WHITELIST_ROLE || !userId) return null;
  const forced = wlCache.get(userId);
  if (forced && Date.now() < forced.until) return forced.status;
  try {
    const [roleId] = await bot.resolveRoles(HOME_GUILD, [WHITELIST_ROLE]);
    const info = await memberInfo(userId);
    if (!roleId || !info) return null;
    if (!info.inGuild) return 'fuera_del_servidor';
    return info.roles.includes(roleId) ? 'aceptada' : 'sin_rol';
  } catch {
    return null;
  }
}

app.get('/api/me', apiLimit, noStore, async (req, res) => {
  const user = req.session?.user || null;
  const whitelist = user ? await whitelistStatus(user.id) : null;
  const linked = verifiedRoblox(req);
  res.json({ user, loginEnabled: loginConfigured(), submitted: recentlySubmitted(req), whitelist, robloxLinkRequired: ROBLOX_LINK_REQUIRED, roblox: linked });
});

// ─── Solicitud de whitelist ───
app.get('/api/solicitud/preguntas', apiLimit, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ sections: publicSections(), options: OPTIONS, receiving: Boolean(WEBHOOK_URL) });
});

// Busca el usuario en Roblox (desde el servidor; el navegador nunca habla con la API de Roblox).
const ROBLOX_IMG_RE = /^https:\/\/[a-z0-9-]+\.rbxcdn\.com\/[\w\-./%]+$/i;
async function robloxHeadshot(id) {
  try {
    const r = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=420x420&format=Png&isCircular=false`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const t = (await r.json())?.data?.[0];
    return t && t.state === 'Completed' && typeof t.imageUrl === 'string' && ROBLOX_IMG_RE.test(t.imageUrl) ? t.imageUrl : null;
  } catch {
    return null; // sin avatar se muestra la inicial; no impide verificar
  }
}
const robloxCache = new Map();
async function lookupRoblox(username) {
  const key = username.toLowerCase();
  const hit = robloxCache.get(key);
  if (hit && Date.now() < hit.until) return hit.user;
  const r = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`Roblox respondió ${r.status}`);
  const d = await r.json();
  const u = Array.isArray(d?.data) ? d.data[0] : null;
  const user = u && Number.isSafeInteger(u.id)
    ? { id: u.id, name: String(u.name).slice(0, 20), displayName: String(u.displayName || u.name).slice(0, 20), avatar: await robloxHeadshot(u.id) }
    : null;
  if (robloxCache.size > 5000) robloxCache.clear();
  // Si el avatar aún no estaba listo, se vuelve a pedir pronto
  robloxCache.set(key, { user, until: Date.now() + (user && !user.avatar ? 60_000 : 10 * 60_000) });
  return user;
}
app.get('/api/roblox', robloxLimit, noStore, async (req, res) => {
  const username = typeof req.query.usuario === 'string' ? req.query.usuario.trim() : '';
  if (!ROBLOX_USER_RE.test(username)) return res.status(400).json({ error: 'Usuario de Roblox inválido.' });
  try {
    const user = await lookupRoblox(username);
    if (!user) return res.status(404).json({ error: 'No existe ese usuario en Roblox.' });
    res.json({ user });
  } catch (err) {
    console.error('[roblox]', err.message);
    res.status(502).json({ error: 'Roblox no respondió. Intenta de nuevo.' });
  }
});

// ─── Vincular Roblox (código en la descripción del perfil) ───
const linkJson = express.json({ limit: '2kb' });
const verifiedRoblox = (req) => {
  const v = req.session?.rbxVerified;
  return v && Date.now() - v.t < 7 * 24 * 60 * 60 * 1000 ? { id: v.id, name: v.name, avatar: v.avatar || null } : null;
};
function linkGuard(req, res) {
  res.set('Cache-Control', 'no-store');
  if (!isSameOrigin(req, ORIGIN)) { res.status(403).json({ error: 'Solicitud no permitida.' }); return false; }
  if (!req.session?.user) { res.status(401).json({ error: 'Inicia sesión con Discord.' }); return false; }
  return true;
}

app.post('/api/roblox/vincular', robloxLimit, linkJson, async (req, res) => {
  if (!linkGuard(req, res)) return;
  const name = typeof req.body?.usuario === 'string' ? req.body.usuario.trim() : '';
  if (!ROBLOX_USER_RE.test(name)) return res.status(400).json({ error: 'Usa solo letras, números o _ (3 a 20 caracteres).' });
  let user;
  try { user = await lookupRoblox(name); } catch { return res.status(502).json({ error: 'Roblox no responde. Intenta en un momento.' }); }
  if (!user) return res.status(404).json({ error: 'No existe ese usuario en Roblox.' });
  const prev = req.session.rbxLink;
  const code = prev && prev.id === String(user.id) && Date.now() - prev.t < LINK_TTL ? prev.code : makeCode();
  req.session.rbxLink = { id: String(user.id), name: user.name, avatar: user.avatar || null, code, t: prev?.code === code ? prev.t : Date.now() };
  res.json({ code, user });
});

app.post('/api/roblox/comprobar', robloxLimit, async (req, res) => {
  if (!linkGuard(req, res)) return;
  const link = req.session.rbxLink;
  if (!link || Date.now() - link.t > LINK_TTL) return res.status(409).json({ error: 'El código venció. Pide uno nuevo.' });
  let profile;
  try { profile = await fetchRobloxProfile(link.id); } catch { return res.status(502).json({ error: 'Roblox no responde. Intenta en un momento.' }); }
  if (!profile) return res.status(404).json({ error: 'Esa cuenta de Roblox ya no existe.' });
  if (!hasCode(profile.description, link.code)) {
    return res.status(409).json({ error: 'Todavía no vemos el código en tu descripción de Roblox. Guárdala y espera unos segundos.' });
  }
  const roblox = { id: link.id, name: profile.name || link.name, avatar: link.avatar };
  req.session.rbxVerified = { ...roblox, t: Date.now() };
  req.session.rbxLink = null;
  const store = await getDb();
  if (store) await panel.setRoblox(store, req.session.user, roblox, Date.now(), { verified: true }).catch((e) => console.error('[db] vincular:', e.message));
  res.json({ ok: true, user: { ...roblox, displayName: profile.displayName } });
});

// Avatares para la sección de equipo (hasta 6 usuarios por consulta, con la misma caché)
app.get('/api/roblox/avatares', apiLimit, async (req, res) => {
  const raw = typeof req.query.usuarios === 'string' ? req.query.usuarios : '';
  const names = [...new Set(raw.split(',').map((n) => n.trim()).filter(Boolean))];
  if (!names.length || names.length > 6 || !names.every((n) => ROBLOX_USER_RE.test(n))) {
    return res.status(400).json({ error: 'Usuarios inválidos.' });
  }
  const users = {};
  await Promise.all(names.map(async (n) => {
    try { users[n.toLowerCase()] = await lookupRoblox(n); } catch { users[n.toLowerCase()] = null; }
  }));
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ users });
});

// Canal de las solicitudes: WHITELIST_CHANNEL_ID o, si no está, el del webhook (Discord lo dice al consultarlo).
class DiscordBusy extends Error {} // Discord está limitando (429): hay que esperar, no cambiar de vía
let reviewChannel = CHANNEL_ID ? { channelId: CHANNEL_ID } : null;
async function getReviewChannel() {
  if (reviewChannel) return reviewChannel;
  const r = await discordRequest(dfetch, WEBHOOK_URL);
  if (r.limit) {
    console.error(`[solicitud] no se pudo leer el webhook (429: ${describeLimit(r.limit)})`);
    throw new DiscordBusy('discord_429');
  }
  if (!r.ok) throw new Error(`no se pudo leer el webhook (${r.status})`);
  if (!/^\d{5,25}$/.test(r.data?.channel_id || '')) throw new Error('el webhook no tiene canal');
  reviewChannel = { channelId: r.data.channel_id };
  console.log(`[solicitud] canal de solicitudes: ${reviewChannel.channelId}`);
  return reviewChannel;
}

// Publica la solicitud. Con bot lleva botones; si el bot falla, se manda igual por el webhook (sin botones).
// Si Discord está limitando, se lanza DiscordBusy para reintentar luego con el bot (y que lleguen los botones).
async function sendApplication(payload, applicantId) {
  if (bot) {
    try {
      const { channelId } = await getReviewChannel();
      const { username, ...message } = payload;
      const r = await bot.postMessage(channelId, { ...message, components: reviewComponents(applicantId) });
      if (r.ok) return 'bot';
      if (r.limit) {
        console.error(`[solicitud] el bot no pudo publicar (429: ${describeLimit(r.limit)})`);
        throw new DiscordBusy('discord_429');
      }
      const why = r.code === 50001 || r.code === 50013 ? 'el bot no puede ver o escribir en ese canal: añádelo al canal'
          : r.status === 401 ? 'DISCORD_BOT_TOKEN no es válido' : `error ${r.status}${r.code ? ` código ${r.code}` : ''}`;
      console.error(`[solicitud] el bot no pudo publicar (${why}); se prueba con el webhook`);
    } catch (err) {
      if (err instanceof DiscordBusy) throw err;
      console.error('[solicitud]', err.message);
    }
  }
  const r = await discordRequest(dfetch, `${WEBHOOK_URL}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (r.ok) return 'webhook';
  if (r.limit) {
    console.error(`[solicitud] webhook 429: ${describeLimit(r.limit)}`);
    throw new DiscordBusy('discord_429');
  }
  throw new Error(`webhook ${r.status}${r.code ? ` código ${r.code}` : ''}`);
}

// ─── Cola de solicitudes ───
// Render gratis comparte su IP con muchos servicios y a veces Discord la bloquea un rato (error 429 de
// Cloudflare). En ese caso la solicitud se guarda aquí y se reintenta cada 90 s hasta 24 h.
const queue = [];
const QUEUE_MAX = 50;
const QUEUE_EVERY = 90_000;
let queueTimer = null;

function enqueue(item) {
  if (queue.some((q) => q.applicantId === item.applicantId)) return true; // ya estaba en la cola
  if (queue.length >= QUEUE_MAX) return false;
  queue.push({ ...item, tries: 0, at: Date.now() });
  // Queda en los logs por si el servidor se reinicia antes de entregarla
  console.log(`[cola] Discord bloquea por ahora; solicitud guardada (Discord ${item.applicantId}, Roblox ${item.roblox}). Pendientes: ${queue.length}`);
  if (!queueTimer) queueTimer = setTimeout(flushQueue, QUEUE_EVERY);
  return true;
}

async function flushQueue() {
  queueTimer = null;
  while (queue.length) {
    const item = queue[0];
    if (Date.now() - item.at > 24 * 60 * 60 * 1000) {
      queue.shift();
      console.error(`[cola] se descartó la solicitud de ${item.applicantId} (24 h sin poder entregarla)`);
      continue;
    }
    try {
      const via = await sendApplication(item.payload, item.applicantId);
      queue.shift();
      if (deliveredFromQueue.size > 5000) deliveredFromQueue.clear();
      deliveredFromQueue.add(item.applicantId);
      console.log(`[cola] solicitud de ${item.applicantId} entregada (${via}) tras ${Math.round((Date.now() - item.at) / 60_000)} min. Pendientes: ${queue.length}`);
    } catch (err) {
      if (err instanceof DiscordBusy) break; // sigue bloqueado: se intenta en la próxima vuelta
      item.tries += 1;
      console.error(`[cola] error enviando la solicitud de ${item.applicantId}: ${err.message}`);
      if (item.tries >= 5) queue.shift();
      break;
    }
  }
  if (queue.length) {
    // Mientras haya pendientes, la web se visita a sí misma para que Render no la duerma.
    if (ON_RENDER) fetch(`${BASE_URL}/healthz`, { signal: AbortSignal.timeout(10_000) }).catch(() => {});
    queueTimer = setTimeout(flushQueue, QUEUE_EVERY);
  }
}

app.post('/api/solicitud', submitLimit, noStore, express.json({ limit: '20kb' }), async (req, res) => {
  if (!isSameOrigin(req, ORIGIN)) return res.status(403).json({ error: 'Solicitud no permitida.' });
  if (!loginConfigured()) return res.status(403).json({ error: 'Esto es una vista previa: el inicio de sesión aún no está activado.' });
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Inicia sesión con Discord para enviar.' });
  if (recentlySubmitted(req)) return res.status(409).json({ error: 'Ya enviaste una solicitud. Espera la respuesta del staff.' });
  if ((await whitelistStatus(user.id)) === 'aceptada') return res.status(409).json({ error: 'Ya tienes la whitelist aceptada.', aceptada: true });
  if (!WEBHOOK_URL) return res.status(503).json({ error: 'El staff aún no activó la recepción de solicitudes.' });

  const { ok, errors, data } = validateApplication(req.body);
  if (!ok) return res.status(400).json({ error: 'Revisa los campos marcados.', errors });

  let payload = null;
  try {
    const roblox = await lookupRoblox(data.roblox); // se vuelve a comprobar aquí: no se confía en el navegador
    if (!roblox) return res.status(400).json({ error: 'Revisa los campos marcados.', errors: { roblox: 'No existe ese usuario en Roblox.' } });
    const linked = verifiedRoblox(req);
    if (ROBLOX_LINK_REQUIRED && linked?.id !== String(roblox.id)) {
      return res.status(400).json({ error: 'Vincula tu cuenta de Roblox antes de enviar.', errors: { roblox: 'Vincula tu cuenta de Roblox (paso 1).' } });
    }
    const score = scoreApplication(data.respuestas);
    payload = buildWebhookPayload({ user, roblox, data, score });
    const store = await getDb();
    if (store) await panel.saveApplication(store, { user, roblox, data, score, verified: Boolean(linked) }).catch((e) => console.error('[db] guardar solicitud:', e.message));
    await sendApplication(payload, user.id);
    req.session.submittedAt = Date.now();
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof DiscordBusy) {
      // Discord bloquea al servidor un rato: se guarda y se envía sola cuando lo permita.
      if (payload && enqueue({ payload, applicantId: user.id, roblox: data.roblox })) {
        req.session.queuedAt = Date.now();
        return res.status(202).json({ ok: true, queued: true });
      }
      return res.status(503).json({ error: 'Discord está limitando los envíos en este momento. Tus respuestas quedan guardadas: intenta de nuevo en unos minutos.' });
    }
    console.error('[solicitud]', err.message);
    res.status(502).json({ error: 'No se pudo enviar. Intenta de nuevo en unos minutos.' });
  }
});

// Contadores de Discord: se consultan como mucho cada 5 minutos (cada 1 si falla),
// así nadie puede usar la web para saturar la API de Discord.
let stats = { members: null, online: null };
let nextRefresh = 0;
let pending = null;
function refreshStats() {
  if (!pending) {
    pending = (async () => {
      try {
        const r = await discordFetch(`${API}/invites/${encodeURIComponent(INVITE_CODE)}?with_counts=true`);
        if (!r.ok) throw new Error(`Discord respondió ${r.status}`);
        const d = await r.json();
        const num = (x) => (Number.isFinite(x) ? x : null);
        stats = { members: num(d.approximate_member_count), online: num(d.approximate_presence_count) };
        nextRefresh = Date.now() + 5 * 60_000;
      } catch (err) {
        console.error('[stats]', err.message);
        nextRefresh = Date.now() + 60_000;
      } finally {
        pending = null;
      }
    })();
  }
  return pending;
}
app.get('/api/stats', apiLimit, async (req, res) => {
  if (Date.now() >= nextRefresh) {
    const p = refreshStats();
    if (stats.members === null) await p; // solo se espera la primera vez
  }
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ members: stats.members, online: stats.online, invite: `https://discord.gg/${INVITE_CODE}` });
});
// ─── Clics en Aceptar / Rechazar (Discord los manda aquí, firmados) ───
async function staffRoleIds(guildId) {
  if (!STAFF_ROLES.length) return [];
  if (bot) return bot.resolveRoles(guildId, STAFF_ROLES);
  return STAFF_ROLES.filter((r) => /^\d{5,25}$/.test(r));
}

async function applyDecision(effect, interaction) {
  const problems = [];
  if (!bot) {
    problems.push('Falta DISCORD_BOT_TOKEN en Render: no pude dar el rol ni avisarle por MD.');
  } else {
    if (effect.kind === 'accept') {
      if (!WHITELIST_ROLE) {
        problems.push('No hay rol configurado (WHITELIST_ROLE en Render), así que no le di ningún rol.');
      } else {
        const [roleId] = await bot.resolveRoles(effect.guildId, [WHITELIST_ROLE]);
        if (!roleId) {
          const names = bot.roleNames(effect.guildId).slice(0, 25);
          problems.push(`No encontré el rol «${WHITELIST_ROLE}». Revisa WHITELIST_ROLE en Render.${names.length ? ` Roles del servidor: ${names.join(', ')}` : ''}`);
        } else {
          const r = await bot.addRole(effect.guildId, effect.applicantId, roleId, `Whitelist aceptada por ${effect.staffName}`);
          if (!r.ok) {
            problems.push(r.code === 10007 ? 'La persona ya no está en el servidor: no pude darle el rol.'
              : r.code === 50013 ? 'No pude dar el rol: en Ajustes del servidor → Roles, sube el rol del bot por encima del rol de whitelist.'
                : `No pude dar el rol (error ${r.status}).`);
          }
        }
      }
    }
    const dm = await bot.dm(effect.applicantId, decisionDm({ kind: effect.kind, motivo: effect.motivo, siteUrl: BASE_URL }));
    if (!dm.ok) problems.push(dm.code === 50007 ? 'No pude avisarle por MD (tiene los mensajes privados cerrados).' : `No pude avisarle por MD (error ${dm.status}).`);
  }
  if (effect.kind === 'accept' && !problems.some((p) => p.includes('rol'))) wlCache.set(effect.applicantId, { status: 'aceptada', until: Date.now() + 2 * 60_000 });
  else wlCache.delete(effect.applicantId);
  memberCache.delete(effect.applicantId);
  const store = await getDb();
  if (store) {
    try {
      await panel.setApplicationStatus(store, effect.applicantId, effect.kind === 'accept' ? 'aceptada' : 'rechazada');
      if (effect.kind === 'accept') {
        const last = await panel.latestApplication(store, effect.applicantId);
        if (last?.personaje && !(await panel.getCharacter(store, effect.applicantId))) {
          await panel.createCharacter(store, { user: { id: effect.applicantId, name: '' }, roblox: last.roblox, input: last.personaje });
        }
      }
    } catch (err) {
      console.error('[db] al revisar la solicitud:', err.message);
    }
  }
  console.log(`[revisión] solicitud de ${effect.applicantId} ${effect.kind === 'accept' ? 'aceptada' : 'rechazada'} por ${effect.staffName || effect.staffId}${problems.length ? ' (con avisos)' : ': rol y mensaje privado OK'}`);
  if (!problems.length) return;
  console.error('[revisión]', problems.join(' | '));
  const appId = /^\d{5,25}$/.test(interaction.application_id || '') ? interaction.application_id : CLIENT_ID;
  if (!appId || typeof interaction.token !== 'string') return;
  await discordFetch(`${API}/webhooks/${appId}/${encodeURIComponent(interaction.token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `⚠️ ${problems.join('\n')}`, flags: 64, allowed_mentions: { parse: [] } }),
  }).catch(() => {});
}

// Comandos de barra (/banco, /cedula, /multar…): usan la misma base de datos que el panel.
// Contexto para los comandos del bot (los de antes y los de la web)
async function botContext(interaction, store) {
  const guildId = interaction.guild_id || HOME_GUILD;
  const u = interaction.member?.user || interaction.user || {};
  // En un DM no vienen los roles: se buscan en el servidor
  const roles = Array.isArray(interaction.member?.roles) ? interaction.member.roles : ((await memberInfo(u.id).catch(() => null))?.roles || []);
  const guildRoles = bot ? await bot.guildRoles(guildId) : [];
  return {
    db: store,
    api: (method, route, body, opts) => bot.call(method, route, body, opts),
    dm: (userId, payload) => bot.dm(userId, payload),
    me: { id: u.id, name: u.global_name || u.username || '', username: u.username || '' },
    roles,
    permissions: interaction.member?.permissions || '0',
    guildId,
    channelId: interaction.channel_id,
    botId: interaction.application_id || CLIENT_ID,
    jobs: jobsFor(roles, guildRoles, JOBS),
    guildRoles,
    webAdmin: roles.some((r) => WEB_ADMINS.includes(r)),
    staffRoles: STAFF_ROLES.length ? await bot.resolveRoles(guildId, STAFF_ROLES) : [],
    siteUrl: BASE_URL,
    now: () => Date.now(),
    lookupRoblox: (name) => lookupRoblox(name),
    robloxFor: (id) => robloxFor(store, id),
    robloxAvatar: async (name) => (name ? (await lookupRoblox(name).catch(() => null))?.avatar || null : null),
    erlc,
    setErlcKey,
    membersWithRoles,
  };
}

// Personas del servidor que tienen alguno de esos roles (para mandarles el caso por DM)
let membersCache = { at: 0, list: [] };
async function membersWithRoles(roleIds) {
  if (!bot || !roleIds?.length) return [];
  if (Date.now() - membersCache.at > 60_000) {
    const all = [];
    let after = '0';
    for (let i = 0; i < 20; i++) {
      const r = await bot.call('GET', `/guilds/${HOME_GUILD}/members?limit=1000&after=${after}`);
      if (!r.ok || !Array.isArray(r.data)) {
        console.error(`[justicia] no pude leer los miembros (error ${r.status}${r.status === 403 ? ': activa "Server Members Intent" en el Developer Portal → Bot' : ''})`);
        break;
      }
      all.push(...r.data);
      if (r.data.length < 1000) break;
      after = r.data[r.data.length - 1].user.id;
    }
    if (all.length) membersCache = { at: Date.now(), list: all.map((m) => ({ id: m.user?.id, bot: Boolean(m.user?.bot), roles: m.roles || [] })) };
  }
  return membersCache.list.filter((m) => !m.bot && m.roles.some((r) => roleIds.includes(r))).map((m) => m.id);
}

// Comandos de barra y botones: la respuesta "pensando…" ya se mandó; aquí se hace el trabajo y se entrega
async function runInteraction(interaction, kind) {
  let out;
  try {
    const store = await getDb();
    if (!store) {
      out = { private: { content: '❌ La base de datos no responde. Intenta en un momento.' } };
    } else if (kind === 'old' || kind === 'component' || kind === 'justice') {
      const ctx = await botContext(interaction, store);
      out = kind === 'old' ? await runOld(interaction, ctx)
        : kind === 'justice' ? await runJustice(interaction, ctx)
          : await runComponent(interaction, ctx);
      out ||= { private: { content: '❌ Este botón ya no funciona.' } };
    } else {
      const roles = Array.isArray(interaction.member?.roles) ? interaction.member.roles : [];
      const guildRoles = bot ? await bot.guildRoles(interaction.guild_id || HOME_GUILD) : [];
      const [wlRole] = bot && WHITELIST_ROLE ? await bot.resolveRoles(interaction.guild_id || HOME_GUILD, [WHITELIST_ROLE]) : [];
      out = await handleCommand(interaction, {
        db: store,
        jobs: jobsFor(roles, guildRoles, JOBS),
        JOBS,
        isCitizen: wlRole ? roles.includes(wlRole) : true,
        robloxAvatar: async (name) => (name ? (await lookupRoblox(name).catch(() => null))?.avatar || null : null),
        robloxFor: (id) => robloxFor(store, id),
        erlc,
        siteUrl: BASE_URL,
        verifyInGame,
      });
    }
  } catch (err) {
    console.error('[comando]', interaction.data?.name || interaction.data?.custom_id, err.message);
    out = { private: { content: err.code === 'llave' ? '❌ La llave de ER:LC no es válida (/erlc set_key).' : err.code === 'apagado' ? '❌ El servidor de ER:LC está apagado.' : '❌ Algo falló. Intenta de nuevo.' } };
  }
  await deliver(interaction, out);
}

async function deliver(interaction, out) {
  const base = `${API}/webhooks/${interaction.application_id || CLIENT_ID}/${encodeURIComponent(interaction.token)}`;
  const json = { 'Content-Type': 'application/json' };
  const priv = { allowed_mentions: { parse: [] }, ...out.private };
  if (priv.content === '') delete priv.content;
  await discordFetch(`${base}/messages/@original`, { method: 'PATCH', headers: json, body: JSON.stringify(priv) })
    .catch((err) => console.error('[comando] respuesta:', err.message));
  if (out.public) {
    await discordFetch(base, { method: 'POST', headers: json, body: JSON.stringify({ allowed_mentions: { parse: [] }, ...out.public }) })
      .catch((err) => console.error('[comando] mensaje público:', err.message));
  }
}

// Registra los comandos en el servidor de Discord (solo si cambiaron).
async function syncCommands() {
  if (!bot || !CLIENT_ID) return;
  const local = buildCommands(JOBS);
  const route = `/applications/${CLIENT_ID}/guilds/${HOME_GUILD}/commands`;
  const current = await bot.call('GET', route);
  if (current.ok && sameCommands(current.data, local)) {
    OUR_COMMAND_IDS = new Set(current.data.map((c) => c.id));
    console.log(`Comandos de Discord: listos (${local.length})`);
  } else {
    const r = await bot.call('PUT', route, local);
    if (r.ok && Array.isArray(r.data)) OUR_COMMAND_IDS = new Set(r.data.map((c) => c.id));
    console.log(r.ok ? `Comandos de Discord: registrados (${local.length})`
      : `Comandos de Discord: no se pudieron registrar (error ${r.status}${r.code === 50001 ? ': vuelve a invitar el bot desde /bot/invitar' : ''})`);
  }
  // Comandos viejos del bot (globales): ya no los atiende nadie, porque las interacciones llegan a esta web
  const global = await bot.call('GET', `/applications/${CLIENT_ID}/commands`);
  if (global.ok && Array.isArray(global.data)) {
    OLD_COMMANDS = global.data.map((c) => c.name);
    if (OLD_COMMANDS.length) console.log(`Comandos de antes (${OLD_COMMANDS.length}): los contesta el bot de antes (la web no los toca)`);
  }
}
let OLD_COMMANDS = [];
let OUR_COMMAND_IDS = new Set();
let gatewayOnce = false;


// Comandos de antes: la web guarda lo que se hizo (arrestos, multas, DNI…) para que salga en el panel.
function mirrorLater(interaction) {
  setTimeout(async () => {
    try {
      const store = await getDb();
      if (!store || !bot) return;
      const ctx = await botContext(interaction, store);
      const done = await mirrorOldCommand(interaction, ctx);
      if (done) console.log(`[espejo] /${interaction.data?.name}: ${done}`);
    } catch (err) {
      console.error('[espejo]', interaction.data?.name, err.message);
    }
  }, 2500);
}

// Respuesta a una interacción (igual por la URL o por el gateway). 'after' sigue trabajando después de responder.
const thinking = { type: 5, data: { flags: 64 } }; // "El bot está pensando…" (privado)
async function answerInteraction(interaction) {
  const name = interaction.data?.name;
  const cid = String(interaction.data?.custom_id || '');
  const later = (kind) => ({ response: thinking, after: () => runInteraction(interaction, kind).catch((err) => console.error('[comando]', err.message)) });

  // Los comandos de antes (y todo lo que no es de la web) los contesta el bot de antes, sin tocarlos
  if (interaction.type === 4) return null;
  if (interaction.type === 2 && !COMMAND_NAMES.includes(name)) {
    mirrorLater(interaction); // solo lee lo que se puso y lo guarda en la web; no contesta nada
    return null;
  }
  if (interaction.type === 2) return later('web');
  if ((interaction.type === 3 || interaction.type === 5) && JUSTICE_RE.test(cid)) {
    const modal = justiceModal(interaction);
    return modal ? { response: { type: 9, data: modal } } : later('justice');
  }
  if ((interaction.type === 3 || interaction.type === 5) && !cid.startsWith('wl:')) return null;
  let roles = [];
  if (interaction.type !== 1 && interaction.guild_id) {
    try { roles = await staffRoleIds(interaction.guild_id); } catch { roles = []; }
  }
  const { response, effect } = decide(interaction, { staffRoleIds: roles });
  return { response, after: effect ? () => applyDecision(effect, interaction).catch((err) => console.error('[revisión]', err.message)) : null };
}

// Por el gateway: Discord manda las interacciones a los dos bots; la web contesta solo las suyas.
async function onGatewayInteraction(interaction) {
  if (!interaction?.id || !interaction.token) return;
  const answer = await answerInteraction(interaction);
  if (!answer) return; // es del bot de antes
  const { response, after } = answer;
  const r = await discordFetch(`${API}/interactions/${interaction.id}/${encodeURIComponent(interaction.token)}/callback`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(response),
  }).catch((err) => ({ ok: false, status: 0, err }));
  if (!r.ok) {
    console.error(`[gateway] no se pudo responder (${r.status || r.err?.message})`);
    return;
  }
  after?.();
}


// En modo gateway, la Interactions Endpoint URL tiene que estar vacía (si no, Discord no manda nada
// por el gateway y el bot viejo se queda sin sus comandos). Solo se borra si es la de esta web.
async function releaseInteractionsUrl() {
  const me = await bot.call('GET', '/applications/@me');
  if (!me.ok) return console.log(`Interactions Endpoint URL: no se pudo revisar (error ${me.status})`);
  const current = me.data?.interactions_endpoint_url || '';
  if (!current) return console.log('Interactions Endpoint URL: vacía (bien: el bot viejo y la web reciben sus comandos)');
  if (current !== `${BASE_URL}/api/discord/interactions`) return console.log(`Interactions Endpoint URL: apunta a otro sitio (${current}); no la toco`);
  for (const value of [null, '']) {
    const r = await bot.call('PATCH', '/applications/@me', { interactions_endpoint_url: value });
    if (r.ok) return console.log('Interactions Endpoint URL: borrada (ahora todo llega por el gateway y el bot viejo vuelve a funcionar)');
  }
  console.log('Interactions Endpoint URL: no se pudo borrar sola. Bórrala en discord.com/developers → tu app → General Information.');
}

app.post('/api/discord/interactions', express.raw({ type: () => true, limit: '200kb' }), async (req, res) => {
  if (!PUBLIC_KEY) return res.status(503).json({ error: 'Falta DISCORD_PUBLIC_KEY.' });
  const valid = verifyInteraction({
    key: PUBLIC_KEY,
    signature: req.get('x-signature-ed25519'),
    timestamp: req.get('x-signature-timestamp'),
    body: req.body,
  });
  if (!valid) return res.status(401).json({ error: 'Firma inválida.' });
  let interaction;
  try { interaction = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ error: 'JSON inválido.' }); }

  const answer = await answerInteraction(interaction);
  if (!answer) return res.json({ type: 4, data: { flags: 64, content: 'Este comando no es de la web.' } });
  res.json(answer.response); // Discord exige respuesta en menos de 3 s; lo demás va después
  answer.after?.();
});

// Enlace corto para añadir el bot al servidor con los permisos justos.
app.get('/bot/invitar', (req, res) => {
  if (!CLIENT_ID) return res.redirect('/');
  const q = new URLSearchParams({ client_id: CLIENT_ID, scope: 'bot applications.commands', permissions: BOT_PERMISSIONS });
  if (GUILD_ID) { q.set('guild_id', GUILD_ID); q.set('disable_guild_select', 'true'); }
  res.redirect(`https://discord.com/oauth2/authorize?${q}`);
});

// ─── Base de datos ───
// Con DATABASE_URL (Neon) los datos son permanentes. Sin ella, modo de prueba: SQLite en un archivo
// temporal que se borra cuando Render reinicia la web.
let db = null;
let dbMode = DATABASE_URL ? 'neon' : 'prueba';
let dbPending = null;
let dbRetryAt = 0;
function getDb() {
  if (db) return Promise.resolve(db);
  if (Date.now() < dbRetryAt) return Promise.resolve(null);
  if (!dbPending) {
    dbPending = (async () => {
      try {
        const conn = DATABASE_URL ? await connectPostgres(DATABASE_URL) : await connectSqlite(path.join(os.tmpdir(), 'panama-rp-prueba.db'));
        await migrate(conn);
        db = conn;
        console.log(DATABASE_URL ? 'Base de datos: Neon conectada' : 'Base de datos: MODO DE PRUEBA (falta DATABASE_URL; los datos se borran al reiniciar)');
      } catch (err) {
        console.error('[db] no se pudo conectar:', err.message);
        dbRetryAt = Date.now() + 20_000;
      } finally {
        dbPending = null;
      }
      return db;
    })();
  }
  return dbPending;
}

// ─── Panel de ciudadano ───
const panelLimit = rateLimit({ windowMs: 60_000, max: 120, keyFn: ipOf });
const panelWriteLimit = rateLimit({ windowMs: 60_000, max: 30, keyFn: ipOf, message: 'Vas muy rápido. Espera un momento.' });
const weekAgo = () => Date.now() - 7 * 24 * 60 * 60 * 1000;

// Todo lo del panel pasa por aquí: sesión, whitelist, base de datos y trabajos según los roles.
async function panelContext(req) {
  const user = req.session?.user;
  if (!loginConfigured()) throw new panel.PanelError(503, 'El inicio de sesión aún no está activado.');
  if (!user) {
    const err = new panel.PanelError(401, 'Inicia sesión con Discord.');
    err.gate = 'login';
    throw err;
  }
  const wl = await whitelistStatus(user.id);
  if (wl === null) throw new panel.PanelError(503, 'No se pudo comprobar tu whitelist. Intenta en un momento.');
  if (wl !== 'aceptada') {
    const err = new panel.PanelError(403, wl === 'fuera_del_servidor' ? 'Únete al Discord de Panamá RP.' : 'Necesitas la whitelist aceptada para entrar al panel.');
    err.gate = 'whitelist';
    throw err;
  }
  const store = await getDb();
  if (!store) throw new panel.PanelError(503, 'La base de datos no responde. Intenta en un momento.');
  const info = await memberInfo(user.id);
  const roles = bot ? await bot.guildRoles(HOME_GUILD) : [];
  const jobs = jobsFor(info?.roles || [], roles, JOBS);
  return { user, db: store, jobs, roles: info?.roles || [], staff: staffRank(info?.roles || []) };
}

// Solo este rol puede crear juicios (Abogados y fiscales)
const TRIAL_ROLES = ['1565913945980801064'];
const canTrial = (roles = []) => roles.some((r) => TRIAL_ROLES.includes(r));

// Moderadores y admins de la web (por rol de Discord)
const WEB_MODS = ['1561821550557265930', '1561818194107301981', '1561818055053410394'];
const WEB_ADMINS = ['1561816462186909736', '1561821788093157407', '1560738331195736134', '1561816254241579008'];
function staffRank(roles) {
  const admin = roles.some((x) => WEB_ADMINS.includes(x));
  return { admin, mod: admin || roles.some((x) => WEB_MODS.includes(x)) };
}
const needMod = (staff) => { if (!staff?.mod) throw new panel.PanelError(403, 'Solo moderadores y admins.'); };
const needAdmin = (staff) => { if (!staff?.admin) throw new panel.PanelError(403, 'Solo admins.'); };

function panelRoute(handler, { write = false } = {}) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (write && !isSameOrigin(req, ORIGIN)) return res.status(403).json({ error: 'Solicitud no permitida.' });
    try {
      const ctx = await panelContext(req);
      res.json(await handler(ctx, req));
    } catch (err) {
      if (err instanceof panel.PanelError) {
        return res.status(err.status).json({ error: err.message, ...(err.fields ? { errors: err.fields } : {}), ...(err.gate ? { gate: err.gate } : {}) });
      }
      console.error('[panel]', err.message);
      res.status(500).json({ error: 'Algo falló. Intenta de nuevo.' });
    }
  };
}

const panelJson = express.json({ limit: '10kb' });
const post = (p, handler) => app.post(`/api/panel${p}`, panelLimit, panelWriteLimit, panelJson, panelRoute(handler, { write: true }));

app.get('/api/panel/estado', panelLimit, panelRoute(async ({ user, db: d, jobs, roles, staff }) => {
  const since = weekAgo();
  const [character, account, shift, week, fines, arrests, transactions, shifts, ranking, linked, salaries] = await Promise.all([
    panel.getCharacter(d, user.id), panel.getAccount(d, user.id), panel.activeShift(d, user.id),
    panel.shiftStats(d, user.id, since), panel.listFines(d, user.id), panel.listArrests(d, user.id), panel.listTransactions(d, user.id),
    panel.listShifts(d, user.id), panel.shiftRanking(d, since), panel.getUserRoblox(d, user.id), panel.listSalaries(d),
  ]);
  // Cuánto gana cada trabajo y la persona (lo pone un admin con /salario-configurar del bot)
  const mine = salaries.filter((x) => (roles || []).includes(x.role_id));
  const guildRoles = mine.length && bot ? await bot.guildRoles(HOME_GUILD).catch(() => []) : [];
  const pay = jobPay(salaries, JOBS);
  const sueldos = paysFor(salaries, roles || [], guildRoles, JOBS);
  const solicitud = character ? null : await panel.latestApplication(d, user.id);
  // Roblox: el de la cédula, el vinculado o el de la whitelist (con su foto)
  const rbxName = character?.roblox_name || linked?.name || solicitud?.roblox?.name || '';
  const rbx = rbxName ? await lookupRoblox(rbxName).catch(() => null) : null;
  const roblox = rbxName ? { name: rbx?.name || rbxName, avatar: rbx?.avatar || null, verified: Boolean(character || linked?.verified) } : null;
  if (Date.now() >= nextRefresh) refreshStats(); // contador de Discord (no se espera)
  return {
    now: Date.now(), user, modo: dbMode, staff, character, account, shift, stats: week, fines, arrests, transactions, roblox,
    shifts, ranking: ranking.map(({ _id, ...r }) => ({ ...r, yo: _id === user.id })), online: stats.online, erlc: await erlcStatus(),
    solicitud, jobs, jobInfo: publicJobs(JOBS), shiftRules: SHIFT, money: panel.MONEY, options: OPTIONS, pay, sueldos,
  };
}));

// La cédula usa la cuenta de Roblox vinculada (comprobada con el código en el perfil)
async function robloxFor(d, userId) {
  const linked = await panel.getUserRoblox(d, userId);
  if (linked && (linked.verified || !ROBLOX_LINK_REQUIRED)) return linked;
  if (!ROBLOX_LINK_REQUIRED) return (await panel.latestApplication(d, userId))?.roblox || null;
  return null;
}
post('/cedula', async ({ user, db: d }, req) => {
  const roblox = await robloxFor(d, user.id);
  if (!roblox) throw new panel.PanelError(400, 'Primero vincula tu cuenta de Roblox.', { roblox: 'Vincula tu cuenta de Roblox arriba.' });
  return { character: await panel.createCharacter(d, { user, roblox, input: req.body?.personaje }) };
});
post('/banco/mover', async ({ user, db: d }, req) => ({ account: await panel.moveMoney(d, user.id, req.body?.tipo, req.body?.monto) }));
post('/banco/transferir', async ({ user, db: d }, req) => panel.transfer(d, user.id, req.body?.cedula, req.body?.monto, req.body?.nota));
post('/multas/pagar', async ({ user, db: d }, req) => ({ account: await panel.payFine(d, user.id, req.body?.id) }));
post('/turno/iniciar', async ({ user, db: d, jobs }, req) => ({ shift: await panel.startShift(d, user.id, req.body?.job, { jobs: JOBS, allowed: jobs, verify: verifyInGame }) }));
post('/turno/terminar', async ({ user, db: d }) => ({ result: await panel.endShift(d, user.id, { jobs: JOBS }) }));
post('/policia/multa', async ({ user, db: d, jobs }, req) => {
  if (!jobs.includes('transito')) throw new panel.PanelError(403, 'Solo la ATT puede poner multas.');
  return { fine: await panel.issueFine(d, user.id, req.body || {}) };
});
post('/policia/arresto', async ({ user, db: d, jobs }, req) => {
  if (!hasPolice(jobs)) throw new panel.PanelError(403, 'No tienes rol de Policía (Policía Nacional, Aeronaval o Senafront).');
  const { targetId, ...arrest } = await panel.registerArrest(d, user.id, req.body || {});
  announceWebArrest(user, arrest, targetId).catch((err) => console.error('[arresto] aviso:', err.message));
  return { arrest };
});

// Arresto hecho en la web: sale en el canal de arrestos y se le da el rol de arrestado
async function announceWebArrest(user, a, targetId) {
  if (!bot) return;
  await bot.addRole(HOME_GUILD, targetId, ARREST_ROLE, `Arresto registrado en la web por ${user.name || user.id}`);
  await bot.postMessage(ARREST_CHANNEL, {
    content: `<@${targetId}>`,
    allowed_mentions: { users: [targetId] },
    embeds: [{
      title: '🚔 Arresto', color: 0xef4444,
      fields: [
        { name: 'Ciudadano', value: `${a.a} (<@${targetId}>)`, inline: true },
        { name: 'Cédula', value: a.cedula, inline: true },
        { name: 'Tiempo', value: `${a.minutos} min`, inline: true },
        { name: 'Cargos', value: String(a.cargos).slice(0, 1024) },
        { name: 'Oficial', value: `${a.oficial} (<@${user.id}>)`, inline: true },
      ],
      footer: { text: 'Registrado en el panel web de Panamá RP' }, timestamp: new Date().toISOString(),
    }],
  });
}
app.get('/api/panel/policia/buscar', panelLimit, panelRoute(async ({ user, db: d, jobs }, req) => {
  if (!hasPolice(jobs) && !jobs.includes('transito')) throw new panel.PanelError(403, 'No tienes rol de Policía ni de ATT.');
  return { results: await panel.searchCitizens(d, user.id, req.query.q) };
}));
// Ficha completa (base de datos): Policía o ATT en turno
app.get('/api/panel/policia/ficha', panelLimit, panelRoute(async ({ user, db: d, jobs }, req) => {
  if (!hasPolice(jobs) && !jobs.includes('transito')) throw new panel.PanelError(403, 'No tienes rol de Policía ni de ATT.');
  const rec = await panel.citizenRecord(d, user.id, req.query.cedula);
  const avatar = rec.persona.roblox_name ? (await lookupRoblox(rec.persona.roblox_name).catch(() => null))?.avatar || null : null;
  return { ...rec, avatar };
}));

// Denuncias y juicios (les llegan por DM a los jueces)
const justiceEnv = (d) => ({
  db: d, now: () => Date.now(), membersWithRoles,
  dm: (userId, payload) => (bot ? bot.dm(userId, payload) : Promise.resolve({ ok: false })),
  api: (m, r, b, o) => (bot ? bot.call(m, r, b, o) : Promise.resolve({ ok: false })),
});
app.get('/api/panel/justicia', panelLimit, panelRoute(async ({ user, db: d, roles }) => ({
  cases: await listMyCases(d, user.id), tipos: DENUNCIAS.map(([k, n, e]) => ({ k, n, e })), juicio: canTrial(roles),
})));
post('/justicia/denuncia', async ({ user, db: d }, req) => {
  if (!bot) throw new panel.PanelError(503, 'El bot no está conectado.');
  return submitCase(justiceEnv(d), user, { ...(req.body || {}), origen: 'denuncia' });
});
post('/justicia/juicio', async ({ user, db: d, roles }, req) => {
  if (!canTrial(roles)) throw new panel.PanelError(403, 'Solo Abogados y fiscales pueden crear juicios.');
  if (!bot) throw new panel.PanelError(503, 'El bot no está conectado.');
  const me = await panel.getCharacter(d, user.id);
  return submitCase(justiceEnv(d), user, { ...(req.body || {}), origen: 'juicio', denunciante: me ? `${me.nombre} ${me.apellidos}` : user.name });
});

// Mercado negro (se paga en efectivo)
app.get('/api/panel/negro', panelLimit, panelRoute(async ({ user, db: d }) => ({
  items: (await market.listCatalog(d)).filter((x) => x.tipo === 'negro'), mine: await market.myBlackMarket(d, user.id),
})));

// Concesionario e inmobiliaria
app.get('/api/panel/tienda', panelLimit, panelRoute(async ({ user, db: d }) => ({
  catalog: await market.listCatalog(d), mine: await market.myAssets(d, user.id), colors: market.COLORS,
})));
post('/tienda/comprar', async ({ user, db: d }, req) => {
  const out = await market.buy(d, user.id, { id: req.body?.id, color: req.body?.color });
  notifyPurchase(d, user, out.bought).catch((err) => console.error('[tienda] aviso a admins:', err.message));
  return out;
});

// Cada compra les llega por DM a los admins (para entregarla dentro del juego)
async function notifyPurchase(d, user, b) {
  if (!bot) return;
  const c = await panel.getCharacter(d, user.id);
  const admins = await membersWithRoles(WEB_ADMINS);
  const embed = {
    title: `${b.tipo === 'negro' ? '🕶️ Mercado negro' : '🛒 Nueva compra'}: ${b.nombre}`, color: b.tipo === 'negro' ? 0x111111 : b.tipo === 'vehiculo' ? 0x4c7dff : 0x22c55e,
    fields: [
      { name: 'Comprador', value: `${c ? `${c.nombre} ${c.apellidos}` : user.name} (<@${user.id}>)`, inline: true },
      { name: 'Cédula', value: c?.cedula || '—', inline: true },
      { name: 'Roblox', value: c?.roblox_name || '—', inline: true },
      { name: 'Precio', value: `$${Number(b.precio).toLocaleString('es-PA')}`, inline: true },
      ...(b.tipo === 'vehiculo' ? [{ name: 'Placa', value: `\`${b.placa}\``, inline: true }, { name: 'Color', value: b.color, inline: true }]
        : b.tipo === 'casa' ? [{ name: 'Dirección', value: b.direccion, inline: true }] : [{ name: 'Pagado', value: 'En efectivo', inline: true }]),
    ],
    footer: { text: b.tipo === 'negro' ? 'Panamá RP · Mercado negro de la web' : 'Panamá RP · Concesionario e inmobiliaria de la web' }, timestamp: new Date().toISOString(),
  };
  for (const id of admins) await bot.dm(id, { embeds: [embed] }).catch(() => {});
}

// ─── Administración (moderadores y admins) ───
app.get('/api/panel/admin/buscar', panelLimit, panelRoute(async ({ user, db: d, staff }, req) => {
  needMod(staff);
  return { results: await panel.searchCitizens(d, user.id, req.query.q, { staff: true }) };
}));
app.get('/api/panel/admin/ficha', panelLimit, panelRoute(async ({ user, db: d, staff }, req) => {
  needMod(staff);
  const rec = await panel.citizenRecord(d, user.id, req.query.cedula, { staff: true });
  const avatar = rec.persona.roblox_name ? (await lookupRoblox(rec.persona.roblox_name).catch(() => null))?.avatar || null : null;
  return { ...rec, avatar };
}));
app.get('/api/panel/admin/casos', panelLimit, panelRoute(async ({ db: d, staff }) => {
  needMod(staff);
  // nombre de cada quien: su personaje (cédula) o su nombre de Discord
  const who = (col) => `(SELECT COALESCE((SELECT ch.nombre || ' ' || ch.apellidos FROM characters ch WHERE ch.discord_id = c.${col}), (SELECT u.discord_name FROM users u WHERE u.discord_id = c.${col}), c.${col}))`;
  return {
    cases: await d.query(
      `SELECT c.id, c.origen, c.tipo, c.estado, c.acusado, c.denunciante, c.motivo, c.created_at, c.updated_at,
         c.juez_id, c.fiscal_id, c.abogado_id, ${who('juez_id')} AS juez, ${who('fiscal_id')} AS fiscal, ${who('abogado_id')} AS abogado
       FROM cases c ORDER BY c.id DESC LIMIT 50`, [],
    ),
  };
}));
app.get('/api/panel/admin/catalogo', panelLimit, panelRoute(async ({ db: d, staff }) => {
  needAdmin(staff);
  return { catalog: await market.listCatalog(d) };
}));
// Guardar carro o casa (con foto opcional): JSON más grande por la foto
app.post('/api/panel/admin/catalogo/guardar', panelLimit, panelWriteLimit, express.json({ limit: '1300kb' }), panelRoute(async ({ user, db: d, staff }, req) => {
  needAdmin(staff);
  const id = await market.saveItem(d, req.body || {});
  if (req.body?.foto) await market.setImage(d, id, req.body.foto);
  await d.run("INSERT INTO bot_logs (tipo, actor_id, detalle, created_at) VALUES ('catalogo', $1, $2, $3)", [user.id, `${req.body?.id ? 'Editó' : 'Agregó'} #${id} ${String(req.body?.nombre || '').slice(0, 60)}`, Date.now()]);
  return { id, catalog: await market.listCatalog(d) };
}, { write: true }));
post('/admin/catalogo/quitar', async ({ user, db: d, staff }, req) => {
  needAdmin(staff);
  await market.removeItem(d, req.body?.id);
  await d.run("INSERT INTO bot_logs (tipo, actor_id, detalle, created_at) VALUES ('catalogo', $1, $2, $3)", [user.id, `Quitó #${Number(req.body?.id)}`, Date.now()]);
  return { catalog: await market.listCatalog(d) };
});

app.get('/api/panel/policia/actividad', panelLimit, panelRoute(async ({ user, db: d, jobs }) => {
  if (!hasPolice(jobs) && !jobs.includes('transito')) throw new panel.PanelError(403, 'No tienes rol de Policía ni de ATT.');
  return panel.officerActivity(d, user.id);
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'no_encontrado' }));

// Fotos de carros y casas (las sube un admin)
app.get('/img/vehiculo/:placa', async (req, res) => {
  const placa = String(req.params.placa || '').toUpperCase();
  const d = /^[A-Z0-9-]{3,12}$/.test(placa) ? await getDb() : null;
  const img = d ? await market.getVehicleImage(d, placa).catch(() => null) : null;
  if (!img) return res.status(404).end();
  res.setHeader('Content-Type', img.mime);
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(img.body);
});
app.get('/img/catalogo/:id', async (req, res) => {
  const id = Number(req.params.id);
  const d = Number.isSafeInteger(id) ? await getDb() : null;
  const img = d ? await market.getImage(d, id).catch(() => null) : null;
  if (!img) return res.status(404).end();
  res.setHeader('Content-Type', img.mime);
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(img.body);
});

app.get('/healthz', (req, res) => res.type('text').send('ok'));

// Con la whitelist ya aceptada, la página de solicitud manda directo al panel
async function acceptedToPanel(req, res, next) {
  const user = req.session?.user;
  if (!user) return next();
  const status = await whitelistStatus(user.id).catch(() => null);
  if (status !== 'aceptada') return next();
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, '/panel');
}
app.get('/solicitud', acceptedToPanel);
app.get('/solicitud.html', acceptedToPanel);

// ─── Archivos de la página ───
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  dotfiles: 'ignore',
  setHeaders(res, filePath) {
    res.setHeader('Cache-Control', /\.(webp|png|jpe?g|svg|ico)$/i.test(filePath) ? 'public, max-age=604800' : 'no-cache');
  },
}));
app.use((req, res) => res.redirect('/'));

// Errores: se registran en el servidor, pero al visitante nunca se le muestran detalles.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && (err.status === 400 || err.status === 413)) {
    return res.status(err.status).json({ error: err.status === 413 ? 'Solicitud demasiado grande.' : 'Datos inválidos.' });
  }
  console.error('[error]', err && err.message ? err.message : err);
  res.status(500).type('text').send('Error interno del servidor');
});

app.listen(PORT, () => {
  console.log(`Panamá RP en ${BASE_URL}`);
  console.log(loginConfigured() ? 'Login con Discord: activo' : 'Login con Discord: falta DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET');
  console.log(`Redirect URI para Discord: ${REDIRECT_URI}`);
  console.log(WEBHOOK_URL ? 'Solicitudes de whitelist: activas' : 'Solicitudes de whitelist: falta WHITELIST_WEBHOOK_URL');
  const missing = [!BOT_TOKEN && 'DISCORD_BOT_TOKEN', !PUBLIC_KEY && 'DISCORD_PUBLIC_KEY'].filter(Boolean);
  console.log(missing.length ? `Botones Aceptar/Rechazar: falta ${missing.join(' y ')}` : 'Botones Aceptar/Rechazar: activos');
  if (BOT_TOKEN_RAW && !BOT_TOKEN) console.log('DISCORD_BOT_TOKEN no tiene el formato de un token de bot.');
  if (process.env.DISCORD_PUBLIC_KEY && !PUBLIC_KEY) console.log('DISCORD_PUBLIC_KEY no es válida (deben ser 64 caracteres).');
  console.log(DISCORD_MODE === 'gateway'
    ? 'Comandos y botones: por el gateway (la web contesta solo los suyos; los de antes, el bot de antes)'
    : `Comandos y botones: por la Interactions Endpoint URL ${BASE_URL}/api/discord/interactions`);
  console.log(`Rol al aceptar: ${WHITELIST_ROLE || 'ninguno (falta WHITELIST_ROLE)'}`);
  getDb();
  console.log(erlc ? `ER:LC: conectado${ERLC_REQUIRE_INGAME ? ' (para iniciar turno hay que estar dentro del servidor)' : ''}` : 'ER:LC: falta ERLC_API_KEY');
  if (erlc) erlc.status().then((st) => console.log(st.encendido ? `ER:LC: ${st.nombre} · ${st.jugadores}/${st.maximo} jugadores` : 'ER:LC: servidor apagado')).catch((err) => console.log(`ER:LC: ${err.message}`));
  if (bot) setTimeout(() => syncCommands().catch((err) => console.error('[comandos]', err.message)), 3000);
  const probe = `${API}/invites/${encodeURIComponent(INVITE_CODE)}`;
  discordRequest(fetch, probe).then((r) => {
    console.log(r.ok ? 'API de Discord (IP principal): responde bien' : `API de Discord (IP principal): ${r.status}${r.limit ? ` (${describeLimit(r.limit)})` : ''}`);
    // Si al arrancar la IP ya está castigada, todo va por el puente desde el principio
    if (r.status === 429 && (r.limit?.cloudflare || (r.limit?.retryAfter ?? 0) > 60)) dfetch.ban((r.limit?.retryAfter || 600) * 1000);
  });
  if (relay) {
    relay(probe).then((r) => console.log(r.ok ? 'Puente a Discord: listo y Discord responde' : `Puente a Discord: Discord respondió ${r.status}`))
      .catch((err) => console.log(`Puente a Discord: no responde (${err.message})`));
  } else {
    console.log('Puente a Discord: no configurado (RELAY_URL / RELAY_SECRET)');
  }
  // Llave de ER:LC guardada con /erlc set_key (si no está en Render) y tareas cada minuto
  if (bot) {
    setTimeout(async () => {
      const store = await getDb();
      if (!store) return;
      if (!erlc) {
        const key = await botCfg(store, 'secreto', 'erlc_key').catch(() => '');
        if (key) { setErlcKey(key); console.log('ER:LC: llave cargada de la base de datos (/erlc set_key)'); }
      }
      setInterval(() => {
        getDb().then((d) => d && housekeeping({ db: d, api: (m, r, b, o) => bot.call(m, r, b, o), guildId: HOME_GUILD, now: () => Date.now() }))
          .catch((err) => console.error('[tareas]', err.message));
      }, 60_000);
    }, 5000);
  }
  if (bot && DISCORD_MODE === 'gateway') {
    startGateway({
      token: BOT_TOKEN,
      onDispatch: (t, d) => {
        if (t === 'READY' && !gatewayOnce) {
          gatewayOnce = true;
          releaseInteractionsUrl().catch((err) => console.error('[gateway]', err.message));
          // ¿A cuántos jueces y abogados/fiscales les llegarían los casos por DM?
          setTimeout(async () => {
            const store = await getDb();
            if (!store) return;
            const [j, a] = await Promise.all([membersWithRoles(await botCfg(store, 'roles', 'jueces')), membersWithRoles(await botCfg(store, 'roles', 'abogados'))]);
            console.log(`Justicia (DM): ${j.length} juez(es), ${a.length} abogado(s)/fiscal(es)`);
          }, 8000);
        }
        if (t === 'INTERACTION_CREATE') onGatewayInteraction(d).catch((err) => console.error('[gateway]', err.message));
      },
    });
  } else if (bot) {
    touchGateway(BOT_TOKEN).then((r) => console.log(r.ok ? 'Bot de Discord: conectado (modo url)' : `Bot de Discord: no se pudo conectar (${r.reason})`));
  }
});
