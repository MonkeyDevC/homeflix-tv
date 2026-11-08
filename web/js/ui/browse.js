// Inicio, Películas, Series, Mi lista, Categorías y Buscar.
import { I } from '../icons.js';
import * as L from '../data/library.js';
import { categoriesOf } from '../data/library.js';
import { state, continueWatching } from '../state.js';
import { titleHref, playHref, setQuery } from '../router.js';
import {
  esc, img, card, continueCard, row, grid, meta, largeTitle, navbar, logo, profileButton, empty, btn, hydrate, progressOf, toast,
} from './components.js';
import * as Art from '../data/art.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

// ---------- Destacado ----------
function hero(list) {
  if (!list.length) return '';
  const slides = list.map((t, i) => {
    const p = t.type === 'movie' ? L.progress(t.video) : null;
    const watching = p && !p.done && p.t > 30;
    const playKey = t.type === 'movie' ? t.video : L.nextEpisode(t).video;
    return `<article class="hero-slide" data-i="${i}" style="--tint:${Art.color(t.titleKey, 22)}">
      <div class="hero-art">${img(t.bannerKey || t.imageKey, 'hero-img', '')}</div>
      <div class="hero-body">
        <div class="hero-cats">${t.categories.slice(0, 3).map(esc).join('<i>·</i>')}</div>
        <h2 class="hero-title">${esc(t.name)}</h2>
        ${meta(t)}
        <div class="hero-actions">
          ${btn(watching ? 'Continuar' : 'Ver', { ic: 'play', href: playHref(playKey, watching ? p.t : 0) })}
          <button class="btn btn-secondary" type="button" data-mylist="${esc(t.titleKey)}">${L.inMyList(t.titleKey) ? I.check : I.plus}<span>Mi lista</span></button>
          <a class="icon-btn icon-btn-glass" href="${titleHref(t.titleKey)}" aria-label="Más sobre ${esc(t.name)}">${I.info}</a>
        </div>
      </div>
    </article>`;
  }).join('');
  return `<section class="hero" data-hero>
    <div class="hero-track" data-track>${slides}</div>
    <div class="hero-pager"><span class="pager-pill"><b data-cur>1</b> de ${list.length}</span>
      <span class="pager-dots">${list.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</span></div>
  </section>`;
}

function mountHero(el) {
  const h = el.querySelector('[data-hero]');
  if (!h) return () => {};
  const track = h.querySelector('[data-track]');
  const slides = [...track.children];
  const dots = [...h.querySelectorAll('.pager-dots i')];
  const cur = h.querySelector('[data-cur]');
  let idx = 0; let auto = 0; let touched = false;
  const set = (i) => {
    idx = i; cur.textContent = String(i + 1);
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
    slides.forEach((s, k) => s.classList.toggle('active', k === i));
  };
  set(0);
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting && e.intersectionRatio > 0.6) set(+e.target.dataset.i);
  }, { root: track, threshold: [0.6] });
  slides.forEach((s) => io.observe(s));
  const next = () => { if (touched || document.hidden) return; track.scrollTo({ left: ((idx + 1) % slides.length) * track.clientWidth, behavior: 'smooth' }); };
  if (!reduced() && !state.design) auto = setInterval(next, 7000);
  track.addEventListener('touchstart', () => { touched = true; }, { passive: true });
  track.addEventListener('pointerdown', () => { touched = true; });

  // Paralaje suave del banner al hacer scroll.
  let raf = 0;
  const onScroll = () => {
    if (raf || reduced()) return;
    raf = requestAnimationFrame(() => { raf = 0; h.style.setProperty('--py', `${Math.min(scrollY, 600) * 0.35}px`); });
  };
  addEventListener('scroll', onScroll, { passive: true });
  return () => { clearInterval(auto); io.disconnect(); removeEventListener('scroll', onScroll); };
}

function bindMyList(el) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mylist]');
    if (!b) return;
    const added = L.toggleMyList(b.dataset.mylist);
    b.querySelector('svg').outerHTML = added ? I.check : I.plus;
    toast(added ? 'Agregado a Mi lista' : 'Quitado de Mi lista');
  });
}

