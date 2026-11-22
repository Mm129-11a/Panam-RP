import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startGateway } from '../lib/gateway.js';

// WebSocket de mentira para probar la conexión sin red
function fakeWs() {
  const sockets = [];
  class FakeWS {
    constructor(url) { this.url = url; this.sent = []; this.handlers = {}; this.closed = null; sockets.push(this); }
    addEventListener(t, fn) { (this.handlers[t] ||= []).push(fn); }
    send(x) { this.sent.push(JSON.parse(x)); }
    close(code) { if (this.closed) return; this.closed = code; (this.handlers.close || []).forEach((f) => f({ code })); }
    emit(m) { (this.handlers.message || []).forEach((f) => f({ data: JSON.stringify(m) })); }
  }
  return { FakeWS, sockets };
}
function fakeTimers() {
  const list = [];
  return {
    list,
    setTimer: (fn, ms) => { const t = { fn, ms }; list.push(t); return t; },
    clearTimer: (t) => { const i = list.indexOf(t); if (i >= 0) list.splice(i, 1); },
    runNext() { const t = list.shift(); t?.fn(); return t; },
  };
}

test('gateway: se identifica, late, entrega interacciones y retoma la sesión', () => {
  const { FakeWS, sockets } = fakeWs();
  const timers = fakeTimers();
  const got = [];
  const logs = [];
  const g = startGateway({ token: 'tok', WebSocketImpl: FakeWS, setTimer: timers.setTimer, clearTimer: timers.clearTimer, random: () => 0.5, onDispatch: (t, d) => got.push([t, d]), log: (m) => logs.push(m) });
  const a = sockets[0];
  a.emit({ op: 10, d: { heartbeat_interval: 1000 } });
  assert.equal(a.sent[0].op, 2);
  assert.equal(a.sent[0].d.token, 'tok');
  assert.equal(timers.list[0].ms, 500); // primer latido con jitter
  a.emit({ op: 0, t: 'READY', s: 1, d: { session_id: 'S1', resume_gateway_url: 'wss://resume.discord.gg' } });
  assert.ok(g.ready);
  a.emit({ op: 0, t: 'INTERACTION_CREATE', s: 2, d: { id: 'i1' } });
  assert.deepEqual(got.at(-1), ['INTERACTION_CREATE', { id: 'i1' }]);
  timers.runNext(); // latido
  assert.deepEqual(a.sent.at(-1), { op: 1, d: 2 });
  a.emit({ op: 11 });
  timers.runNext(); // otro latido (hubo ACK)
  assert.equal(a.sent.filter((m) => m.op === 1).length, 2);
  timers.runNext(); // sin ACK → reconecta
  assert.equal(a.closed, 4000);
  timers.runNext(); // espera de reconexión
  const b = sockets[1];
  assert.match(b.url, /^wss:\/\/resume\.discord\.gg\/\?v=10/);
  b.emit({ op: 10, d: { heartbeat_interval: 1000 } });
  assert.deepEqual(b.sent[0], { op: 6, d: { token: 'tok', session_id: 'S1', seq: 2 } });
  g.stop();
});

test('gateway: token inválido → deja de intentar', () => {
  const { FakeWS, sockets } = fakeWs();
  const timers = fakeTimers();
  const logs = [];
  startGateway({ token: 'x', WebSocketImpl: FakeWS, setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: (m) => logs.push(m) });
  sockets[0].close(4004);
  assert.equal(timers.list.length, 0);
  assert.match(logs.join(' '), /token del bot inválido/);
});

test('gateway: sesión inválida → se identifica de nuevo', () => {
  const { FakeWS, sockets } = fakeWs();
  const timers = fakeTimers();
  startGateway({ token: 't', WebSocketImpl: FakeWS, setTimer: timers.setTimer, clearTimer: timers.clearTimer, random: () => 0 });
  const a = sockets[0];
  a.emit({ op: 10, d: { heartbeat_interval: 1000 } });
  a.emit({ op: 0, t: 'READY', s: 1, d: { session_id: 'S', resume_gateway_url: 'wss://r' } });
  a.emit({ op: 9, d: false });
  timers.list.splice(0).forEach((t) => { if (t.ms >= 1000) t.fn(); });
  const b = sockets[1];
  assert.match(b.url, /gateway\.discord\.gg/);
  b.emit({ op: 10, d: { heartbeat_interval: 1000 } });
  assert.equal(b.sent[0].op, 2);
});
