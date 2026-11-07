// Propuestas del catálogo: 07 Inicio, 08 filas, 09 Series (cuadrícula), 10 biblioteca vacía, 16 Buscar.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { art } from './posters.mjs';
import { avatar } from './avatars.mjs';

const here = join(fileURLToPath(import.meta.url), '..');

const ic = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><path d="M12 7.5h.01"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor"/></svg>',
  chats: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};

// Biblioteca de demostración (índices de posters.mjs)
const T = {
  0: { n: 'Viaje espacial', t: 'movie', meta: '2023 · 1 h 52 min · 1080p', d: 'Una familia cruza la galaxia en busca de un nuevo hogar, entre planetas desconocidos y decisiones difíciles.' },
  1: { n: 'Bosque mágico', t: 'series', meta: '2 temporadas · 18 capítulos', kids: true },
  2: { n: 'Reino del océano', t: 'series', meta: '1 temporada · 8 capítulos', kids: true },
  3: { n: 'Ciudad neón', t: 'series', meta: '3 temporadas · 24 capítulos' },
  4: { n: 'Montaña lejana', t: 'movie', meta: '2021 · 1 h 38 min · 4K' },
  5: { n: 'Cabaña nevada', t: 'movie', meta: '2019 · 1 h 41 min · 1080p', kids: true },
  6: { n: 'Isla secreta', t: 'series', meta: '1 temporada · 10 capítulos' },
  7: { n: 'Castillo violeta', t: 'series', meta: '2 temporadas · 16 capítulos', kids: true },
  8: { n: 'Luces nocturnas', t: 'movie', meta: '2022 · 2 h 05 min · 1080p' },
  9: { n: 'Aventura lunar', t: 'movie', meta: '2024 · 1 h 29 min · 1080p', kids: true },
  10: { n: 'Tesoro dorado', t: 'movie', meta: '2020 · 1 h 47 min · 720p' },
  11: { n: 'Robot viajero', t: 'series', meta: '1 temporada · 12 capítulos', kids: true },
};

const brand = `<div class="hf2-brand small"><div class="hf2-logo"></div><div class="hf2-wordmark">Home<span>Flix</span></div></div>`;

function topbar(active, opts = {}) {
  const items = [['home', 'Inicio'], ['movies', 'Películas'], ['series', 'Series'], ['mylist', 'Mi lista']];
  return `<div class="hf2-topbar">
    ${brand}
    <nav class="hf2-menu">${items.map(([id, l]) => `<span class="${id === active ? 'on' : ''}"${opts.menuFocus === id ? ' data-focused="true"' : ''}>${l}</span>`).join('')}</nav>
    <div class="hf2-top-right">
      ${opts.sync ? `<span class="hf2-sync">${ic.clock}${opts.sync}</span>` : ''}
      <span class="hf2-round sm${opts.searchFocus ? '" data-focused="true' : ''}">${ic.search}</span>
      <span class="hf2-round sm">${ic.gear}</span>
      <span class="hf2-me"><span class="hf2-me-avatar">${avatar('panda')}</span>Familia</span>
    </div>
  </div>`;
}

const badgeKids = `<span class="hf2-chip kids">${ic.star}Infantil</span>`;

function card(i, o = {}) {
  const t = T[i];
  const sub = o.sub || t.meta;
  return `<div class="hf2-card${o.focus ? '" data-focused="true' : ''}">
    <div class="hf2-card-art">${art(i, 'c' + (o.k || ''))}
      <span class="hf2-card-type">${o.label || (t.t === 'movie' ? 'Película' : 'Serie')}</span>
      ${t.kids && !o.noKids ? `<span class="hf2-card-kids">${ic.star}</span>` : ''}
      ${o.progress ? `<span class="hf2-card-progress"><i style="width:${o.progress}%"></i></span>` : ''}
      ${o.left ? `<span class="hf2-card-left">${o.left}</span>` : ''}
    </div>
    <div class="hf2-card-title">${o.title || t.n}</div>
    <div class="hf2-card-sub">${sub}</div>
  </div>`;
}

/* Carrusel en ciclo: a la izquierda asoma el último elemento y a la derecha se repiten los primeros,
 * así se lee que la fila continúa. En la app, ▶ en el último pasa al primero (y ◀ en el primero, al último). */
function row(title, cards, note, loop = true) {
  if (!loop) {
    return `<div class="hf2-row"><div class="hf2-row-head"><h3>${title}</h3>${note ? `<span>${note}</span>` : ''}</div><div class="hf2-row-viewport plain"><div class="hf2-row-track">${cards.join('')}</div></div></div>`;
  }
  const ghost = (c) => c.replace('class="hf2-card', 'class="hf2-card ghost').replace(' data-focused="true"', '');
  const looped = [ghost(cards[cards.length - 1]), ...cards, ...cards.slice(0, 3).map(ghost)];
  return `<div class="hf2-row loop"><div class="hf2-row-head"><h3>${title}</h3>${note ? `<span>${note}</span>` : ''}</div>
    <div class="hf2-row-viewport"><div class="hf2-row-track">${looped.join('')}</div><i class="hf2-fade left"></i><i class="hf2-fade right"></i></div></div>`;
}

