// Panel de ciudadano de Panamá RP: inicio, cédula, banco y trabajos según los roles de Discord.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => `$${Number(n || 0).toLocaleString('es-PA')}`;
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fecha = (ms) => { const d = new Date(ms); return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`; };
  const fechaHora = (ms) => { const d = new Date(ms); return `${fecha(ms)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const isoBonito = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}` : iso; };
  const KIND = { apertura: 'Apertura de cuenta', depositar: 'Depósito', retirar: 'Retiro', transferencia: 'Transferencia', salario: 'Salario', multa: 'Pago de multa' };

  const main = $('#pn-main');
  const nav = $('#pn-nav');
  let S = null; // estado que manda el servidor
  const ui = { search: null, activity: null, rbxPic: null, busy: false };

  // ─── Utilidades ───
  let toastT = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 3200);
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

  const discordPic = (u) => (typeof u?.avatar === 'string' && u.avatar.startsWith('https://cdn.discordapp.com/') ? u.avatar : 'https://cdn.discordapp.com/embed/avatars/0.png');
  const robloxName = () => S?.character?.roblox_name || S?.solicitud?.roblox?.name || '';
  const displayName = () => (S.character ? `${S.character.nombre} ${S.character.apellidos}` : S.user.name);
  const pendingFines = () => S.fines.filter((f) => f.estado === 'pendiente');
  const jobInfo = (k) => S.jobInfo[k] || { name: k, icon: '💼', color: '#7aa2ff', payPerHour: 0 };

  // Foto de Roblox: se pone donde haya [data-rbx-pic]; si no carga, queda la inicial.
  function photo(cls = '') {
    const ini = esc((S.character?.nombre || S.user.name || '?').charAt(0).toUpperCase());
    return `<div class="pn-photo ${cls}" data-rbx-pic><span>${ini}</span></div>`;
  }
  function paintPhotos() {
    if (!ui.rbxPic) return;
    for (const el of $$('[data-rbx-pic]')) {
      if (el.querySelector('img')) continue;
      const img = new Image();
      img.alt = 'Avatar de Roblox';
      img.addEventListener('load', () => el.append(img));
      img.src = ui.rbxPic;
    }
  }
  async function loadRobloxPic() {
    const name = robloxName();
    if (!name || ui.rbxPic) return;
    try {
      const r = await api(`/api/roblox/avatares?usuarios=${encodeURIComponent(name)}`);
      ui.rbxPic = r.users?.[name.toLowerCase()]?.avatar || null;
      paintPhotos();
    } catch { /* queda la inicial */ }
  }

  // ─── Pantallas de acceso ───
  function gate(e) {
    nav.classList.add('hidden');
    nav.parentElement.classList.add('solo');
    if (e.gate === 'login' || e.status === 401) $('#pn-logout').classList.add('hidden');
    const box = (icon, title, text, actions) => {
      main.innerHTML = `<section class="pn-gate"><div class="big-ico ${icon === 'ok' ? 'ok' : icon === 'discord' ? 'discord' : 'warn'}">${icon === 'discord' ? 'D' : icon === 'ok' ? '✓' : '!'}</div>
        <h1>${title}</h1><p>${text}</p><div class="pn-gate-actions">${actions}</div></section>`;
    };
    if (e.gate === 'login' || e.status === 401) {
      return box('discord', 'Inicia sesión', 'El panel es solo para ciudadanos de Panamá RP. Entra con tu cuenta de Discord.',
        '<a class="btn lg" href="/auth/discord?next=/panel">Iniciar sesión con Discord</a>');
    }
    if (e.gate === 'whitelist') {
      return box('warn', 'Aún no tienes la whitelist', esc(e.error),
        '<a class="btn lg btn-wl" href="/solicitud"><span>Hacer la whitelist</span></a><a class="btn lg ghost" href="/">Volver al inicio</a>');
    }
    return box('warn', 'No se pudo abrir el panel', esc(e.error), '<button class="btn lg" type="button" data-act="reintentar">Reintentar</button>');
  }

  // ─── Navegación ───
  function renderNav() {
    const items = [['inicio', '🏠', 'Inicio'], ['cedula', '🪪', 'Mi cédula'], ['banco', '🏦', 'Banco'],
      ...S.jobs.map((k) => [`trabajo-${k}`, jobInfo(k).icon, jobInfo(k).name])];
    nav.innerHTML = items.map(([id, ico, label]) => `<a href="#${id}" data-view="${id}"><span aria-hidden="true">${ico}</span>${esc(label)}</a>`).join('');
    nav.classList.remove('hidden');
    nav.parentElement.classList.remove('solo');
    $('#pn-logout').classList.remove('hidden');
    const me = $('#pn-me');
    const pic = $('#pn-me-pic');
    pic.addEventListener('error', () => { pic.src = '/img/favicon.png'; }, { once: true });
    pic.src = discordPic(S.user);
    $('#pn-me-name').textContent = S.user.name;
    me.classList.remove('hidden');
  }

  function currentView() {
    const h = location.hash.slice(1);
    if (['inicio', 'cedula', 'banco'].includes(h)) return h;
    if (h.startsWith('trabajo-') && S.jobs.includes(h.slice(8))) return h;
    return 'inicio';
  }

  function render() {
    const view = currentView();
    $$('a', nav).forEach((a) => a.classList.toggle('on', a.dataset.view === view));
    const banner = S.modo === 'prueba'
      ? '<div class="ap-banner warn"><b>Modo de prueba.</b> Falta conectar la base de datos: lo que hagas aquí se borra cuando la web se reinicia.</div>' : '';
    const html = view === 'cedula' ? viewCedula() : view === 'banco' ? viewBanco() : view.startsWith('trabajo-') ? viewTrabajo(view.slice(8)) : viewInicio();
    main.innerHTML = banner + html;
    paintPhotos();
    tick();
    if (view === 'trabajo-policia' && onDuty('policia') && !ui.activity) loadActivity();
  }

  // ─── Inicio ───
  function shiftStrip() {
    if (!S.shift) return '';
    const j = jobInfo(S.shift.job);
    return `<a class="pn-strip" href="#trabajo-${esc(S.shift.job)}" data-color="${esc(j.color)}">
      <span class="pn-live" aria-hidden="true"></span><b>En turno · ${esc(j.name)}</b>
      <span class="pn-timer" data-timer>00:00:00</span><span class="pn-strip-go">Ver turno →</span></a>`;
  }

  function viewInicio() {
    const c = S.character;
    const fines = pendingFines();
    const owed = fines.reduce((a, f) => a + Number(f.monto), 0);
    const hours = (S.stats.minutos / 60).toFixed(1).replace('.', ',');
    const jobs = S.jobs.length
      ? `<div class="pn-jobs">${S.jobs.map((k) => {
        const j = jobInfo(k);
        return `<a class="pn-job" href="#trabajo-${esc(k)}" data-color="${esc(j.color)}"><span class="pn-job-ico" aria-hidden="true">${j.icon}</span>
          <b>${esc(j.name)}</b><small>${money(j.payPerHour)} por hora</small><span class="pn-job-go">Abrir →</span></a>`;
      }).join('')}</div>`
      : '<p class="pn-muted">No tienes roles de trabajo en Discord. Cuando el staff te dé uno (por ejemplo Policía), aparecerá aquí con sus botones.</p>';
    return `
      ${c ? '' : `<div class="pn-callout"><div><b>Crea tu cédula</b><p>Con ella se abre tu cuenta del banco y puedes trabajar.</p></div><a class="btn" href="#cedula">Crear cédula</a></div>`}
      <section class="pn-hero">
        ${photo('lg')}
        <div class="pn-hero-txt">
          <span class="eyebrow">Ciudadano de Panamá RP</span>
          <h1>${esc(displayName())}</h1>
          <div class="pn-chips">${c ? `<span class="pn-chip">🪪 ${esc(c.cedula)}</span>` : ''}${robloxName() ? `<span class="pn-chip">🎮 @${esc(robloxName())}</span>` : ''}<span class="pn-chip ok">✓ Whitelist</span></div>
        </div>
      </section>
      ${shiftStrip()}
      <div class="pn-tiles">
        <div class="pn-tile"><small>Banco</small><b>${S.account ? money(S.account.banco) : '—'}</b></div>
        <div class="pn-tile"><small>Efectivo</small><b>${S.account ? money(S.account.efectivo) : '—'}</b></div>
        <a class="pn-tile ${fines.length ? 'bad' : ''}" href="#cedula"><small>Multas pendientes</small><b>${fines.length}</b>${fines.length ? `<em>${money(owed)}</em>` : ''}</a>
        <div class="pn-tile"><small>Trabajado esta semana</small><b>${hours} h</b><em>${money(S.stats.pagado)}</em></div>
      </div>
      <h2 class="pn-h2">Tus trabajos</h2>
      ${jobs}
      ${S.transactions.length ? `<h2 class="pn-h2">Últimos movimientos</h2>${txList(S.transactions.slice(0, 4))}<a class="pn-more" href="#banco">Ver todo en el banco →</a>` : ''}`;
  }

  // ─── Cédula ───
  function field(name, label, input, err = '') {
    return `<div class="ap-field"><label class="ap-label" for="f-${name}">${label}</label>${input}<div class="pn-err" data-err="${name}">${esc(err)}</div></div>`;
  }
  const select = (name, opts, val) => `<div class="ap-select"><select class="ap-input" id="f-${name}" name="${name}" required>
    <option value="">Elige…</option>${opts.map((o) => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;

  function cedulaForm() {
    const p = S.solicitud?.personaje || {};
    const o = S.options;
    return `<section class="pn-card">
      <h2 class="pn-h2 first">Crea tu cédula</h2>
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
        ${field('roblox', 'Usuario de Roblox', `<input class="ap-input" id="f-roblox" name="roblox" maxlength="20" autocomplete="off" value="${esc(S.solicitud?.roblox?.name)}" required>`)}
        <button class="btn lg" type="submit">Crear mi cédula</button>
      </form></section>`;
  }

  function idCard() {
    const c = S.character;
    return `<div class="pn-id">
      <div class="pn-id-top"><img src="/img/logo.webp" alt="" width="40" height="40"><div><b>PANAMÁ RP</b><small>Cédula de identidad · documento de rol</small></div></div>
      <div class="pn-id-body">
        ${photo('id')}
        <dl>
          <div><dt>Nombre</dt><dd>${esc(c.nombre)}</dd></div>
          <div><dt>Apellidos</dt><dd>${esc(c.apellidos)}</dd></div>
          <div><dt>Nacimiento</dt><dd>${esc(isoBonito(c.nacimiento))}</dd></div>
          <div><dt>Sexo</dt><dd>${esc(c.genero)}</dd></div>
          <div><dt>Sangre</dt><dd>${esc(c.sangre)}</dd></div>
          <div><dt>Nacionalidad</dt><dd>${esc(c.nacionalidad)}</dd></div>
        </dl>
      </div>
      <div class="pn-id-foot"><div><small>N.º de cédula</small><b>${esc(c.cedula)}</b></div><div class="r"><small>Roblox</small><b>@${esc(c.roblox_name)}</b></div></div>
      <div class="pn-id-band" aria-hidden="true"></div>
    </div><p class="pn-muted small">Expedida el ${fecha(c.created_at)}.</p>`;
  }

  function viewCedula() {
    if (!S.character) return cedulaForm();
    const fines = S.fines.length ? `<ul class="pn-list">${S.fines.map((f) => `<li>
        <div><b>${esc(f.motivo)}</b><small>${esc(f.officer_name)} · ${fecha(f.created_at)}</small></div>
        <div class="pn-list-r"><b class="${f.estado === 'pendiente' ? 'neg' : ''}">${money(f.monto)}</b>
        ${f.estado === 'pendiente' ? `<button class="btn sm" type="button" data-act="pagar" data-id="${f.id}">Pagar</button>` : '<span class="pn-tag ok">Pagada</span>'}</div></li>`).join('')}</ul>`
      : '<p class="pn-muted">No tienes multas. 👌</p>';
    const arrests = S.arrests.length ? `<ul class="pn-list">${S.arrests.map((a) => `<li>
        <div><b>${esc(a.cargos)}</b><small>${esc(a.officer_name)} · ${fecha(a.created_at)}</small></div>
        <div class="pn-list-r"><span class="pn-tag">${a.minutos} min</span></div></li>`).join('')}</ul>`
      : '<p class="pn-muted">Sin antecedentes.</p>';
    return `<div class="pn-two">
      <section>${idCard()}</section>
      <section class="pn-card">
        <h2 class="pn-h2 first">Multas</h2>${fines}
        <h2 class="pn-h2">Antecedentes</h2>${arrests}
      </section></div>`;
  }

  // ─── Banco ───
  function txList(list) {
    if (!list.length) return '<p class="pn-muted">Todavía no hay movimientos.</p>';
    return `<ul class="pn-list">${list.map((t) => {
      const who = t.other_nombre ? ` · ${esc(t.other_nombre)} ${esc(t.other_apellidos)}` : '';
      return `<li><div><b>${esc(KIND[t.kind] || t.kind)}${who}</b><small>${t.note ? `${esc(t.note)} · ` : ''}${fechaHora(t.created_at)}</small></div>
        <div class="pn-list-r"><b class="${t.amount < 0 ? 'neg' : 'pos'}">${t.amount < 0 ? '−' : '+'}${money(Math.abs(t.amount))}</b></div></li>`;
    }).join('')}</ul>`;
  }

  function viewBanco() {
    if (!S.account) return `<div class="pn-callout"><div><b>No tienes cuenta todavía</b><p>Se abre sola al crear tu cédula.</p></div><a class="btn" href="#cedula">Crear cédula</a></div>`;
    return `<div class="pn-bank">
        <div class="pn-bal main"><small>Saldo en el banco</small><b>${money(S.account.banco)}</b></div>
        <div class="pn-bal"><small>Efectivo</small><b>${money(S.account.efectivo)}</b></div>
      </div>
      <div class="pn-two">
        <section class="pn-card">
          <h2 class="pn-h2 first">Depositar o retirar</h2>
          <form data-form="mover" novalidate>
            ${field('mover-monto', 'Monto', `<input class="ap-input" id="f-mover-monto" name="monto" inputmode="numeric" placeholder="Ej: 500" required>`)}
            <div class="pn-row"><button class="btn" type="submit" name="tipo" value="depositar">Depositar</button><button class="btn ghost" type="submit" name="tipo" value="retirar">Retirar</button></div>
          </form>
        </section>
        <section class="pn-card">
          <h2 class="pn-h2 first">Transferir</h2>
          <form data-form="transferir" novalidate>
            ${field('tr-cedula', 'Cédula de quien recibe', '<input class="ap-input" id="f-tr-cedula" name="cedula" maxlength="20" placeholder="Ej: 8-123-4567" autocomplete="off" required>')}
            ${field('tr-monto', 'Monto', '<input class="ap-input" id="f-tr-monto" name="monto" inputmode="numeric" placeholder="Ej: 1500" required>')}
            ${field('tr-nota', 'Nota (opcional)', '<input class="ap-input" id="f-tr-nota" name="nota" maxlength="80" placeholder="Ej: Renta del local">')}
            <button class="btn" type="submit">Enviar dinero</button>
          </form>
        </section>
      </div>
      <section class="pn-card"><h2 class="pn-h2 first">Movimientos</h2>${txList(S.transactions)}</section>`;
  }

  // ─── Trabajos ───
  const onDuty = (job) => S.shift?.job === job;

  function viewTrabajo(job) {
    const j = jobInfo(job);
    const r = S.shiftRules;
    let control;
    if (!S.character) {
      control = '<p class="pn-muted">Primero crea tu cédula para poder trabajar.</p><a class="btn" href="#cedula">Crear cédula</a>';
    } else if (onDuty(job)) {
      control = `<div class="pn-clock"><span class="pn-live" aria-hidden="true"></span><span class="pn-timer big" data-timer>00:00:00</span></div>
        <p class="pn-earn">Llevas ganado <b data-earn>$0</b></p>
        <button class="btn lg danger" type="button" data-act="terminar">Terminar turno y cobrar</button>`;
    } else if (S.shift) {
      const o = jobInfo(S.shift.job);
      control = `<p class="pn-muted">Tienes un turno abierto de <b>${esc(o.name)}</b>. Termínalo antes de empezar otro.</p><a class="btn ghost" href="#trabajo-${esc(S.shift.job)}">Ir a ${esc(o.name)}</a>`;
    } else {
      control = `<button class="btn lg" type="button" data-act="iniciar" data-job="${esc(job)}">Iniciar turno</button>
        <p class="pn-muted small">Empieza el contador cuando entres al servidor de ER:LC para trabajar.</p>`;
    }
    return `<section class="pn-jobhead" data-color="${esc(j.color)}"><span class="pn-job-ico" aria-hidden="true">${j.icon}</span>
        <div><span class="eyebrow">Trabajo</span><h1>${esc(j.name)}</h1><small>${money(j.payPerHour)} por hora · mínimo ${r.minMinutes} min · máximo ${r.maxMinutes / 60} h por turno</small></div></section>
      <div class="pn-two">
        <section class="pn-card pn-shift">${control}</section>
        <section class="pn-card"><h2 class="pn-h2 first">Esta semana</h2>
          <div class="pn-tiles mini"><div class="pn-tile"><small>Turnos</small><b>${S.stats.turnos}</b></div>
          <div class="pn-tile"><small>Horas</small><b>${(S.stats.minutos / 60).toFixed(1).replace('.', ',')}</b></div>
          <div class="pn-tile"><small>Cobrado</small><b>${money(S.stats.pagado)}</b></div></div>
          <p class="pn-muted small">Cuenta todos tus trabajos de los últimos 7 días.</p></section>
      </div>
      ${job === 'policia' ? policeTools() : ''}`;
  }

  function policeTools() {
    const duty = onDuty('policia');
    const results = ui.search === null ? '' : ui.search.length ? `<ul class="pn-list">${ui.search.map((p) => `<li>
        <div><b>${esc(p.nombre)} ${esc(p.apellidos)}</b><small>🪪 ${esc(p.cedula)} · ${esc(isoBonito(p.nacimiento))} · ${esc(p.nacionalidad)} · @${esc(p.roblox_name)}</small>
        <small>${p.multas ? `<span class="pn-tag bad">${p.multas} multa(s) pendiente(s)</span>` : '<span class="pn-tag ok">Sin multas</span>'} ${p.arrestos ? `<span class="pn-tag">${p.arrestos} arresto(s)</span>` : ''}</small></div>
        <div class="pn-list-r col"><button class="btn sm" type="button" data-act="usar" data-cedula="${esc(p.cedula)}" data-to="multa">Multar</button>
        <button class="btn sm ghost" type="button" data-act="usar" data-cedula="${esc(p.cedula)}" data-to="arresto">Arrestar</button></div></li>`).join('')}</ul>`
      : '<p class="pn-muted">No se encontró a nadie.</p>';
    const act = ui.activity;
    const activity = !act ? '<p class="pn-muted">Cargando…</p>'
      : (act.fines.length || act.arrests.length) ? `<ul class="pn-list">${[
        ...act.fines.map((f) => ({ t: f.created_at, h: `<li><div><b>Multa · ${esc(f.nombre)} ${esc(f.apellidos)}</b><small>${esc(f.motivo)} · ${fechaHora(f.created_at)}</small></div><div class="pn-list-r"><b>${money(f.monto)}</b></div></li>` })),
        ...act.arrests.map((a) => ({ t: a.created_at, h: `<li><div><b>Arresto · ${esc(a.nombre)} ${esc(a.apellidos)}</b><small>${esc(a.cargos)} · ${fechaHora(a.created_at)}</small></div><div class="pn-list-r"><span class="pn-tag">${a.minutos} min</span></div></li>` })),
      ].sort((a, b) => b.t - a.t).slice(0, 10).map((x) => x.h).join('')}</ul>` : '<p class="pn-muted">Aún no has puesto multas ni arrestos.</p>';
    return `<section class="pn-card pn-police ${duty ? '' : 'locked'}">
      <h2 class="pn-h2 first">Herramientas de Policía</h2>
      ${duty ? '' : '<div class="pn-lock">🔒 Inicia tu turno de Policía para usar estas herramientas.</div>'}
      <fieldset ${duty ? '' : 'disabled'}>
        <form data-form="buscar" class="pn-search" novalidate>
          <input class="ap-input" name="q" maxlength="40" placeholder="Buscar por nombre, cédula o usuario de Roblox" autocomplete="off">
          <button class="btn" type="submit">Buscar</button>
        </form>
        ${results}
        <div class="pn-two tight">
          <form data-form="multa" novalidate>
            <h3>Poner multa</h3>
            ${field('m-cedula', 'Cédula', '<input class="ap-input" id="f-m-cedula" name="cedula" maxlength="20" placeholder="8-123-4567" autocomplete="off" required>')}
            ${field('m-motivo', 'Motivo', '<input class="ap-input" id="f-m-motivo" name="motivo" maxlength="200" placeholder="Ej: Exceso de velocidad" required>')}
            ${field('m-monto', `Monto ($${S.money.fineMin}–$${S.money.fineMax.toLocaleString('es-PA')})`, '<input class="ap-input" id="f-m-monto" name="monto" inputmode="numeric" placeholder="Ej: 750" required>')}
            <button class="btn" type="submit">Poner multa</button>
          </form>
          <form data-form="arresto" novalidate>
            <h3>Registrar arresto</h3>
            ${field('a-cedula', 'Cédula', '<input class="ap-input" id="f-a-cedula" name="cedula" maxlength="20" placeholder="8-123-4567" autocomplete="off" required>')}
            ${field('a-cargos', 'Cargos', '<input class="ap-input" id="f-a-cargos" name="cargos" maxlength="300" placeholder="Ej: Robo a mano armada" required>')}
            ${field('a-minutos', 'Tiempo en celda (minutos)', '<input class="ap-input" id="f-a-minutos" name="minutos" inputmode="numeric" placeholder="Ej: 20" required>')}
            <button class="btn" type="submit">Registrar arresto</button>
          </form>
        </div>
        <h2 class="pn-h2">Mi actividad</h2>${duty ? activity : '<p class="pn-muted">Aparece cuando estés en turno.</p>'}
      </fieldset></section>`;
  }

  async function loadActivity() {
    try { ui.activity = await api('/api/panel/policia/actividad'); } catch { ui.activity = { fines: [], arrests: [] }; }
    if (currentView() === 'trabajo-policia') render();
  }

  // ─── Contador del turno ───
  function tick() {
    if (!S?.shift) return;
    const secs = Math.max(0, Math.floor((Date.now() - S.shift.started_at - (S.clockSkew || 0)) / 1000));
    const hh = String(Math.floor(secs / 3600)).padStart(2, '0');
    const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    $$('[data-timer]').forEach((el) => { el.textContent = `${hh}:${mm}:${ss}`; });
    const min = Math.floor(secs / 60);
    const pay = min >= S.shiftRules.minMinutes ? Math.round((Math.min(min, S.shiftRules.maxMinutes) / 60) * jobInfo(S.shift.job).payPerHour) : 0;
    $$('[data-earn]').forEach((el) => { el.textContent = money(pay); });
  }
  setInterval(tick, 1000);

  // ─── Colores por trabajo (sin estilos en línea: se ponen con JS) ───
  const paintColors = () => $$('[data-color]').forEach((el) => el.style.setProperty('--job', el.dataset.color));
  new MutationObserver(paintColors).observe(main, { childList: true });

  // ─── Acciones ───
  function showErrors(form, errors = {}) {
    $$('[data-err]', form).forEach((el) => { el.textContent = ''; });
    $$('.ap-input', form).forEach((el) => el.classList.remove('bad'));
    for (const [k, msg] of Object.entries(errors)) {
      const el = $(`[data-err="${k}"]`, form) || $(`[data-err$="-${k}"]`, form);
      if (el) el.textContent = msg;
      const input = $(`[name="${k}"]`, form);
      if (input) input.classList.add('bad');
    }
  }

  async function refresh() {
    S = withSkew(await api('/api/panel/estado'));
    renderNav();
    render();
  }
  // Por si el reloj del teléfono no coincide con el del servidor
  function withSkew(state) { return { ...state, clockSkew: typeof state.now === 'number' ? Date.now() - state.now : 0 }; }

  async function run(form, fn) {
    if (ui.busy) return;
    ui.busy = true;
    const btns = form ? $$('button', form) : [];
    btns.forEach((b) => { b.disabled = true; });
    try {
      await fn();
    } catch (e) {
      if (e.gate) return gate(e);
      if (form && e.errors) showErrors(form, e.errors);
      toast(e.error);
    } finally {
      ui.busy = false;
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  main.addEventListener('submit', (ev) => {
    const form = ev.target.closest('form[data-form]');
    if (!form) return;
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const kind = form.dataset.form;
    run(form, async () => {
      if (kind === 'cedula') {
        const r = await api('/api/panel/cedula', { roblox: f.roblox, personaje: { nombre: f.nombre, apellidos: f.apellidos, nacimiento: f.nacimiento, genero: f.genero, sangre: f.sangre, nacionalidad: f.nacionalidad } });
        ui.rbxPic = null;
        toast(`¡Listo! Tu cédula es ${r.character.cedula}`);
        await refresh();
        loadRobloxPic();
      } else if (kind === 'mover') {
        const tipo = ev.submitter?.value === 'retirar' ? 'retirar' : 'depositar';
        await api('/api/panel/banco/mover', { tipo, monto: f.monto });
        toast(tipo === 'depositar' ? `Depositaste ${money(f.monto)}` : `Retiraste ${money(f.monto)}`);
        await refresh();
      } else if (kind === 'transferir') {
        const r = await api('/api/panel/banco/transferir', { cedula: f.cedula, monto: f.monto, nota: f.nota });
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
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'reintentar') return void load();
    if (act === 'usar') {
      const form = $(`form[data-form="${b.dataset.to}"]`);
      const input = form && $('[name="cedula"]', form);
      if (input) { input.value = b.dataset.cedula; form.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => $('[name="motivo"],[name="cargos"]', form)?.focus(), 350); }
      return;
    }
    run(null, async () => {
      if (act === 'iniciar') {
        await api('/api/panel/turno/iniciar', { job: b.dataset.job });
        toast('Turno iniciado. ¡Buen trabajo!');
        ui.activity = null;
        await refresh();
      } else if (act === 'terminar') {
        const r = (await api('/api/panel/turno/terminar', {})).result;
        toast(r.tooShort ? `Turno de ${r.minutes} min: muy corto para cobrar.` : `Turno de ${r.minutes} min · cobraste ${money(r.paid)}${r.capped ? ' (tope de 4 h)' : ''}`);
        await refresh();
      } else if (act === 'pagar') {
        await api('/api/panel/multas/pagar', { id: Number(b.dataset.id) });
        toast('Multa pagada.');
        await refresh();
      }
    });
  });

  $('#pn-logout').addEventListener('click', async () => {
    try { await fetch('/logout', { method: 'POST', credentials: 'same-origin' }); } catch { /* igual se va */ }
    location.href = '/';
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
    renderNav();
    render();
    loadRobloxPic();
  }
  load();
})();
