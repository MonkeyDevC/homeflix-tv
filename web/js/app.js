// Arranque de HomeFlix web: rutas, guardas, transiciones, gestos y modo tablero (?design=<vista>).
import { state, sync, signIn, signOut, chooseProfile, onLibrary, rebuild } from './state.js';
import * as R from './router.js';
import { tabbar, hydrate, skeletonRows } from './ui/components.js';
import { closeTopSheet, sheetTracks } from './ui/sheets.js';
import { edgeSwipeBack, pullToRefresh } from './gestures.js';
import * as Access from './ui/access.js';
import * as Browse from './ui/browse.js';
import { detail } from './ui/detail.js';
import { player } from './ui/player.js';
import * as Settings from './ui/settings.js';
import * as P from './data/playback.js';

const VIEWS = {
  login: Access.login,
  'login-qr': Access.loginQr,
  'login-phone': Access.loginPhone,
  'login-code': Access.loginCode,
  'login-password': Access.loginPassword,
  profiles: Access.profiles,
  'profile-edit': Access.profileEdit,
  pin: Access.pin,
  home: Browse.home,
  movies: Browse.movies,
  series: Browse.series,
  mylist: Browse.mylist,
  categories: Browse.categories,
  search: Browse.search,
  detail,
  player,
  settings: Settings.settings,
  account: Settings.account,
  guide: Settings.guide,
};
const ACCESS = new Set(['login', 'login-qr', 'login-phone', 'login-code', 'login-password']);
const NO_PROFILE = new Set([...ACCESS, 'profiles', 'profile-edit', 'pin']);

const viewEl = document.getElementById('view');
const tabEl = document.getElementById('tabbar');
const html = document.documentElement;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollMemo = new Map();
let cleanup = null;
let prevHash = null;

// ---------- Modo tablero ----------
// Mismos nombres de vista que la TV y el celular. Cada cuadro del tablero abre web/?design=<vista>.
const DESIGN = {
  login: '/login', 'login-qr': '/login/qr', 'login-phone': '/login/numero', 'login-code': '/login/codigo', 'login-password': '/login/clave',
  profiles: '/perfiles', 'profile-edit': '/perfiles/editar/p2', pin: '/pin/p2',
  home: '/inicio', movies: '/peliculas', series: '/series', mylist: '/mi-lista', categories: '/categorias', search: '/buscar',
  'detail-movie': '/titulo/m%3Ala%20ultima%20estacion%3A2025', 'detail-series': '/titulo/s%3Acasa%20solar',
  'sheet-quality': '/titulo/m%3Ala%20ultima%20estacion%3A2025?sheet=quality',
  player: '/ver/@movie', 'player-next': '/ver/@episode', 'sheet-tracks': '/ver/@movie',
  settings: '/ajustes', account: '/cuenta', guide: '/instalar',
};

function startDesign(name) {
  state.design = name;
  html.dataset.design = name;
  signIn('design', false);
  if (!/^(login|profiles|profile-edit|pin)/.test(name)) chooseProfile('p1');
  let path = DESIGN[name] || '/inicio';
  if (path.includes('@movie')) path = `/ver/${encodeURIComponent(state.lib.titles['m:orbita cero:2026'].video)}`;
  if (path.includes('@episode')) path = `/ver/${encodeURIComponent(state.lib.titles['s:casa solar'].seasons[0].episodes[1].video)}`;
  history.replaceState({ idx: 0 }, '', `${location.pathname}${location.search}#${path}`);
  if (name === 'sheet-tracks') setTimeout(() => sheetTracks(P.tracks(), P.tracks().current || { audio: 'es', sub: 'es' }, { onAudio: P.setAudio, onSub: P.setSub }), 900);
}

// ---------- Pintado ----------
function render(dir) {
  const route = R.parse();
  if (!route) { R.go(state.account ? '/inicio' : '/login', { replace: true }); return; }
  if (!state.account && !ACCESS.has(route.view)) { R.go('/login', { replace: true }); return; }
  if (state.account && ACCESS.has(route.view) && !state.design) { R.go('/perfiles', { replace: true }); return; }
  if (state.account && !state.profile && !NO_PROFILE.has(route.view)) { R.go('/perfiles', { replace: true }); return; }

  const def = VIEWS[route.view](route);
  if (def.redirect) { R.go(def.redirect, { replace: true }); return; }
  if (prevHash) scrollMemo.set(prevHash, scrollY);
  prevHash = route.hash;
  state.route = route;

  const swap = () => {
    closeTopSheet();
    cleanup?.(); cleanup = null;
    if (route.tab) state.tab = route.tab;
    else if (route.tab === null) state.tab = null;
    const showTabs = def.chrome !== false && route.tab !== null && !!state.profile;
    html.dataset.view = route.view;
    html.classList.toggle('has-tabs', showTabs);
    viewEl.className = `view ${def.cls || ''}`;
    viewEl.innerHTML = def.html;
    tabEl.innerHTML = showTabs ? tabbar(def.tab || state.tab) : '';
    tabEl.hidden = !showTabs;
    hydrate(viewEl);
    cleanup = def.mount?.(viewEl, route) || null;
    const y = dir === 'back' ? scrollMemo.get(route.hash) || 0 : 0;
    scrollTo(0, y);
    onScroll();
    if (dir === 'forward') viewEl.focus({ preventScroll: true });
    document.title = titleFor(route);
  };

  const swiped = viewEl.dataset.swiped; delete viewEl.dataset.swiped;
  const kind = dir === 'none' || swiped ? null : route.root && state.lastRoot ? 'tab' : dir;
  state.lastRoot = route.root;
  if (kind && document.startViewTransition && !reduced()) {
    html.dataset.nav = kind;
    document.startViewTransition(swap).finished.finally(() => { delete html.dataset.nav; });
  } else swap();
}

