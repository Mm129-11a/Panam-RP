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

// Lo que hace cada trabajo durante el turno: salen como botones mientras está en servicio y quedan
// registrados en el turno. La Policía Nacional, Aeronaval y Senafront NO hacen lo mismo.
export const JOB_ACTIONS = {
  policia: [
    { id: 'patrullaje', icon: '🚓', label: 'Patrullaje en la ciudad' },
    { id: 'llamada', icon: '📞', label: 'Atender llamada al 911' },
    { id: 'reten', icon: '🚧', label: 'Retén / control policial' },
    { id: 'persecucion', icon: '🚨', label: 'Persecución' },
    { id: 'robo', icon: '💰', label: 'Atender robo' },
    { id: 'disturbio', icon: '🥊', label: 'Disturbio / riña' },
    { id: 'apoyo', icon: '🤝', label: 'Apoyo a otra unidad' },
  ],
  aeronaval: [
    { id: 'aereo', icon: '🚁', label: 'Patrullaje aéreo' },
    { id: 'maritimo', icon: '🚤', label: 'Patrullaje marítimo' },
    { id: 'rescate_mar', icon: '🛟', label: 'Rescate en el mar' },
    { id: 'apoyo_aereo', icon: '🔦', label: 'Apoyo aéreo a persecución' },
    { id: 'embarcacion', icon: '⚓', label: 'Inspeccionar embarcación' },
    { id: 'decomiso_costa', icon: '📦', label: 'Decomiso en la costa' },
    { id: 'evacuacion', icon: '🏥', label: 'Evacuación aérea' },
  ],
  senafront: [
    { id: 'frontera', icon: '🥾', label: 'Patrullaje fronterizo' },
    { id: 'puesto', icon: '🛂', label: 'Puesto de control' },
    { id: 'selva', icon: '🌳', label: 'Operativo en la selva' },
    { id: 'contrabando', icon: '📦', label: 'Decomiso de contrabando' },
    { id: 'reconocimiento', icon: '🔭', label: 'Reconocimiento del terreno' },
    { id: 'comunidad', icon: '🤝', label: 'Apoyo a comunidades' },
  ],
  transito: [
    { id: 'radar', icon: '📡', label: 'Control de velocidad' },
    { id: 'accidente', icon: '💥', label: 'Atender accidente de tránsito' },
    { id: 'dirigir', icon: '🚦', label: 'Dirigir el tránsito' },
    { id: 'operativo', icon: '🚧', label: 'Operativo de tránsito' },
    { id: 'documentos', icon: '🪪', label: 'Revisar licencia y documentos' },
    { id: 'escolta', icon: '🏍️', label: 'Escolta' },
  ],
  bomberos: [
    { id: 'incendio', icon: '🔥', label: 'Apagar incendio' },
    { id: 'incendio_vehiculo', icon: '🚗', label: 'Incendio de vehículo' },
    { id: 'rescate', icon: '🪢', label: 'Rescate' },
    { id: 'auxilios', icon: '🩹', label: 'Primeros auxilios' },
    { id: 'gas', icon: '☣️', label: 'Fuga de gas' },
    { id: 'inspeccion', icon: '📋', label: 'Inspección de seguridad' },
  ],
  mecanico: [
    { id: 'reparar', icon: '🔧', label: 'Reparar vehículo' },
    { id: 'grua', icon: '🚛', label: 'Remolcar con grúa' },
    { id: 'llanta', icon: '🛞', label: 'Cambiar llanta' },
    { id: 'carretera', icon: '🧰', label: 'Asistencia en carretera' },
    { id: 'revision', icon: '📋', label: 'Revisión técnica' },
    { id: 'pintura', icon: '🎨', label: 'Pintura / modificaciones' },
  ],
};

// Cuerpos de policía (arrestos, antecedentes y juicios). La ATT pone multas.
export const POLICE_JOBS = ['policia', 'aeronaval', 'senafront'];
export const hasPolice = (jobs = []) => jobs.some((j) => POLICE_JOBS.includes(j));

export const SHIFT = { minMinutes: 5, maxMinutes: 240 };

// Sueldos (los pone un admin con /salario-configurar del bot; la web solo los muestra).
// salaries: [{ role_id, monto, cooldown_h }]
export function jobPay(salaries = [], jobs = JOBS) {
  const out = {};
  for (const [k, j] of Object.entries(jobs)) {
    const s = salaries.find((x) => (j.ids || []).includes(x.role_id));
    if (s) out[k] = { monto: s.monto, cooldown_h: s.cooldown_h };
  }
  return out;
}
// Lo que gana alguien con sus roles (nombre del trabajo o del rol de Discord)
export function paysFor(salaries = [], roleIds = [], guildRoles = [], jobs = JOBS) {
  return salaries.filter((s) => roleIds.includes(s.role_id)).map((s) => {
    const keys = Object.keys(jobs).filter((k) => (jobs[k].ids || []).includes(s.role_id));
    const name = keys.length ? keys.map((k) => jobs[k].name).join(' / ') : (guildRoles.find((r) => r.id === s.role_id)?.name || 'Rol de Discord');
    return { ...s, name, job: keys[0] || null, icon: keys.length ? jobs[keys[0]].icon : (s.monto < 0 ? '🧾' : '💼') };
  });
}

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
  return Object.fromEntries(Object.entries(jobs).map(([k, j]) => [k, { name: j.name, icon: j.icon, color: j.color, actions: JOB_ACTIONS[k] || [] }]));
}
