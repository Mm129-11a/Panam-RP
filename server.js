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
app.use(methodGuard(['/logout']));
app.use(rateLimit({ windowMs: 60_000, max: 300, keyFn: ipOf }));

const authLimit = rateLimit({
  windowMs: 10 * 60_000, max: 30, keyFn: ipOf,
  message: 'Demasiados intentos de inicio de sesión. Espera unos minutos.',
});
const apiLimit = rateLimit({ windowMs: 60_000, max: 60, keyFn: ipOf });
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
const discordFetch = (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });

// ─── Inicio de sesión con Discord ───
app.get('/auth/discord', authLimit, noStore, (req, res) => {
  if (!loginConfigured()) return res.redirect('/?login=noconfig');
  if (req.session.user) return res.redirect('/');
  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauth = { state, t: Date.now() };
  const params = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: GUILD_ID ? 'identify guilds' : 'identify', state, prompt: 'none',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', authLimit, noStore, async (req, res) => {
  const { code, state, error } = req.query;
  const saved = req.session.oauth;
  req.session.oauth = null; // un intento de login solo se puede usar una vez

  if (error || typeof code !== 'string' || !code || code.length > 256) return res.redirect('/?login=cancel');
  if (!saved || typeof saved.state !== 'string' || Date.now() - Number(saved.t) > OAUTH_MAX_AGE
      || !safeEqual(typeof state === 'string' ? state : '', saved.state)) {
    return res.redirect('/?login=error');
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
    if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
    const { access_token } = await tokenRes.json();
    if (typeof access_token !== 'string') throw new Error('token inválido');
    const auth = { headers: { Authorization: `Bearer ${access_token}` } };

    const userRes = await discordFetch(`${API}/users/@me`, auth);
    if (!userRes.ok) throw new Error(`user ${userRes.status}`);
    const u = await userRes.json();
    if (!/^\d{5,25}$/.test(String(u.id))) throw new Error('usuario inválido');

    if (GUILD_ID) {
      const guildsRes = await discordFetch(`${API}/users/@me/guilds`, auth);
      const guilds = guildsRes.ok ? await guildsRes.json() : [];
      if (!Array.isArray(guilds) || !guilds.some((g) => g && g.id === GUILD_ID)) return res.redirect('/?login=guild');
    }

    const avatar = /^(a_)?[0-9a-f]{32}$/.test(String(u.avatar || ''))
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;
    const name = String(u.global_name || u.username || 'Usuario').slice(0, 64);
    req.session.user = { id: String(u.id), name, username: String(u.username || '').slice(0, 64), avatar };
    res.redirect('/?login=ok');
  } catch (err) {
    console.error('[login]', err.message); // nunca se registran tokens ni secretos
    res.redirect('/?login=error');
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
app.get('/api/me', apiLimit, noStore, (req, res) => {
  res.json({ user: req.session?.user || null, loginEnabled: loginConfigured() });
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
app.use('/api', (req, res) => res.status(404).json({ error: 'no_encontrado' }));

app.get('/healthz', (req, res) => res.type('text').send('ok'));

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
  console.error('[error]', err && err.message ? err.message : err);
  if (res.headersSent) return next(err);
  res.status(500).type('text').send('Error interno del servidor');
});

app.listen(PORT, () => {
  console.log(`Panamá RP en ${BASE_URL}`);
  console.log(loginConfigured() ? 'Login con Discord: activo' : 'Login con Discord: falta DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET');
  console.log(`Redirect URI para Discord: ${REDIRECT_URI}`);
});