const footer = (l, r) => `<div class="hf2-footer"><span>${l}</span><span class="keys">${r}</span></div>`;

/* ---------------- 07 · Inicio ---------------- */
const hero = (focusBtn) => `<div class="hf2-billboard">
  <div class="hf2-bb-art">${art(0, 'hero')}</div>
  <div class="hf2-bb-shade"></div>
  <div class="hf2-bb-copy">
    <div class="hf2-bb-badges"><span class="hf2-chip gold">Película</span><span class="hf2-chip">Nuevo</span></div>
    <h1>Viaje espacial</h1>
    <div class="hf2-bb-meta"><b>2023</b><span>1 h 52 min</span><span class="hf2-q">1080p</span><span>Ciencia ficción · Familiar</span></div>
    <p>${T[0].d}</p>
    <div class="hf2-bb-actions">
      <span class="hf2-btn primary small icon"${focusBtn ? ' data-focused="true"' : ''}>${ic.play}Reproducir</span>
      <span class="hf2-btn ghost small icon">${ic.info}Más info</span>
      <span class="hf2-round">${ic.plus}</span>
    </div>
  </div>
  <div class="hf2-bb-dots"><i class="on"></i><i></i><i></i><i></i><i></i></div>
</div>`;

const continueRow = row('Continuar viendo', [
  card(1, { label: 'T1:E3', title: 'Bosque mágico', sub: 'T1:E3 · El secreto de las luces', progress: 62, left: 'Quedan 9 min', noKids: true }),
  card(4, { progress: 35, left: 'Quedan 1 h 04 min', sub: 'Película · 2021' }),
  card(3, { label: 'T2:E5', sub: 'T2:E5 · Señales', progress: 18, left: 'Quedan 38 min' }),
  card(9, { progress: 80, left: 'Quedan 17 min', sub: 'Película · 2024' }),
  card(11, { label: 'T1:E7', sub: 'T1:E7 · La tormenta', progress: 45, left: 'Quedan 12 min' }),
], '', false);

const p07 = `<div class="hf2 cat" data-route="browse">
  <div class="hf2-page">${hero(true)}<div class="hf2-rows" style="margin-top:-150px">${continueRow}</div></div>
  ${topbar('home')}
  ${footer('Viaje espacial · Película · 2023', '◀ ▶ Destacados · ▼ Filas · OK Reproducir')}
</div>`;

/* ---------------- 08 · Filas ---------------- */
const p08 = `<div class="hf2 cat" data-route="browse">
  <div class="hf2-page" style="top:120px">
    <div class="hf2-rows">
      ${row('Agregados recientemente', [card(9), card(2), card(0, { focus: true }), card(7), card(10), card(6)], '12 títulos')}
      ${row('Películas', [card(0, { k: 'm' }), card(4, { k: 'm' }), card(5, { k: 'm' }), card(8, { k: 'm' }), card(9, { k: 'm' }), card(10, { k: 'm' })], '6')}
      ${row('Series', [card(1, { k: 's' }), card(2, { k: 's' }), card(3, { k: 's' }), card(6, { k: 's' }), card(7, { k: 's' }), card(11, { k: 's' })], '6')}
    </div>
  </div>
  ${topbar('home')}
  ${footer('Viaje espacial · Película · 2023 · 1 h 52 min', '◀ ▶ ▲ ▼ Navegar · OK Ver ficha')}
</div>`;

/* ---------------- 09 / 09b · Secciones Series y Películas ----------------
 * Destacado propio de la sección + carruseles en ciclo agrupados. */
function sectionHero({ i, badges, title, meta, desc, primary, secondary }) {
  return `<div class="hf2-billboard compact">
  <div class="hf2-bb-art">${art(i, 'sec' + i)}</div>
  <div class="hf2-bb-shade"></div>
  <div class="hf2-bb-copy">
    <div class="hf2-bb-badges">${badges}</div>
    <h1>${title}</h1>
    <div class="hf2-bb-meta">${meta}</div>
    <p>${desc}</p>
    <div class="hf2-bb-actions">
      <span class="hf2-btn primary small icon" data-focused="true">${ic.play}${primary}</span>
      <span class="hf2-btn ghost small icon">${ic.info}${secondary}</span>
      <span class="hf2-round">${ic.plus}</span>
    </div>
  </div>
  <div class="hf2-bb-dots"><i class="on"></i><i></i><i></i><i></i></div>
</div>`;
}

const S = (ids, k) => ids.map((i, n) => card(i, { k: k + n }));

