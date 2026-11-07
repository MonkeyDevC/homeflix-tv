// Propuesta 10b: guía «Cómo etiquetar» (desde la biblioteca vacía, la ayuda de chats y «Sin clasificar»).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { art } from './posters.mjs';
import { avatar } from './avatars.mjs';

const here = join(fileURLToPath(import.meta.url), '..');

const ic = {
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4.5" width="20" height="13" rx="2"/><path d="M8 21h8M12 17.5V21"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#fff"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
};

const formats = [
  ['Película', 'pelicula#<b>Coco (2017)</b>#<i>Un niño viaja…</i>', 'El año entre paréntesis es opcional'],
  ['Capítulo', 'serie(<b>1/3</b>)#<b>Bluey</b>#<i>Juegan a los médicos</i>', 'Temporada 1, capítulo 3'],
  ['Con título', 'serie(1/3)#Bluey#<b>El hospital</b>#<i>…</i>', 'Un campo más para el título del capítulo'],
  ['Portada', '<b>Foto</b> con serie#<b>Bluey</b>#<i>Resumen de la serie</i>', 'Una foto con ese comentario pone portada y resumen'],
  ['Infantil', '… <b>#infantil</b>', 'Al final del comentario: lo ven los perfiles infantiles'],
];

const html = `<div class="hf2 cat" data-route="browse">
  <div class="hf2-glow"></div>
  <div class="hf2-brand"><div class="hf2-logo"></div><div class="hf2-wordmark">Home<span>Flix</span></div></div>
  <div class="hf2-top-actions"><span class="hf2-btn ghost small icon top">${ic.tag}Ir a Sin clasificar</span><span class="hf2-btn primary small top" data-focused="true">Entendido</span></div>

  <div class="hf2-guide">
    <div class="hf2-kicker">Guía</div>
    <h1 class="hf2-title">Cómo ordena HomeFlix tus videos</h1>
    <p class="hf2-text wide">Cada video necesita decir si es una película o un capítulo de una serie. Hay dos formas: usa la que te quede más cómoda.</p>

    <div class="hf2-guide-cols">
      <div class="hf2-guide-card">
        <div class="hf2-guide-head"><span class="hf2-guide-ic">${ic.phone}</span><div><b>Desde Telegram</b><small>Al subir el video, escribe su comentario así</small></div><span class="hf2-chip gold">Recomendado</span></div>
        <div class="hf2-tg">
          <div class="hf2-tg-bubble">
            <div class="hf2-tg-video">${art(2, 'guide')}<span class="hf2-tg-play">${ic.play}</span><span class="hf2-tg-dur">7:12</span></div>
            <div class="hf2-tg-caption"><span class="k">serie(1/3)</span>#<span class="n">Reino del océano</span>#<span class="d">Los delfines encuentran un mapa antiguo.</span> <span class="k">#infantil</span></div>
            <div class="hf2-tg-time">21:04 ✓✓</div>
          </div>
          <div class="hf2-tg-arrow">→</div>
          <div class="hf2-tg-result">
            <div class="hf2-tg-result-art">${art(2, 'guide2')}<span class="hf2-card-type">T1:E3</span><span class="hf2-card-kids">${ic.star}</span></div>
            <b>Reino del océano</b><small>Temporada 1 · Capítulo 3</small>
          </div>
        </div>
        <div class="hf2-formats">
          ${formats.map(([k, code, note]) => `<div class="hf2-format"><span class="hf2-format-k">${k}</span><code>${code}</code><span class="hf2-format-n">${note}</span></div>`).join('')}
        </div>
      </div>

      <div class="hf2-guide-card side">
        <div class="hf2-guide-head"><span class="hf2-guide-ic">${ic.tv}</span><div><b>Desde la TV</b><small>Para los videos que ya subiste sin comentario</small></div></div>
        <ol class="hf2-steps compact">
          <li><span>1</span><div>Abre la fila <b>Sin clasificar</b> en Inicio.</div></li>
          <li><span>2</span><div>Elige el video y pulsa <b>Etiquetar</b>.</div></li>
          <li><span>3</span><div>Con ◀ ▶ dices si es película o capítulo, la serie, la temporada y el capítulo.</div></li>
        </ol>
        <div class="hf2-mini-editor">
          <div class="hf2-mini-row"><span>Tipo</span><b>◀ Capítulo de serie ▶</b></div>
          <div class="hf2-mini-row on"><span>Serie</span><b>◀ Reino del océano ▶</b></div>
          <div class="hf2-mini-row"><span>Temporada · Capítulo</span><b>1 · 3</b></div>
          <div class="hf2-mini-row"><span>Infantil</span><b>${ic.star} Sí</b></div>
        </div>
        <div class="hf2-guide-note">${ic.tag}La etiqueta se guarda en esta TV y no cambia nada en Telegram.</div>
      </div>
    </div>

  </div>
  <div class="hf2-footer"><span>Puedes volver a esta guía desde la ayuda (?) en Ajustes</span><span class="keys">◀ ▶ Navegar · OK Seleccionar · BACK Cerrar</span></div>
</div>`;

writeFileSync(join(here, '10b-guide.html'), JSON.stringify({ label: 'Cómo etiquetar (guía)', html }));
console.log('propuesta 10b lista');
