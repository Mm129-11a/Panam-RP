// Vincular la cuenta de Roblox: la persona pone un código en la descripción ("Acerca de") de su
// perfil de Roblox y comprobamos que esté ahí. Así se sabe que la cuenta es suya.
import crypto from 'node:crypto';

// Palabras sencillas (sin números ni tildes, para que el filtro de Roblox no las tape)
const WORDS = ['SOL', 'MAR', 'RIO', 'LUZ', 'OLA', 'ISLA', 'CANAL', 'SELVA', 'TUCAN', 'MANGO', 'COCO', 'PALMA', 'FARO',
  'BARCO', 'PUERTO', 'ARENA', 'BRISA', 'NUBE', 'LUNA', 'RAYO', 'PERLA', 'CORAL', 'JAGUAR', 'AGUILA', 'CAFE', 'CACAO',
  'TAMBOR', 'COLINA', 'LAGO', 'BAHIA', 'PIRATA', 'ANCLA', 'VELERO', 'MONTE', 'TRUENO', 'COMETA'];

export const LINK_TTL = 30 * 60 * 1000;

export function makeCode(randomInt = crypto.randomInt) {
  const pick = () => WORDS[randomInt(WORDS.length)];
  return `PRP ${pick()} ${pick()} ${pick()}`;
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]+/g, ' ').trim();

// ¿La descripción tiene el código? (sin importar mayúsculas, guiones o espacios de más)
export function hasCode(description, code) {
  const c = norm(code);
  return Boolean(c) && ` ${norm(description)} `.includes(` ${c} `);
}

export async function fetchRobloxProfile(id, fetchImpl = fetch) {
  const r = await fetchImpl(`https://users.roblox.com/v1/users/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(6000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Roblox respondió ${r.status}`);
  const d = await r.json();
  return { id: String(d.id), name: String(d.name || ''), displayName: String(d.displayName || d.name || ''), description: String(d.description || '') };
}
