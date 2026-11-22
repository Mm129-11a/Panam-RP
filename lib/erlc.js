// Conexión con la API de ER:LC (Police Roleplay Community).
// La llave (Server-Key) se saca dentro del juego: servidor privado → ajustes → "API key" (ER:LC API).
// Va en Render como ERLC_API_KEY; nunca en el código.

const BASE = 'https://api.policeroleplay.community/v1';

// "Nombre:123" → { name, id }
export function parsePlayer(raw) {
  const s = typeof raw === 'string' ? raw : '';
  const i = s.lastIndexOf(':');
  if (i <= 0) return null;
  const name = s.slice(0, i);
  const id = s.slice(i + 1);
  return /^\d{1,20}$/.test(id) && name ? { name, id } : null;
}

export function createErlc({ key, fetchImpl = fetch, base = BASE, now = () => Date.now() }) {
  const cache = new Map();
  async function get(path, ttl) {
    const hit = cache.get(path);
    if (hit && now() < hit.until) return hit.value;
    const r = await fetchImpl(`${base}${path}`, { headers: { 'Server-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (r.status === 403 || r.status === 401) throw Object.assign(new Error('La llave de ER:LC no es válida (ERLC_API_KEY).'), { code: 'llave' });
    if (r.status === 422) {
      // el servidor privado está apagado / sin jugadores
      const value = path === '/server/players' ? [] : null;
      cache.set(path, { value, until: now() + ttl });
      return value;
    }
    if (!r.ok) throw Object.assign(new Error(`ER:LC respondió ${r.status}`), { code: r.status === 429 ? 'limite' : 'error' });
    const value = await r.json();
    cache.set(path, { value, until: now() + ttl });
    return value;
  }
  return {
    // { nombre, jugadores, maximo, codigo }
    async status() {
      const s = await get('/server', 30_000);
      if (!s) return { encendido: false };
      return {
        encendido: true,
        nombre: String(s.Name || ''),
        jugadores: Number(s.CurrentPlayers) || 0,
        maximo: Number(s.MaxPlayers) || 0,
        codigo: String(s.JoinKey || ''),
      };
    },
    // [{ name, id, team }]
    async players() {
      const list = await get('/server/players', 15_000);
      return (Array.isArray(list) ? list : []).map((p) => {
        const who = parsePlayer(p?.Player);
        return who ? { ...who, team: String(p.Team || '') } : null;
      }).filter(Boolean);
    },
    // Registros del servidor (entradas, asesinatos, comandos) — sin caché larga
    async logs(kind) {
      const path = { entradas: '/server/joinlogs', kills: '/server/killlogs', comandos: '/server/commandlogs' }[kind];
      if (!path) return [];
      const list = await get(path, 10_000);
      return Array.isArray(list) ? list : [];
    },
    // Ejecuta un comando dentro del juego (ej: ":h Hola"). Necesita una llave con permiso.
    async command(cmd) {
      const r = await fetchImpl(`${base}/server/command`, {
        method: 'POST',
        headers: { 'Server-Key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ command: String(cmd).slice(0, 200) }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.status === 403 || r.status === 401) throw Object.assign(new Error('La llave de ER:LC no es válida.'), { code: 'llave' });
      if (r.status === 422) throw Object.assign(new Error('El servidor de ER:LC está apagado.'), { code: 'apagado' });
      if (!r.ok) throw Object.assign(new Error(`ER:LC respondió ${r.status}`), { code: r.status === 429 ? 'limite' : 'error' });
      return true;
    },
    async isInServer({ id, name }) {
      const list = await this.players();
      const n = String(name || '').toLowerCase();
      return list.some((p) => (id && p.id === String(id)) || (n && p.name.toLowerCase() === n));
    },
  };
}
