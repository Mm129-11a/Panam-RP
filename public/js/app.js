// Panamá RP — lógica de la página
/* ═══════════ CONFIGURACIÓN — cambia aquí tus datos ═══════════ */
const CONFIG = {
  serverCode: 'PANAMARP', // ← pon aquí el código real de tu servidor
  online: 22, members: 61, // respaldo si no carga el dato en vivo
  links: { discord: 'https://discord.gg/fgRGQPbJF3', youtube: '', tiktok: '', instagram: '', roblox: '' },
  // Para poner fotos: sube la imagen a /public/img/galeria/ y escribe la ruta en img, por ejemplo img: '/img/galeria/ems.webp'
  gallery: [
    { cls: 'ems', img: '', label: 'EMS', icon: '🚑', color: '#4f9fd0', desc: 'Atiende emergencias y salva vidas.' },
    { cls: 'obr', img: '', label: 'Obreros', icon: '🚧', color: '#f0a43a', desc: 'Construye y mantén la ciudad en pie.' },
    { cls: 'bom', img: '', label: 'Bomberos', icon: '🚒', color: '#ff5a62', desc: 'Apaga incendios y rescata a quien lo necesite.' },
    { cls: 'tra', img: '', label: 'Policía de Tránsito', icon: '🚓', color: '#7aa2ff', desc: 'Controla el tráfico y la seguridad vial.' },
    { cls: 'rp', img: '', label: 'Rol libre', icon: '🌃', color: '#b28cff', desc: 'Vive tu propia historia en la ciudad.' },
  ],
  team: [
    { name: 'kalevft26', role: 'Fundador', icon: '👑' },
    { name: 'Por asignar', role: 'Co-Fundador', icon: '🛡️' },
    { name: 'Por asignar', role: 'Developer', icon: '💻' },
  ],
  rules: [
    ['Respeto ante todo', 'Trata a todos con respeto dentro y fuera del rol. Insultos, discriminación o toxicidad se sancionan.'],
    ['Metagaming (MG)', 'Prohibido usar información obtenida fuera del rol (Discord, streams, mensajes) dentro de tu personaje.'],
    ['Powergaming (PG)', 'No realices acciones imposibles ni obligues a otros jugadores sin darles opción a responder.'],
    ['RDM / VDM', 'No mates ni atropelles a nadie sin un rol previo que lo justifique.'],
    ['Valorar la vida', 'Tu personaje teme por su vida. Si te apuntan con un arma, actúa en consecuencia.'],
    ['Avatar realista', 'Usa un avatar acorde a la ciudad y el cuerpo cuadrado clásico de Roblox.'],
    ['Zonas seguras', 'Hospitales, estaciones de policía y el spawn son zonas seguras: no se permiten robos ni tiroteos.'],
  ],
  shop: [
    { emoji: '🥉', name: 'VIP Bronce', price: '$2.99', perks: ['Rol de Discord exclusivo', 'Prioridad en whitelist', 'Color de nombre'] },
    { emoji: '🥇', name: 'VIP Oro', price: '$6.99', featured: true, perks: ['Todo lo de Bronce', 'Vehículo personalizado', 'Acceso anticipado a novedades'] },
    { emoji: '💎', name: 'VIP Diamante', price: '$12.99', perks: ['Todo lo de Oro', 'Facción propia (sujeto a staff)', 'Soporte prioritario'] },
  ],
};

/* ═══════════ Utilidades ═══════════ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let tt;
function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('show'); clearTimeout(tt); tt=setTimeout(()=>t.classList.remove('show'),2800); }
function countUp(el, to){ const t0=performance.now(), d=1500;
  (function f(t){ const p=Math.min(1,(t-t0)/d), e=1-Math.pow(1-p,3); el.textContent=Math.round(to*e).toLocaleString('en-US'); if(p<1) requestAnimationFrame(f); })(t0); }

/* ═══════════ Contenido ═══════════ */
$$('[data-code]').forEach(el => el.textContent = CONFIG.serverCode);
$('#year').textContent = new Date().getFullYear();

$('#panels').innerHTML = CONFIG.gallery.map((g,i)=>`
  <div class="panel ${i===0?'open':''}" data-panel>
    <div class="art ${g.img?'photo':g.cls}"></div>
    ${g.img?'':`<div class="big">${g.icon}</div>`}
    <div class="pl"><i></i><b>${esc(g.label)}</b><p>${esc(g.desc)}</p></div>
  </div>`).join('');

// Color y foto de cada panel (se aplican desde JS para cumplir la política de seguridad)
$$('[data-panel]').forEach((p, i) => {
  const g = CONFIG.gallery[i];
  p.style.setProperty('--c', g.color);
  if (g.img) $('.art', p).style.backgroundImage = `url("${encodeURI(g.img)}")`;
});

$('#team').innerHTML = CONFIG.team.map((m,i)=>`
  <div class="member reveal">
    <div class="ring"><div>${m.icon}</div></div>
    <div class="mtext"><h3>${esc(m.name)}</h3>
    <span class="role">${esc(m.role)}</span>
    <small>#${String(i+1).padStart(3,'0')}</small></div>
  </div>`).join('');

$('#rules').innerHTML = CONFIG.rules.map(([t,d],i)=>`<div class="rule"><div class="n">${String(i+1).padStart(2,'0')}</div><div><h3>${esc(t)}</h3><p>${esc(d)}</p></div></div>`).join('');
$('#shop').innerHTML = CONFIG.shop.map(p=>`<div class="product ${p.featured?'featured':''}"><div class="emoji">${p.emoji}</div><h3>${esc(p.name)}</h3><div class="price">${esc(p.price)}</div><ul>${p.perks.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><button class="btn" data-buy="${esc(p.name)}">Comprar</button></div>`).join('');

