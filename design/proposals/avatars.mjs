// Avatares prediseñados de HomeFlix (SVG, sin imágenes externas). avatar(id) → <svg> cuadrado.
// Cada uno trae su fondo; en la app se elegirían desde el editor de perfil.

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

export const AVATAR_IDS = Object.keys(FACES);
export const AVATAR_NAMES = {
  panda: 'Panda', zorro: 'Zorro', buho: 'Búho', dino: 'Dino', robot: 'Robot', astro: 'Astronauta',
  gato: 'Gato', conejo: 'Conejo', oso: 'Oso', pinguino: 'Pingüino', rana: 'Rana', leon: 'León',
};

export function avatar(id) {
  const [a, b] = BG[id];
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="av-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="120" height="120" fill="url(#av-${id})"/><g transform="translate(0 6)">${FACES[id]}</g></svg>`;
}
