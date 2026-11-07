// Propuestas de fichas: 11 película, 12 serie, 13 capítulos, 14 video sin clasificar, 15 etiquetar.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { art } from './posters.mjs';

const here = join(fileURLToPath(import.meta.url), '..');

const ic = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>',
  restart: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 3v6h6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.5-2.7 4"/><path d="M12 17.3h.01"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
};

const brand = `<div class="hf2-brand small dt"><div class="hf2-logo"></div><div class="hf2-wordmark">Home<span>Flix</span></div></div>`;
const backHint = `<div class="hf2-back">${ic.back}Volver</div>`;
const footer = (l, r) => `<div class="hf2-footer"><span>${l}</span><span class="keys">${r}</span></div>`;

function backdrop(i, cls = '') {
  return `<div class="hf2-dt-art ${cls}">${art(i, 'dt' + i + cls)}</div><div class="hf2-dt-shade ${cls}"></div>`;
}

function miniCard(i, title, sub, k, extra = '') {
  return `<div class="hf2-card"><div class="hf2-card-art">${art(i, 'mc' + k)}${extra}</div><div class="hf2-card-title">${title}</div><div class="hf2-card-sub">${sub}</div></div>`;
}

function loopRow(title, cards, note) {
  const ghost = (c) => c.replace('class="hf2-card', 'class="hf2-card ghost');
  const looped = [ghost(cards[cards.length - 1]), ...cards, ...cards.slice(0, 3).map(ghost)];
  return `<div class="hf2-row loop"><div class="hf2-row-head"><h3>${title}</h3>${note ? `<span>${note}</span>` : ''}</div>
    <div class="hf2-row-viewport"><div class="hf2-row-track">${looped.join('')}</div><i class="hf2-fade left"></i><i class="hf2-fade right"></i></div></div>`;
}

/* ---------------- 11 · Ficha de película ---------------- */
const p11 = `<div class="hf2 cat dt" data-route="detail">
  ${backdrop(8)}
  ${brand}${backHint}
  <div class="hf2-dt-copy">
    <div class="hf2-bb-badges"><span class="hf2-chip gold">Película</span></div>
    <h1>Luces nocturnas</h1>
    <div class="hf2-bb-meta"><b>2022</b><span>2 h 05 min</span><span class="hf2-q">1080p</span><span>1,8 GB</span></div>
    <div class="hf2-dt-source">${ic.chat}De <b>Películas Familia</b></div>
    <div class="hf2-dt-progress"><span class="bar"><i style="width:38%"></i></span><span>Viste 40 min · quedan 1 h 25 min</span></div>
    <p>Una noche en la carretera cambia los planes de una familia que vuelve a casa después de las vacaciones.</p>
    <div class="hf2-bb-actions">
      <span class="hf2-btn primary small icon" data-focused="true">${ic.play}Reanudar desde 40:00</span>
      <span class="hf2-btn ghost small icon">${ic.restart}Desde el inicio</span>
      <span class="hf2-btn ghost small icon">${ic.check}En mi lista</span>
      <span class="hf2-btn ghost small icon">${ic.pencil}Editar</span>
    </div>
  </div>
  <div class="hf2-dt-more">${loopRow('También de Películas Familia', [
    miniCard(0, 'Viaje espacial', '2023 · 1 h 52 min', 'a'), miniCard(4, 'Montaña lejana', '2021 · 1 h 38 min', 'b'),
    miniCard(10, 'Tesoro dorado', '2020 · 1 h 47 min', 'c'), miniCard(5, 'Cabaña nevada', '2019 · 1 h 41 min', 'd'),
    miniCard(9, 'Aventura lunar', '2024 · 1 h 29 min', 'e'),
  ], '5')}</div>
  ${footer('Reanudar Luces nocturnas desde 40:00', '◀ ▶ Botones · ▼ Más títulos · OK Seleccionar · BACK Volver')}
</div>`;