// ---------- Inicio ----------
export function home() {
  const lib = state.lib;
  if (!lib.movies.length && !lib.series.length) {
    return { cls: 'v-home', tab: 'inicio', html: `${homeBar()}<div class="pad-top">${empty('film', 'Todavía no hay nada aquí', 'Cuando se publique algo en el grupo aparecerá en esta pantalla.', btn('Ir a ajustes', { kind: 'secondary', href: '#/ajustes' }))}</div>` };
  }
  const featured = lib.recent.filter((t) => t.bannerKey || t.imageKey).slice(0, 6);
  const cont = continueWatching();
  const mine = L.myList().map((k) => lib.titles[k]).filter(Boolean);
  const cats = categoriesOf(lib).filter((c) => c.titles.length >= 2);
  const recent = lib.recent.slice(0, 5);
  return {
    cls: 'v-home',
    tab: 'inicio',
    html: `${homeBar()}
      ${hero(featured)}
      <div class="rows">
        ${row('Continuar viendo', '', cont.map(continueCard).join(''))}
        ${row('Recién agregados', `los últimos ${recent.length}`, recent.map((t) => card(t, { progress: progressOf(t) })).join(''))}
        ${row('Mi lista', plural(mine.length, 'título', 'títulos'), mine.map((t) => card(t)).join(''), { href: '#/mi-lista' })}
        ${row('Películas', plural(lib.movies.length, 'título', 'títulos'), lib.movies.slice(0, 10).map((t) => card(t, { progress: progressOf(t) })).join(''), { href: '#/peliculas' })}
        ${row('Series', plural(lib.series.length, 'título', 'títulos'), lib.series.map((t) => card(t)).join(''), { href: '#/series' })}
        ${cats.map((c) => row(esc(c.name), plural(c.titles.length, 'título', 'títulos'), c.titles.map((t) => card(t)).join(''), { href: `#/categorias/${encodeURIComponent(c.name)}` })).join('')}
      </div>`,
    mount(el) { bindMyList(el); return mountHero(el); },
  };
}

function homeBar() {
  return `<header class="home-bar" data-navbar>
    <div class="home-bar-inner">${logo()}<span class="nav-right"><a class="icon-btn" href="#/buscar" aria-label="Buscar">${I.search}</a>${profileButton()}</span></div>
    <nav class="home-chips"><a class="chip" href="#/peliculas">Películas</a><a class="chip" href="#/series">Series</a><a class="chip" href="#/categorias">Categorías ${I.down}</a></nav>
  </header>`;
}

// ---------- Películas / Series ----------
function listView(kind) {
  const lib = state.lib;
  const list = kind === 'movies' ? lib.movies : lib.series;
  const title = kind === 'movies' ? 'Películas' : 'Series';
  const cats = [...new Set(list.flatMap((t) => t.categories))].sort((a, b) => a.localeCompare(b, 'es'));
  return {
    cls: 'v-list',
    tab: kind === 'movies' ? 'peliculas' : 'series',
    html: `${largeTitle(title, { right: profileButton() })}
      <div class="chips-row" role="tablist">${['Todas', ...cats].map((c, i) => `<button class="chip ${i ? '' : 'on'}" type="button" data-cat="${i ? esc(c) : ''}">${esc(c)}</button>`).join('')}</div>
      <p class="list-note" data-note>${plural(list.length, 'título', 'títulos')}</p>
      <div data-grid>${grid(list) || empty(kind === 'movies' ? 'film' : 'tv', `No hay ${title.toLowerCase()} todavía`, 'Aparecerán cuando se publiquen en el grupo.')}</div>`,
    mount(el) {
      el.querySelector('.chips-row').addEventListener('click', (e) => {
        const c = e.target.closest('[data-cat]');
        if (!c) return;
        el.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === c));
        const sel = c.dataset.cat ? list.filter((t) => t.categories.includes(c.dataset.cat)) : list;
        el.querySelector('[data-grid]').innerHTML = grid(sel);
        el.querySelector('[data-note]').textContent = plural(sel.length, 'título', 'títulos');
        hydrate(el);
        c.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
      });
    },
  };
}
export const movies = () => listView('movies');
export const series = () => listView('series');

// ---------- Mi lista ----------
export function mylist() {
  const list = L.myList().map((k) => state.lib.titles[k]).filter(Boolean);
  return {
    cls: 'v-list',
    tab: 'mi-lista',
    html: `${largeTitle('Mi lista', { right: profileButton() })}
      ${list.length ? `<p class="list-note">${plural(list.length, 'título', 'títulos')}</p>${grid(list)}`
        : empty('heart', 'Tu lista está vacía', 'Toca «Mi lista» en una película o serie para guardarla aquí.', btn('Explorar', { kind: 'secondary', href: '#/inicio' }))}`,
  };
}

// ---------- Categorías ----------
export function categories(route) {
  const all = categoriesOf(state.lib);
  const name = route.params.name;
  if (name) {
    const c = all.find((x) => x.name === name);
    return {
      cls: 'v-list',
      html: `${largeTitle(esc(name), { back: true })}
        ${c ? `<p class="list-note">${plural(c.titles.length, 'título', 'títulos')}</p>${grid(c.titles)}` : empty('grid', 'No encontramos esta categoría', 'Puede que ya no tenga títulos.')}`,
    };
  }
  return {
    cls: 'v-list',
    html: `${largeTitle('Categorías', { back: true })}
      <div class="cat-grid">${all.map((c) => {
        const t = c.titles[0];
        return `<a class="cat-tile" href="#/categorias/${encodeURIComponent(c.name)}" style="--tint:${Art.color(t.titleKey, 30)}">
          ${img(t.imageKey, 'cat-art')}<span class="cat-name">${esc(c.name)}</span><span class="cat-count">${plural(c.titles.length, 'título', 'títulos')}</span></a>`;
      }).join('')}</div>`,
  };
}

// ---------- Buscar ----------
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const RECENT_KEY = 'hf.web.searches';
const recentSearches = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
const saveSearch = (q) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...recentSearches().filter((x) => x !== q)].slice(0, 6))); } catch { /* sin almacenamiento */ }
};

export function search(route) {
  const q = route.query.q || '';
  return {
    cls: 'v-search',
    tab: 'buscar',
    html: `${largeTitle('Buscar')}
      <form class="search-bar" data-form role="search">
        <label class="search-field">${I.search}
          <input name="q" type="search" enterkeyhint="search" placeholder="Películas, series, categorías" value="${esc(q)}" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Buscar"></label>
        <button type="button" class="search-cancel" data-cancel>Cancelar</button>
      </form>
      <div data-results></div>`,
    mount(el) {
      const f = el.querySelector('[data-form]');
      const out = el.querySelector('[data-results]');
      const all = [...state.lib.movies, ...state.lib.series];
      const paint = () => {
        const v = f.q.value.trim();
        setQuery({ q: v });
        f.classList.toggle('active', !!v || document.activeElement === f.q);
        if (!v) {
          const rs = recentSearches();
          const cats = categoriesOf(state.lib);
          out.innerHTML = `${rs.length ? `<h3 class="sec-title">Búsquedas recientes</h3><div class="chips-wrap">${rs.map((s) => `<button class="chip" type="button" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
            <h3 class="sec-title">Categorías</h3><div class="chips-wrap">${cats.map((c) => `<a class="chip" href="#/categorias/${encodeURIComponent(c.name)}">${esc(c.name)}</a>`).join('')}</div>
            <h3 class="sec-title">Para ti</h3>${grid(state.lib.recent.slice(0, 6))}`;
        } else {
          const n = norm(v);
          const hits = all.filter((t) => norm(t.name).includes(n) || t.categories.some((c) => norm(c).includes(n))
            || (t.type === 'series' && t.seasons.some((s) => s.episodes.some((e) => norm(e.title).includes(n)))));
          out.innerHTML = hits.length ? `<p class="list-note">${plural(hits.length, 'resultado', 'resultados')}</p>${grid(hits)}`
            : empty('search', 'Sin resultados', `No encontramos nada con «${esc(v)}». Prueba con otra palabra.`);
        }
        hydrate(out);
      };
      let deb = 0;
      f.q.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(paint, 120); });
      f.q.addEventListener('focus', () => f.classList.add('active'));
      f.q.addEventListener('blur', () => { if (f.q.value.trim()) saveSearch(f.q.value.trim()); if (!f.q.value) f.classList.remove('active'); });
      f.onsubmit = (e) => { e.preventDefault(); f.q.blur(); };
      el.querySelector('[data-cancel]').onclick = () => { f.q.value = ''; f.q.blur(); paint(); };
      out.addEventListener('click', (e) => { const c = e.target.closest('[data-q]'); if (c) { f.q.value = c.dataset.q; paint(); } });
      paint();
      if (!q && !state.design && matchMedia('(hover: hover)').matches) f.q.focus({ preventScroll: true });
    },
  };
}

export { navbar };
