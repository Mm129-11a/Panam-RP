// Panel de ciudadano de Panamá RP: inicio con categorías, perfil con expediente, turnos y banco.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => `$${Number(n || 0).toLocaleString('es-PA')}`;
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fecha = (ms) => { const d = new Date(ms); return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`; };
  const hora = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const fechaHora = (ms) => `${fecha(ms)}, ${hora(ms)}`;
  const isoBonito = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };
  const edad = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return ''; const n = new Date(); let a = n.getFullYear() - +m[1]; if (n.getMonth() + 1 < +m[2] || (n.getMonth() + 1 === +m[2] && n.getDate() < +m[3])) a--; return a; };
  const hm = (min) => `${Math.floor(min / 60)}h ${min % 60}m`;
  const KIND = { apertura: 'Apertura de cuenta', depositar: 'Depósito', retirar: 'Retiro', transferencia: 'Transferencia', salario: 'Salario', multa: 'Pago de multa' };

  // Íconos de línea (SVG dentro del HTML, permitido por la CSP)
  const P = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    power: '<path d="M12 3v9"/><path d="M6.3 7.5a8 8 0 1 0 11.4 0"/>',
    bank: '<path d="M3 10 12 4l9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
    swap: '<path d="M7 7h13l-3-3M17 17H4l3 3"/>',
    down: '<path d="M12 4v13M6 12l6 6 6-6"/>',
    send: '<path d="m4 12 16-8-6 16-2-6z"/>',
    gavel: '<path d="m14 4 6 6M11 7l6 6M9 9l-6 6 3 3 6-6M13 5l6 6"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 8v4l3 2"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v2a3 3 0 0 0 4 3M16 6h4v2a3 3 0 0 1-4 3M12 13v4M8 21h8M9 17h6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    id: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.5-1.5 1.7-2 3-2s2.5.5 3 2M14 10h4M14 13h3"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  };
  const ico = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

  const head = $('#pn-head');
  const main = $('#pn-main');
  let S = null;
  const ui = { tab: 'info', work: 'historial', search: null, activity: null, busy: false, flip: false, link: null };

  // ─── Utilidades ───
  let toastT = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 3400);
  }

  async function api(path, body) {
    const opts = body === undefined ? { credentials: 'same-origin' } : {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    };
    let r;
    try { r = await fetch(path, opts); } catch { throw { status: 0, error: 'Sin conexión. Revisa tu internet.' }; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw { status: r.status, ...j, error: j.error || (r.status === 429 ? 'Vas muy rápido. Espera un momento.' : 'Algo falló. Intenta de nuevo.') };
    return j;
  }
  const withSkew = (st) => ({ ...st, clockSkew: typeof st.now === 'number' ? Date.now() - st.now : 0 });

  const discordPic = (u) => (typeof u?.avatar === 'string' && u.avatar.startsWith('https://cdn.discordapp.com/') ? u.avatar : 'https://cdn.discordapp.com/embed/avatars/0.png');
  const handle = () => (S.user.username || S.user.name || '').toUpperCase();
  const fullName = () => (S.character ? `${S.character.nombre} ${S.character.apellidos}` : S.user.name);
  const pending = () => S.fines.filter((f) => f.estado === 'pendiente');
  const owed = () => pending().reduce((a, f) => a + Number(f.monto), 0);
  const jobInfo = (k) => S.jobInfo[k] || { name: k, icon: '💼', color: '#7aa2ff', payPerHour: 0 };

  // Foto de Roblox (si no carga, queda la inicial detrás)
  function avatar(cls = '') {
    const ini = esc((S.character?.nombre || S.user.name || '?').charAt(0).toUpperCase());
    const img = S.roblox?.avatar ? `<img src="${esc(S.roblox.avatar)}" alt="Avatar de Roblox" data-rbx>` : '';
    return `<span class="pn-ava ${cls}"><span>${ini}</span>${img}</span>`;
  }
  document.addEventListener('error', (e) => { if (e.target instanceof HTMLImageElement && e.target.hasAttribute('data-rbx')) e.target.remove(); }, true);

  // ─── Encabezado de cada pantalla ───
  const TITLES = {
    inicio: () => ['Panel <em>ciudadano</em>', 'Panel central de herramientas y accesos del servidor'],
    perfil: () => ['Mi perfil', 'Identidad IC, cuenta y expediente'],
    trabajos: () => [`Panel de turnos <em>${esc(handle())}</em>`, 'Inicia tu turno al entrar al servidor y cobra al terminar'],
    banco: () => [`Banco, <em>${esc(handle())}</em>`, 'Depósitos, retiros, transferencias y movimientos'],
  };
  function renderHead(view) {
    const [title, sub] = TITLES[view]();
    const pills = [
      S.erlc ? (S.erlc.encendido ? `<span class="pn-pill"><i class="dot on"></i>${S.erlc.jugadores}/${S.erlc.maximo} jugadores</span>` : '<span class="pn-pill"><i class="dot"></i>Servidor apagado</span>') : '',
      S.online != null ? `<span class="pn-pill"><i class="dot"></i>${S.online} en Discord</span>` : '',
      S.account ? `<span class="pn-pill">${ico('cash')}${money(S.account.efectivo)} efectivo</span>` : '',
      S.shift ? `<a class="pn-pill on" href="#trabajos"><i class="dot on"></i>En turno · ${esc(jobInfo(S.shift.job).name)}</a>` : '',
    ].join('');
    const right = view === 'inicio'
      ? `<a class="pn-hbtn" href="/#normativa">${ico('book')}<span>Normativa</span></a><button class="pn-hbtn" type="button" data-act="salir">${ico('logout')}<span>Cerrar sesión</span></button>`
      : `<a class="pn-hbtn" href="#inicio">${ico('back')}<span>Volver</span></a>`;
    head.innerHTML = `<div class="pn-head-l"><h1 class="pn-title">${title}</h1><p class="pn-sub">${sub}</p><div class="pn-pills">${pills}</div></div>
      <div class="pn-head-r"><a class="pn-logo" href="/" aria-label="Inicio de Panamá RP"><img src="/img/logo.webp" alt="" width="46" height="46"></a>
        <div class="pn-chip"><img src="${esc(discordPic(S.user))}" alt="" width="34" height="34" data-dpic><div><b>${esc(S.user.name)}</b><small>@${esc(S.user.username || S.user.name)}</small></div></div>${right}</div>`;
    const dp = $('[data-dpic]', head);
    dp.addEventListener('error', () => { dp.src = '/img/favicon.png'; }, { once: true });
  }

  // ─── Pantallas de acceso ───
  function gate(e) {
    head.innerHTML = '';
    const box = (kind, title, text, actions) => {
      main.innerHTML = `<section class="pn-gate"><div class="pn-gate-ico ${kind}">${ico(kind === 'login' ? 'user' : kind === 'wl' ? 'id' : 'alert')}</div>
        <h1>${title}</h1><p>${text}</p><div class="pn-gate-actions">${actions}</div></section>`;
    };
    if (e.gate === 'login' || e.status === 401) {
      return box('login', 'Inicia sesión', 'El panel es solo para ciudadanos de Panamá RP. Entra con tu cuenta de Discord.',
        '<a class="pn-btn gold lg" href="/auth/discord?next=/panel">Iniciar sesión con Discord</a>');
    }
    if (e.gate === 'whitelist') {
      return box('wl', 'Aún no tienes la whitelist', esc(e.error),
        '<a class="pn-btn gold lg" href="/solicitud">Hacer la whitelist</a><a class="pn-btn ghost lg" href="/">Volver al inicio</a>');
    }
    return box('err', 'No se pudo abrir el panel', esc(e.error), '<button class="pn-btn gold lg" type="button" data-act="reintentar">Reintentar</button>');
  }

  // ─── Pantallas (#inicio, #perfil, #trabajos, #banco) ───
  const VIEWS = ['inicio', 'perfil', 'trabajos', 'banco'];
  const currentView = () => { const h = location.hash.slice(1); return VIEWS.includes(h) ? h : 'inicio'; };

  function render() {
    const view = currentView();
    renderHead(view);
    const banner = S.modo === 'prueba' ? `<div class="pn-note warn">${ico('alert')}<div>Modo de prueba: falta la base de datos y lo que hagas aquí se borra al reiniciar la web.</div></div>` : '';
    main.innerHTML = banner + ({ perfil: viewPerfil, trabajos: viewTrabajos, banco: viewBanco }[view] || viewInicio)();
    $$('[data-color]').forEach((el) => el.style.setProperty('--job', el.dataset.color));
    tick();
    if (view === 'trabajos' && S.shift?.job === 'policia' && !ui.activity) loadActivity();
  }

  // ─── Inicio ───
  const cat = (href, color, icon, title, text) => `<a class="pn-cat ${color}" href="${href}">
      <span class="pn-cat-ico">${ico(icon)}</span><b>${title}</b><small>${text}</small><span class="pn-cat-go">${ico('arrow')}</span></a>`;

  function viewInicio() {
    return `${S.character ? '' : `<div class="pn-note info">${ico('id')}<div><b>Crea tu cédula</b> para abrir tu cuenta del banco y poder trabajar.</div><a class="pn-btn gold" href="#perfil">Crear cédula</a></div>`}
      <section class="pn-welcome">
        <div class="pn-welcome-txt">
          <h2 class="${handle().length > 14 ? 'long' : ''}">Bienvenido,<br><em>${esc(handle())}</em></h2>
          <p>Selecciona una categoría para acceder a las herramientas</p>
        </div>
        <div class="pn-welcome-side">
          <a class="pn-stat" href="#trabajos"><span class="pn-stat-tag ${S.shift ? 'on' : ''}">${S.shift ? 'En turno' : 'Turno'}<i></i></span>
            <span class="pn-stat-ico">${ico('clock')}</span><b ${S.shift ? 'data-week' : ''}>${hm(S.stats.minutos)}</b><small>Horas trabajadas</small><em>Esta semana ${ico('arrow')}</em></a>
          <a class="pn-stat" href="#banco"><span class="pn-stat-ico">${ico('bank')}</span><b>${S.account ? money(S.account.banco) : 'Sin cuenta'}</b><small>Saldo en banco</small><em>Ver banco ${ico('arrow')}</em></a>
        </div>
      </section>
      <h3 class="pn-sec"><span>${ico('grid')}</span>Categorías</h3>
      <div class="pn-cats">
        ${cat('#perfil', 'green', 'user', 'Mi perfil', 'Cédula, banco, multas y antecedentes')}
        ${cat('#trabajos', 'blue', 'power', 'Servicio Trabajos', 'Prende turno y gana dinero IC')}
        ${cat('#banco', 'gold', 'bank', 'Banco', 'Depósitos, retiros y transferencias')}
        ${cat('/#normativa', 'red', 'book', 'Normativa', 'Reglas del servidor')}
      </div>`;
  }

  // ─── Perfil y expediente ───
  function field(name, label, input) {
    return `<div class="ap-field"><label class="ap-label" for="f-${name}">${label}</label>${input}<div class="pn-err" data-err="${name}"></div></div>`;
  }
  const select = (name, opts, val) => `<div class="ap-select"><select class="ap-input" id="f-${name}" name="${name}" required>
    <option value="">Elige…</option>${opts.map((o) => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;

  function viewPerfil() {
    const has = Boolean(S.account);
    const rbx = S.roblox?.verified
      ? `<small>Roblox: <b>${esc(S.roblox.name)}</b> <span class="pn-ok">✓ vinculado</span></small>`
      : linkBox();
    const shorts = [
      ['multas', 'receipt', 'Multas', `${pending().length} pendiente(s)`, 'gold'],
      ['arrestos', 'gavel', 'Arrestos', `${S.arrests.length} registro(s)`, 'red'],
      ['#banco', 'bank', 'Banco', 'Movimientos', 'green'],
      ['#trabajos', 'briefcase', 'Trabajos', S.jobs.length ? S.jobs.map((k) => jobInfo(k).name).join(', ') : 'Sin rol', 'blue'],
      ['/#normativa', 'book', 'Normativa', 'Reglas', 'muted'],
    ].map(([to, i, t, s, col]) => (/^[#/]/.test(to)
      ? `<a class="pn-short ${col}" href="${to}"><span>${ico(i)}</span><b>${t}</b><small>${esc(s)}</small></a>`
      : `<button class="pn-short ${col}" type="button" data-act="tab" data-tab="${to}"><span>${ico(i)}</span><b>${t}</b><small>${esc(s)}</small></button>`)).join('');
    return `<section class="pn-prof">
        <div class="pn-prof-id">${avatar('xl')}<div class="pn-prof-name"><span class="pn-badge">Ciudadano</span><h2>${esc(fullName())}</h2>${rbx}</div></div>
        <div class="pn-prof-money">
          <div class="pn-coins">
            <div class="pn-coin y"><span>${ico('cash')}</span><small>Efectivo</small><b>${has ? money(S.account.efectivo) : '—'}</b></div>
            <div class="pn-coin r"><span>${ico('alert')}</span><small>Multas</small><b>${money(owed())}</b></div>
            <div class="pn-coin g"><span>${ico('bank')}</span><small>Banco</small><b>${has ? money(S.account.banco) : '—'}</b></div>
          </div>
          <div class="pn-prof-btns">
            <button class="pn-btn gold-o" type="button" data-act="modal" data-m="depositar" ${has ? '' : 'disabled'}>${ico('swap')}Depositar</button>
            <button class="pn-btn gold-o" type="button" data-act="modal" data-m="retirar" ${has ? '' : 'disabled'}>${ico('down')}Retirar</button>
            <button class="pn-btn blue-o" type="button" data-act="modal" data-m="transferir" ${has ? '' : 'disabled'}>${ico('send')}Transferir</button>
          </div>
        </div>
      </section>
      <div class="pn-shorts">${shorts}</div>
      <section class="pn-box" id="pn-exp">
        <div class="pn-box-h"><span class="pn-box-ico">${ico('shield')}</span><div><b>Mi expediente</b><small>Información personal, arrestos y multas</small></div></div>
        <div class="pn-tabs" role="tablist">
          ${[['info', 'id', 'Info general'], ['arrestos', 'gavel', `Arrestos (${S.arrests.length})`], ['multas', 'receipt', `Multas (${S.fines.length})`]]
            .map(([k, i, t]) => `<button type="button" role="tab" aria-selected="${ui.tab === k}" class="${ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${ico(i)}${t}</button>`).join('')}
        </div>
        ${ui.tab === 'arrestos' ? tabArrestos() : ui.tab === 'multas' ? tabMultas() : S.character ? tabInfo() : cedulaForm()}
      </section>`;
  }

  // Vincular Roblox: código en la descripción del perfil de Roblox
  function linkBox() {
    const L = ui.link;
    if (!L) {
      return `<form class="pn-link" data-form="roblox" novalidate><input class="ap-input" name="usuario" maxlength="20" placeholder="Tu usuario de Roblox" autocomplete="off" aria-label="Tu usuario de Roblox" value="${esc(S.roblox?.name || '')}"><button class="pn-btn gold sm" type="submit">Vincular</button><span class="pn-err" data-err="usuario"></span></form>`;
    }
    return `<div class="pn-linkbox">
        <small>Pega este código en la <b>descripción</b> de tu perfil de Roblox (<b>@${esc(L.user.name)}</b>), guárdala y toca Comprobar:</small>
        <div class="pn-code"><code>${esc(L.code)}</code><button class="pn-btn ghost sm" type="button" data-act="copiar">Copiar</button></div>
        <div class="pn-row"><a class="pn-btn ghost sm" href="https://www.roblox.com/users/${encodeURIComponent(L.user.id)}/profile" target="_blank" rel="noopener">Abrir mi perfil ↗</a>
        <button class="pn-btn gold sm" type="button" data-act="comprobar">Comprobar</button>
        <button class="pn-btn ghost sm" type="button" data-act="otro-usuario">Otro usuario</button></div>
      </div>`;
  }

  const empty = (icon, text) => `<div class="pn-empty">${ico(icon)}<p>${text}</p></div>`;

  function tabInfo() {
    const c = S.character;
    const limpio = !S.arrests.length && !pending().length;
    return `<div class="pn-trio">
        <div class="pn-kv ${limpio ? 'ok' : 'bad'}"><span>${ico(limpio ? 'shield' : 'alert')}</span><div><small>Estado legal</small><b>${limpio ? 'Sin antecedentes' : 'Con registros'}</b><em>${limpio ? 'Sin arrestos ni multas pendientes' : `${S.arrests.length} arresto(s) · ${pending().length} multa(s) pendiente(s)`}</em></div></div>
        <div class="pn-kv"><span>${ico('receipt')}</span><div><b>${pending().length}</b><small>Multas pendientes</small><em>${money(owed())}</em></div></div>
        <div class="pn-kv"><span>${ico('clock')}</span><div><b>${S.stats.turnos}</b><small>Turnos esta semana</small><em>${hm(S.stats.minutos)} trabajadas</em></div></div>
      </div>
      <div class="pn-docs">
        <div class="pn-doc">
          <h4>${ico('id')}Documento de identidad</h4>
          <button class="pn-card3d ${ui.flip ? 'flip' : ''}" type="button" data-act="girar" aria-label="Girar la cédula">
            <span class="pn-card3d-in">${idFront(c)}${idBack(c)}</span>
          </button>
          <small class="pn-hint">Toca para girar</small>
        </div>
        <div class="pn-doc">
          <h4>${ico('user')}Datos personales</h4>
          <dl class="pn-dl">
            <div><dt>N.º de cédula</dt><dd class="mono">${esc(c.cedula)}</dd></div>
            <div><dt>Nombre</dt><dd>${esc(c.nombre)} ${esc(c.apellidos)}</dd></div>
            <div><dt>Nacionalidad</dt><dd>${esc(c.nacionalidad)}</dd></div>
            <div><dt>Nacimiento</dt><dd>${esc(isoBonito(c.nacimiento))} · ${edad(c.nacimiento)} años</dd></div>
            <div><dt>Sangre</dt><dd>${esc(c.sangre)}</dd></div>
            <div><dt>Sexo</dt><dd>${esc(c.genero)}</dd></div>
            <div><dt>Expedición</dt><dd>${fecha(c.created_at)}</dd></div>
            <div><dt>Roblox</dt><dd>${esc(c.roblox_name)}</dd></div>
          </dl>
        </div>
      </div>`;
  }

  // ─── Cédula (diseño tipo cédula panameña, documento de rol) ───
  const MES3 = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const fechaId = (d) => `${String(d.getUTCDate()).padStart(2, '0')}-${MES3[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
  // Día local (lo que ve la persona) guardado como fecha UTC, para que no salte de día
  const dayOf = (ms) => { const d = new Date(ms); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };
  const isoDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
  const LUGAR = { Panameña: 'PANAMÁ', Colombiana: 'COLOMBIA', Venezolana: 'VENEZUELA', Costarricense: 'COSTA RICA', Nicaragüense: 'NICARAGUA', Mexicana: 'MÉXICO', Estadounidense: 'EE. UU.', Española: 'ESPAÑA' };
  const sexo = (g) => (g === 'Masculino' ? 'M' : g === 'Femenino' ? 'F' : 'X');
  const plain = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

  // Números pseudoaleatorios fijos por cédula (el dibujo siempre sale igual)
  function rng(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  }
  // Código 2D denso (decorativo: no se puede leer). Se guarda para no redibujarlo en cada actualización.
  const codeCache = new Map();
  function code2d(seed, n = 36) {
    if (codeCache.has(seed)) return codeCache.get(seed);
    const rand = rng(seed);
    let d = '';
    for (let y = 0; y < n; y++) {
      let run = -1;
      for (let x = 0; x <= n; x++) {
        let on = false;
        if (x < n) {
          if (x === 0 || y === n - 1) on = true; // borde en L
          else if (y === 0) on = x % 2 === 0; // borde alterno arriba
          else if (x === n - 1) on = y % 2 === 1; // borde alterno a la derecha
          else on = rand() > 0.5;
        }
        if (on && run < 0) run = x;
        if (!on && run >= 0) { d += `M${run} ${y}h${x - run}v1h-${x - run}z`; run = -1; }
      }
    }
    const svg = `<svg class="pn-code2d" viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}"/></svg>`;
    codeCache.set(seed, svg);
    return svg;
  }
  // Líneas de lectura (formato de 3 líneas × 30, con dígitos de control)
  function mrz(c) {
    const val = (ch) => (/\d/.test(ch) ? +ch : /[A-Z]/.test(ch) ? ch.charCodeAt(0) - 55 : 0);
    const chk = (str) => String([...str].reduce((a, ch, i) => a + val(ch) * [7, 3, 1][i % 3], 0) % 10);
    const pad = (str, n) => (str + '<'.repeat(n)).slice(0, n);
    const yymmdd = (d) => `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    const doc = pad(plain(c.cedula).replace(/[^A-Z0-9]/g, ''), 9);
    const born = yymmdd(isoDate(c.nacimiento) || new Date(0));
    const exp = dayOf(c.created_at); exp.setUTCFullYear(exp.getUTCFullYear() + 10);
    const expS = yymmdd(exp);
    const l1 = pad(`IDPRP${doc}${chk(doc)}`, 30);
    const l2 = pad(`${born}${chk(born)}${sexo(c.genero)}${expS}${chk(expS)}PAN`, 29) + chk(born + expS);
    const l3 = pad(`${plain(c.apellidos).replace(/[^A-Z]+/g, '<')}<<${plain(c.nombre).replace(/[^A-Z]+/g, '<')}`, 30);
    return [l1, l2, l3].map((l) => esc(l).replace(/</g, '&lt;')).join('<br>');
  }

  // Ventanita de la esquina con el logo del server medio transparente
  const idWindow = (side) => `<span class="pn-id-win ${side}"><img src="/img/logo.webp" alt=""></span>`;

  function idFront(c) {
    const born = isoDate(c.nacimiento);
    const exp = dayOf(c.created_at); exp.setUTCFullYear(exp.getUTCFullYear() + 10);
    return `<span class="pn-id pn-face-a">
      <span class="pn-id-title"><b>PANAMÁ RP</b><small>DOCUMENTO DE IDENTIDAD</small></span>
      ${idWindow('a')}
      ${avatar('id')}
      <b class="pn-id-num">${esc(c.cedula)}</b>
      <span class="pn-id-data">
        <span class="pn-id-fn">${esc(c.nombre)}</span>
        <span class="pn-id-ln">${esc(c.apellidos)}</span>
        <span class="pn-id-rows">
          <span><small>NOMBRE USUAL:</small> ${esc(plain(c.nombre).split(' ')[0])}</span>
          <span><small>FECHA DE NACIMIENTO:</small> ${born ? fechaId(born) : esc(c.nacimiento)}</span>
          <span><small>LUGAR DE NACIMIENTO:</small> ${esc(LUGAR[c.nacionalidad] || 'EXTRANJERO')}</span>
          <span><small>SEXO:</small> ${sexo(c.genero)} &nbsp;&nbsp;<small>TIPO DE SANGRE:</small> ${esc(c.sangre)}</span>
          <span><small>EXPEDIDA:</small> ${fechaId(dayOf(c.created_at))} &nbsp;&nbsp;<small>EXPIRA:</small> ${fechaId(exp)}</span>
        </span>
      </span>
      <span class="pn-id-ghost">${avatar('ghost')}</span>
      <span class="pn-id-sign">${esc(c.nombre.split(' ')[0].charAt(0))}. ${esc(c.apellidos.split(' ')[0])}</span>
      <span class="pn-id-state">CIUDADANO</span>
    </span>`;
  }

  function idBack(c) {
    const serial = `${String(Math.floor(rng(c.cedula)() * 9e7) + 1e7)}`;
    return `<span class="pn-id pn-face-b">
      ${idWindow('b')}
      <span class="pn-idb-serial">PRP${serial}</span>
      <small class="pn-idb-note">Documento de rol de Panamá RP. Sin validez oficial.</small>
      <span class="pn-codes">${code2d(`${c.cedula}a`)}${code2d(`${c.cedula}b`)}</span>
      <span class="pn-mrz">${mrz(c)}</span>
    </span>`;
  }

  function cedulaForm() {
    const p = S.solicitud?.personaje || {};
    const o = S.options;
    return `<div class="pn-form-box">
      <h4>${ico('id')}Crea tu cédula</h4>
      <p class="pn-muted">${S.solicitud ? 'Usamos los datos de tu whitelist; revísalos antes de crearla.' : 'Escribe los datos de tu personaje.'} La cédula no se puede cambiar después.</p>
      <form data-form="cedula" novalidate>
        <div class="ap-grid">
          ${field('nombre', 'Nombre', `<input class="ap-input" id="f-nombre" name="nombre" maxlength="40" value="${esc(p.nombre)}" required>`)}
          ${field('apellidos', 'Apellidos', `<input class="ap-input" id="f-apellidos" name="apellidos" maxlength="40" value="${esc(p.apellidos)}" required>`)}
          ${field('nacimiento', 'Fecha de nacimiento', `<input class="ap-input" id="f-nacimiento" name="nacimiento" type="date" value="${esc(p.nacimiento)}" required>`)}
          ${field('genero', 'Sexo', select('genero', o.genero, p.genero))}
          ${field('sangre', 'Tipo de sangre', select('sangre', o.sangre, p.sangre))}
          ${field('nacionalidad', 'Nacionalidad', select('nacionalidad', o.nacionalidad, p.nacionalidad))}
        </div>
        <p class="pn-muted small">${S.roblox?.verified ? `Roblox: <b>${esc(S.roblox.name)}</b> ✓ (sale tu avatar en la foto)` : '⚠️ Primero vincula tu cuenta de Roblox arriba (junto a tu nombre).'}</p>
        <div class="pn-err" data-err="roblox"></div>
        <button class="pn-btn gold lg" type="submit" ${S.roblox?.verified ? '' : 'disabled'}>Crear mi cédula</button>
      </form></div>`;
  }

  function tabArrestos() {
    if (!S.arrests.length) return empty('gavel', 'No tienes arrestos registrados');
    return `<ul class="pn-list">${S.arrests.map((a) => `<li><span class="pn-li-ico red">${ico('gavel')}</span>
      <div><b>${esc(a.cargos)}</b><small>Oficial ${esc(a.officer_name)} · ${fechaHora(a.created_at)}</small></div>
      <div class="pn-li-r"><span class="pn-tag">${a.minutos} min</span></div></li>`).join('')}</ul>`;
  }

  function tabMultas() {
    if (!S.fines.length) return empty('receipt', 'No tienes multas registradas');
    return `<ul class="pn-list">${S.fines.map((f) => `<li><span class="pn-li-ico ${f.estado === 'pendiente' ? 'gold' : 'green'}">${ico('receipt')}</span>
      <div><b>${esc(f.motivo)}</b><small>Oficial ${esc(f.officer_name)} · ${fechaHora(f.created_at)}</small></div>
      <div class="pn-li-r"><b class="${f.estado === 'pendiente' ? 'neg' : ''}">${money(f.monto)}</b>
      ${f.estado === 'pendiente' ? `<button class="pn-btn gold sm" type="button" data-act="pagar" data-id="${f.id}">Pagar</button>` : '<span class="pn-tag ok">Pagada</span>'}</div></li>`).join('')}</ul>`;
  }

  // ─── Turnos ───
  function viewTrabajos() {
    const on = S.shift;
    const j = on ? jobInfo(on.job) : null;
    let controls;
    if (!S.character) {
      controls = `<a class="pn-btn gold" href="#perfil">Crea tu cédula para trabajar</a>`;
    } else if (on) {
      controls = `<button class="pn-btn red lg" type="button" data-act="terminar">${ico('power')}Terminar turno y cobrar</button>`;
    } else if (S.jobs.length) {
      controls = `<div class="pn-pick"><div class="ap-select"><select class="ap-input" id="pn-job" aria-label="Trabajo">${S.jobs.map((k) => `<option value="${esc(k)}">${jobInfo(k).icon} ${esc(jobInfo(k).name)} · ${money(jobInfo(k).payPerHour)}/h</option>`).join('')}</select></div>
        <button class="pn-btn gold lg" type="button" data-act="iniciar">${ico('power')}Iniciar turno</button></div>`;
    } else {
      controls = `<div class="pn-dropbox">${ico('briefcase')}<div><b>Trabajos disponibles</b><small>Necesitas el rol del trabajo en Discord (Policía, EMS, Bomberos…)</small></div></div>`;
    }
    const r = S.shiftRules;
    return `<section class="pn-work" ${j ? `data-color="${esc(j.color)}"` : ''}>
        <div class="pn-work-main">
          <span class="pn-state ${on ? 'on' : ''}"><i></i>${on ? `En servicio · ${esc(j.name)}` : 'Fuera de servicio'}</span>
          <h2>Panel de <em>trabajo</em></h2>
          <p>Elige tu trabajo y toca <b>Iniciar turno</b> cuando entres al servidor de ER:LC. Al salir, toca <b>Terminar turno</b> y el pago se acredita a tu banco. Necesitas el rol del trabajo en Discord. Mínimo ${r.minMinutes} min · máximo ${r.maxMinutes / 60} h por turno.</p>
          ${controls}
        </div>
        <div class="pn-work-side">
          <div class="pn-stat"><span class="pn-stat-ico">${ico('clock')}</span><b ${on ? 'data-hm' : ''}>0h 0m</b><small>${on ? 'Turno activo <span data-sec></span>' : 'Sin turno activo'}</small></div>
          <div class="pn-stat"><span class="pn-stat-ico gold">${ico('cash')}</span><b ${on ? 'data-earn' : ''}>${on ? '$0' : '—'}</b><small>Ganancia estimada</small></div>
        </div>
      </section>
      <div class="pn-bigtabs">
        <button type="button" class="${ui.work === 'historial' ? 'on' : ''}" data-act="work" data-tab="historial">${ico('history')}<span><b>Historial</b><small>Tus servicios</small></span></button>
        <button type="button" class="${ui.work === 'ranking' ? 'on' : ''}" data-act="work" data-tab="ranking">${ico('trophy')}<span><b>Ranking</b><small>Estadísticas</small></span></button>
      </div>
      ${ui.work === 'ranking' ? ranking() : historial()}
      ${S.jobs.includes('policia') ? policeTools() : ''}`;
  }

  function historial() {
    const list = S.shifts.length ? `<ul class="pn-list">${S.shifts.map((s) => {
      const j = jobInfo(s.job);
      return `<li><span class="pn-li-ico job" data-color="${esc(j.color)}">${j.icon}</span>
        <div><b>${esc(j.name)}</b><small>${fecha(s.started_at)} · ${hora(s.started_at)} – ${hora(s.ended_at)}</small></div>
        <div class="pn-li-r"><span class="pn-tag">${hm(s.minutes)}</span><b class="${s.paid ? 'pos' : ''}">${s.paid ? `+${money(s.paid)}` : 'Sin pago'}</b></div></li>`;
    }).join('')}</ul>` : '<div class="pn-empty soft"><b>Sin resultados</b><p>No hay servicios registrados</p></div>';
    return `<section class="pn-box"><h3 class="pn-h3">Historial de servicios</h3><p class="pn-muted">Tus últimos turnos terminados</p>${list}</section>`;
  }

  function ranking() {
    const list = S.ranking.length ? `<ol class="pn-rank">${S.ranking.map((p, i) => `<li class="${p.yo ? 'me' : ''}">
        <span class="pos p${i + 1}">${i + 1}</span><b>${esc(p.nombre)} ${esc(p.apellidos)}${p.yo ? ' <em>(tú)</em>' : ''}</b>
        <span class="pn-tag">${p.turnos} turno(s)</span><strong>${hm(p.minutos)}</strong></li>`).join('')}</ol>`
      : '<div class="pn-empty soft"><b>Sin resultados</b><p>Nadie ha terminado turnos esta semana</p></div>';
    return `<section class="pn-box"><h3 class="pn-h3">Ranking de la semana</h3><p class="pn-muted">Quién más horas ha trabajado en los últimos 7 días</p>${list}</section>`;
  }

  function policeTools() {
    const duty = S.shift?.job === 'policia';
    const results = ui.search === null ? '' : ui.search.length ? `<ul class="pn-list">${ui.search.map((p) => `<li><span class="pn-li-ico blue">${ico('user')}</span>
        <div><b>${esc(p.nombre)} ${esc(p.apellidos)}</b><small>${esc(p.cedula)} · ${esc(isoBonito(p.nacimiento))} · ${esc(p.nacionalidad)} · Roblox: ${esc(p.roblox_name)}</small>
        <small>${p.multas ? `<span class="pn-tag bad">${p.multas} multa(s) pendiente(s)</span>` : '<span class="pn-tag ok">Sin multas</span>'} ${p.arrestos ? `<span class="pn-tag">${p.arrestos} arresto(s)</span>` : ''}</small></div>
        <div class="pn-li-r col"><button class="pn-btn gold sm" type="button" data-act="usar" data-cedula="${esc(p.cedula)}" data-to="multa">Multar</button>
        <button class="pn-btn ghost sm" type="button" data-act="usar" data-cedula="${esc(p.cedula)}" data-to="arresto">Arrestar</button></div></li>`).join('')}</ul>`
      : empty('search', 'No se encontró a nadie');
    const act = ui.activity;
    const activity = !duty ? '<p class="pn-muted">Aparece cuando estés en turno.</p>' : !act ? '<p class="pn-muted">Cargando…</p>'
      : (act.fines.length || act.arrests.length) ? `<ul class="pn-list">${[
        ...act.fines.map((f) => ({ t: f.created_at, h: `<li><span class="pn-li-ico gold">${ico('receipt')}</span><div><b>Multa · ${esc(f.nombre)} ${esc(f.apellidos)}</b><small>${esc(f.motivo)} · ${fechaHora(f.created_at)}</small></div><div class="pn-li-r"><b>${money(f.monto)}</b></div></li>` })),
        ...act.arrests.map((a) => ({ t: a.created_at, h: `<li><span class="pn-li-ico red">${ico('gavel')}</span><div><b>Arresto · ${esc(a.nombre)} ${esc(a.apellidos)}</b><small>${esc(a.cargos)} · ${fechaHora(a.created_at)}</small></div><div class="pn-li-r"><span class="pn-tag">${a.minutos} min</span></div></li>` })),
      ].sort((a, b) => b.t - a.t).slice(0, 10).map((x) => x.h).join('')}</ul>` : empty('shield', 'Aún no has puesto multas ni arrestos');
    return `<section class="pn-box pn-police ${duty ? '' : 'locked'}">
      <div class="pn-box-h"><span class="pn-box-ico blue">${ico('shield')}</span><div><b>Herramientas de Policía</b><small>Buscar ciudadanos, multas y arrestos</small></div></div>
      ${duty ? '' : `<div class="pn-note warn">${ico('alert')}<div>Inicia tu turno de <b>Policía</b> para usar estas herramientas.</div></div>`}
      <fieldset ${duty ? '' : 'disabled'}>
        <form data-form="buscar" class="pn-search" novalidate>${ico('search')}
          <input class="ap-input" name="q" maxlength="40" placeholder="Buscar por nombre, cédula o usuario de Roblox" autocomplete="off" aria-label="Buscar ciudadano">
          <button class="pn-btn gold" type="submit">Buscar</button>
        </form>
        ${results}
        <div class="pn-two">
          <form data-form="multa" class="pn-form-box" novalidate>
            <h4>${ico('receipt')}Poner multa</h4>
            ${field('m-cedula', 'Cédula', '<input class="ap-input" id="f-m-cedula" name="cedula" maxlength="20" placeholder="8-123-4567" autocomplete="off" required>')}
            ${field('m-motivo', 'Motivo', '<input class="ap-input" id="f-m-motivo" name="motivo" maxlength="200" placeholder="Ej: Exceso de velocidad" required>')}
            ${field('m-monto', `Monto ($${S.money.fineMin}–$${S.money.fineMax.toLocaleString('es-PA')})`, '<input class="ap-input" id="f-m-monto" name="monto" inputmode="numeric" placeholder="Ej: 750" required>')}
            <button class="pn-btn gold" type="submit">Poner multa</button>
          </form>
          <form data-form="arresto" class="pn-form-box" novalidate>
            <h4>${ico('gavel')}Registrar arresto</h4>
            ${field('a-cedula', 'Cédula', '<input class="ap-input" id="f-a-cedula" name="cedula" maxlength="20" placeholder="8-123-4567" autocomplete="off" required>')}
            ${field('a-cargos', 'Cargos', '<input class="ap-input" id="f-a-cargos" name="cargos" maxlength="300" placeholder="Ej: Robo a mano armada" required>')}
            ${field('a-minutos', 'Tiempo en celda (minutos)', '<input class="ap-input" id="f-a-minutos" name="minutos" inputmode="numeric" placeholder="Ej: 20" required>')}
            <button class="pn-btn gold" type="submit">Registrar arresto</button>
          </form>
        </div>
        <h3 class="pn-h3">Mi actividad</h3>${activity}
      </fieldset></section>`;
  }

  async function loadActivity() {
    try { ui.activity = await api('/api/panel/policia/actividad'); } catch { ui.activity = { fines: [], arrests: [] }; }
    if (currentView() === 'trabajos') render();
  }

  // ─── Banco ───
  function txList(list) {
    if (!list.length) return empty('bank', 'Todavía no hay movimientos');
    return `<ul class="pn-list">${list.map((t) => {
      const who = t.other_nombre ? ` · ${esc(t.other_nombre)} ${esc(t.other_apellidos)}` : '';
      return `<li><span class="pn-li-ico ${t.amount < 0 ? 'red' : 'green'}">${ico(t.amount < 0 ? 'send' : 'down')}</span>
        <div><b>${esc(KIND[t.kind] || t.kind)}${who}</b><small>${t.note ? `${esc(t.note)} · ` : ''}${fechaHora(t.created_at)}</small></div>
        <div class="pn-li-r"><b class="${t.amount < 0 ? 'neg' : 'pos'}">${t.amount < 0 ? '−' : '+'}${money(Math.abs(t.amount))}</b></div></li>`;
    }).join('')}</ul>`;
  }

  function viewBanco() {
    if (!S.account) return `<div class="pn-note info">${ico('bank')}<div><b>No tienes cuenta todavía.</b> Se abre sola al crear tu cédula.</div><a class="pn-btn gold" href="#perfil">Crear cédula</a></div>`;
    return `<div class="pn-bank">
        <div class="pn-bal main"><span>${ico('bank')}</span><small>Saldo en el banco</small><b>${money(S.account.banco)}</b></div>
        <div class="pn-bal"><span>${ico('cash')}</span><small>Efectivo</small><b>${money(S.account.efectivo)}</b></div>
        <div class="pn-bal"><span>${ico('alert')}</span><small>Multas pendientes</small><b class="${owed() ? 'neg' : ''}">${money(owed())}</b></div>
      </div>
      <div class="pn-two">
        <section class="pn-box">${moverForm()}</section>
        <section class="pn-box">${transferForm()}</section>
      </div>
      <section class="pn-box"><h3 class="pn-h3">Movimientos</h3>${txList(S.transactions)}</section>`;
  }

  const moverForm = (tipo) => `<form data-form="mover" novalidate>
      <h4 class="pn-h4">${ico('swap')}${tipo === 'retirar' ? 'Retirar del banco' : tipo === 'depositar' ? 'Depositar al banco' : 'Depositar o retirar'}</h4>
      ${field('mover-monto', 'Monto', '<input class="ap-input" id="f-mover-monto" name="monto" inputmode="numeric" placeholder="Ej: 500" required>')}
      <div class="pn-row">${tipo !== 'retirar' ? '<button class="pn-btn gold" type="submit" name="tipo" value="depositar">Depositar</button>' : ''}${tipo !== 'depositar' ? `<button class="pn-btn ${tipo ? 'gold' : 'ghost'}" type="submit" name="tipo" value="retirar">Retirar</button>` : ''}</div>
    </form>`;
  const transferForm = () => `<form data-form="transferir" novalidate>
      <h4 class="pn-h4">${ico('send')}Transferir</h4>
      ${field('tr-cedula', 'Cédula de quien recibe', '<input class="ap-input" id="f-tr-cedula" name="cedula" maxlength="20" placeholder="Ej: 8-123-4567" autocomplete="off" required>')}
      ${field('tr-monto', 'Monto', '<input class="ap-input" id="f-tr-monto" name="monto" inputmode="numeric" placeholder="Ej: 1500" required>')}
      ${field('tr-nota', 'Nota (opcional)', '<input class="ap-input" id="f-tr-nota" name="nota" maxlength="80" placeholder="Ej: Renta del local">')}
      <button class="pn-btn blue" type="submit">Enviar dinero</button>
    </form>`;

  // ─── Ventana para depositar / retirar / transferir desde el perfil ───
  const modal = $('#pn-modal');
  function openModal(kind) {
    $('#pn-modal-body').innerHTML = `<p class="pn-modal-bal" id="pn-modal-title">Banco ${money(S.account.banco)} · Efectivo ${money(S.account.efectivo)}</p>${kind === 'transferir' ? transferForm() : moverForm(kind)}`;
    modal.classList.remove('hidden');
    document.body.classList.add('pn-noscroll');
    setTimeout(() => $('#pn-modal-body input')?.focus(), 50);
  }
  function closeModal() { modal.classList.add('hidden'); document.body.classList.remove('pn-noscroll'); }
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal(); });

  // ─── Contador del turno ───
  function tick() {
    if (!S?.shift) return;
    const secs = Math.max(0, Math.floor((Date.now() - (S.clockSkew || 0) - S.shift.started_at) / 1000));
    const min = Math.floor(secs / 60);
    $$('[data-hm]').forEach((el) => { el.textContent = hm(min); });
    $$('[data-sec]').forEach((el) => { el.textContent = `· ${String(secs % 60).padStart(2, '0')}s`; });
    $$('[data-week]').forEach((el) => { el.textContent = hm(S.stats.minutos + min); });
    const pay = min >= S.shiftRules.minMinutes ? Math.round((Math.min(min, S.shiftRules.maxMinutes) / 60) * jobInfo(S.shift.job).payPerHour) : 0;
    $$('[data-earn]').forEach((el) => { el.textContent = money(pay); });
  }
  setInterval(tick, 1000);

  // ─── Acciones ───
  function showErrors(form, errors = {}) {
    $$('[data-err]', form).forEach((el) => { el.textContent = ''; });
    $$('.ap-input', form).forEach((el) => el.classList.remove('bad'));
    for (const [k, msg] of Object.entries(errors)) {
      const el = $(`[data-err="${k}"]`, form) || $(`[data-err$="-${k}"]`, form);
      if (el) el.textContent = msg;
      $(`[name="${k}"]`, form)?.classList.add('bad');
    }
  }

  async function refresh() {
    S = withSkew(await api('/api/panel/estado'));
    render();
  }

  async function run(form, fn) {
    if (ui.busy) return;
    ui.busy = true;
    const btns = form ? $$('button', form) : [];
    btns.forEach((b) => { b.disabled = true; });
    try {
      await fn();
    } catch (e) {
      if (e.gate) { closeModal(); return gate(e); }
      if (form && e.errors) showErrors(form, e.errors);
      toast(e.error);
    } finally {
      ui.busy = false;
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('form[data-form]');
    if (!form) return;
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const kind = form.dataset.form;
    run(form, async () => {
      if (kind === 'roblox') {
        const r = await api('/api/roblox/vincular', { usuario: f.usuario });
        ui.link = { code: r.code, user: r.user };
        render();
      } else if (kind === 'cedula') {
        const r = await api('/api/panel/cedula', { personaje: { nombre: f.nombre, apellidos: f.apellidos, nacimiento: f.nacimiento, genero: f.genero, sangre: f.sangre, nacionalidad: f.nacionalidad } });
        toast(`¡Listo! Tu cédula es ${r.character.cedula}`);
        ui.tab = 'info';
        await refresh();
      } else if (kind === 'mover') {
        const tipo = ev.submitter?.value === 'retirar' ? 'retirar' : 'depositar';
        await api('/api/panel/banco/mover', { tipo, monto: f.monto });
        closeModal();
        toast(tipo === 'depositar' ? `Depositaste ${money(f.monto)}` : `Retiraste ${money(f.monto)}`);
        await refresh();
      } else if (kind === 'transferir') {
        const r = await api('/api/panel/banco/transferir', { cedula: f.cedula, monto: f.monto, nota: f.nota });
        closeModal();
        toast(`Enviaste ${money(f.monto)} a ${r.to}`);
        await refresh();
      } else if (kind === 'buscar') {
        ui.search = (await api(`/api/panel/policia/buscar?q=${encodeURIComponent(f.q || '')}`)).results;
        render();
        const q = $('form[data-form="buscar"] input');
        if (q) q.value = f.q || '';
      } else if (kind === 'multa') {
        const r = await api('/api/panel/policia/multa', { cedula: f.cedula, motivo: f.motivo, monto: f.monto });
        toast(`Multa de ${money(r.fine.monto)} a ${r.fine.a}`);
        ui.activity = null; ui.search = null;
        await refresh();
      } else if (kind === 'arresto') {
        const r = await api('/api/panel/policia/arresto', { cedula: f.cedula, cargos: f.cargos, minutos: f.minutos });
        toast(`Arresto registrado: ${r.arrest.a} (${r.arrest.minutos} min)`);
        ui.activity = null; ui.search = null;
        await refresh();
      }
    });
  });

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'reintentar') return void load();
    if (act === 'cerrar') return closeModal();
    if (act === 'modal') return openModal(b.dataset.m);
    if (act === 'tab') { ui.tab = b.dataset.tab; render(); if (b.classList.contains('pn-short')) $('#pn-exp')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (act === 'work') { ui.work = b.dataset.tab; render(); return; }
    if (act === 'copiar') { navigator.clipboard?.writeText(ui.link?.code || '').then(() => toast('Código copiado'), () => toast('Mantén presionado el código para copiarlo')); return; }
    if (act === 'otro-usuario') { ui.link = null; render(); return; }
    if (act === 'girar') { ui.flip = !ui.flip; b.classList.toggle('flip', ui.flip); return; }
    if (act === 'usar') {
      const form = $(`form[data-form="${b.dataset.to}"]`);
      const input = form && $('[name="cedula"]', form);
      if (input) { input.value = b.dataset.cedula; form.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => $('[name="motivo"],[name="cargos"]', form)?.focus(), 350); }
      return;
    }
    if (act === 'salir') {
      fetch('/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {}).finally(() => { location.href = '/'; });
      return;
    }
    run(null, async () => {
      if (act === 'iniciar') {
        await api('/api/panel/turno/iniciar', { job: $('#pn-job')?.value });
        toast('Turno iniciado. ¡Buen trabajo!');
        ui.activity = null;
        await refresh();
      } else if (act === 'terminar') {
        const r = (await api('/api/panel/turno/terminar', {})).result;
        toast(r.tooShort ? `Turno de ${r.minutes} min: muy corto para cobrar.` : `Turno de ${hm(r.minutes)} · cobraste ${money(r.paid)}${r.capped ? ' (tope de 4 h)' : ''}`);
        await refresh();
      } else if (act === 'comprobar') {
        const r = await api('/api/roblox/comprobar', {});
        ui.link = null;
        toast(`¡Roblox vinculado: ${r.user.name}!`);
        await refresh();
      } else if (act === 'pagar') {
        await api('/api/panel/multas/pagar', { id: Number(b.dataset.id) });
        toast('Multa pagada.');
        await refresh();
      }
    });
  });

  window.addEventListener('hashchange', () => { if (S) { render(); window.scrollTo(0, 0); } });

  async function load() {
    main.innerHTML = '<div class="pn-loading"><span class="pn-spin" aria-hidden="true"></span>Cargando tu panel…</div>';
    try {
      S = withSkew(await api('/api/panel/estado'));
    } catch (e) {
      return gate(e);
    }
    const login = new URLSearchParams(location.search).get('login');
    if (login) history.replaceState(null, '', location.pathname + location.hash);
    if (login === 'ok') toast(`¡Hola, ${S.user.name}!`);
    render();
  }
  load();
})();
