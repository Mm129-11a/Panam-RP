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

// ¿Es un bloqueo de Cloudflare a la IP (no un límite normal de Discord)?
export async function isIpBan(response) {
  if (response.status !== 429) return false;
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) return false;
  const text = await response.clone().text().catch(() => '');
  return /1015|banned|rate limited|cloudflare/i.test(text) || !text;
}

// Va directo a Discord; si la IP está bloqueada, usa el puente (y lo sigue usando un rato
// para no sumar más errores a la IP bloqueada).
export function createSmartFetch({ direct = fetch, relay = null, banMs = 10 * 60_000, onBan = () => {}, now = () => Date.now() }) {
  let bannedUntil = 0;
  const smart = async function smartFetch(url, opts = {}) {
    if (relay && now() < bannedUntil) return relay(url, opts);
    const r = await direct(url, opts);
    if (relay && (await isIpBan(r))) {
      const first = now() >= bannedUntil;
      bannedUntil = now() + banMs;
      if (first) onBan();
      return relay(url, opts);
    }
    return r;
  };
  smart.state = () => ({ usingRelay: now() < bannedUntil });
  return smart;
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