/* ---------------- 12 / 13 · Ficha de serie ---------------- */
const eps = [
  [1, 'La primera luz', 'Mía y Leo siguen una luciérnaga que los lleva al corazón del bosque.', '22 min', { done: true }],
  [2, 'El río que canta', 'El río guarda una melodía que solo se escucha al atardecer.', '24 min', { done: true }],
  [3, 'El secreto de las luces', 'Descubren por qué el bosque brilla de noche… y quién lo cuida.', '23 min', { progress: 62 }],
  [4, 'La lechuza sabia', 'Una lechuza anciana les enseña a leer las estrellas.', '22 min', {}],
  [5, 'Tormenta de hojas', 'El viento se lleva el mapa y deben volver por otro camino.', '25 min', {}],
];

function episodeCard([n, t, d, dur, o], k, focus) {
  return `<div class="hf2-ep${focus ? '" data-focused="true' : ''}">
    <div class="hf2-ep-art">${art([1, 6, 2, 7, 11][(n - 1) % 5], 'ep' + k + n)}<span class="hf2-ep-num">${n}</span>
      ${o.done ? `<span class="hf2-ep-done">${ic.check}Visto</span>` : ''}
      ${o.progress ? `<span class="hf2-card-progress"><i style="width:${o.progress}%"></i></span>` : ''}
      ${focus ? `<span class="hf2-ep-play">${ic.play}</span>` : ''}
    </div>
    <div class="hf2-ep-title"><b>${t}</b><span>${dur}</span></div>
    <div class="hf2-ep-desc">${d}</div>
  </div>`;
}

function seriesDetail(focusEpisodes) {
  return `<div class="hf2 cat dt${focusEpisodes ? ' scrolled' : ''}" data-route="detail">
  ${backdrop(1)}
  ${brand}${backHint}
  <div class="hf2-dt-copy">
    <div class="hf2-bb-badges"><span class="hf2-chip gold">Serie</span><span class="hf2-chip kids">${ic.star}Infantil</span></div>
    <h1>Bosque mágico</h1>
    <div class="hf2-bb-meta"><b>2 temporadas</b><span>18 capítulos</span><span class="hf2-q">1080p</span><span>Aventura · Familiar</span></div>
    ${focusEpisodes ? '' : `<div class="hf2-dt-source">${ic.chat}De <b>Dibujos animados</b></div>
    <p>Dos hermanos entran a un bosque lleno de luces y personajes curiosos que guardan un secreto antiguo.</p>
    <div class="hf2-bb-actions">
      <span class="hf2-btn primary small icon" data-focused="true">${ic.play}Continuar T1:E3</span>
      <span class="hf2-btn ghost small icon">${ic.restart}Desde T1:E1</span>
      <span class="hf2-btn ghost small icon">${ic.plus}Mi lista</span>
    </div>`}
  </div>
  <div class="hf2-dt-episodes">
    <div class="hf2-seasons"><span class="hf2-pill on">Temporada 1 <b>10</b></span><span class="hf2-pill">Temporada 2 <b>8</b></span><span class="hf2-seasons-note">Viste 2 de 10 capítulos</span></div>
    <div class="hf2-ep-track">${eps.map((e, k) => episodeCard(e, focusEpisodes ? 'f' : 'h', focusEpisodes && k === 2)).join('')}</div>
  </div>
  ${footer(focusEpisodes ? 'T1:E3 · El secreto de las luces · quedan 9 min' : 'Continuar Bosque mágico: T1:E3 · El secreto de las luces', focusEpisodes ? '◀ ▶ Capítulos · ▲ Temporadas · OK Reproducir · BACK Volver' : '◀ ▶ Botones · ▼ Capítulos · OK Seleccionar · BACK Volver')}
</div>`;
}

