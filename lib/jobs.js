// Trabajos del panel. Cada trabajo se activa si la persona tiene en Discord un rol cuyo nombre
// coincide con alguna de sus palabras (sin importar tildes, mayúsculas ni emojis).
// Se pueden cambiar con la variable JOB_ROLES, por ejemplo:
//   JOB_ROLES="policia=Policía Nacional;ems=Paramédicos;mecanico=Taller"
import { normRoleName } from './review.js';

export const JOBS = {
  // Cada trabajo es un rol de Discord de Panamá RP (por ID). 'policia' es la Policía Nacional.
  policia: { name: 'Policía Nacional', icon: '🚓', color: '#3a6af0', roles: [], ids: ['1560736880872525836'] },
  aeronaval: { name: 'Aeronaval', icon: '🚁', color: '#0ea5e9', roles: [], ids: ['1560736880872525835'] },
  senafront: { name: 'Senafront', icon: '🪖', color: '#16a34a', roles: [], ids: ['1565913556535353444'] },
  transito: { name: 'ATT', icon: '🚦', color: '#eab308', roles: [], ids: ['1560736880478130184'] },
  bomberos: { name: 'Bomberos', icon: '🚒', color: '#f97316', roles: [], ids: ['1560736880872525834'] },
  mecanico: { name: 'Mecánico', icon: '🔧', color: '#a855f7', roles: [], ids: ['1560736880478130184'] }, // el rol de la ATT también es mecánico
};

// Cuerpos de policía (arrestos, antecedentes y juicios). La ATT pone multas.
export const POLICE_JOBS = ['policia', 'aeronaval', 'senafront'];
export const hasPolice = (jobs = []) => jobs.some((j) => POLICE_JOBS.includes(j));

export const SHIFT = { minMinutes: 5, maxMinutes: 240 };

// Lee JOB_ROLES y devuelve los trabajos con los nombres de rol ajustados.
export function configureJobs(envValue = '') {
  const jobs = structuredClone(JOBS);
  for (const part of String(envValue).split(';')) {
    const [key, names] = part.split('=');
    const k = (key || '').trim().toLowerCase();
    if (!jobs[k] || !names) continue;
    const list = names.split(',').map((n) => n.trim()).filter(Boolean);
    if (list.length) jobs[k].roles = list;
  }
  return jobs;
}

// ¿Qué trabajos tiene alguien? memberRoleIds: IDs de sus roles; guildRoles: [{id, name}] del servidor.
export function jobsFor(memberRoleIds, guildRoles, jobs = JOBS) {
  const names = guildRoles.filter((r) => memberRoleIds.includes(r.id)).map((r) => normRoleName(r.name));
  return Object.keys(jobs).filter((key) => (jobs[key].ids || []).some((id) => memberRoleIds.includes(id)) || (jobs[key].roles || []).some((w) => {
    const word = normRoleName(w);
    return word && names.some((n) => n === word || n.split(' ').includes(word) || n.includes(word));
  }));
}

export function publicJobs(jobs = JOBS) {
  return Object.fromEntries(Object.entries(jobs).map(([k, j]) => [k, { name: j.name, icon: j.icon, color: j.color }]));
}
