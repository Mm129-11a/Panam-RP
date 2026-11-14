// Solicitud de whitelist de Panamá RP: preguntas, validación y mensaje para el staff.
// Las respuestas correctas solo viven aquí (en el servidor); al navegador se le
// mandan las preguntas sin ellas.

export const OPTIONS = {
  genero: ['Masculino', 'Femenino', 'Otro'],
  sangre: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
  nacionalidad: ['Panameña', 'Colombiana', 'Venezolana', 'Costarricense', 'Nicaragüense', 'Mexicana', 'Estadounidense', 'Española', 'Otra'],
};

export const AGE = { min: 18, max: 90 };
export const TEXT = { min: 50, max: 500 };

export const SECTIONS = [
  {
    id: 'conducta',
    title: 'Conducta y sanciones',
    intro: 'Responde según la normativa del servidor.',
    questions: [
      { id: 'c1', type: 'yesno', text: '¿Entiendes que si acumulas más de 2 sanciones serás baneado del servidor?', expect: 'si' },
      { id: 'c2', type: 'text', text: '¿Qué pasa si solo te dedicas a pelear (PVP) sin hacer rol?' },
      { id: 'c3', type: 'text', text: '¿Qué consecuencias tiene ser tóxico con el servidor o con otros miembros?' },
      {
        id: 'c4', type: 'choice', text: 'Ves a alguien rompiendo las normas en pleno rol. ¿Qué haces?',
        options: ['Lo insulto por el chat', 'Rompo el rol yo también para vengarme', 'Sigo en rol y lo reporto al staff con pruebas', 'Me salgo del servidor'],
        answer: 2,
      },
    ],
  },
  {
    id: 'rol',
    title: 'Conocimiento de rol',
    intro: 'Conceptos básicos para rolear en Panamá RP.',
    questions: [
      {
        id: 'r1', type: 'choice', text: '¿Qué es Metagaming (MG)?',
        options: ['Usar dentro del rol información de afuera (Discord, streams, mensajes)', 'Hacer acciones imposibles en el juego', 'Matar a alguien sin motivo', 'Manejar a alta velocidad'],
        answer: 0,
      },
      {
        id: 'r2', type: 'choice', text: '¿Qué es Powergaming (PG)?',
        options: ['Tener mucho dinero en el juego', 'Hacer acciones imposibles u obligar a otros sin dejarles responder', 'Jugar muchas horas seguidas', 'Ser parte del staff'],
        answer: 1,
      },
      {
        id: 'r3', type: 'choice', text: '¿Qué es RDM / VDM?',
        options: ['Robar un banco con rol previo', 'Matar o atropellar a alguien sin un rol previo que lo justifique', 'Pedir refuerzos por radio', 'Usar un vehículo de trabajo'],
        answer: 1,
      },
      { id: 'r4', type: 'text', text: 'Te apuntan con un arma y te piden tus pertenencias. ¿Cómo actúas y por qué?' },
      { id: 'r5', type: 'yesno', text: '¿Usarás un avatar realista con el cuerpo cuadrado de Roblox?', expect: 'si' },
    ],
  },
];

const ALL_QUESTIONS = SECTIONS.flatMap((s) => s.questions);

// Lo que ve el navegador: sin respuestas correctas.
export function publicSections() {
  return SECTIONS.map((s) => ({
    id: s.id, title: s.title, intro: s.intro,
    questions: s.questions.map(({ id, type, text, options }) => ({
      id, type, text, ...(options ? { options } : {}), ...(type === 'text' ? { min: TEXT.min, max: TEXT.max } : {}),
    })),
  }));
}

