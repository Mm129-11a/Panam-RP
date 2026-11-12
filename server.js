// Panamá Roleplay — servidor web
// Sirve la página, el inicio de sesión con Discord y los contadores en vivo.
import express from 'express';
import cookieSession from 'cookie-session';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `${BASE_URL}/auth/discord/callback`;
const INVITE_CODE = process.env.DISCORD_INVITE_CODE || 'fgRGQPbJF3';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const API = 'https://discord.com/api/v10';

app.set('trust proxy', 1);
app.use(cookieSession({
  name: 'prp_session',
  secret: process.env.SESSION_SECRET || 'cambia-esto-en-render',
  httpOnly: true,
  sameSite: 'lax',
  secure: BASE_URL.startsWith('https://'),
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 días
}));

const loginConfigured = () => Boolean(CLIENT_ID && CLIENT_SECRET);

// ─── Inicio de sesión con Discord ───
app.get('/auth/discord', (req, res) => {
  if (!loginConfigured()) return res.redirect('/?login=noconfig');
  const state = crypto.randomBytes(16).toString('hex');
  req.session.state = state;
  const params = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: GUILD_ID ? 'identify guilds' : 'identify', state, prompt: 'none',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code) return res.redirect('/?login=cancel');
  if (!state || state !== req.session.state) return res.redirect('/?login=error');
  req.session.state = null;
  try {
    const tokenRes = await fetch(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code',
        code: String(code), redirect_uri: REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}: ${await tokenRes.text()}`);
    const { access_token } = await tokenRes.json();
    const auth = { headers: { Authorization: `Bearer ${access_token}` } };

    const userRes = await fetch(`${API}/users/@me`, auth);
    if (!userRes.ok) throw new Error(`user ${userRes.status}`);
    const u = await userRes.json();

    if (GUILD_ID) {
      const guilds = await (await fetch(`${API}/users/@me/guilds`, auth)).json();
      if (!Array.isArray(guilds) || !guilds.some((g) => g.id === GUILD_ID)) return res.redirect('/?login=guild');
    }

    const avatar = u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;
    req.session.user = { id: u.id, name: u.global_name || u.username, username: u.username, avatar };
    res.redirect('/?login=ok');
  } catch (err) {
    console.error('[login]', err.message);
    res.redirect('/?login=error');
  }
});

app.get('/logout', (req, res) => { req.session = null; res.redirect('/'); });

app.get('/api/me', (req, res) => res.json({ user: req.session?.user || null, loginEnabled: loginConfigured() }));

// ─── Contadores en vivo (miembros y conectados de Discord) ───
let statsCache = { members: null, online: null, at: 0 };
app.get('/api/stats', async (req, res) => {
  if (Date.now() - statsCache.at > 5 * 60 * 1000) {
    try {
      const r = await fetch(`${API}/invites/${INVITE_CODE}?with_counts=true`);
      if (r.ok) {
        const d = await r.json();
        statsCache = { members: d.approximate_member_count, online: d.approximate_presence_count, at: Date.now() };
      }
    } catch (err) { console.error('[stats]', err.message); }
  }
  res.json({ members: statsCache.members, online: statsCache.online, invite: `https://discord.gg/${INVITE_CODE}` });
});

app.get('/healthz', (req, res) => res.send('ok'));

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use((req, res) => res.redirect('/'));

app.listen(PORT, () => {
  console.log(`Panamá RP en ${BASE_URL}`);
  console.log(loginConfigured() ? 'Login con Discord: activo' : 'Login con Discord: falta DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET');
  console.log(`Redirect URI para Discord: ${REDIRECT_URI}`);
});
