// Enrutador por hash con atrás/adelante del navegador y enlaces que se pueden compartir.
// history.state.idx dice si un cambio es «avanzar» o «volver» (para la animación y el scroll).

const ROUTES = [
  // [patrón, vista, pestaña|null, raíz]
  ['login', 'login', null, true],
  ['login/qr', 'login-qr', null, false],
  ['login/numero', 'login-phone', null, false],
  ['login/codigo', 'login-code', null, false],
  ['login/clave', 'login-password', null, false],
  ['perfiles', 'profiles', null, true],
  ['perfiles/editar/:id', 'profile-edit', null, false],
  ['pin/:id', 'pin', null, false],
  ['inicio', 'home', 'inicio', true],
  ['peliculas', 'movies', 'peliculas', true],
  ['series', 'series', 'series', true],
  ['mi-lista', 'mylist', 'mi-lista', true],
  ['buscar', 'search', 'buscar', true],
  ['categorias', 'categories', undefined, false],
  ['categorias/:name', 'categories', undefined, false],
  ['titulo/:key', 'detail', undefined, false],
  ['ver/:key', 'player', null, false],
  ['ajustes', 'settings', undefined, false],
  ['cuenta', 'account', undefined, false],
  ['instalar', 'guide', undefined, false],
];

export function parse(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const segs = path.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(qs));
  for (const [pattern, view, tab, root] of ROUTES) {
    const ps = pattern.split('/');
    if (ps.length !== segs.length) continue;
    const params = {};
    let okay = true;
    ps.forEach((p, i) => {
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
      else if (p !== segs[i]) okay = false;
    });
    if (okay) return { view, tab, root, params, query, path: `/${path}`, hash: `#/${raw}` };
  }
  return null;
}

let onChange = () => {};
let idx = 0;

export function start(handler) {
  onChange = handler;
  idx = history.state?.idx ?? 0;
  if (history.state?.idx == null) history.replaceState({ idx }, '');
  window.addEventListener('popstate', (e) => {
    const next = e.state?.idx ?? 0;
    const dir = next < idx ? 'back' : 'forward';
    idx = next;
    onChange(dir);
  });
  onChange('none');
}

/** Ir a una ruta. `replace` no agrega al historial (por ejemplo, tras iniciar sesión). */
export function go(path, { replace = false, dir } = {}) {
  const hash = path.startsWith('#') ? path : `#${path.startsWith('/') ? '' : '/'}${path}`;
  if (hash === location.hash && !replace) return;
  if (replace) history.replaceState({ idx }, '', hash);
  else { idx += 1; history.pushState({ idx }, '', hash); }
  onChange(dir || (replace ? 'none' : 'forward'));
}

/** Volver. En la app instalada no hay botón atrás del navegador, así que siempre hay a dónde ir. */
export function back(fallback = '/inicio') {
  if (idx > 0) history.back();
  else go(fallback, { replace: true, dir: 'back' });
}

/** Cambia la consulta sin redibujar (por ejemplo, el texto de búsqueda). */
export function setQuery(query) {
  const r = parse();
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v)).toString();
  history.replaceState({ idx }, '', `#${r ? r.path : '/inicio'}${qs ? `?${qs}` : ''}`);
}

export const href = (path) => `#${path}`;
export const titleHref = (titleKey) => `#/titulo/${encodeURIComponent(titleKey)}`;
export const playHref = (key, t) => `#/ver/${encodeURIComponent(key)}${t ? `?t=${Math.floor(t)}` : ''}`;
