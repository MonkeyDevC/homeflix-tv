// Piezas de interfaz: funciones que devuelven HTML.
import { I, icon } from '../icons.js';
import * as L from '../data/library.js';
import * as Art from '../data/art.js';
import { state } from '../state.js';
import { titleHref, playHref } from '../router.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Imágenes perezosas ----------
let io = null;
function load(img) {
  const key = img.dataset.img;
  if (!key) return;
  img.removeAttribute('data-img');
  Art.image(key).then((url) => {
    img.src = url;
    img.decode?.().catch(() => {}).finally(() => img.classList.add('ready'));
  }).catch(() => img.classList.add('missing'));
}
/** Carga las imágenes de un contenedor. En el tablero (?design=) se piden todas: los cuadros reducidos no entran a la vista. */
export function hydrate(root) {
  const imgs = root.querySelectorAll('img[data-img]');
  if (state.design || !('IntersectionObserver' in window)) { imgs.forEach(load); return; }
  io ??= new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); load(e.target); }
  }, { rootMargin: '400px 400px' });
  imgs.forEach((i) => io.observe(i));
}
export const img = (key, cls = '', alt = '') => key
  ? `<img class="art ${cls}" data-img="${esc(key)}" alt="${esc(alt)}" decoding="async">`
  : `<span class="art missing ${cls}"></span>`;

// ---------- Avatares ----------
const AV = [
  ['#f0d2a8', '#c99a66'], ['#9ad0ff', '#4d7cff'], ['#ffb3a7', '#e0576b'],
  ['#b9f0c4', '#3fa36b'], ['#ffe58a', '#f29d38'], ['#d7b6ff', '#7b52d9'],
];
export const AVATAR_COUNT = AV.length;
export function avatar(p, cls = '') {
  const [a, b] = AV[(p.avatar ?? 0) % AV.length];
  return `<span class="avatar ${cls}" style="--a:${a};--b:${b}" aria-hidden="true">
    <svg viewBox="0 0 64 64"><circle cx="22" cy="27" r="4" fill="#1a1a1a"/><circle cx="42" cy="27" r="4" fill="#1a1a1a"/>
    <path d="M22 41c5 5 15 5 20 0" fill="none" stroke="#1a1a1a" stroke-width="3.5" stroke-linecap="round"/></svg>
    ${p.kids ? `<i class="avatar-star">${I.star}</i>` : ''}</span>`;
}

// ---------- Logo ----------
export const logo = (cls = '') => `<span class="logo ${cls}"><img src="icons/panda.png" alt="" width="34" height="34"><b>Home<em>Flix</em></b></span>`;

// ---------- Botones ----------
export const btn = (label, { kind = 'primary', ic, href, attrs = '', cls = '' } = {}) => {
  const inner = `${ic ? icon(ic) : ''}<span>${label}</span>`;
  return href
    ? `<a class="btn btn-${kind} ${cls}" href="${href}" ${attrs}>${inner}</a>`
    : `<button class="btn btn-${kind} ${cls}" type="button" ${attrs}>${inner}</button>`;
};
export const iconBtn = (ic, label, attrs = '', cls = '') => `<button class="icon-btn ${cls}" type="button" aria-label="${esc(label)}" ${attrs}>${icon(ic)}</button>`;

// ---------- Tarjetas ----------
export function pct(p) { return p && p.d ? Math.min(100, Math.round((p.t / p.d) * 100)) : 0; }

export function card(t, { progress, sub, wide = false } = {}) {
  const kind = t.type === 'movie' ? 'PELÍCULA' : 'SERIE';
  const bar = progress != null ? `<span class="bar"><i style="width:${progress}%"></i></span>` : '';
  return `<a class="card ${wide ? 'card-wide' : ''}" href="${titleHref(t.titleKey)}" aria-label="${esc(t.name)}">
    <span class="card-art">${img(t.imageKey, '', t.name)}
      <span class="tag">${kind}</span>${t.kids ? `<span class="kids-star" title="Infantil">${I.star}</span>` : ''}${bar}</span>
    ${sub ? `<span class="card-sub">${sub}</span>` : ''}
  </a>`;
}

