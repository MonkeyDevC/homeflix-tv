// Tablero de diseño de HomeFlix: junta las capturas de design/snapshots/ (HTML real de cada pantalla)
// con el CSS real de la app y genera design/index.html para revisar todas las vistas a la vez.
// Uso: node design/build.mjs   → abrir http://localhost:5173/design/
//
// Las propuestas nuevas van en design/proposals/<mismo-nombre>.html (mismo formato que las capturas)
// y se muestran al lado de la versión actual.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(fileURLToPath(import.meta.url), '..');
const root = join(here, '..');

const GROUPS = [
  { title: 'Acceso', ids: ['01-splash', '02-login-qr', '03-login-api'] },
  { title: 'Perfiles y ajustes', ids: ['04-profiles', '05-profile-edit', '06-settings', '06b-settings-help'] },
  { title: 'Catálogo', ids: ['07-browse-home', '08-browse-rows', '09-browse-series', '09b-browse-movies', '10-browse-empty', '10b-guide', '16-search'] },
  { title: 'Fichas', ids: ['11-detail-movie', '12-detail-series', '13-detail-episodes', '14-detail-video', '15-tag-edit'] },
  { title: 'Reproductor', ids: ['17-player', '17b-player-episodes', '18-player-tracks', '19-player-next'] },
];

const appCss = ['style.css', 'screens.css', 'profiles.css']
  .map((f) => readFileSync(join(root, 'css', f), 'utf8'))
  .join('\n')
  .replace(/url\((['"]?)(?!data:|https?:|\.\.\/)/g, 'url($1../');
// proposal.css primero (variables y piezas comunes), luego el resto de proposals/*.css
const proposalDir = join(here, 'proposals');
const proposalCss = existsSync(proposalDir)
  ? readdirSync(proposalDir).filter((f) => f.endsWith('.css')).sort((a, b) => (a === 'proposal.css' ? -1 : b === 'proposal.css' ? 1 : a.localeCompare(b)))
    .map((f) => readFileSync(join(proposalDir, f), 'utf8')).join('\n')
  : '';

function load(dir, id) {
  const file = join(here, dir, id + '.html');
  if (!existsSync(file)) return null;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  // rutas de imágenes relativas a la app → relativas a design/
  data.html = data.html.replace(/src="images\//g, 'src="../images/');
  return data;
}

function frame(id, data, kind) {
  return `<figure class="frame ${kind}" data-id="${id}">
  <div class="viewport"><div class="stage ${kind === 'proposal' ? 'proposal-stage' : 'current-stage'}">${data.html}</div></div>
  <figcaption><span class="tag ${kind}">${kind === 'proposal' ? 'Propuesta' : 'Actual'}</span> ${id.slice(0, 2)} · ${data.label}</figcaption>
</figure>`;
}

const sections = GROUPS.map((g) => {
  const items = g.ids.map((id) => {
    const cur = load('snapshots', id);
    const prop = load('proposals', id);
    if (!cur && !prop) return '';
    return `<div class="pair">${cur ? frame(id, cur, 'current') : ''}${prop ? frame(id, prop, 'proposal') : ''}</div>`;
  }).join('\n');
  return `<section><h2>${g.title}</h2>${items}</section>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<title>HomeFlix · Tablero de diseño</title>
<style>
/* ===== CSS real de la app, aislado dentro de .current-stage ===== */
${appCss}
/* ===== CSS de las propuestas ===== */
${proposalCss}

/* ===== Tablero ===== */
html, body { overflow: auto !important; height: auto !important; background: #0b0f0d !important; }
body.board { margin: 0; padding: 40px 48px 120px; font-family: Arial, Helvetica, sans-serif; color: #e8ecea; }
.board-head { display: flex; align-items: flex-end; gap: 40px; margin-bottom: 30px; }
.board-head h1 { margin: 0; font-size: 34px; }
.board-head h1 b { color: #ffd400; }
.board-head p { margin: 8px 0 0; color: #9aa59f; font-size: 16px; max-width: 900px; line-height: 1.5; }
.reference { margin-left: auto; text-align: right; }
.reference img { width: 420px; border-radius: 10px; border: 2px solid #ffd400; display: block; }
.reference span { font-size: 13px; color: #9aa59f; }
section { margin-top: 44px; }
section h2 { font-size: 22px; margin: 0 0 18px; padding-bottom: 8px; border-bottom: 1px solid #26302b; color: #ffd400; letter-spacing: 1px; text-transform: uppercase; }
.pair { display: flex; gap: 28px; margin-bottom: 30px; flex-wrap: wrap; }
.frame { margin: 0; width: 864px; cursor: zoom-in; }
.viewport { width: 864px; height: 486px; overflow: hidden; border-radius: 10px; border: 1px solid #2c3631; position: relative; background: #000; }
.stage { width: 1920px; height: 1080px; transform: scale(0.45); transform-origin: 0 0; position: relative; overflow: hidden; }
.stage #app { width: 1920px !important; height: 1080px !important; position: relative !important; }
.stage .screen { display: block; }
figcaption { margin-top: 10px; font-size: 15px; color: #c9d1cd; }
.tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; margin-right: 6px; }
.tag.current { background: #33403a; color: #c9d1cd; }
.tag.proposal { background: #ffd400; color: #06120d; }
/* Vista ampliada al hacer clic */
.frame.zoom { position: fixed; z-index: 1000; inset: 0; width: auto; background: rgba(0,0,0,.92); display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: zoom-out; }
.frame.zoom .viewport { width: var(--zw); height: var(--zh); }
.frame.zoom .stage { transform: scale(var(--zs)); }
</style>
</head>
<body class="board">
<div class="board-head">
  <div>
    <h1><b>HomeFlix</b> · Tablero de diseño</h1>
    <p>Cada pantalla está pintada con el HTML y el CSS reales de la app a 1920×1080 (datos de demostración). Clic en una pantalla para verla grande. Las propuestas aparecen al lado de la versión actual a medida que las diseñemos.</p>
  </div>
  <div class="reference"><img src="reference/estilo-objetivo.png" alt="Estilo objetivo"/><span>Estilo objetivo (referencia)</span></div>
</div>
${sections}
<script>
document.addEventListener('click', function (e) {
  var f = e.target.closest('.frame');
  if (!f) return;
  if (f.classList.contains('zoom')) { f.classList.remove('zoom'); return; }
  var s = Math.min((innerWidth - 60) / 1920, (innerHeight - 80) / 1080);
  f.style.setProperty('--zs', s); f.style.setProperty('--zw', (1920 * s) + 'px'); f.style.setProperty('--zh', (1080 * s) + 'px');
  f.classList.add('zoom');
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var z = document.querySelector('.frame.zoom'); if (z) z.classList.remove('zoom'); } });
</script>
</body>
</html>
`;

writeFileSync(join(here, 'index.html'), html);
console.log('design/index.html listo');
