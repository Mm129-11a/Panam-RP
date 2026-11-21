// Puente a Discord (servicio aparte en otra región de Render). Sin dependencias.
// Variables: RELAY_SECRET (la misma que en el servidor principal), PORT (la pone Render).
import http from 'node:http';
import { handleRelay } from './lib/relay.js';

const PORT = process.env.PORT || 3100;
const SECRET = process.env.RELAY_SECRET || '';
const ON_RENDER = process.env.RENDER === 'true';
const TARGET = !ON_RENDER && process.env.RELAY_TARGET ? process.env.RELAY_TARGET : 'https://discord.com'; // otro destino solo en pruebas
const MAX_BODY = 256 * 1024;

if (SECRET.length < 32) {
  console.error('Falta RELAY_SECRET (32+ caracteres).');
  process.exit(1);
}

// Tope general por si alguien intenta saturarlo (igual necesita la firma para hacer algo).
let windowStart = Date.now();
let count = 0;
const allow = () => {
  if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); count = 0; }
  return ++count <= 300;
};

const send = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(obj));
};

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  if (req.method !== 'POST' || req.url !== '/relay') return send(res, 404, { error: 'no_encontrado' });
  if (!allow()) return send(res, 429, { error: 'demasiadas' });
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { send(res, 413, { error: 'grande' }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', async () => {
    if (res.writableEnded) return;
    const out = await handleRelay({
      secret: SECRET,
      timestamp: req.headers['x-relay-timestamp'],
      signature: req.headers['x-relay-signature'],
      rawBody: Buffer.concat(chunks).toString('utf8'),
      target: TARGET,
    });
    send(res, out.status, out.json);
  });
}).listen(PORT, async () => {
  console.log(`Puente a Discord escuchando en ${PORT}`);
  try {
    const r = await fetch(`${TARGET}/api/v10/invites/fgRGQPbJF3`, { signal: AbortSignal.timeout(10_000) });
    const blocked = r.status === 429 && !(r.headers.get('content-type') || '').includes('json');
    console.log(blocked ? 'Discord: esta IP también está bloqueada (1015)' : `Discord: responde (${r.status})`);
  } catch (err) {
    console.log(`Discord: sin conexión (${err.message})`);
  }
});
