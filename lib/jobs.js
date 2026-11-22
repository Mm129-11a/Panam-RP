// Trabajos del panel. Cada trabajo se activa si la persona tiene en Discord un rol cuyo nombre
// coincide con alguna de sus palabras (sin importar tildes, mayúsculas ni emojis).
// Se pueden cambiar con la variable JOB_ROLES, por ejemplo:
//   JOB_ROLES="policia=Policía Nacional;ems=Paramédicos;mecanico=Taller"
import { normRoleName } from './review.js';

export const JOBS = {
  // ids: roles de Panamá RP (Policía Nacional, Aeronaval, Senafront)
  policia: { name: 'Policía', icon: '🚓', color: '#3a6af0', payPerHour: 1200, roles: ['policia', 'police', 'pnp', 'oficial', 'aeronaval', 'senafront'], ids: ['1560736880872525836', '1560736880872525835', '1565913556535353444'] },
  ems: { name: 'Paramédico', icon: '🚑', color: '#22c55e', payPerHour: 1100, roles: ['ems', 'paramedico', 'medico', 'sinaproc'] },
  bomberos: { name: 'Bomberos', icon: '🚒', color: '#f97316', payPerHour: 1100, roles: ['bombero'], ids: ['1560736880872525834'] },
  transito: { name: 'Tránsito (ATT)', icon: '🚦', color: '#eab308', payPerHour: 1000, roles: ['transito', 'attt', 'att'], ids: ['1560736880478130184'] },
  mecanico: { name: 'Mecánico', icon: '🔧', color: '#a855f7', payPerHour: 900, roles: ['mecanico', 'taller'] },
};

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
  return Object.keys(jobs).filter((key) => (jobs[key].ids || []).some((id) => memberRoleIds.includes(id)) || jobs[key].roles.some((w) => {
    const word = normRoleName(w);
    return word && names.some((n) => n === word || n.split(' ').includes(word) || n.includes(word));
  }));
}

export function publicJobs(jobs = JOBS) {
  return Object.fromEntries(Object.entries(jobs).map(([k, j]) => [k, { name: j.name, icon: j.icon, color: j.color, payPerHour: j.payPerHour }]));
}