const p09 = `<div class="hf2 cat" data-route="browse">
  <div class="hf2-page">
    ${sectionHero({
      i: 1,
      badges: `<span class="hf2-chip gold">Serie</span>${badgeKids}`,
      title: 'Bosque mágico',
      meta: '<b>2 temporadas</b><span>18 capítulos</span><span class="hf2-q">1080p</span><span>Aventura · Familiar</span>',
      desc: 'Dos hermanos entran a un bosque lleno de luces y personajes curiosos que guardan un secreto antiguo.',
      primary: 'Continuar T1:E3',
      secondary: 'Capítulos',
    })}
    <div class="hf2-rows" style="margin-top:-120px">
      ${row('Series que empezaste', [
        card(1, { k: 'se1', label: 'T1:E3', sub: 'T1:E3 · El secreto de las luces', progress: 62, noKids: true }),
        card(3, { k: 'se2', label: 'T2:E5', sub: 'T2:E5 · Señales', progress: 18 }),
        card(11, { k: 'se3', label: 'T1:E7', sub: 'T1:E7 · La tormenta', progress: 45 }),
      ], '3', false)}
      ${row('Recién agregadas', S([6, 7, 2, 11, 3, 1], 'sr'), '6')}
      ${row('Para niños', S([1, 2, 7, 11], 'sk'), '4 infantiles')}
    </div>
  </div>
  ${topbar('series')}
  ${footer('Bosque mágico · Serie infantil · 2 temporadas', '◀ ▶ Destacadas · ▼ Filas · OK Continuar · BACK Inicio')}
</div>`;

const p09b = `<div class="hf2 cat" data-route="browse">
  <div class="hf2-page">
    ${sectionHero({
      i: 4,
      badges: '<span class="hf2-chip gold">Película</span><span class="hf2-chip">4K</span>',
      title: 'Montaña lejana',
      meta: '<b>2021</b><span>1 h 38 min</span><span class="hf2-q">4K</span><span>Aventura · Drama</span>',
      desc: 'Una familia viaja a la montaña y aprende a reconectar lejos del ruido cotidiano.',
      primary: 'Reproducir',
      secondary: 'Más info',
    })}
    <div class="hf2-rows" style="margin-top:-120px">
      ${row('Recién agregadas', S([9, 0, 8, 5, 10, 4], 'mr'), '6')}
      ${row('Para niños', S([5, 9, 0], 'mk'), '3 infantiles')}
      ${row('Para una noche de cine', S([8, 0, 10, 4], 'mn'), 'más de 1 h 40 min')}
    </div>
  </div>
  ${topbar('movies')}
  ${footer('Montaña lejana · Película · 2021 · 4K', '◀ ▶ Destacadas · ▼ Filas · OK Reproducir · BACK Inicio')}
</div>`;

/* ---------------- 10 · Biblioteca vacía ---------------- */
const p10 = `<div class="hf2 cat" data-route="browse">
  <div class="hf2-glow"></div>
  <div class="hf2-empty">
    <div class="hf2-empty-art"><div class="hf2-logo big"></div></div>
    <h2>Tu biblioteca está vacía</h2>
    <p>HomeFlix muestra los videos de los chats de Telegram que elijas. Elige dónde subes tus películas y series, y aparecerán aquí.</p>
    <div class="hf2-empty-steps">
      <div><span>1</span><b>Elige tus chats</b><small>Grupos o canales donde subes los videos</small></div>
      <div><span>2</span><b>Pon nombre a cada video</b><small>En su comentario de Telegram, o desde la TV</small></div>
      <div><span>3</span><b>Disfruta</b><small>Películas y series ordenadas, con portada</small></div>
    </div>
    <div class="hf2-actions center">
      <span class="hf2-btn primary small icon" data-focused="true">${ic.chats}Elegir chats</span>
      <span class="hf2-btn ghost small icon">${ic.tag}Cómo etiquetar</span>
    </div>
  </div>
  ${topbar('home')}
  ${footer('Todavía no hay chats activos', 'OK Seleccionar')}
</div>`;

/* ---------------- 16 · Buscar ---------------- */
const p16 = `<div class="hf2 cat" data-route="search">
  <div class="hf2-page" style="top:120px">
    <div class="hf2-searchbox" data-focused="true">${ic.search}<span class="hf2-search-text">aven<i></i></span><span class="hf2-search-hint">Usa el teclado de la TV o el del teléfono con Apps2Samsung</span></div>
    <div class="hf2-recent"><span class="lbl">Recientes</span><span class="hf2-chip">Bluey</span><span class="hf2-chip">Coco</span><span class="hf2-chip">Dark</span></div>
    <div class="hf2-grid-head small"><h2>3 resultados para «aven»</h2></div>
    <div class="hf2-grid">${[9, 0, 6].map((i, k) => card(i, { k: 'q' + k })).join('')}</div>
  </div>
  ${topbar('', { searchFocus: true })}
  ${footer('Escribe el nombre de una película o serie', '▼ Resultados · OK Escribir · BACK Volver')}
</div>`;

const out = {
  '07-browse-home': ['Catálogo: Inicio (destacado)', p07],
  '08-browse-rows': ['Catálogo: filas', p08],
  '09-browse-series': ['Sección Series', p09],
  '09b-browse-movies': ['Sección Películas', p09b],
  '10-browse-empty': ['Catálogo sin videos', p10],
  '16-search': ['Buscar', p16],
};
for (const [id, [label, html]] of Object.entries(out)) writeFileSync(join(here, id + '.html'), JSON.stringify({ label, html }));
console.log('propuestas del catálogo listas');
