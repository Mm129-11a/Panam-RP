// Pruebas de lib/security.js — se corren con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCsp, securityHeaders, clientIp, rateLimit, methodGuard, isSameOrigin, safeEqual,
} from '../lib/security.js';

function mockRes() {
  const headers = {};
  return {
    statusCode: 200, headers, body: undefined, ended: false,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    end(b) { this.body = b; this.ended = true; },
  };
}
const mockReq = (o = {}) => ({ method: 'GET', url: '/', headers: {}, socket: { remoteAddress: '::ffff:10.0.0.1' }, ...o });
const run = (mw, req, res) => { let called = false; mw(req, res, () => { called = true; }); return called; };

test('CSP solo permite scripts propios y bloquea marcos', () => {
  const csp = buildCsp();
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
  assert.match(buildCsp({ https: true }), /upgrade-insecure-requests/);
});

test('securityHeaders pone todas las cabeceras y HSTS solo con https', () => {
  const res = mockRes();
  assert.equal(run(securityHeaders({ https: true }), mockReq(), res), true);
  for (const h of ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy',
    'permissions-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'strict-transport-security']) {
    assert.ok(res.headers[h], `falta ${h}`);
  }
  assert.equal(res.headers['x-frame-options'], 'DENY');
  const res2 = mockRes();
  run(securityHeaders({ https: false }), mockReq(), res2);
  assert.equal(res2.headers['strict-transport-security'], undefined);
});

test('clientIp usa la cabecera de Cloudflare en Render y no la de X-Forwarded-For', () => {
  const req = mockReq({ headers: { 'true-client-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4, 104.22.1.1' } });
  assert.deepEqual(clientIp(req, { behindRender: true }), { ip: '203.0.113.7', source: 'true-client-ip' });
  const req2 = mockReq({ headers: { 'cf-connecting-ip': '198.51.100.2' } });
  assert.equal(clientIp(req2, { behindRender: true }).source, 'cf-connecting-ip');
  const req3 = mockReq({ headers: { 'x-forwarded-for': '198.51.100.9, 10.0.0.2' } });
  assert.equal(clientIp(req3, { behindRender: true }).ip, '198.51.100.9');
  // Fuera de Render se ignoran las cabeceras (se pueden falsificar)
  assert.deepEqual(clientIp(req, { behindRender: false }), { ip: '10.0.0.1', source: 'socket' });
});

test('rateLimit bloquea con 429 al pasar el límite y es por visitante', () => {
  const limit = rateLimit({ windowMs: 60_000, max: 3, keyFn: (r) => r.headers.ip });
  const a = () => mockReq({ headers: { ip: 'A' } });
  for (let i = 0; i < 3; i++) assert.equal(run(limit, a(), mockRes()), true);
  const res = mockRes();
  assert.equal(run(limit, a(), res), false);
  assert.equal(res.statusCode, 429);
  assert.ok(Number(res.headers['retry-after']) >= 1);
  assert.equal(run(limit, mockReq({ headers: { ip: 'B' } }), mockRes()), true, 'otro visitante no se bloquea');
});

test('rateLimit vuelve a permitir cuando termina la ventana', async () => {
  const limit = rateLimit({ windowMs: 50, max: 1, keyFn: () => 'x' });
  assert.equal(run(limit, mockReq(), mockRes()), true);
  assert.equal(run(limit, mockReq(), mockRes()), false);
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(run(limit, mockReq(), mockRes()), true);
});

test('methodGuard solo deja GET/HEAD y los POST permitidos', () => {
  const g = methodGuard(['/logout']);
  assert.equal(run(g, mockReq({ method: 'GET' }), mockRes()), true);
  assert.equal(run(g, mockReq({ method: 'HEAD' }), mockRes()), true);
  assert.equal(run(g, mockReq({ method: 'POST', url: '/logout' }), mockRes()), true);
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = mockRes();
    assert.equal(run(g, mockReq({ method: m, url: '/api/me' }), res), false);
    assert.equal(res.statusCode, 405);
  }
});

test('isSameOrigin acepta la propia web y rechaza otras', () => {
  const O = 'https://panama-rp.onrender.com';
  assert.equal(isSameOrigin(mockReq({ headers: { 'sec-fetch-site': 'same-origin' } }), O), true);
  assert.equal(isSameOrigin(mockReq({ headers: { 'sec-fetch-site': 'cross-site' } }), O), false);
  assert.equal(isSameOrigin(mockReq({ headers: { 'sec-fetch-site': 'same-site' } }), O), false);
  assert.equal(isSameOrigin(mockReq({ headers: { origin: O } }), O), true);
  assert.equal(isSameOrigin(mockReq({ headers: { origin: 'https://evil.example' } }), O), false);
  assert.equal(isSameOrigin(mockReq({ headers: { referer: O + '/#tienda' } }), O), true);
  assert.equal(isSameOrigin(mockReq({ headers: { referer: 'no es url' } }), O), false);
  assert.equal(isSameOrigin(mockReq(), O), false, 'sin cabeceras se rechaza');
});

test('safeEqual compara bien y no acepta tipos raros', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual(['abc'], 'abc'), false);
  assert.equal(safeEqual(undefined, 'abc'), false);
});
