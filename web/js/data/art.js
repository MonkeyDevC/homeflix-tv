// Portadas y banners generados (SVG) para los datos de demostración.
// Imita HFTelegram.image(key, ancho) → promesa de URL. Con el motor real se cambia por esa función.

const meta = new Map(); // imageKey/bannerKey → { t, kind }

export function register(lib) {
  meta.clear();
  for (const t of Object.values(lib.titles)) {
    if (t.imageKey) meta.set(t.imageKey, { t, kind: 'portada' });
    if (t.bannerKey) meta.set(t.bannerKey, { t, kind: 'banner' });
  }
}

function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let x = seed || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; }; }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function hueOf(titleKey) { return hash(titleKey) % 360; }
/** Color de fondo tomado de la portada (en el motor real saldría de un canvas). */
export function color(titleKey, l = 18) { return `hsl(${hueOf(titleKey)} 42% ${l}%)`; }

function motif(t, W, H, r, h) {
  const cats = t.categories.join(' ').toLowerCase();
  const acc = `hsl(${(h + 38) % 360} 85% 68%)`;
  const acc2 = `hsl(${(h + 320) % 360} 75% 60%)`;
  let s = '';
  if (/ciencia|espacio/.test(cats)) {
    for (let i = 0; i < 60; i += 1) s += `<circle cx="${r() * W}" cy="${r() * H * 0.7}" r="${r() * 1.6 + 0.3}" fill="#fff" opacity="${0.3 + r() * 0.6}"/>`;
    const cx = W * (0.62 + r() * 0.2); const cy = H * 0.42; const R = H * 0.26;
    s += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#planet)"/>`;
    s += `<ellipse cx="${cx}" cy="${cy}" rx="${R * 1.7}" ry="${R * 0.32}" fill="none" stroke="${acc}" stroke-width="${H * 0.012}" opacity=".75" transform="rotate(-14 ${cx} ${cy})"/>`;
  } else if (/animaci/.test(cats)) {
    for (let i = 0; i < 14; i += 1) {
      const rad = H * (0.04 + r() * 0.14);
      s += `<circle cx="${r() * W}" cy="${H * 0.2 + r() * H * 0.6}" r="${rad}" fill="${i % 2 ? acc : acc2}" opacity="${0.35 + r() * 0.45}"/>`;
    }
  } else if (/suspenso|misterio/.test(cats)) {
    s += `<circle cx="${W * 0.72}" cy="${H * 0.3}" r="${H * 0.14}" fill="#f3efe6" opacity=".9"/>`;
    s += `<circle cx="${W * 0.72 + H * 0.05}" cy="${H * 0.28}" r="${H * 0.13}" fill="url(#bg)"/>`;
    for (let i = 0; i < 4; i += 1) s += `<rect x="${-W * 0.1}" y="${H * (0.55 + i * 0.09)}" width="${W * 1.2}" height="${H * 0.05}" rx="${H * 0.025}" fill="#fff" opacity="${0.05 + i * 0.03}"/>`;
  } else if (/acci/.test(cats)) {
    for (let i = 0; i < 9; i += 1) {
      const y = r() * H;
      s += `<rect x="${-W * 0.2 + r() * W * 0.5}" y="${y}" width="${W * (0.4 + r() * 0.6)}" height="${H * (0.006 + r() * 0.02)}" fill="${i % 3 ? acc : '#fff'}" opacity="${0.3 + r() * 0.5}" transform="rotate(-18 ${W / 2} ${H / 2})"/>`;
    }
    s += `<circle cx="${W * 0.7}" cy="${H * 0.45}" r="${H * 0.22}" fill="${acc2}" opacity=".35"/>`;
  } else if (/comedia|familia/.test(cats)) {
    for (let i = 0; i < 40; i += 1) {
      const x = r() * W; const y = r() * H * 0.75;
      s += `<rect x="${x}" y="${y}" width="${H * 0.03}" height="${H * 0.012}" rx="2" fill="${[acc, acc2, '#fff'][i % 3]}" opacity=".8" transform="rotate(${r() * 180} ${x} ${y})"/>`;
    }
    s += `<circle cx="${W * 0.25}" cy="${H * 0.35}" r="${H * 0.18}" fill="${acc}" opacity=".5"/>`;
  } else {
    s += `<circle cx="${W * (0.3 + r() * 0.4)}" cy="${H * 0.52}" r="${H * 0.2}" fill="${acc}" opacity=".85"/>`;
  }
  // Horizonte en capas
  for (let i = 0; i < 3; i += 1) {
    const base = H * (0.62 + i * 0.1);
    let d = `M0 ${H} L0 ${base}`;
    const steps = 6;
    for (let k = 1; k <= steps; k += 1) d += ` Q${(W / steps) * (k - 0.5)} ${base - H * (0.05 + r() * 0.12)} ${(W / steps) * k} ${base - r() * H * 0.03}`;
    d += ` L${W} ${H} Z`;
    s += `<path d="${d}" fill="hsl(${h} 40% ${10 - i * 2}%)" opacity="${0.6 + i * 0.2}"/>`;
  }
  return s;
}

function svg(t, kind) {
  const banner = kind === 'banner';
  const W = banner ? 1920 : 1280; const H = banner ? 1080 : 720;
  const h = hueOf(t.titleKey);
  const r = rng(hash(t.titleKey + kind));
  const title = esc(t.name);
  const size = Math.min(110, Math.round(1500 / Math.max(8, t.name.length)));
  const text = banner ? '' : `
    <rect x="0" y="${H * 0.55}" width="${W}" height="${H * 0.45}" fill="url(#fade)"/>
    <text x="64" y="${H - 70}" font-family="-apple-system, system-ui, 'Segoe UI', Roboto, sans-serif" font-weight="800" font-size="${size}" letter-spacing="-2" fill="#fff">${title}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${h} 55% 30%)"/><stop offset=".55" stop-color="hsl(${(h + 25) % 360} 50% 16%)"/><stop offset="1" stop-color="hsl(${(h + 50) % 360} 45% 7%)"/>
    </linearGradient>
    <radialGradient id="glow" cx=".7" cy=".3" r=".7"><stop offset="0" stop-color="hsl(${(h + 30) % 360} 90% 70%)" stop-opacity=".55"/><stop offset="1" stop-color="hsl(${h} 90% 70%)" stop-opacity="0"/></radialGradient>
    <radialGradient id="planet" cx=".35" cy=".35" r=".8"><stop offset="0" stop-color="hsl(${(h + 30) % 360} 70% 70%)"/><stop offset="1" stop-color="hsl(${h} 60% 18%)"/></radialGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".7"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  ${motif(t, W, H, r, h)}
  ${text}
</svg>`;
}

const cache = new Map();
/** Al pasar a la cuenta real: las portadas dibujadas de la demostración no deben taparle las de Telegram. */
export function clear() { meta.clear(); cache.clear(); }

/** Igual que HFTelegram.image: promesa de una URL de imagen para una clave de mensaje.
 * Demostración: portada dibujada. Cuenta real: la miniatura de Telegram (con la caché del motor). */
export function image(key) {
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  const m = meta.get(key);
  if (!m) {
    const T = globalThis.HFTelegram;
    if (!T || !T.available()) return Promise.reject(new Error('sin imagen'));
    return T.image(key, 640).then((url) => url || Promise.reject(new Error('sin imagen')));
  }
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg(m.t, m.kind))}`;
  cache.set(key, url);
  return Promise.resolve(url);
}
