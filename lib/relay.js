// Puente a Discord.
// Render gratis comparte su IP de salida con muchos servicios y Discord (Cloudflare) a veces la
// bloquea durante horas (error 1015). El puente es un servicio pequeño en otra región: el servidor
// principal le pasa la petición firmada y el puente la hace a Discord desde su propia IP.
import crypto from 'node:crypto';

export const RELAY_HEADERS = ['authorization', 'content-type', 'x-audit-log-reason', 'user-agent'];
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_SKEW = 60_000;

export function signRelay(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function verifyRelay({ secret, timestamp, signature, body, now = Date.now() }) {
  if (!secret || typeof signature !== 'string' || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (typeof timestamp !== 'string' || !/^\d{10,16}$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp)) > MAX_SKEW) return false;
  const good = Buffer.from(signRelay(secret, timestamp, body), 'hex');
  const got = Buffer.from(signature, 'hex');
  return got.length === good.length && crypto.timingSafeEqual(got, good);
}

// Solo se aceptan peticiones a la API de Discord (nada de usar el puente para otra cosa).
export function checkTarget(rawUrl, base = 'https://discord.com') {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  const b = new URL(base);
  if (u.protocol !== b.protocol || u.host !== b.host || !u.pathname.startsWith('/api/')) return null;
  if (u.username || u.password) return null;
  return u;
}