export const ROBLOX_USER_RE = /^[A-Za-z0-9_]{3,20}$/;
const NAME_RE = /^\p{L}[\p{L}' -]{1,39}$/u;

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

export function ageOn(isoDate, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  let age = now.getUTCFullYear() - y;
  const beforeBirthday = now.getUTCMonth() < mo - 1 || (now.getUTCMonth() === mo - 1 && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

// Respuesta escrita "real": largo mínimo y que no sea un relleno como "aaaaaa".
function textProblem(value) {
  if (value.length < TEXT.min) return `Escribe al menos ${TEXT.min} caracteres.`;
  if (value.length > TEXT.max) return `Máximo ${TEXT.max} caracteres.`;
  if (new Set(value.toLowerCase().replace(/\s/g, '')).size < 8 || value.split(' ').length < 6) return 'Escribe una respuesta real, con tus palabras.';
  return null;
}

// Valida todo lo que manda el navegador. Nunca se confía en el navegador.
export function validateApplication(body, { now = new Date() } = {}) {
  const errors = {};
  const b = body && typeof body === 'object' ? body : {};
  const p = b.personaje && typeof b.personaje === 'object' ? b.personaje : {};
  const r = b.respuestas && typeof b.respuestas === 'object' ? b.respuestas : {};

  const roblox = clean(b.roblox);
  if (!ROBLOX_USER_RE.test(roblox)) errors.roblox = 'Usuario de Roblox inválido.';

  const personaje = {
    nombre: clean(p.nombre), apellidos: clean(p.apellidos), nacimiento: clean(p.nacimiento),
    genero: clean(p.genero), sangre: clean(p.sangre), nacionalidad: clean(p.nacionalidad),
  };
  if (!NAME_RE.test(personaje.nombre)) errors.nombre = 'Escribe un nombre válido (solo letras).';
  if (!NAME_RE.test(personaje.apellidos)) errors.apellidos = 'Escribe apellidos válidos (solo letras).';
  const age = ageOn(personaje.nacimiento, now);
  if (age === null) errors.nacimiento = 'Elige una fecha válida.';
  else if (age < AGE.min || age > AGE.max) errors.nacimiento = `Tu personaje debe tener entre ${AGE.min} y ${AGE.max} años.`;
  for (const k of ['genero', 'sangre', 'nacionalidad']) {
    if (!OPTIONS[k].includes(personaje[k])) errors[k] = 'Elige una opción.';
  }

  const respuestas = {};
  for (const q of ALL_QUESTIONS) {
    const v = r[q.id];
    if (q.type === 'yesno') {
      if (v !== 'si' && v !== 'no') errors[q.id] = 'Elige Sí o No.';
      else respuestas[q.id] = v;
    } else if (q.type === 'choice') {
      if (!Number.isInteger(v) || v < 0 || v >= q.options.length) errors[q.id] = 'Elige una opción.';
      else respuestas[q.id] = v;
    } else {
      const t = clean(v);
      const problem = textProblem(t);
      if (problem) errors[q.id] = problem;
      else respuestas[q.id] = t;
    }
  }

  if (b.acepto !== true) errors.acepto = 'Debes aceptar la normativa para enviar.';

  const ok = Object.keys(errors).length === 0;
  return { ok, errors, data: ok ? { roblox, personaje, edad: age, respuestas } : null };
}

// Resultado para el staff: preguntas de opción correctas y respuestas "No" donde se esperaba "Sí".
export function scoreApplication(respuestas) {
  const choice = ALL_QUESTIONS.filter((q) => q.type === 'choice');
  const correct = choice.filter((q) => respuestas[q.id] === q.answer).length;
  const flags = ALL_QUESTIONS.filter((q) => q.type === 'yesno' && respuestas[q.id] !== q.expect).map((q) => q.text);
  return { correct, total: choice.length, flags };
}

// Evita menciones masivas y recorta al límite de Discord.
function safe(text, max) {
  const t = String(text).replace(/@(everyone|here)/gi, '@​$1');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export function buildWebhookPayload({ user, roblox, data, score, preview = false }) {
  const p = data.personaje;
  const choiceLines = ALL_QUESTIONS.filter((q) => q.type === 'choice').map((q) => {
    const picked = data.respuestas[q.id];
    return `${picked === q.answer ? '✅' : '❌'} ${q.text} → ${q.options[picked]}`;
  });
  const yesnoLines = ALL_QUESTIONS.filter((q) => q.type === 'yesno').map((q) => `${data.respuestas[q.id] === q.expect ? '✅' : '⚠️'} ${q.text} → ${data.respuestas[q.id] === 'si' ? 'Sí' : 'No'}`);
  const textFields = ALL_QUESTIONS.filter((q) => q.type === 'text').map((q) => ({
    name: safe(q.text, 256), value: safe(data.respuestas[q.id], 1024),
  }));

  return {
    username: 'Whitelist Panamá RP',
    allowed_mentions: { parse: [] }, // nadie puede hacer @everyone desde el formulario
    content: `${preview ? '[PRUEBA] ' : ''}Nueva solicitud de <@${user.id}>`,
    embeds: [{
      title: 'Solicitud de whitelist',
      color: score.correct === score.total && score.flags.length === 0 ? 0x22c55e : 0xe0262f,
      fields: [
        { name: 'Discord', value: safe(`<@${user.id}> · ${user.name}\nID ${user.id}`, 1024), inline: true },
        { name: 'Roblox', value: safe(`[${roblox.name}](https://www.roblox.com/users/${roblox.id}/profile)\n${roblox.displayName} · ID ${roblox.id}`, 1024), inline: true },
        {
          name: 'Personaje (cédula IC)',
          value: safe(`**${p.nombre} ${p.apellidos}**\nNacimiento: ${p.nacimiento} (${data.edad} años)\nGénero: ${p.genero} · Sangre: ${p.sangre}\nNacionalidad: ${p.nacionalidad}`, 1024),
        },
        { name: `Conceptos: ${score.correct}/${score.total} correctas`, value: safe(choiceLines.join('\n'), 1024) },
        { name: 'Compromisos', value: safe(yesnoLines.join('\n'), 1024) },
        ...textFields,
      ],
      timestamp: new Date().toISOString(),
    }],
  };
}

export const WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\/\d{5,25}\/[\w-]{20,100}$/;
