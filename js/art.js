/* Arte de HomeFlix dibujado en SVG (sin imágenes externas): carátulas ilustradas para el mosaico de la
 * pantalla inicial (cuando la biblioteca todavía no tiene portadas) y los 12 avatares de perfil.
 * Generado desde design/proposals/posters.mjs y avatars.mjs (mismo dibujo que el tablero de diseño).
 *   HFArt.poster(i) / HFArt.art(i, clave) / HFArt.posterTitle(i) / HFArt.POSTER_COUNT
 *   HFArt.avatar(id) / HFArt.AVATAR_IDS / HFArt.AVATAR_NAMES */
var HFArt = (function () {
  "use strict";

const P = [
  { t: 'VIAJE ESPACIAL', k: 'UNA AVENTURA ENTRE ESTRELLAS', sky: ['#0b1030', '#2a1b5c', '#6b3fa0'], scene: 'space' },
  { t: 'BOSQUE MÁGICO', k: 'EL SECRETO DE LAS LUCES', sky: ['#0c2a22', '#1f5a3e', '#9fd38a'], scene: 'forest' },
  { t: 'REINO DEL OCÉANO', k: 'BAJO LAS OLAS', sky: ['#05253f', '#0f6e8c', '#7fd6e0'], scene: 'ocean' },
  { t: 'CIUDAD NEÓN', k: 'NADA ES LO QUE PARECE', sky: ['#14051f', '#4a0f5c', '#e0457a'], scene: 'city' },
  { t: 'MONTAÑA LEJANA', k: 'EL VIAJE DE UNA FAMILIA', sky: ['#1f2f4d', '#d9895a', '#f6d29a'], scene: 'mountain' },
  { t: 'CABAÑA NEVADA', k: 'UNA NAVIDAD INOLVIDABLE', sky: ['#1a2a44', '#5b7aa6', '#dbe7f3'], scene: 'snow' },
  { t: 'ISLA SECRETA', k: 'EL MAPA PERDIDO', sky: ['#0e3b52', '#2aa3b8', '#f3d58c'], scene: 'island' },
  { t: 'CASTILLO VIOLETA', k: 'UNA LEYENDA DE VALOR', sky: ['#1c0f33', '#5b2a86', '#c79bf2'], scene: 'castle' },
  { t: 'LUCES NOCTURNAS', k: 'UNA NOCHE EN LA CARRETERA', sky: ['#060a14', '#1a2a4a', '#f2a541'], scene: 'road' },
  { t: 'AVENTURA LUNAR', k: 'LA IMAGINACIÓN NO TIENE GRAVEDAD', sky: ['#020409', '#16213a', '#39507a'], scene: 'moon' },
  { t: 'TESORO DORADO', k: 'LA AMISTAD VALE MÁS', sky: ['#2b1606', '#8a4b12', '#f2c14e'], scene: 'desert' },
  { t: 'ROBOT VIAJERO', k: 'BUSCANDO EL CAMINO A CASA', sky: ['#13201f', '#2e5b57', '#9ed9c9'], scene: 'robot' },
];

function stars(n, seed, h) {
  let s = seed;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  let out = '';
  for (let i = 0; i < n; i++) out += `<circle cx="${(r() * 300).toFixed(0)}" cy="${(r() * h).toFixed(0)}" r="${(r() * 1.6 + 0.4).toFixed(1)}" fill="#fff" opacity="${(r() * 0.7 + 0.3).toFixed(2)}"/>`;
  return out;
}

const SCENES = {
  space: () => `${stars(60, 3, 300)}<circle cx="210" cy="120" r="62" fill="#f08a5d"/><ellipse cx="210" cy="120" rx="100" ry="18" fill="none" stroke="#ffd29a" stroke-width="5" opacity=".8"/><circle cx="70" cy="210" r="22" fill="#7cc6fe"/><path d="M120 330 l18 -60 l18 60 z" fill="#e8e8f0"/><path d="M128 330 l10 30 l10 -30z" fill="#ff9f43"/>`,
  forest: () => `<circle cx="150" cy="120" r="48" fill="#f6f2b8" opacity=".9"/>${[20, 70, 120, 170, 220, 270].map((x, i) => `<path d="M${x} ${330 - (i % 2) * 30} l35 -140 l35 140z" fill="${i % 2 ? '#123d2c' : '#0b2a1f'}"/>`).join('')}${[60, 140, 230].map((x) => `<circle cx="${x}" cy="240" r="4" fill="#fff59d"/>`).join('')}`,
  ocean: () => `<circle cx="220" cy="90" r="40" fill="#fff3c4"/><path d="M0 230 q40 -20 75 0 t75 0 t75 0 t75 0 V450 H0z" fill="#0a4f6b"/><path d="M0 270 q40 -20 75 0 t75 0 t75 0 t75 0 V450 H0z" fill="#063a52"/><path d="M110 300 q30 -40 70 0 q-35 25 -70 0z" fill="#ffb347"/><circle cx="165" cy="295" r="3" fill="#222"/>`,
  city: () => `<circle cx="80" cy="90" r="34" fill="#ffd1e6" opacity=".85"/>${[[0, 170, 50], [45, 120, 40], [80, 190, 60], [135, 90, 45], [175, 150, 55], [225, 110, 40], [260, 175, 45]].map(([x, h, w]) => `<rect x="${x}" y="${330 - h}" width="${w}" height="${h + 120}" fill="#1a0b26"/>`).join('')}${stars(40, 7, 300).replace(/#fff/g, '#ffd166')}`,
  mountain: () => `<circle cx="150" cy="150" r="52" fill="#fff1c9"/><path d="M-10 330 L90 170 L160 260 L230 150 L320 330z" fill="#3a3550"/><path d="M-10 360 L70 260 L150 340 L240 240 L320 360z" fill="#272338"/><path d="M90 170 l18 30 l-14 -6 l-12 8z" fill="#fff"/>`,
  snow: () => `${stars(50, 11, 330).replace(/r="([\d.]+)"/g, 'r="2"')}<path d="M0 330 q150 -50 300 0 V450 H0z" fill="#eef4fb"/><rect x="105" y="250" width="90" height="62" fill="#6b3f2a"/><path d="M95 255 l55 -45 l55 45z" fill="#f4f7fb"/><rect x="138" y="275" width="22" height="22" fill="#ffd27a"/>`,
  island: () => `<circle cx="80" cy="100" r="36" fill="#fff4b0"/><path d="M0 260 H300 V450 H0z" fill="#147a8f"/><ellipse cx="160" cy="262" rx="95" ry="22" fill="#f1d189"/><path d="M160 260 q-5 -60 8 -110" stroke="#5b3a1e" stroke-width="7" fill="none"/><path d="M168 150 q-45 -10 -70 15 M168 150 q40 -20 70 5 M168 150 q-20 -35 -50 -40 M168 150 q25 -30 55 -30" stroke="#2f8a3c" stroke-width="9" fill="none" stroke-linecap="round"/>`,
  castle: () => `${stars(35, 5, 250)}<circle cx="225" cy="90" r="28" fill="#fdf2ff"/><path d="M60 330 V200 h25 v-20 h15 v20 h20 v-60 h20 v-25 l15 -25 l15 25 v25 h20 v60 h20 v-20 h15 v20 h25 V330z" fill="#2a1446"/><rect x="138" y="270" width="24" height="60" rx="12" fill="#ffd27a"/>`,
  road: () => `<path d="M150 200 L20 450 H280z" fill="#151a22"/><path d="M150 200 l-4 250 h8z" fill="#f2c14e" opacity=".8"/><circle cx="150" cy="190" r="70" fill="#f2a541" opacity=".25"/>${[110, 190].map((x) => `<circle cx="${x}" cy="330" r="10" fill="#fff6d6"/>`).join('')}${stars(30, 9, 180)}`,
  moon: () => `${stars(70, 13, 450)}<circle cx="150" cy="170" r="90" fill="#d8dde8"/><circle cx="120" cy="140" r="16" fill="#b7bfcf"/><circle cx="180" cy="200" r="22" fill="#b7bfcf"/><circle cx="170" cy="120" r="9" fill="#b7bfcf"/><path d="M60 320 l20 -40 h20 l20 40z" fill="#eaeaf2"/><circle cx="90" cy="268" r="14" fill="#eaeaf2"/><circle cx="90" cy="268" r="8" fill="#7cc6fe"/>`,
  desert: () => `<circle cx="150" cy="140" r="58" fill="#ffe08a"/><path d="M0 290 q80 -50 160 0 t160 0 V450 H0z" fill="#c9792b"/><path d="M0 320 q90 -40 170 5 t150 -5 V450 H0z" fill="#9c5a1c"/><rect x="128" y="250" width="44" height="30" rx="4" fill="#6b3a12"/><rect x="124" y="244" width="52" height="10" rx="3" fill="#f2c14e"/>`,
  robot: () => `<circle cx="230" cy="90" r="30" fill="#e6fff8" opacity=".85"/><path d="M0 330 q150 -30 300 0 V450 H0z" fill="#1d3a37"/><rect x="115" y="200" width="70" height="80" rx="12" fill="#cfd8dc"/><rect x="125" y="160" width="50" height="40" rx="10" fill="#eceff1"/><circle cx="140" cy="180" r="6" fill="#26c6da"/><circle cx="160" cy="180" r="6" fill="#26c6da"/><path d="M150 160 v-14" stroke="#eceff1" stroke-width="3"/><circle cx="150" cy="144" r="4" fill="#ff7043"/><rect x="122" y="280" width="18" height="30" rx="5" fill="#b0bec5"/><rect x="160" y="280" width="18" height="30" rx="5" fill="#b0bec5"/>`,
};

const POSTER_COUNT = P.length;

function poster(i) {
  const p = P[i % P.length];
  const id = 'g' + i;
  const words = p.t.split(' ');
  const lines = words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [p.t];
  return `<svg viewBox="0 0 300 450" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset=".6" stop-color="${p.sky[1]}"/><stop offset="1" stop-color="${p.sky[2]}"/></linearGradient>
<linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".85"/></linearGradient></defs>
<rect width="300" height="450" fill="url(#${id})"/>
${SCENES[p.scene]()}
<rect width="300" height="450" fill="url(#${id}f)"/>
<text x="150" y="32" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="11" letter-spacing="2" fill="#fff" opacity=".75">${p.k}</text>
${lines.map((l, n) => `<text x="150" y="${392 + n * 34 - (lines.length - 1) * 17}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${l.length > 9 ? 28 : 32}" fill="#fff">${l}</text>`).join('')}
<text x="150" y="436" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" letter-spacing="3" fill="#fff" opacity=".6">HOMEFLIX ORIGINAL</text>
</svg>`;
}

/** Solo la escena (sin títulos), para tarjetas 16:9 y fondos. Se recorta al centro con slice. */
function art(i, key = 'a') {
  const p = P[i % P.length];
  const id = 'ga' + key + i;
  return `<svg viewBox="0 40 300 300" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset=".6" stop-color="${p.sky[1]}"/><stop offset="1" stop-color="${p.sky[2]}"/></linearGradient></defs>
<rect y="-200" width="300" height="900" fill="url(#${id})"/>${SCENES[p.scene]()}</svg>`;
}

function posterTitle(i) {
  const t = P[i % P.length].t.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}


const BG = {
  panda: ['#f0d2a8', '#b88552'],
  zorro: ['#5d7fb3', '#2b3d5e'],
  buho: ['#a283c7', '#4a3366'],
  dino: ['#8fb07a', '#3b5532'],
  robot: ['#6fb3b0', '#2c5654'],
  astro: ['#34406b', '#121733'],
  gato: ['#d9776d', '#6e2b26'],
  conejo: ['#e7a6c0', '#8a4a66'],
  oso: ['#c08a62', '#5c3a24'],
  pinguino: ['#7fb8e0', '#2b5a80'],
  rana: ['#b8d36b', '#4f6b22'],
  leon: ['#f2b84b', '#a5621a'],
};

const FACES = {
  panda: `<circle cx="34" cy="34" r="15" fill="#1d1d1f"/><circle cx="86" cy="34" r="15" fill="#1d1d1f"/><circle cx="60" cy="64" r="38" fill="#fff"/><ellipse cx="45" cy="60" rx="11" ry="14" fill="#1d1d1f" transform="rotate(-20 45 60)"/><ellipse cx="75" cy="60" rx="11" ry="14" fill="#1d1d1f" transform="rotate(20 75 60)"/><circle cx="46" cy="58" r="4" fill="#fff"/><circle cx="74" cy="58" r="4" fill="#fff"/><ellipse cx="60" cy="76" rx="7" ry="5" fill="#1d1d1f"/><path d="M53 84 q7 6 14 0" stroke="#1d1d1f" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  zorro: `<path d="M22 22 L44 46 L30 58z" fill="#e8762f"/><path d="M98 22 L76 46 L90 58z" fill="#e8762f"/><path d="M60 100 L24 54 Q60 30 96 54z" fill="#f08a3c"/><path d="M60 100 L40 70 Q60 80 80 70z" fill="#fff"/><circle cx="46" cy="62" r="5" fill="#1d1d1f"/><circle cx="74" cy="62" r="5" fill="#1d1d1f"/><circle cx="60" cy="92" r="5" fill="#1d1d1f"/>`,
  buho: `<path d="M30 30 L44 44 L28 46z" fill="#6b4a2f"/><path d="M90 30 L76 44 L92 46z" fill="#6b4a2f"/><ellipse cx="60" cy="68" rx="36" ry="38" fill="#8a6142"/><ellipse cx="60" cy="80" rx="22" ry="22" fill="#d9b48a"/><circle cx="45" cy="58" r="15" fill="#fff"/><circle cx="75" cy="58" r="15" fill="#fff"/><circle cx="45" cy="58" r="7" fill="#1d1d1f"/><circle cx="75" cy="58" r="7" fill="#1d1d1f"/><path d="M55 70 L65 70 L60 80z" fill="#f2a541"/>`,
  dino: `<path d="M30 40 l8 -14 l8 12 l8 -14 l8 12 l8 -14 l8 12 l8 -12 l4 18z" fill="#2f7a3a"/><rect x="26" y="38" width="68" height="62" rx="30" fill="#5fbf6b"/><circle cx="46" cy="62" r="9" fill="#fff"/><circle cx="74" cy="62" r="9" fill="#fff"/><circle cx="47" cy="63" r="4" fill="#1d1d1f"/><circle cx="73" cy="63" r="4" fill="#1d1d1f"/><path d="M44 84 q16 12 32 0" stroke="#1d5a28" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="52" cy="80" r="2" fill="#1d5a28"/><circle cx="68" cy="80" r="2" fill="#1d5a28"/>`,
  robot: `<path d="M60 22 v12" stroke="#cfd8dc" stroke-width="4"/><circle cx="60" cy="20" r="6" fill="#ff7043"/><rect x="28" y="34" width="64" height="58" rx="14" fill="#eceff1"/><rect x="36" y="46" width="48" height="26" rx="8" fill="#263238"/><circle cx="49" cy="59" r="6" fill="#4dd0e1"/><circle cx="71" cy="59" r="6" fill="#4dd0e1"/><rect x="46" y="80" width="28" height="5" rx="2.5" fill="#90a4ae"/><rect x="20" y="54" width="8" height="18" rx="3" fill="#b0bec5"/><rect x="92" y="54" width="8" height="18" rx="3" fill="#b0bec5"/>`,
  astro: `<circle cx="20" cy="22" r="1.6" fill="#fff"/><circle cx="100" cy="30" r="1.4" fill="#fff"/><circle cx="96" cy="96" r="1.2" fill="#fff"/><circle cx="60" cy="62" r="38" fill="#eceff1"/><rect x="34" y="44" width="52" height="38" rx="19" fill="#1c2747"/><path d="M42 54 q8 -8 18 -6" stroke="#7fb8e0" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="51" cy="66" r="4" fill="#fff"/><circle cx="69" cy="66" r="4" fill="#fff"/><path d="M53 74 q7 5 14 0" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
  gato: `<path d="M28 26 L46 44 L28 56z" fill="#3a3a3c"/><path d="M92 26 L74 44 L92 56z" fill="#3a3a3c"/><circle cx="60" cy="66" r="36" fill="#4a4a4d"/><ellipse cx="47" cy="62" rx="7" ry="9" fill="#c6e86b"/><ellipse cx="73" cy="62" rx="7" ry="9" fill="#c6e86b"/><ellipse cx="47" cy="62" rx="2.5" ry="7" fill="#1d1d1f"/><ellipse cx="73" cy="62" rx="2.5" ry="7" fill="#1d1d1f"/><path d="M56 76 h8 l-4 5z" fill="#f4a3b5"/><path d="M30 78 h18 M30 84 h18 M72 78 h18 M72 84 h18" stroke="#9e9ea2" stroke-width="2"/>`,
  conejo: `<ellipse cx="45" cy="30" rx="9" ry="24" fill="#fff"/><ellipse cx="75" cy="30" rx="9" ry="24" fill="#fff"/><ellipse cx="45" cy="32" rx="4" ry="16" fill="#f4a3b5"/><ellipse cx="75" cy="32" rx="4" ry="16" fill="#f4a3b5"/><circle cx="60" cy="72" r="32" fill="#fff"/><circle cx="48" cy="68" r="4" fill="#1d1d1f"/><circle cx="72" cy="68" r="4" fill="#1d1d1f"/><ellipse cx="60" cy="80" rx="5" ry="3.5" fill="#f4a3b5"/><circle cx="42" cy="82" r="5" fill="#ffd1dc"/><circle cx="78" cy="82" r="5" fill="#ffd1dc"/>`,
  oso: `<circle cx="32" cy="36" r="14" fill="#7a4e2d"/><circle cx="88" cy="36" r="14" fill="#7a4e2d"/><circle cx="32" cy="36" r="6" fill="#c08a62"/><circle cx="88" cy="36" r="6" fill="#c08a62"/><circle cx="60" cy="66" r="38" fill="#8d5b36"/><ellipse cx="60" cy="80" rx="18" ry="14" fill="#d9a77c"/><circle cx="46" cy="60" r="5" fill="#1d1d1f"/><circle cx="74" cy="60" r="5" fill="#1d1d1f"/><ellipse cx="60" cy="74" rx="6" ry="4.5" fill="#1d1d1f"/>`,
  pinguino: `<ellipse cx="60" cy="66" rx="38" ry="40" fill="#1f2a36"/><ellipse cx="60" cy="74" rx="26" ry="28" fill="#fff"/><circle cx="49" cy="60" r="5" fill="#1d1d1f"/><circle cx="71" cy="60" r="5" fill="#1d1d1f"/><circle cx="50" cy="58" r="1.6" fill="#fff"/><circle cx="72" cy="58" r="1.6" fill="#fff"/><path d="M52 70 L68 70 L60 80z" fill="#f2a541"/><circle cx="42" cy="76" r="5" fill="#ffc1cc"/><circle cx="78" cy="76" r="5" fill="#ffc1cc"/>`,
  rana: `<circle cx="40" cy="40" r="15" fill="#6fbf4a"/><circle cx="80" cy="40" r="15" fill="#6fbf4a"/><circle cx="40" cy="40" r="8" fill="#fff"/><circle cx="80" cy="40" r="8" fill="#fff"/><circle cx="41" cy="41" r="4" fill="#1d1d1f"/><circle cx="79" cy="41" r="4" fill="#1d1d1f"/><ellipse cx="60" cy="72" rx="40" ry="30" fill="#6fbf4a"/><path d="M38 76 q22 18 44 0" stroke="#2f5f1c" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="34" cy="70" r="5" fill="#ff9aa8" opacity=".7"/><circle cx="86" cy="70" r="5" fill="#ff9aa8" opacity=".7"/>`,
  leon: `<circle cx="60" cy="62" r="44" fill="#b86a1d"/>${Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return `<circle cx="${(60 + Math.cos(a) * 40).toFixed(1)}" cy="${(62 + Math.sin(a) * 40).toFixed(1)}" r="10" fill="#9a5414"/>`; }).join('')}<circle cx="60" cy="64" r="30" fill="#f2c063"/><circle cx="50" cy="58" r="4.5" fill="#1d1d1f"/><circle cx="70" cy="58" r="4.5" fill="#1d1d1f"/><path d="M54 70 h12 l-6 6z" fill="#6b3a12"/><path d="M60 76 q-6 6 -10 3 M60 76 q6 6 10 3" stroke="#6b3a12" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
};

const AVATAR_IDS = Object.keys(FACES);
const AVATAR_NAMES = {
  panda: 'Panda', zorro: 'Zorro', buho: 'Búho', dino: 'Dino', robot: 'Robot', astro: 'Astronauta',
  gato: 'Gato', conejo: 'Conejo', oso: 'Oso', pinguino: 'Pingüino', rana: 'Rana', leon: 'León',
};

function avatar(id) {
  const [a, b] = BG[id];
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="av-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="120" height="120" fill="url(#av-${id})"/><g transform="translate(0 6)">${FACES[id]}</g></svg>`;
}

  return { poster: poster, art: art, posterTitle: posterTitle, POSTER_COUNT: POSTER_COUNT, avatar: avatar, AVATAR_IDS: AVATAR_IDS, AVATAR_NAMES: AVATAR_NAMES };
})();
