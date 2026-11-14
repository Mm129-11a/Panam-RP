// Panamá RP — solicitud de whitelist (formulario por pasos)
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const INVITE = 'https://discord.gg/fgRGQPbJF3';
  const STEPS = ['Identidad', 'Personaje', 'Conducta', 'Rol'];
  const KEY = 'prp_solicitud_v1';
  const NAME_RE = /^\p{L}[\p{L}' -]{1,39}$/u;
  const ROBLOX_RE = /^[A-Za-z0-9_]{3,20}$/;
  const AGE = { min: 18, max: 90 };
  const TEXT = { min: 50, max: 500 };
  const DISCORD_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.6 0L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.6 9-.2 13.6.3 18.1a19.9 19.9 0 0 0 6 3l1.3-2.1c-.7-.3-1.4-.6-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.9 19.9 0 0 0 6-3c.5-5.2-.8-9.7-3.5-13.7ZM8.5 15.3c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Zm7 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Z"/></svg>';

  const emptyDraft = () => ({
    roblox: '', robloxUser: null,
    personaje: { nombre: '', apellidos: '', nacimiento: '', genero: '', sangre: '', nacionalidad: '' },
    respuestas: {}, acepto: false,
  });
  const S = { step: 0, me: null, loginEnabled: false, receiving: false, sections: [], options: {}, sending: false, d: emptyDraft() };

  // ─── Borrador (se guarda mientras llenas, por si recargas la página) ───
  function loadDraft() {
    try {
      const v = JSON.parse(sessionStorage.getItem(KEY));
      if (!v || typeof v !== 'object') return;
      S.d = { ...emptyDraft(), ...v, personaje: { ...emptyDraft().personaje, ...(v.personaje || {}) }, respuestas: { ...(v.respuestas || {}) } };
      if (Number.isInteger(v._step)) S.step = Math.min(Math.max(v._step, 0), 3);
    } catch { /* sin almacenamiento: no pasa nada */ }
  }
  const saveDraft = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ ...S.d, _step: S.step })); } catch {} };
  const clearDraft = () => { try { sessionStorage.removeItem(KEY); } catch {} };

  let tt;
  function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 3200); }

  // ─── Reglas (las mismas que revisa el servidor) ───
  const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  function ageOf(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    const now = new Date();
    let a = now.getFullYear() - y;
    if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) a -= 1;
    return a;
  }
  function textProblem(raw) {
    const v = clean(raw);
    if (v.length < TEXT.min) return `Escribe al menos ${TEXT.min} caracteres.`;
    if (v.length > TEXT.max) return `Máximo ${TEXT.max} caracteres.`;
    if (new Set(v.toLowerCase().replace(/\s/g, '')).size < 8 || v.split(' ').length < 6) return 'Escribe una respuesta real, con tus palabras.';
    return null;
  }
  const allQuestions = () => S.sections.flatMap((s) => s.questions);

  function validateStep(i) {
    const e = {};
    const d = S.d;
    if (i === 0) {
      if (!ROBLOX_RE.test(clean(d.roblox))) e.roblox = 'Usa solo letras, números o _ (3 a 20 caracteres).';
      else if (!d.robloxUser || d.robloxUser.name.toLowerCase() !== clean(d.roblox).toLowerCase()) e.roblox = 'Toca "Verificar" para confirmar tu usuario.';
    }
    if (i === 1) {
      const p = d.personaje;
      if (!NAME_RE.test(clean(p.nombre))) e.nombre = 'Escribe un nombre válido (solo letras).';
      if (!NAME_RE.test(clean(p.apellidos))) e.apellidos = 'Escribe apellidos válidos (solo letras).';
      const a = ageOf(p.nacimiento);
      if (a === null) e.nacimiento = 'Elige una fecha.';
      else if (a < AGE.min || a > AGE.max) e.nacimiento = `Tu personaje debe tener entre ${AGE.min} y ${AGE.max} años.`;
      for (const k of ['genero', 'sangre', 'nacionalidad']) if (!(S.options[k] || []).includes(p[k])) e[k] = 'Elige una opción.';
    }
    if (i === 2 || i === 3) {
      for (const q of S.sections[i - 2].questions) {
        const v = d.respuestas[q.id];
        if (q.type === 'yesno' && v !== 'si' && v !== 'no') e[q.id] = 'Elige Sí o No.';
        if (q.type === 'choice' && !Number.isInteger(v)) e[q.id] = 'Elige una opción.';
        if (q.type === 'text') { const pr = textProblem(v); if (pr) e[q.id] = pr; }
      }
      if (i === 3 && !d.acepto) e.acepto = 'Debes aceptar la normativa para enviar.';
    }
    return e;
  }
  function stepOfField(k) {
    if (k === 'roblox') return 0;
    if (k in emptyDraft().personaje) return 1;
    if (k === 'acepto') return 3;
    const idx = S.sections.findIndex((s) => s.questions.some((q) => q.id === k));
    return idx >= 0 ? idx + 2 : 0;
  }

  function showErrors(errors) {
    $$('[data-err]').forEach((el) => { el.textContent = errors[el.dataset.err] || ''; });
    $$('[data-field]').forEach((el) => el.classList.toggle('bad', Boolean(errors[el.dataset.field])));
    const first = Object.keys(errors).find((k) => $(`[data-err="${k}"]`));
    if (first) $(`[data-err="${first}"]`).closest('.ap-field, .ap-q')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ─── Pasos ───
  const err = (k) => `<div class="ap-err" data-err="${k}"></div>`;
  const kicker = () => `<span class="ap-kicker">Paso ${S.step + 1} de 4 · ${STEPS[S.step]}</span>`;

  function viewIdentidad() {
    const u = S.me && S.me.user;
    const account = u
      ? `<div class="ap-account"><img src="${esc(u.avatar)}" alt="" /><div><small>DISCORD</small><b>${esc(u.name)}</b><span>ID ${esc(u.id)}</span></div></div>`
      : `<div class="ap-account"><div class="ph">${DISCORD_SVG}</div><div><small>DISCORD</small><b>Vista previa</b><span>Aquí aparecerá tu cuenta al iniciar sesión</span></div></div>`;
    return `${kicker()}
      <h2 class="ap-h">Confirma tus cuentas</h2>
      <p class="ap-p">Tu cuenta de Discord y tu usuario de Roblox quedan unidos a tu solicitud.</p>
      ${account}
      <div class="ap-field">
        <label class="ap-label" for="f-roblox">Usuario de Roblox</label>
        <div class="ap-inline">
          <input id="f-roblox" class="ap-input" data-field="roblox" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="20" placeholder="Tu usuario, no el nombre visible" value="${esc(S.d.roblox)}" />
          <button type="button" class="btn ghost" id="btn-verify">Verificar</button>
        </div>
        <div id="roblox-found">${foundHtml()}</div>
        ${err('roblox')}
      </div>`;
  }
  function foundHtml() {
    const r = S.d.robloxUser;
    if (!r || r.name.toLowerCase() !== clean(S.d.roblox).toLowerCase()) return '';
    const pic = r.avatar ? `<img src="${esc(r.avatar)}" alt="Avatar de ${esc(r.name)}" data-rbx-img />` : '';
    return `<div class="ap-rbx">
        <div class="ap-rbx-pic"><span class="ph">${esc(r.name.charAt(0).toUpperCase())}</span>${pic}</div>
        <div class="ap-rbx-info"><small>ROBLOX · VERIFICADO</small><b>${esc(r.displayName)}</b><span>@${esc(r.name)} · ID ${esc(r.id)}</span></div>
        <span class="ap-rbx-ok" aria-label="Verificado">✓</span>
      </div>`;
  }

  function selectField(k, label) {
    const opts = (S.options[k] || []).map((o) => `<option value="${esc(o)}"${S.d.personaje[k] === o ? ' selected' : ''}>${esc(o)}</option>`).join('');
    return `<div class="ap-field"><label class="ap-label" for="f-${k}">${label}</label>
      <div class="ap-select"><select id="f-${k}" class="ap-input" data-p="${k}" data-field="${k}"><option value="">Elegir…</option>${opts}</select></div>${err(k)}</div>`;
  }
  function viewPersonaje() {
    const p = S.d.personaje;
    const today = new Date();
    const iso = (y) => `${today.getFullYear() - y}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return `${kicker()}
      <h2 class="ap-h">Crea tu personaje</h2>
      <p class="ap-p">Estos datos salen en tu cédula dentro del rol (IC). Usa un nombre realista, no tu usuario.</p>
      <div class="ap-grid">
        <div class="ap-field"><label class="ap-label" for="f-nombre">Nombre</label>
          <input id="f-nombre" class="ap-input" data-p="nombre" data-field="nombre" maxlength="40" autocomplete="off" placeholder="Ej: Daniela" value="${esc(p.nombre)}" />${err('nombre')}</div>
        <div class="ap-field"><label class="ap-label" for="f-apellidos">Apellidos</label>
          <input id="f-apellidos" class="ap-input" data-p="apellidos" data-field="apellidos" maxlength="40" autocomplete="off" placeholder="Ej: Herrera Castillo" value="${esc(p.apellidos)}" />${err('apellidos')}</div>
        <div class="ap-field"><label class="ap-label" for="f-nacimiento">Fecha de nacimiento</label>
          <input id="f-nacimiento" type="date" class="ap-input" data-p="nacimiento" data-field="nacimiento" min="${iso(AGE.max)}" max="${iso(AGE.min)}" value="${esc(p.nacimiento)}" />${err('nacimiento')}</div>
        ${selectField('genero', 'Género')}
        ${selectField('sangre', 'Grupo sanguíneo')}
        ${selectField('nacionalidad', 'Nacionalidad')}
      </div>`;
  }

  function viewSection(si) {
    const sec = S.sections[si];
    const offset = S.sections.slice(0, si).reduce((n, s) => n + s.questions.length, 0);
    const qs = sec.questions.map((q, i) => {
      const v = S.d.respuestas[q.id];
      let input = '';
      if (q.type === 'yesno') {
        input = `<div class="ap-yn">${[['si', 'Sí'], ['no', 'No']].map(([val, lab]) =>
          `<button type="button" class="ap-opt" data-q="${q.id}" data-val="${val}" aria-pressed="${v === val}">${lab}</button>`).join('')}</div>`;
      } else if (q.type === 'choice') {
        input = `<div class="ap-choices">${q.options.map((o, oi) =>
          `<button type="button" class="ap-opt" data-q="${q.id}" data-val="${oi}" aria-pressed="${v === oi}"><span class="mark"></span>${esc(o)}</button>`).join('')}</div>`;
      } else {
        const len = clean(v).length;
        input = `<textarea class="ap-input" data-q="${q.id}" data-field="${q.id}" maxlength="${q.max}" placeholder="Responde con tus palabras (mínimo ${q.min} caracteres)">${esc(v || '')}</textarea>
          <span class="ap-count${len >= q.min ? ' ok' : ''}" data-count="${q.id}">${len}/${q.min} mínimo</span>`;
      }
      return `<div class="ap-q"><div class="ap-qt"><b>${offset + i + 1}.</b><span>${esc(q.text)}</span></div>${input}${err(q.id)}</div>`;
    }).join('');
    const accept = si === S.sections.length - 1
      ? `<label class="ap-check" data-field="acepto"><input type="checkbox" id="f-acepto"${S.d.acepto ? ' checked' : ''} />
          <span>Leí la <a href="/#normativa" target="_blank" rel="noopener">normativa completa</a> y me comprometo a cumplirla.</span></label>${err('acepto')}`
      : '';
    return `${kicker()}<h2 class="ap-h">${esc(sec.title)}</h2><p class="ap-p">${esc(sec.intro)}</p>${qs}${accept}`;
  }

  function renderSteps() {
    $$('#ap-steps li').forEach((li) => {
      const n = Number(li.dataset.step);
      li.classList.toggle('current', n === S.step);
      li.classList.toggle('done', n < S.step);
    });
    $('#ap-fill').style.width = `${(S.step / 3) * 75}%`;
  }
  function renderActions() {
    const back = $('#ap-back');
    const next = $('#ap-next');
    back.classList.toggle('invisible', S.step === 0);
    next.disabled = false;
    if (S.step < 3) next.textContent = 'Siguiente';
    else if (!S.loginEnabled) { next.textContent = 'Enviar (vista previa)'; next.disabled = true; }
    else if (S.sending) { next.textContent = 'Enviando…'; next.disabled = true; }
    else next.textContent = 'Enviar solicitud';
  }
  function render() {
    $('#ap-steps').classList.remove('hidden');
    $('#ap-actions').classList.remove('hidden');
    const views = [viewIdentidad, viewPersonaje, () => viewSection(0), () => viewSection(1)];
    $('#ap-content').innerHTML = views[S.step]();
    renderSteps();
    renderActions();
  }
  function go(step) {
    S.step = step;
    saveDraft();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ─── Pantallas especiales ───
  function screen(html) {
    $('#ap-steps').classList.add('hidden');
    $('#ap-actions').classList.add('hidden');
    $('#ap-content').innerHTML = `<div class="ap-center">${html}</div>`;
  }
  const viewGate = () => screen(`<div class="big-ico discord">${DISCORD_SVG}</div>
    <h2 class="ap-h">Inicia sesión con Discord</h2>
    <p>Para hacer la whitelist necesitamos saber quién eres. Solo vemos tu nombre, tu foto y tu ID de Discord. Debes estar en el Discord de Panamá RP.</p>
    <a class="btn lg" href="/auth/discord?next=/solicitud">${DISCORD_SVG}Iniciar sesión con Discord</a>
    <a class="btn lg ghost" href="${INVITE}" target="_blank" rel="noopener">Unirme al Discord</a>`);
  const viewDone = (already) => screen(`<div class="big-ico ok">✓</div>
    <h2 class="ap-h">${already ? 'Ya enviaste tu solicitud' : '¡Solicitud enviada!'}</h2>
    <p>${already ? 'El staff la está revisando. Te avisarán por Discord.' : 'El staff la revisará y te avisará por Discord. Mientras tanto, repasa la normativa.'}</p>
    <a class="btn lg" href="/">Volver al inicio</a>`);

  function banner(kind, html) {
    $('#ap-banner').innerHTML = `<div class="ap-banner ${kind}">${html}</div>`;
  }

  // ─── Eventos ───
  const content = $('#ap-content');
  let autoLookup = 0;
  // Si la imagen del avatar no carga, queda la inicial
  document.addEventListener('error', (e) => {
    if (e.target instanceof HTMLImageElement && e.target.hasAttribute('data-rbx-img')) e.target.remove();
  }, true);
  content.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'f-roblox') {
      S.d.roblox = t.value;
      $('#roblox-found').innerHTML = foundHtml();
      // Busca solo el avatar cuando dejas de escribir
      clearTimeout(autoLookup);
      if (ROBLOX_RE.test(clean(t.value)) && !$('#roblox-found').innerHTML) autoLookup = setTimeout(() => verifyRoblox(true), 900);
    } else if (t.dataset.p) {
      S.d.personaje[t.dataset.p] = t.value;
    } else if (t.tagName === 'TEXTAREA' && t.dataset.q) {
      S.d.respuestas[t.dataset.q] = t.value;
      const c = $(`[data-count="${t.dataset.q}"]`);
      const q = allQuestions().find((x) => x.id === t.dataset.q);
      const len = clean(t.value).length;
      if (c && q) { c.textContent = `${len}/${q.min} mínimo`; c.classList.toggle('ok', len >= q.min); }
    }
    const key = t.dataset.field;
    if (key) { t.classList.remove('bad'); const el = $(`[data-err="${key}"]`); if (el) el.textContent = ''; }
    saveDraft();
  });
  content.addEventListener('change', (e) => {
    if (e.target.id === 'f-acepto') {
      S.d.acepto = e.target.checked;
      const el = $('[data-err="acepto"]'); if (el) el.textContent = '';
      saveDraft();
    }
  });
  content.addEventListener('keydown', (e) => {
    if (e.target.id === 'f-roblox' && e.key === 'Enter') { e.preventDefault(); verifyRoblox(false); }
  });
  content.addEventListener('click', (e) => {
    const opt = e.target.closest('.ap-opt[data-q]');
    if (opt) {
      const q = allQuestions().find((x) => x.id === opt.dataset.q);
      S.d.respuestas[q.id] = q.type === 'choice' ? Number(opt.dataset.val) : opt.dataset.val;
      $$(`.ap-opt[data-q="${q.id}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === opt)));
      const el = $(`[data-err="${q.id}"]`); if (el) el.textContent = '';
      saveDraft();
      return;
    }
    if (e.target.closest('#btn-verify')) verifyRoblox(false);
  });

  let lookupSeq = 0;
  async function verifyRoblox(auto = false) {
    const input = $('#f-roblox');
    const btn = $('#btn-verify');
    if (!input || !btn) return;
    const u = clean(input.value);
    if (!ROBLOX_RE.test(u)) return auto ? undefined : showErrors({ roblox: 'Usa solo letras, números o _ (3 a 20 caracteres).' });
    clearTimeout(autoLookup);
    const seq = ++lookupSeq;
    btn.disabled = true; btn.textContent = 'Buscando…';
    try {
      const r = await fetch(`/api/roblox?usuario=${encodeURIComponent(u)}`);
      const j = await r.json().catch(() => ({}));
      // Si mientras tanto escribiste otro usuario o cambiaste de paso, esta respuesta ya no sirve
      if (seq !== lookupSeq || !document.body.contains(input) || clean(input.value).toLowerCase() !== u.toLowerCase()) return;
      if (r.ok && j.user) {
        S.d.roblox = j.user.name; S.d.robloxUser = j.user;
        if (input.value !== j.user.name) input.value = j.user.name;
        $('#roblox-found').innerHTML = foundHtml();
        showErrors({});
        saveDraft();
      } else if (!(auto && r.status === 429)) {
        showErrors({ roblox: r.status === 429 ? 'Demasiadas búsquedas. Espera un minuto.' : (j.error || 'No se pudo verificar.') });
      }
    } catch {
      if (!auto) showErrors({ roblox: 'Sin conexión. Intenta de nuevo.' });
    } finally {
      if (seq === lookupSeq && document.body.contains(btn)) { btn.disabled = false; btn.textContent = 'Verificar'; }
    }
  }

  $('#ap-back').addEventListener('click', () => { if (S.step > 0) go(S.step - 1); });
  $('#ap-next').addEventListener('click', () => {
    const errors = validateStep(S.step);
    if (Object.keys(errors).length) { showErrors(errors); toast('Revisa los campos marcados'); return; }
    if (S.step < 3) go(S.step + 1);
    else submit();
  });
  $('#ap-steps').addEventListener('click', (e) => {
    const li = e.target.closest('li.done');
    if (li) go(Number(li.dataset.step));
  });

  async function submit() {
    if (!S.loginEnabled) return toast('Vista previa: todavía no se puede enviar.');
    if (!S.receiving) return toast('El staff aún no activó la recepción de solicitudes.');
    S.sending = true; renderActions();
    try {
      const r = await fetch('/api/solicitud', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roblox: clean(S.d.roblox), personaje: S.d.personaje, respuestas: S.d.respuestas, acepto: S.d.acepto }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { clearDraft(); S.d = emptyDraft(); viewDone(false); return; }
      if (r.status === 409) { clearDraft(); viewDone(true); return; }
      if (r.status === 401) { toast('Tu sesión expiró. Inicia sesión otra vez.'); setTimeout(() => { location.href = '/auth/discord?next=/solicitud'; }, 1200); return; }
      if (r.status === 400 && j.errors) {
        const first = Object.keys(j.errors)[0];
        S.step = stepOfField(first); saveDraft(); render(); showErrors(j.errors);
        toast(j.error || 'Revisa los campos marcados');
        return;
      }
      toast(j.error || (r.status === 429 ? 'Demasiados envíos. Intenta más tarde.' : 'No se pudo enviar. Intenta de nuevo.'));
    } catch {
      toast('Sin conexión. Intenta de nuevo.');
    } finally {
      S.sending = false;
      if ($('#ap-actions:not(.hidden)')) renderActions();
    }
  }

  // ─── Inicio ───
  async function init() {
    const login = new URLSearchParams(location.search).get('login');
    if (login) history.replaceState(null, '', location.pathname);
    try {
      const [me, q] = await Promise.all([
        fetch('/api/me', { credentials: 'same-origin' }).then((r) => r.json()),
        fetch('/api/solicitud/preguntas').then((r) => r.json()),
      ]);
      S.me = me; S.loginEnabled = Boolean(me.loginEnabled); S.receiving = Boolean(q.receiving);
      S.sections = q.sections || []; S.options = q.options || {};
    } catch {
      screen('<h2 class="ap-h">No se pudo cargar</h2><p>Revisa tu conexión y recarga la página.</p>');
      return;
    }

    if (login === 'guild') banner('warn', `Para continuar debes estar en el Discord de Panamá RP. <a href="${INVITE}" target="_blank" rel="noopener">Únete aquí</a> y vuelve a iniciar sesión.`);
    else if (login === 'error') toast('No se pudo iniciar sesión. Inténtalo de nuevo.');
    else if (login === 'cancel') toast('Cancelaste el inicio de sesión.');
    else if (login === 'ok' && S.me.user) toast(`¡Hola, ${S.me.user.name}!`);

    if (S.loginEnabled && !S.me.user) return viewGate();
    if (S.me.user && S.me.submitted) return viewDone(true);
    if (!S.loginEnabled) banner('info', '<b>Vista previa.</b> El inicio de sesión con Discord aún no está activado, así que puedes ver el formulario pero no enviarlo.');
    else if (!S.receiving) banner('warn', 'El staff aún no activó la recepción de solicitudes. Puedes llenarla, pero no enviarla todavía.');

    loadDraft();
    render();
  }
  init();
})();
