// Seguridad de la web de Panamá RP.
// Solo usa APIs de Node (setHeader, statusCode, end), así funciona con Express
// y se puede probar sin instalar nada.
import crypto from 'node:crypto';

// ─── Política de contenido (CSP) ───
// Solo se permiten scripts y estilos propios, más las fuentes de Google y los
// avatares de Discord. Bloquea código inyectado y que otra web meta la nuestra en un marco.
export function buildCsp({ https = false } = {}) {
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' https://cdn.discordapp.com https://*.rbxcdn.com",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (https) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

// ─── Cabeceras de seguridad en todas las respuestas ───
export function securityHeaders({ https = false } = {}) {
  const csp = buildCsp({ https });
  return function securityHeadersMiddleware(req, res, next) {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

// ─── IP del visitante ───
// En Render hay Cloudflare delante: True-Client-IP / CF-Connecting-IP los pone
// Cloudflare y el visitante no puede falsificarlos. X-Forwarded-For sí se puede
// falsificar, por eso solo se usa como último recurso.
const IP_SOURCES = ['true-client-ip', 'cf-connecting-ip'];
export function clientIp(req, { behindRender = false } = {}) {
  if (behindRender) {
    for (const h of IP_SOURCES) {
      const v = req.headers[h];
      if (typeof v === 'string' && v && v.length <= 64) return { ip: v.trim(), source: h };
    }
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) {
      const first = xff.split(',')[0].trim();
      if (first && first.length <= 64) return { ip: first, source: 'x-forwarded-for' };
    }
  }
  const sock = (req.socket && req.socket.remoteAddress) || 'desconocida';
  return { ip: String(sock).replace(/^::ffff:/, ''), source: 'socket' };
}

// ─── Límite de solicitudes por visitante ───
// Ventana fija en memoria. Si alguien abusa, recibe 429 por un rato.
export function rateLimit({ windowMs, max, keyFn, message = 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.' }) {
  if (!(windowMs > 0) || !(max > 0) || typeof keyFn !== 'function') throw new Error('rateLimit: configuración inválida');
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, Math.max(windowMs, 10_000));
  if (typeof sweep.unref === 'function') sweep.unref();

  function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = keyFn(req);
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      if (hits.size >= 50_000) hits.clear(); // tope de memoria
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    const secs = Math.max(1, Math.ceil((entry.reset - now) / 1000));
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    res.setHeader('RateLimit-Reset', String(secs));
    if (entry.count > max) {
      res.statusCode = 429;
      res.setHeader('Retry-After', String(secs));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end(message);
    }
    return next();
  }
  rateLimitMiddleware.reset = () => hits.clear();
  return rateLimitMiddleware;
}

// ─── Solo GET/HEAD, salvo los POST permitidos ───
function pathOf(req) {
  return String(req.url || '/').split('?')[0];
}
export function methodGuard(allowedPostPaths = []) {
  return function methodGuardMiddleware(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (req.method === 'POST' && allowedPostPaths.includes(pathOf(req))) return next();
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Método no permitido');
  };
}

// ─── ¿La solicitud viene de nuestra propia web? (protección CSRF) ───
export function isSameOrigin(req, allowedOrigin) {
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site) return site === 'same-origin';
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin) return origin === allowedOrigin;
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer) {
    try { return new URL(referer).origin === allowedOrigin; } catch { return false; }
  }
  return false;
}

// ─── Comparación de textos en tiempo constante ───
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
