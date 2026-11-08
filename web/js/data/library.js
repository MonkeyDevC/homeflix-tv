// HFLibrary para la web: adaptador sobre el motor compartido (../js/library.js, global window.HFLibrary).
//
// Las pantallas de la web usan una forma de datos propia (t.video = clave, t.duration, versiones con slot = calidad,
// byKey → {titleKey, slot, main}). Aquí se arma la biblioteca con el motor real y se traduce a esa forma, con las
// MISMAS claves de título y de video que la TV y el celular: así Mi lista, el progreso y los perfiles se guardan donde
// los guarda el motor y se sincronizan entre dispositivos (js/sync.js).
// La cuenta «demo» y el tablero (?design=) usan la misma lógica con datos de demostración.

const E = globalThis.HFLibrary; // el motor (script clásico cargado antes que los módulos)

// ---------- Almacenamiento propio de la web (solo preferencias y la sesión recordada) ----------
const mem = new Map();
const store = {
  get(k, def) {
    try {
      const v = globalThis.localStorage ? localStorage.getItem(k) : mem.get(k);
      return v == null ? def : JSON.parse(v);
    } catch { return def; }
  },
  set(k, v) {
    const s = JSON.stringify(v);
    try { if (globalThis.localStorage) localStorage.setItem(k, s); else mem.set(k, s); } catch { mem.set(k, s); }
  },
  del(k) { try { globalThis.localStorage ? localStorage.removeItem(k) : mem.delete(k); } catch { mem.delete(k); } },
};

let account = store.get('hf.web.account', null);
let profileId = null;
if (account) E.setAccount(account);
const ak = (name) => `hf.web.${account || 'demo'}.${name}`;
const pk = (name) => `hf.web.${account || 'demo'}.${profileId || 'none'}.${name}`;

// ---------- Comentarios (los lee el motor; esto es para la guía y el preparador) ----------
export function parseCaption(caption) {
  const c = E.parseCaption(caption);
  if (!c) return null;
  return { ...c, title: c.episodeTitle || '', image: c.image || null };
}
export function composeCaption(t) {
  return E.composeCaption({ ...t, episodeTitle: t.title });
}
export function qualityOf(fileName, height) {
  const m = /\[(\d{3,4})p\]|\b(2160|1080|720|480|360)p\b/i.exec(fileName || '');
  const h = m ? +(m[1] || m[2]) : height || 1080;
  return h >= 2000 ? '4K' : h >= 1000 ? '1080p' : h >= 700 ? '720p' : h >= 450 ? '480p' : '360p';
}

