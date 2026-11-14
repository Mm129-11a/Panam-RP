// Pruebas de lib/whitelist.js — se corren con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTIONS, publicSections, validateApplication, scoreApplication, buildWebhookPayload, ageOn, WEBHOOK_RE,
} from '../lib/whitelist.js';

const NOW = new Date('2026-11-13T12:00:00Z');
const LONG = 'Primero levanto las manos, obedezco y valoro la vida de mi personaje porque quiero seguir rolando.';

function goodBody() {
  const respuestas = {};
  for (const s of SECTIONS) for (const q of s.questions) {
    respuestas[q.id] = q.type === 'yesno' ? 'si' : q.type === 'choice' ? q.answer : LONG;
  }
  return {
    roblox: 'Santi_RP2',
    personaje: { nombre: 'Santiago', apellidos: 'Ramírez López', nacimiento: '1998-05-20', genero: 'Masculino', sangre: 'O+', nacionalidad: 'Panameña' },
    respuestas,
    acepto: true,
  };
}

test('al navegador no le llegan las respuestas correctas', () => {
  const json = JSON.stringify(publicSections());
  assert.doesNotMatch(json, /"answer"|"expect"/);
  assert.equal(publicSections().flatMap((s) => s.questions).length, SECTIONS.flatMap((s) => s.questions).length);
});

test('una solicitud completa y correcta pasa', () => {
  const r = validateApplication(goodBody(), { now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.data.edad, 28);
  assert.equal(r.data.personaje.apellidos, 'Ramírez López');
});

test('detecta campos inválidos', () => {
  const b = goodBody();
  b.roblox = 'no vale!';
  b.personaje.nombre = '<script>';
  b.personaje.sangre = 'Z+';
  b.personaje.nacimiento = '2015-01-01'; // 11 años
  b.respuestas.c2 = 'muy corto';
  b.respuestas.c3 = 'a'.repeat(60); // relleno
  b.respuestas.c4 = 9;
  b.respuestas.c1 = 'tal vez';
  b.acepto = false;
  const r = validateApplication(b, { now: NOW });
  assert.equal(r.ok, false);
  for (const k of ['roblox', 'nombre', 'sangre', 'nacimiento', 'c2', 'c3', 'c4', 'c1', 'acepto']) assert.ok(r.errors[k], `debería fallar ${k}`);
});

test('no se rompe con cuerpos vacíos o raros', () => {
  for (const body of [undefined, null, 'texto', [], { personaje: 'x', respuestas: 5 }]) {
    const r = validateApplication(body, { now: NOW });
    assert.equal(r.ok, false);
  }
});

test('edad: fechas imposibles y cumpleaños', () => {
  assert.equal(ageOn('2026-02-30', NOW), null);
  assert.equal(ageOn('1998-11-13', NOW), 28);
  assert.equal(ageOn('1998-11-14', NOW), 27);
});

test('puntaje y alertas para el staff', () => {
  const b = goodBody();
  b.respuestas.r1 = 3; // incorrecta
  b.respuestas.c1 = 'no';
  const { data } = validateApplication(b, { now: NOW });
  const s = scoreApplication(data.respuestas);
  assert.equal(s.total, 4);
  assert.equal(s.correct, 3);
  assert.equal(s.flags.length, 1);
});

test('el mensaje al staff no permite @everyone y respeta límites de Discord', () => {
  const b = goodBody();
  b.respuestas.c2 = '@everyone ' + LONG + ' @here';
  const { data } = validateApplication(b, { now: NOW });
  const payload = buildWebhookPayload({
    user: { id: '1414024365342986424', name: 'elpibasasooo' },
    roblox: { id: 123, name: 'Santi_RP2', displayName: 'Santi' },
    data, score: scoreApplication(data.respuestas),
  });
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  const text = JSON.stringify(payload);
  assert.doesNotMatch(text, /@everyone|@here/);
  const embed = payload.embeds[0];
  assert.ok(embed.fields.length <= 25);
  for (const f of embed.fields) {
    assert.ok(f.name.length <= 256 && f.value.length > 0 && f.value.length <= 1024);
  }
  const total = embed.title.length + embed.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  assert.ok(total <= 6000, `embed demasiado largo: ${total}`);
});

test('solo se aceptan URLs reales de webhook de Discord', () => {
  assert.ok(WEBHOOK_RE.test('https://discord.com/api/webhooks/123456789012345678/AbCdEf_123-xyzABCDEFGHIJKLMNOP'));
  assert.ok(!WEBHOOK_RE.test('https://evil.example/api/webhooks/1/abc'));
  assert.ok(!WEBHOOK_RE.test('http://discord.com/api/webhooks/123456789012345678/AbCdEf_123-xyzABCDEFGHIJ'));
});