// Paneles de experiencia: se abren al pasar el mouse o al tocar
function openPanel(p){ $$('[data-panel]').forEach(x=>x.classList.toggle('open', x===p)); }
$$('[data-panel]').forEach(p=>{
  p.addEventListener('mouseenter', ()=>{ if(matchMedia('(hover:hover)').matches) openPanel(p); });
  p.addEventListener('click', ()=>openPanel(p));
});

/* ═══════════ Navegación ═══════════ */
const PAGES = ['inicio','normativa','tienda'];
let current = 'inicio';
function show(page, scrollId){
  if(!PAGES.includes(page)) page='inicio';
  current = page;
  PAGES.forEach(p=>$('#page-'+p).classList.toggle('show', p===page));
  $$('.menu a').forEach(a=>a.classList.toggle('on', a.dataset.go===page && !scrollId));
  $('#menu').classList.remove('open');
  if(scrollId) setTimeout(()=>document.getElementById(scrollId)?.scrollIntoView({behavior:'smooth'}), 40);
  else window.scrollTo({top:0});
  observeReveal();
}
$('#burger').addEventListener('click', ()=>$('#menu').classList.toggle('open'));

function copyCode(){
  navigator.clipboard?.writeText(CONFIG.serverCode).then(()=>toast('Código copiado ✓')).catch(()=>toast('Código: '+CONFIG.serverCode));
}

document.addEventListener('click', e=>{
  const go = e.target.closest('[data-go]');
  if(go){ e.preventDefault(); const p=go.dataset.go;
    if(p==='inicio'){ history.replaceState(null,'',location.pathname); show('inicio'); } else { location.hash=p; } return; }
  const sc = e.target.closest('[data-scroll]');
  if(sc){ e.preventDefault(); if(current!=='inicio') history.replaceState(null,'',location.pathname); show('inicio', sc.dataset.scroll); return; }
  const so = e.target.closest('[data-social]');
  if(so){ const url = CONFIG.links[so.dataset.social];
    if(url){ so.setAttribute('href', url); so.setAttribute('target','_blank'); so.setAttribute('rel','noopener'); }
    else { e.preventDefault(); toast('Enlace próximamente disponible'); } return; }
  if(e.target.closest('[data-login]')){ if(!SESSION.user) location.href='/auth/discord'; return; }
  if(e.target.closest('#modal-close') || e.target.id==='modal'){ $('#modal').classList.remove('show'); return; }
  const by = e.target.closest('[data-buy]'); if(by){ toast(`${by.dataset.buy}: la tienda abrirá muy pronto`); return; }
  if(e.target.closest('[data-copy]')) copyCode();
});
window.addEventListener('hashchange', ()=>show(location.hash.slice(1)));

// Animación al hacer scroll
let io;
function observeReveal(){
  if(!('IntersectionObserver' in window)){ $$('.reveal').forEach(r=>r.classList.add('in')); return; }
  io?.disconnect();
  io = new IntersectionObserver(es=>es.forEach(en=>{ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target);} }),{threshold:.12});
  $$('.page.show .reveal').forEach(r=>{ if(!r.classList.contains('in')) io.observe(r); });
}
show(location.hash.slice(1));

/* ═══════════ Sesión de Discord y datos en vivo ═══════════ */
const SESSION = { user: null };
function openModal(title, text){ $('#modal-title').textContent=title; $('#modal-text').textContent=text; $('#modal').classList.add('show'); }

fetch('/api/me').then(r=>r.json()).then(({user})=>{
  if(!user) return;
  SESSION.user = user;
  $('#btn-login-top').classList.add('hidden');
  $('#userchip').classList.remove('hidden');
  $('#u-avatar').src = user.avatar; $('#u-name').textContent = user.name;
  const hb = $('#btn-login-hero');
  hb.removeAttribute('data-login'); hb.setAttribute('data-social','discord');
  $('.lbl', hb).textContent = 'Conectado como ' + user.name;
}).catch(()=>{});

// Cerrar sesión (POST: otra web no puede desconectarte)
$('#btn-logout').addEventListener('click', async () => {
  try { await fetch('/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
  location.href = '/';
});

fetch('/api/stats').then(r=>r.json()).then(d=>{
  if(d.invite) CONFIG.links.discord = d.invite;
  const m = d.members ?? CONFIG.members, o = d.online ?? CONFIG.online;
  countUp($('#st-miembros'), m);
  $('#st-online').textContent = o; $('#live-n').textContent = o;
}).catch(()=> countUp($('#st-miembros'), CONFIG.members));

// Resultado del inicio de sesión
const q = new URLSearchParams(location.search).get('login');
if(q){
  history.replaceState(null,'',location.pathname+location.hash);
  if(q==='ok') setTimeout(()=>toast(SESSION.user ? `¡Bienvenido, ${SESSION.user.name}!` : '¡Sesión iniciada!'), 600);
  else if(q==='cancel') toast('Cancelaste el inicio de sesión');
  else if(q==='noconfig') openModal('Inicio de sesión en configuración','El inicio de sesión con Discord se está activando. Mientras tanto, únete a nuestro Discord.');
  else if(q==='guild') openModal('Únete al Discord primero','Para iniciar sesión debes ser miembro del servidor de Discord de Panamá RP.');
  else openModal('No se pudo iniciar sesión','Ocurrió un error al conectar con Discord. Inténtalo de nuevo.');
}