export function partOf(fileName) {
  const m = /parte\s+(\d+)\s+de\s+(\d+)/i.exec(fileName || '');
  return m ? { part: +m[1], pieces: +m[2] } : { part: 1, pieces: 1 };
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// ---------- Biblioteca: motor real → forma de la web ----------
let real = null; // última biblioteca del motor (el reproductor la usa para abrir el video real)

function webVersion(v) {
  const parts = (v.parts || []).map((p, i) => ({ key: p.key, dur: p.dur || 0, size: p.size || 0, idx: i + 1 }));
  return { slot: v.q, q: v.q, h: v.h || 0, n: v.n || parts.length, pieces: v.n || parts.length, parts, dur: v.dur || 0, size: v.size || 0, bps: v.bps || 0 };
}
function webVersions(list) {
  const out = [];
  for (const v of (list || []).slice().sort((a, b) => (b.h || 0) - (a.h || 0))) {
    if (!out.some((x) => x.slot === v.q)) out.push(webVersion(v)); // una por calidad
  }
  return out;
}

export function build(items) {
  real = E.build(items || [], E.tags());
  const titles = {};
  const byKey = {};
  const movies = [];
  const series = [];
  for (const m of real.movies) {
    const versions = webVersions(m.versions);
    const video = m.video.key; // el video «de identidad»: el mismo que usan la TV y el celular para el progreso
    const t = {
      type: 'movie', titleKey: m.titleKey, name: m.name, year: m.year, description: m.description || '', kids: !!m.kids,
      categories: (m.categories || []).slice(), video, versions, quality: versions[0] ? versions[0].q : m.quality,
      duration: m.video.duration || (versions[0] && versions[0].dur) || 0, imageKey: m.imageKey || null, bannerKey: m.bannerKey || null,
      date: m.date || 0, chatTitle: m.video.chatTitle || '',
    };
    for (const v of versions) for (const p of v.parts) byKey[p.key] = { titleKey: t.titleKey, slot: v.slot };
    byKey[video] = { ...(byKey[video] || { titleKey: t.titleKey, slot: t.quality }), main: true };
    titles[t.titleKey] = t;
    movies.push(t);
  }
  for (const s of real.series) {
    const t = {
      type: 'series', titleKey: s.titleKey, name: s.name, year: s.year || 0, description: s.description || '', kids: !!s.kids,
      categories: (s.categories || []).slice(), seasons: [], imageKey: s.imageKey || null, bannerKey: s.bannerKey || null,
      date: s.date || 0, chatTitle: '', quality: null,
    };
    for (const season of s.seasons) {
      const eps = [];
      for (const e of season.episodes) {
        const versions = webVersions(e.versions);
        const video = e.video ? e.video.key : e.key;
        const ep = {
          key: video, video, season: e.season, episode: e.episode, title: e.title || '', description: e.description || '',
          versions, titleKey: t.titleKey, duration: (e.video && e.video.duration) || (versions[0] && versions[0].dur) || 0,
          quality: versions[0] ? versions[0].q : e.quality,
        };
        for (const v of versions) for (const p of v.parts) byKey[p.key] = { titleKey: t.titleKey, slot: v.slot, season: ep.season, episode: ep.episode };
        byKey[video] = { ...(byKey[video] || { titleKey: t.titleKey, season: ep.season, episode: ep.episode }), main: true };
        if (!t.chatTitle && e.video) t.chatTitle = e.video.chatTitle || '';
        eps.push(ep);
      }
      t.seasons.push({ number: season.number, episodes: eps });
    }
    t.quality = t.seasons[0]?.episodes[0]?.quality || null;
    titles[t.titleKey] = t;
    series.push(t);
  }
  const byDate = (a, b) => b.date - a.date;
  movies.sort(byDate); series.sort(byDate);
  const recent = [...movies, ...series].sort(byDate).slice(0, 10);
  return { movies, series, unclassified: real.unclassified || [], recent, byKey, titles };
}

/** La película o el capítulo del motor real para una clave de video (lo que necesita HFPlayback.open). */
export function realEntry(videoKey) {
  return real ? real.byKey[videoKey] || null : null;
}

export function filterKids(lib) {
  const movies = lib.movies.filter((t) => t.kids);
  const series = lib.series.filter((t) => t.kids);
  const keep = new Set([...movies, ...series].map((t) => t.titleKey));
  const titles = Object.fromEntries(Object.entries(lib.titles).filter(([k]) => keep.has(k)));
  const byKey = Object.fromEntries(Object.entries(lib.byKey).filter(([, v]) => keep.has(v.titleKey)));
  return { movies, series, unclassified: [], recent: lib.recent.filter((t) => keep.has(t.titleKey)), byKey, titles };
}

/** Categorías con su lista de títulos; «Accion» y «Acción» son la misma (se muestra la que lleva tilde). */
export function categoriesOf(lib) {
  const map = new Map();
  for (const t of [...lib.movies, ...lib.series]) for (const c of t.categories) {
    const k = norm(c);
    if (!map.has(k)) map.set(k, { name: c, titles: [] });
    const g = map.get(k);
    if (/[áéíóúñ]/i.test(c) && !/[áéíóúñ]/i.test(g.name)) g.name = c;
    if (!g.titles.includes(t)) g.titles.push(t);
  }
  return [...map.values()].sort((a, b) => b.titles.length - a.titles.length);
}

// ---------- Cuentas ----------
/** `persist: false` sirve para el tablero (?design=): no pisa la sesión guardada. */
export function setAccount(id, persist = true) {
  account = id ? String(id) : null;
  profileId = null;
  E.setAccount(account || 'anon');
  if (!persist) return;
  if (account) store.set('hf.web.account', account); else store.del('hf.web.account');
}
export function accountId() { return account; }
export function accounts() { return account ? [account] : []; }

// ---------- Perfiles (los del motor: los mismos en la TV y el celular) ----------
export function profiles() { return E.profiles(); }
export function saveProfile(p) {
  const r = E.saveProfile({ id: p.id, name: p.name, avatar: p.avatar, kids: !!p.kids, pin: p.pin === null ? '' : p.pin });
  if (r && r.error) throw new Error(r.error);
  return r.profile;
}
export function deleteProfile(id) { return E.deleteProfile(id); }
export function checkPin(id, pin) { return E.checkPin(id, pin); }
export function setProfile(id) {
  profileId = id || null;
  E.setProfile(id || undefined);
  if (id) store.set(ak('profile'), id); else store.del(ak('profile'));
}
export function currentProfile() {
  if (!profileId) {
    const saved = store.get(ak('profile'), null);
    if (saved && E.profiles().some((p) => p.id === saved)) { profileId = saved; E.setProfile(saved); }
  }
  return E.profiles().find((p) => p.id === profileId) || null;
}

/** Chats de la biblioteca del perfil: {id: título} (null si nunca eligió). */
export function enabledSources() { return E.enabledSources(); }
export function setEnabledSources(map) { E.setEnabledSources(map || {}); }
export function allEnabledSources() { return E.allEnabledSources(); }

// ---------- Caché del catálogo ----------
export function cachedItems() { return E.cachedItems(); }
export function setCachedItems(items) { E.setCachedItems(items); }
export function tags() { return E.tags(); }

// ---------- Progreso y Mi lista (del motor: se sincronizan) ----------
export function allProgress() { return E.allProgress(); }
export function progress(key) { return E.progress(key); }
export function setProgress(key, t, d) { E.setProgress(key, t, d); return E.progress(key); }
export function myList() { return E.myList(); }
export function inMyList(titleKey) { return E.inMyList(titleKey); }
export function toggleMyList(titleKey) { return E.toggleMyList(titleKey); }

// ---------- Preferencias de este dispositivo ----------
export function prefs() { return { quality: 'auto', autoplay: true, ...store.get(pk('prefs'), {}) }; }
export function setPrefs(p) { store.set(pk('prefs'), { ...prefs(), ...p }); }

// ---------- Series ----------
const episodesOf = (s) => s.seasons.flatMap((x) => x.episodes);
export function episodeAfter(series, key) {
  const eps = episodesOf(series);
  const i = eps.findIndex((e) => e.video === key);
  return i >= 0 ? eps[i + 1] || null : null;
}
/** El capítulo para «Continuar»: el último empezado si no terminó, o el siguiente. */
export function nextEpisode(series) {
  const eps = episodesOf(series);
  const all = allProgress();
  let last = null;
  for (const e of eps) { const p = all[e.video]; if (p && (!last || p.at > all[last.video].at)) last = e; }
  if (!last) return eps[0];
  if (!all[last.video].done) return last;
  return episodeAfter(series, last.video) || eps[0];
}

// ---------- Formatos ----------
export function formatDuration(sec) {
  const m = Math.round((sec || 0) / 60);
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}
export function formatClock(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'); const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
export function formatSize(bytes) {
  const mb = (bytes || 0) / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1).replace('.', ',')} GB` : `${Math.round(mb)} MB`;
}