function titleFor(route) {
  if (route.view === 'detail') return `${state.lib?.titles[route.params.key]?.name || 'Título'} · HomeFlix`;
  return 'HomeFlix';
}

// ---------- Barra que se vuelve «vidrio» al hacer scroll ----------
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const y = scrollY;
    html.classList.toggle('scrolled', y > 6);
    html.classList.toggle('past-title', y > 44);
    const heroH = viewEl.querySelector('.hero, .detail-hero')?.offsetHeight || 0;
    html.classList.toggle('past-hero', heroH ? y > heroH - 110 : y > 6);
  });
}
addEventListener('scroll', onScroll, { passive: true });

// ---------- Enlaces y teclas ----------
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="back"]')) { e.preventDefault(); R.back(backFallback()); return; }
  const a = e.target.closest('a[href^="#/"]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  const href = a.getAttribute('href');
  const target = R.parse(href);
  // Tocar la pestaña activa sube al principio (como en iOS).
  if (target?.root && target.hash === state.route?.hash) { scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); return; }
  R.go(href, { replace: !!(target?.root && state.route?.root && target.tab) });
});

function backFallback() {
  const v = state.route?.view;
  if (v === 'profile-edit') return '/perfiles?editar=1';
  if (v === 'pin' || v === 'login-qr' || v === 'login-phone') return v === 'pin' ? '/perfiles' : '/login';
  if (v === 'login-code') return '/login/numero';
  if (v === 'login-password') return '/login';
  if (v === 'account' || v === 'guide') return '/ajustes';
  return `/${state.tab || 'inicio'}`;
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (closeTopSheet()) { e.preventDefault(); return; }
  if (state.route && !state.route.root && state.route.view !== 'player' && !e.target.matches('input')) R.back(backFallback());
});

// ---------- Gestos ----------
edgeSwipeBack(viewEl, {
  canGoBack: () => !!state.route && !state.route.root && state.route.view !== 'player' && !document.querySelector('.sheet-layer'),
  onBack: () => R.back(backFallback()),
});
pullToRefresh(viewEl, document.getElementById('ptr'), {
  enabled: () => state.route?.view === 'home' && !document.querySelector('.sheet-layer'),
  onRefresh: async () => {
    viewEl.querySelector('.rows')?.insertAdjacentHTML('afterbegin', `<div class="refreshing">${skeletonRows(1)}</div>`);
    await sync();
    render('none');
  },
});

// ---------- Instalación (service worker) ----------
function registerSW() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!('serviceWorker' in navigator) || state.design || !(location.protocol === 'https:' || local)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- Inicio ----------
/* Volver a pintar cuando cambia la biblioteca (llegó lo de Telegram u otro dispositivo cambió Mi lista, progreso,
 * perfiles). No se toca el reproductor ni las pantallas donde se está escribiendo. */
const CALM = new Set(['home', 'movies', 'series', 'mylist', 'categories', 'detail', 'profiles']);
onLibrary(() => { if (state.route && CALM.has(state.route.view) && !document.querySelector('.sheet-layer')) render('none'); });

/* Sesión de Telegram guardada: se comprueba con Telegram (pudo cerrarse desde el teléfono). */
function resume() {
  const T = globalThis.HFTelegram;
  const acc = state.account;
  if (!acc || acc === 'demo' || !T || !T.available() || !T.credentials()) return;
  T.me().then((u) => {
    if (state.account !== acc) return;
    if (u && String(u.id) === String(acc)) {
      signIn(u);
      sync();
      if (state.route) render('none');
    } else {
      signOut().then(() => R.go('/login', { replace: true }));
    }
  }, () => { /* sin conexión: se queda con lo guardado */ });
}

const design = new URLSearchParams(location.search).get('design');
if (design) startDesign(design);
else { rebuild(); resume(); }
R.start(render);
document.getElementById('splash')?.classList.add('gone');
setTimeout(() => document.getElementById('splash')?.remove(), 600);
registerSW();