export function continueCard({ t, ep, p }) {
  const left = p.d ? L.formatDuration(Math.max(60, p.d - p.t)) : '';
  const sub = ep ? `<b>T${ep.season}:E${ep.episode}</b> ${esc(ep.title)}` : `<b>${esc(t.name)}</b>`;
  const key = ep ? ep.video : t.video;
  return `<div class="card card-continue">
    <a class="card-art" href="${playHref(key, p.t)}" aria-label="Continuar ${esc(t.name)}">${img(t.imageKey, '', t.name)}
      <span class="play-badge">${I.play}</span><span class="bar"><i style="width:${pct(p)}%"></i></span></a>
    <a class="card-sub" href="${titleHref(t.titleKey)}">${sub}<small>${left ? `Quedan ${left}` : ''}</small></a>
  </div>`;
}

export function row(title, note, inner, { href } = {}) {
  if (!inner) return '';
  const head = href
    ? `<a class="row-head" href="${href}"><h2>${title}</h2>${note ? `<span class="note">${note}</span>` : ''}${I.chevron}</a>`
    : `<div class="row-head"><h2>${title}</h2>${note ? `<span class="note">${note}</span>` : ''}</div>`;
  return `<section class="row">${head}<div class="row-track">${inner}</div></section>`;
}

export const grid = (titles) => titles.length
  ? `<div class="grid">${titles.map((t) => card(t, { progress: progressOf(t) })).join('')}</div>`
  : '';

export function progressOf(t) {
  if (t.type !== 'movie') return undefined;
  const p = L.progress(t.video);
  return p && !p.done && p.t > 30 ? pct(p) : undefined;
}

export function meta(t) {
  const bits = [];
  if (t.year) bits.push(`<span class="year">${t.year}</span>`);
  if (t.type === 'movie') bits.push(`<span>${L.formatDuration(t.duration)}</span>`);
  else bits.push(`<span>${t.seasons.length} ${t.seasons.length === 1 ? 'temporada' : 'temporadas'}</span>`);
  if (t.quality) bits.push(`<span class="seal">${t.quality}</span>`);
  if (t.kids) bits.push('<span class="pill-kids">INFANTIL</span>');
  return `<div class="meta">${bits.join('')}</div>`;
}

// ---------- Encabezados ----------
/** Título grande estilo iOS que se convierte en barra compacta al hacer scroll. */
export function largeTitle(title, { right = '', back = false } = {}) {
  return `<header class="navbar navbar-collapsing" data-navbar>
      <div class="navbar-inner">${back ? backBtn() : '<span class="nav-spacer"></span>'}<span class="navbar-title">${title}</span><span class="nav-right">${right}</span></div>
    </header>
    <h1 class="large-title">${title}</h1>`;
}
export function navbar({ title = '', right = '', transparent = false } = {}) {
  return `<header class="navbar ${transparent ? 'navbar-transparent' : ''}" data-navbar>
    <div class="navbar-inner">${backBtn()}<span class="navbar-title">${title}</span><span class="nav-right">${right}</span></div></header>`;
}
export const backBtn = () => `<button class="nav-back" type="button" data-action="back" aria-label="Volver">${I.back}</button>`;

export function profileButton() {
  const p = state.profile;
  return p ? `<a class="nav-avatar" href="#/ajustes" aria-label="Ajustes de ${esc(p.name)}">${avatar(p, 'avatar-sm')}</a>` : '';
}

// ---------- Estado vacío ----------
export const empty = (ic, title, text, action = '') => `<div class="empty">${icon(ic)}<h3>${title}</h3><p>${text}</p>${action}</div>`;

// ---------- Esqueleto ----------
export const skeletonRows = (n = 3) => `<div class="skeleton-hero shimmer"></div>${Array.from({ length: n }, () => `
  <section class="row"><div class="row-head"><span class="sk-line shimmer"></span></div>
  <div class="row-track">${'<span class="card"><span class="card-art shimmer"></span></span>'.repeat(4)}</div></section>`).join('')}`;

// ---------- Aviso ----------
let toastTimer = 0;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- Barra de pestañas ----------
const TABS = [
  ['inicio', 'Inicio', 'home'], ['peliculas', 'Películas', 'film'], ['series', 'Series', 'tv'],
  ['mi-lista', 'Mi lista', 'heart'], ['buscar', 'Buscar', 'search'],
];
export function tabbar(active) {
  return TABS.map(([id, label, ic]) => `<a class="tab ${id === active ? 'active' : ''}" href="#/${id}" ${id === active ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`).join('');
}
