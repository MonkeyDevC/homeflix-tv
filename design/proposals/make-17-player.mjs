// Propuestas del reproductor: 17 controles, 18 audio y subtítulos, 19 siguiente capítulo.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { art } from './posters.mjs';

const here = join(fileURLToPath(import.meta.url), '..');

const ic = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/></svg>',
  back10: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 3v6h6"/><text x="12" y="15.5" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor" stroke="none" font-family="Arial">10</text></svg>',
  fwd10: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/><text x="12" y="15.5" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor" stroke="none" font-family="Arial">10</text></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M5 5v14l10-7z" fill="currentColor"/><rect x="16" y="5" width="3" height="14" rx="1" fill="currentColor"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  subs: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M7 14h4M13 14h4M7 10.5h2M11 10.5h6"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  backArrow: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
};

function frame(i, cls = '') {
  return `<div class="hf2-pl-video ${cls}">${art(i, 'pl' + i + cls)}</div>`;
}

const top = `<div class="hf2-pl-top">
  <span class="hf2-pl-back">${ic.backArrow}</span>
  <div><div class="hf2-pl-title">Ciudad neón</div><div class="hf2-pl-sub">T2:E5 · Señales</div></div>
  <div class="hf2-pl-brand"><div class="hf2-logo"></div></div>
</div>`;

function controls(focus = 'pause', opts = {}) {
  const f = (k) => (focus === k ? ' data-focused="true"' : '');
  return `<div class="hf2-pl-bottom">
  <div class="hf2-pl-progress">
    <span class="t">25:00</span>
    <div class="hf2-pl-bar"${f('bar')}><i class="buf" style="width:66%"></i><i class="fill" style="width:58%"></i><b style="left:58%"></b></div>
    <span class="t">-18:12</span>
  </div>
  <div class="hf2-pl-controls">
    <div class="hf2-pl-main">
      <span class="hf2-pl-btn"${f('back')}>${ic.back10}</span>
      <span class="hf2-pl-btn big"${f('pause')}>${opts.paused ? ic.play : ic.pause}</span>
      <span class="hf2-pl-btn"${f('fwd')}>${ic.fwd10}</span>
    </div>
    <div class="hf2-pl-extra">
      <span class="hf2-pl-pill"${f('eps')}>${ic.list}Capítulos</span>
      <span class="hf2-pl-pill"${f('subs')}>${ic.subs}Audio y subtítulos</span>
      <span class="hf2-pl-pill"${f('next')}>${ic.next}Siguiente</span>
      <span class="hf2-pl-pill"${f('edit')}>${ic.pencil}Editar</span>
    </div>
  </div>
</div>`;
}

/* ---------------- 17 · Controles ---------------- */
const p17 = `<div class="hf2 pl" data-route="player">
  ${frame(3)}
  <div class="hf2-pl-shade"></div>
  ${top}
  <div class="hf2-pl-sublines bump">— ¿Viste esa luz en la torre?<br>— Es la misma señal de anoche.</div>
  ${controls('pause')}
</div>`;

/* ---------------- 17b · Capítulos dentro del reproductor ---------------- */
const pEps = [
  [1, 'Luces de neón', 'La ciudad se apaga y solo una torre sigue encendida.', '44 min', { done: true }, 3],
  [2, 'El taller', 'Nora encuentra un aparato que capta frecuencias perdidas.', '41 min', { done: true }, 8],
  [3, 'Interferencias', 'La radio repite un mensaje que nadie recuerda haber grabado.', '43 min', { done: true }, 3],
  [4, 'Azotea', 'Desde lo alto, el grupo ve el patrón de las luces.', '45 min', { done: true }, 7],
  [5, 'Señales', 'La misma luz aparece en la torre cada noche a la misma hora.', '43 min', { now: true, progress: 58 }, 3],
  [6, 'Interferencia', 'La señal se repite y alguien en la ciudad sabe por qué.', '46 min', { focus: true }, 7],
  [7, 'Corte de luz', 'Toda la ciudad queda a oscuras menos el barrio de Nora.', '42 min', {}, 8],
];

function playerEp([n, t, d, dur, o, artI]) {
  return `<div class="hf2-ep${o.focus ? '" data-focused="true' : ''}${o.now ? ' now' : ''}">
    <div class="hf2-ep-art">${art(artI, 'pe' + n)}<span class="hf2-ep-num">${n}</span>
      ${o.done ? `<span class="hf2-ep-done">${ic.check}Visto</span>` : ''}
      ${o.now ? `<span class="hf2-ep-now">${ic.play}Viendo ahora</span>` : ''}
      ${o.progress ? `<span class="hf2-card-progress"><i style="width:${o.progress}%"></i></span>` : ''}
      ${o.focus ? `<span class="hf2-ep-play">${ic.play}</span>` : ''}
    </div>
    <div class="hf2-ep-title"><b>${t}</b><span>${dur}</span></div>
    <div class="hf2-ep-desc">${d}</div>
  </div>`;
}