/* ---------------- 14 · Video sin clasificar ---------------- */
const p14 = `<div class="hf2 cat dt" data-route="detail">
  ${backdrop(6, 'muted')}
  ${brand}${backHint}
  <div class="hf2-dt-copy">
    <div class="hf2-bb-badges"><span class="hf2-chip warn">Sin clasificar</span></div>
    <h1 class="smaller">VID 20240712 playa</h1>
    <div class="hf2-bb-meta"><span>5 min</span><span class="hf2-q">1080p</span><span>214 MB</span></div>
    <div class="hf2-dt-source">${ic.chat}De <b>Películas Familia</b> · subido el 12 jul 2024</div>
    <div class="hf2-unclassified">
      <b>Este video todavía no dice qué es</b>
      <p>Por eso no aparece en Películas ni en Series. Etiquétalo para darle nombre y ordenarlo.</p>
      <div class="hf2-current-caption"><span>Comentario en Telegram</span><q>Vacaciones en la playa 2024</q></div>
    </div>
    <div class="hf2-bb-actions">
      <span class="hf2-btn primary small icon" data-focused="true">${ic.tag}Etiquetar</span>
      <span class="hf2-btn ghost small icon">${ic.play}Reproducir</span>
      <span class="hf2-btn ghost small icon">${ic.help}Cómo etiquetar</span>
    </div>
  </div>
  ${footer('Etiqueta el video para ordenarlo en tu biblioteca', '◀ ▶ Botones · OK Seleccionar · BACK Volver')}
</div>`;

/* ---------------- 15 · Etiquetar ---------------- */
const p15 = `<div class="hf2 cat" data-route="tag-edit">
  <div class="hf2-glow"></div>
  ${brand}
  <div class="hf2-panel tagger">
    <div class="hf2-tag-preview">
      <div class="hf2-kicker">Vista previa</div>
      <div class="hf2-card big"><div class="hf2-card-art">${art(6, 'tagprev')}<span class="hf2-card-type">T1:E4</span><span class="hf2-card-kids">${ic.star}</span></div>
        <div class="hf2-card-title">Isla secreta</div><div class="hf2-card-sub">T1:E4 · La cueva del faro</div></div>
      <div class="hf2-tag-file"><span>Archivo</span>VID_20240712_playa.mp4 · 5 min<br><span>Chat</span>Películas Familia</div>
    </div>
    <div class="hf2-panel-main tagger">
      <div class="hf2-kicker">Etiquetar video</div>
      <h1 class="hf2-title small">¿Qué es este video?</h1>
      <div class="hf2-tag-type"><span>Película</span><span class="on">Capítulo de serie</span></div>
      <div class="hf2-form">
        <div class="hf2-frow" data-focused="true"><label>Serie</label><div class="hf2-choice">◀ <b>Isla secreta</b> ▶<small>3 de 6 · o escribe una nueva</small></div></div>
        <div class="hf2-frow split">
          <div><label>Temporada</label><div class="hf2-stepper"><i>${ic.minus}</i><b>1</b><i>${ic.plus}</i></div></div>
          <div><label>Capítulo</label><div class="hf2-stepper"><i>${ic.minus}</i><b>4</b><i>${ic.plus}</i><small>siguiente libre</small></div></div>
          <div><label>Infantil</label><div class="hf2-toggle-row"><span class="hf2-toggle on"><i></i></span><span>Sí</span></div></div>
        </div>
        <div class="hf2-frow"><label>Título del capítulo</label><div class="hf2-input">La cueva del faro</div></div>
        <div class="hf2-frow"><label>Descripción</label><div class="hf2-input placeholder">Opcional</div></div>
      </div>
      <div class="hf2-tag-code"><span>En Telegram sería:</span><code>serie(1/4)#Isla secreta#La cueva del faro# #infantil</code></div>
      <div class="hf2-actions">
        <span class="hf2-btn primary small">Guardar</span>
        <span class="hf2-btn ghost small">Cancelar</span>
      </div>
    </div>
  </div>
  ${footer('◀ ▶ cambia la serie · OK para escribir una nueva', '▲ ▼ Campos · OK Seleccionar · BACK Cancelar')}
</div>`;

const out = {
  '11-detail-movie': ['Ficha de película (a medias)', p11],
  '12-detail-series': ['Ficha de serie', seriesDetail(false)],
  '13-detail-episodes': ['Ficha de serie: capítulos', seriesDetail(true)],
  '14-detail-video': ['Video sin clasificar', p14],
  '15-tag-edit': ['Etiquetar video desde la TV', p15],
};
for (const [id, [label, html]] of Object.entries(out)) writeFileSync(join(here, id + '.html'), JSON.stringify({ label, html }));
console.log('propuestas de fichas listas');