function pickHeaders(headers) {
  const out = {};
  const get = (k) => (typeof headers?.get === 'function' ? headers.get(k) : headers?.[k] ?? headers?.[k.toLowerCase()]
    ?? Object.entries(headers || {}).find(([h]) => h.toLowerCase() === k)?.[1]);
  for (const k of RELAY_HEADERS) {
    const v = get(k);
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

function bodyToString(body, headers) {
  if (body === undefined || body === null) return { body: null, headers };
  if (body instanceof URLSearchParams) {
    return { body: body.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers } };
  }
  return { body: String(body), headers };
}

// fetch que pasa por el puente. Devuelve un Response normal, como si se hubiera llamado a Discord.
export function createRelayFetch({ relayUrl, secret, fetchImpl = fetch, timeoutMs = 55_000 }) {
  return async function relayFetch(url, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    const packed = bodyToString(opts.body, pickHeaders(opts.headers));
    const payload = JSON.stringify({ method, url: String(url), headers: packed.headers, body: packed.body });
    const timestamp = String(Date.now());
    const r = await fetchImpl(`${relayUrl}/relay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-relay-timestamp': timestamp, 'x-relay-signature': signRelay(secret, timestamp, payload) },
      body: payload,
      signal: AbortSignal.timeout(timeoutMs), // el puente puede estar dormido: Render tarda en despertarlo
    });
    if (!r.ok) throw new Error(`el puente respondió ${r.status}`);
    const out = await r.json();
    return new Response(out.status === 204 ? null : out.body, { status: out.status, headers: out.headers || {} });
  };
}

// ¿Discord bloqueó la IP (no es un límite normal)? Devuelve cuántos ms conviene usar el puente (0 = no).
// - Cloudflare (texto "1015", "banned"…): no dice cuánto, se usa el tiempo por defecto.
// - JSON con espera larga (ej. "esperar 2820s") o "blocked from accessing our API temporarily":
//   Discord castigó la IP compartida de Render; esperar aquí no sirve, hay que ir por el puente.
const LONG_WAIT_S = 60;
export async function ipBanWait(response, fallbackMs = 10 * 60_000) {
  if (response.status !== 429) return 0;
  const type = response.headers.get('content-type') || '';
  const text = await response.clone().text().catch(() => '');
  if (!type.includes('application/json')) return /1015|banned|rate limited|cloudflare/i.test(text) || !text ? fallbackMs : 0;
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  const wait = Number(data?.retry_after ?? response.headers.get('retry-after'));
  if (/blocked from accessing our api/i.test(String(data?.message || '')) || (Number.isFinite(wait) && wait > LONG_WAIT_S)) {
    return Number.isFinite(wait) && wait > 0 ? Math.min(wait * 1000, 3 * 60 * 60_000) : fallbackMs;
  }
  return 0;
}
export async function isIpBan(response) {
  return (await ipBanWait(response)) > 0;
}

// Va directo a Discord; si la IP está bloqueada, usa el puente (y lo sigue usando mientras dure el
// bloqueo, al menos 10 min, para no sumar más errores a la IP bloqueada).
// Cualquier otro 429 también se prueba una vez por el puente: si por ahí sí entra, el problema era la
// IP de Render y se sigue por el puente 10 min (la IP compartida de Render a veces la castiga Discord).
export function createSmartFetch({ direct = fetch, relay = null, banMs = 10 * 60_000, onBan = () => {}, onOdd = () => {}, now = () => Date.now() }) {
  let bannedUntil = 0;
  const ban = (ms) => {
    const first = now() >= bannedUntil;
    bannedUntil = Math.max(bannedUntil, now() + Math.max(banMs, ms));
    if (first) onBan(Math.round((bannedUntil - now()) / 60_000));
  };
  const smart = async function smartFetch(url, opts = {}) {
    if (relay && now() < bannedUntil) return relay(url, opts);
    const r = await direct(url, opts);
    if (!relay || r.status !== 429) return r;
    const wait = await ipBanWait(r, banMs);
    if (wait > 0) { ban(wait); return relay(url, opts); }
    const viaRelay = await relay(url, opts).catch(() => null);
    if (!viaRelay) return r;
    if (viaRelay.status !== 429) {
      onOdd(await describe429(r));
      ban(banMs);
    }
    return viaRelay;
  };
  smart.state = () => ({ usingRelay: now() < bannedUntil });
  smart.ban = (ms) => { if (relay) ban(ms); }; // p. ej. si al arrancar Discord ya dice "esperar 2820s"
  return smart;
}
// Resumen de un 429 para los logs (Discord no manda nada secreto en ese cuerpo)
async function describe429(r) {
  const text = await r.clone().text().catch(() => '');
  const h = (k) => r.headers.get(k) || '-';
  return `tipo=${h('content-type')} espera=${h('retry-after')} global=${h('x-ratelimit-global')} scope=${h('x-ratelimit-scope')} cuerpo=${text.replace(/\s+/g, ' ').slice(0, 120)}`;
}

// Lado del puente: valida y ejecuta una petición recibida. Devuelve { status, json }.
export async function handleRelay({ secret, timestamp, signature, rawBody, target = 'https://discord.com', fetchImpl = fetch, now = Date.now() }) {
  if (!verifyRelay({ secret, timestamp, signature, body: rawBody, now })) return { status: 401, json: { error: 'firma' } };
  let req;
  try { req = JSON.parse(rawBody); } catch { return { status: 400, json: { error: 'json' } }; }
  const method = String(req?.method || '').toUpperCase();
  const url = checkTarget(req?.url); // siempre https://discord.com/api/…
  if (!METHODS.has(method) || !url) return { status: 400, json: { error: 'destino' } };
  const headers = pickHeaders(req.headers);
  const body = typeof req.body === 'string' && method !== 'GET' ? req.body : undefined;
  try {
    const r = await fetchImpl(`${target}${url.pathname}${url.search}`, { method, headers, body, signal: AbortSignal.timeout(15_000), redirect: 'manual' });
    const text = r.status === 204 ? '' : await r.text();
    const keep = {};
    for (const k of ['content-type', 'retry-after', 'x-ratelimit-global', 'x-ratelimit-scope', 'x-ratelimit-remaining', 'x-ratelimit-reset-after']) {
      const v = r.headers.get(k);
      if (v) keep[k] = v;
    }
    return { status: 200, json: { status: r.status, headers: keep, body: text } };
  } catch (err) {
    return { status: 502, json: { error: 'discord', detail: err.message } };
  }
}