const p17b = `<div class="hf2 pl" data-route="player">
  ${frame(3, 'dim')}
  <div class="hf2-pl-shade eps"></div>
  ${top}
  <div class="hf2-pl-eps">
    <div class="hf2-pl-eps-head">
      <h2>Capítulos</h2>
      <div class="hf2-seasons"><span class="hf2-pill">Temporada 1 <b>8</b></span><span class="hf2-pill on">Temporada 2 <b>10</b></span><span class="hf2-pill">Temporada 3 <b>6</b></span><span class="hf2-seasons-note">Viste 4 de 10 · estás en el 5</span></div>
    </div>
    <div class="hf2-ep-track pl">${pEps.map(playerEp).join('')}</div>
  </div>
  <div class="hf2-footer pl"><span>T2:E6 · Interferencia · 46 min</span><span class="keys">◀ ▶ Capítulos · ▲ Temporadas · OK Reproducir · BACK Volver al video</span></div>
</div>`;

/* ---------------- 18 · Audio y subtítulos ---------------- */
const audio = [['Español (Latino)', '5.1', true], ['Inglés', 'Estéreo', false], ['Japonés', 'Estéreo', false]];
const subs = [['Desactivados', '', false], ['Español', '', true, true], ['Español', 'forzados', false], ['Inglés', '', false]];
const p18 = `<div class="hf2 pl" data-route="player">
  ${frame(3, 'dim')}
  <div class="hf2-pl-shade"></div>
  ${top}
  <div class="hf2-pl-sublines left">— ¿Viste esa luz en la torre?<br>— Es la misma señal de anoche.</div>
  <div class="hf2-tracks">
    <h2>Audio y subtítulos</h2>
    <div class="hf2-tracks-cols">
      <div>
        <div class="hf2-tracks-h">${ic.audio}Audio</div>
        ${audio.map(([n, d, on]) => `<div class="hf2-track${on ? ' on' : ''}"><span class="ck">${on ? ic.check : ''}</span><b>${n}</b><small>${d}</small></div>`).join('')}
      </div>
      <div>
        <div class="hf2-tracks-h">${ic.subs}Subtítulos</div>
        ${subs.map(([n, d, on, f]) => `<div class="hf2-track${on ? ' on' : ''}"${f ? ' data-focused="true"' : ''}><span class="ck">${on ? ic.check : ''}</span><b>${n}</b><small>${d}</small></div>`).join('')}
        <div class="hf2-tracks-h small">Tamaño</div>
        <div class="hf2-segment"><span>Pequeño</span><span class="on">Mediano</span><span>Grande</span></div>
      </div>
    </div>
    <div class="hf2-tracks-note">Se recuerda para este video. ◀ ▶ cambiar columna · BACK cerrar</div>
  </div>
</div>`;

/* ---------------- 19 · Siguiente capítulo ---------------- */
const p19 = `<div class="hf2 pl" data-route="player">
  ${frame(3, 'credits')}
  <div class="hf2-pl-shade credits"></div>
  <div class="hf2-credits">Dirección · Producción · Música original<br>HomeFlix Original</div>
  <div class="hf2-next">
    <div class="hf2-next-art">${art(7, 'next')}<span class="hf2-ep-num">6</span></div>
    <div class="hf2-next-body">
      <div class="hf2-kicker">Siguiente capítulo</div>
      <div class="hf2-next-title">T2:E6 · Interferencia</div>
      <div class="hf2-next-desc">La señal se repite cada noche y alguien en la ciudad sabe por qué.</div>
      <div class="hf2-next-count"><span class="bar"><i style="width:40%"></i></span>Empieza en 8 s</div>
      <div class="hf2-next-actions">
        <span class="hf2-btn primary small icon" data-focused="true">${ic.play}Ver ahora</span>
        <span class="hf2-btn ghost small">Ver créditos</span>
      </div>
    </div>
  </div>
</div>`;

const out = {
  '17-player': ['Reproductor con controles', p17],
  '17b-player-episodes': ['Reproductor: capítulos', p17b],
  '18-player-tracks': ['Reproductor: audio y subtítulos', p18],
  '19-player-next': ['Reproductor: siguiente capítulo', p19],
};
for (const [id, [label, html]] of Object.entries(out)) writeFileSync(join(here, id + '.html'), JSON.stringify({ label, html }));
console.log('propuestas del reproductor listas');
