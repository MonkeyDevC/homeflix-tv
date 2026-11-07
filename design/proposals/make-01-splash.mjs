// Genera design/proposals/01-splash.json-en-.html (mismo formato que las capturas: {label, html}).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { poster, POSTER_COUNT } from './posters.mjs';

const here = join(fileURLToPath(import.meta.url), '..');

const icon = {
  login: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H4"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  rocket: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0"/><path d="M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/></svg>',
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 18v3"/></svg>',
  picture: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  face: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/></svg>',
  party: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5.8 11.3L2 22l10.7-3.8"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="M22 2l-2.2.7a2 2 0 0 0-1.3 2.4l.1.4a2 2 0 0 1-1.3 2.4L15 8.6"/><path d="M11 13c1.9 1.9 2.8 4.2 2 5s-3.1-.1-5-2-2.8-4.2-2-5 3.1.1 5 2z"/></svg>',
};

// 7 columnas de 4 carátulas cada una; cada cinta se repite dos veces para que el movimiento no tenga cortes.
const COLS = 7;
const PER_COL = 4;
const wall = Array.from({ length: COLS }, (_, c) => {
  const ids = Array.from({ length: PER_COL }, (_, k) => (c * 5 + k * 3) % POSTER_COUNT);
  const tiles = ids.map((i) => `<div class="hf2-tile">${poster(i)}</div>`).join('');
  return `<div class="hf2-col ${c % 2 ? 'down' : 'up'}"><div class="hf2-reel">${tiles}${tiles}</div></div>`;
}).join('');

const cats = [
  ['Película<br>reciente', 'Acción', icon.rocket, true],
  ['Serie<br>popular', 'Drama', icon.tv],
  ['Película<br>familiar', 'Aventura', icon.picture],
  ['Serie<br>animada', 'Niños', icon.face],
  ['Estreno', 'Familia', icon.party],
];

const html = `<div class="hf2" data-route="splash">
  <div class="hf2-wall">${wall}</div>
  <div class="hf2-shade"></div>

  <div class="hf2-brand"><div class="hf2-logo"></div><div class="hf2-wordmark">Home<span>Flix</span></div></div>
  <div class="hf2-top-actions">
    <div class="hf2-round" data-focusable="true" data-title="Ajustes">${icon.gear}</div>
  </div>

  <div class="hf2-hero">
    <h1>Disfruta películas y<br>series sin límites.</h1>
    <p>Contenido familiar, series y películas seleccionadas para ver desde tu televisor.</p>
    <div class="hf2-ctas">
      <div class="hf2-btn primary" data-focusable="true" data-focused="true">Iniciar sesión</div>
    </div>
  </div>

  <div class="hf2-footer"><span>Pulsa OK para iniciar sesión con Telegram</span><span class="keys">OK Seleccionar · ▲ Ajustes</span></div>
</div>`;

writeFileSync(join(here, '01-splash.html'), JSON.stringify({ label: 'Pantalla inicial', html }));
console.log('design/proposals/01-splash.html listo');
