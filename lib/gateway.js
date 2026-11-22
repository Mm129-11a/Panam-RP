// Conexión permanente al Gateway de Discord (como cualquier bot normal).
// Sirve para que el bot viejo y esta web usen el MISMO bot a la vez: Discord les manda
// las interacciones a los dos y cada uno contesta solo las suyas.

const FATAL = new Set([4004, 4010, 4011, 4012, 4013, 4014]); // token malo, intents, etc.: no reintentar
const FRESH = new Set([4007, 4009]); // la sesión ya no sirve: identificarse de nuevo

export function startGateway({
  token,
  intents = 0,
  onDispatch = () => {},
  log = (...a) => console.log(...a),
  WebSocketImpl = globalThis.WebSocket,
  url = 'wss://gateway.discord.gg/?v=10&encoding=json',
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  random = Math.random,
}) {
  let ws = null;
  let seq = null;
  let sessionId = null;
  let resumeUrl = null;
  let hbTimer = null;
  let retryTimer = null;
  let acked = true;
  let stopped = false;
  let ready = false;
  let failures = 0;

  const send = (op, d) => { try { ws?.send(JSON.stringify({ op, d })); } catch { /* cerrado */ } };
  const heartbeat = () => send(1, seq);
  const stopBeat = () => { if (hbTimer) clearTimer(hbTimer); hbTimer = null; };

  function beat(interval, first) {
    stopBeat();
    hbTimer = setTimer(() => {
      if (!acked) { // Discord no contestó el último latido: conexión muerta
        log('[gateway] sin respuesta de Discord, reconectando');
        try { ws?.close(4000); } catch { /* ya cerrado */ }
        return;
      }
      acked = false;
      heartbeat();
      beat(interval, false);
    }, first ? Math.floor(interval * random()) : interval);
  }

  function identify() {
    send(2, { token, intents, properties: { os: 'linux', browser: 'panama-rp', device: 'panama-rp' } });
  }

  function connect() {
    if (stopped) return;
    const target = sessionId && resumeUrl ? `${resumeUrl.replace(/\/?$/, '/')}?v=10&encoding=json` : url;
    let sock;
    try { sock = new WebSocketImpl(target); } catch (err) { log(`[gateway] no se pudo abrir: ${err.message}`); return retry(); }
    ws = sock;
    acked = true;
    sock.addEventListener('message', (ev) => {
      if (ws !== sock) return;
      let m;
      try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      if (m.s != null) seq = m.s;
      try {
        if (m.op === 10) {
          beat(m.d?.heartbeat_interval || 41_250, true);
          if (sessionId) send(6, { token, session_id: sessionId, seq });
          else identify();
        } else if (m.op === 11) {
          acked = true;
        } else if (m.op === 1) {
          heartbeat();
        } else if (m.op === 7) {
          try { sock.close(4000); } catch { /* ya cerrado */ }
        } else if (m.op === 9) {
          if (!m.d) { sessionId = null; seq = null; }
          try { sock.close(4000); } catch { /* ya cerrado */ }
        } else if (m.op === 0) {
          if (m.t === 'READY') {
            sessionId = m.d?.session_id || null;
            resumeUrl = m.d?.resume_gateway_url || null;
            failures = 0;
            if (!ready) log('Bot de Discord: conectado y escuchando');
            ready = true;
          } else if (m.t === 'RESUMED') {
            failures = 0;
          }
          onDispatch(m.t, m.d);
        }
      } catch (err) {
        log(`[gateway] ${err.message}`);
      }
    });
    sock.addEventListener('close', (ev) => {
      if (ws !== sock) return;
      ws = null;
      stopBeat();
      const code = ev?.code;
      if (FATAL.has(code)) {
        stopped = true;
        ready = false;
        log(`Bot de Discord: desconectado (${code === 4004 ? 'token del bot inválido' : `error ${code}`})`);
        return;
      }
      if (FRESH.has(code)) { sessionId = null; seq = null; }
      retry();
    });
    sock.addEventListener('error', () => { /* el 'close' que viene después reintenta */ });
  }

  function retry() {
    if (stopped || retryTimer) return;
    failures += 1;
    const wait = Math.min(60_000, 1000 * 2 ** Math.min(failures - 1, 6)) + Math.floor(random() * 1000);
    retryTimer = setTimer(() => { retryTimer = null; connect(); }, wait);
  }

  connect();
  return {
    get ready() { return ready && Boolean(ws); },
    stop() {
      stopped = true;
      stopBeat();
      if (retryTimer) clearTimer(retryTimer);
      try { ws?.close(1000); } catch { /* ya cerrado */ }
      ws = null;
    },
  };
}
