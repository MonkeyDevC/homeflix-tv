// HFLibrary de demostración para la web. Mismos nombres que el motor compartido descrito en el plan
// (parseCaption, build, filterKids, perfiles, progreso, Mi lista, formatos) para poder cambiarlo por el real.

// ---------- Almacenamiento (seguro aunque localStorage no exista o falle) ----------
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
const pk = (name) => `hf.web.${account || 'demo'}.${profileId || 'none'}.${name}`;
const ak = (name) => `hf.web.${account || 'demo'}.${name}`;

// ---------- Comentarios ----------
const TAG_TAIL = /(?:\s+#[\p{L}\p{N}_]+)+\s*$/u;
const QUALITY = [
  { re: /\b(4k|2160p|uhd)\b/i, q: '4K', h: 2160 },
  { re: /\b1080p\b/i, q: '1080p', h: 1080 },
  { re: /\b720p\b/i, q: '720p', h: 720 },
  { re: /\b480p\b/i, q: '480p', h: 480 },
  { re: /\b360p\b/i, q: '360p', h: 360 },
];
const Q_ORDER = ['4K', '1080p', '720p', '480p', '360p'];
const Q_HEIGHT = { '4K': 2160, '1080p': 1080, '720p': 720, '480p': 480, '360p': 360 };

export function qualityOf(fileName, height) {
  for (const x of QUALITY) if (x.re.test(fileName || '')) return x.q;
  if (height >= 2000) return '4K';
  if (height >= 1000) return '1080p';
  if (height >= 700) return '720p';
  if (height >= 450) return '480p';
  return height ? '360p' : '1080p';
}

export function partOf(fileName) {
  const m = /parte\s+(\d+)\s+de\s+(\d+)/i.exec(fileName || '');
  return m ? { part: +m[1], pieces: +m[2] } : { part: 1, pieces: 1 };
}

/** Lee un comentario. Devuelve null si no sigue el formato. */
export function parseCaption(caption) {
  if (!caption) return null;
  let text = String(caption).trim();
  const tags = [];
  const tail = TAG_TAIL.exec(text);
  if (tail) {
    for (const t of tail[0].trim().split(/\s+/)) tags.push(t.slice(1));
    text = text.slice(0, tail.index).trim();
  }
  const lower = tags.map((t) => t.toLowerCase());
  const kids = lower.includes('infantil');
  const image = lower.includes('portada') ? 'portada' : lower.includes('banner') ? 'banner' : null;
  const categories = tags
    .filter((t) => !['infantil', 'portada', 'banner'].includes(t.toLowerCase()))
    .map((t) => t.replace(/_/g, ' '));

  const parts = text.split('#');
  const head = parts[0].trim().toLowerCase();

  if (head === 'pelicula' || head === 'película') {
    const m = /^\s*(.+?)\s*\((\d{4})\)\s*(.*)$/s.exec(parts[1] || '');
    if (!m) return null;
    // Tolerancia: si falta el «#» después del año, lo que sigue es la descripción.
    const after = parts.slice(2).join('#').trim();
    const description = [m[3].trim(), after].filter(Boolean).join(' ').trim();
    return { type: 'movie', name: m[1].trim(), year: +m[2], description, categories, kids, image };
  }

  const s = /^serie(?:\((\d+)\/(\d+)\))?$/.exec(head.replace(/\s+/g, ''));
  if (s) {
    const name = (parts[1] || '').trim();
    if (!name) return null;
    if (!s[1]) return { type: 'series', name, description: parts.slice(2).join('#').trim(), categories, kids, image };
    return {
      type: 'series', name, season: +s[1], episode: +s[2],
      title: (parts[2] || '').trim(), description: parts.slice(3).join('#').trim(), categories, kids, image,
    };
  }
  return null;
}

/** Arma un comentario (para el preparador). */
export function composeCaption(t) {
  const tags = (t.categories || []).map((c) => ` #${c.replace(/\s+/g, '_')}`).join('') + (t.kids ? ' #infantil' : '');
  if (t.type === 'movie') return `pelicula#${t.name} (${t.year})#${t.description || ''}${tags}`;
  return `serie(${t.season}/${t.episode})#${t.name}#${t.title || ''}#${t.description || ''}${tags}`;
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// ---------- Biblioteca ----------
function addVersion(versions, item) {
  const q = qualityOf(item.fileName, item.height);
  const { part, pieces } = partOf(item.fileName);
  let v = versions.find((x) => x.slot === q);
  if (!v) { v = { slot: q, q, h: Q_HEIGHT[q], n: 0, pieces, parts: [], dur: 0, size: 0, bps: 0 }; versions.push(v); }
  v.parts.push({ key: item.key, dur: item.duration || 0, size: item.size || 0, idx: part });
}

function finishVersions(versions) {
  for (const v of versions) {
    v.parts.sort((a, b) => a.idx - b.idx);
    v.n = v.parts.length;
    v.dur = v.parts.reduce((a, p) => a + p.dur, 0);
    v.size = v.parts.reduce((a, p) => a + p.size, 0);
    v.bps = v.dur ? Math.round((v.size * 8) / v.dur) : 0;
  }
  versions.sort((a, b) => Q_ORDER.indexOf(a.q) - Q_ORDER.indexOf(b.q));
  return versions;
}

export function build(items) {
  const titles = {};
  const byKey = {};
  const unclassified = [];
  const images = [];

  for (const it of items) {
    const c = parseCaption(it.caption);
    if (!c) { if (it.kind === 'video') unclassified.push(it); continue; }
    const titleKey = c.type === 'movie' ? `m:${norm(c.name)}:${c.year}` : `s:${norm(c.name)}`;
    let t = titles[titleKey];
    if (!t) {
      t = titles[titleKey] = c.type === 'movie'
        ? { type: 'movie', titleKey, name: c.name, year: c.year, description: '', kids: false, categories: [], video: null, versions: [], quality: null, imageKey: null, bannerKey: null, date: 0 }
        : { type: 'series', titleKey, name: c.name, description: '', kids: false, categories: [], seasons: [], imageKey: null, bannerKey: null, date: 0, chatTitle: it.chatTitle };
    }
    t.chatTitle = it.chatTitle;
    if (c.kids) t.kids = true;
    for (const cat of c.categories) if (!t.categories.includes(cat)) t.categories.push(cat);

    if (it.kind === 'photo') {
      if (c.image) images.push({ t, image: c.image, key: it.key });
      if (c.description && !t.description && c.season == null) t.description = c.description;
      continue;
    }
    t.date = Math.max(t.date, it.date || 0);
    if (c.type === 'movie') {
      if (c.description && !t.description) t.description = c.description;
      addVersion(t.versions, it);
    } else {
      if (c.season == null) continue;
      let season = t.seasons.find((s) => s.number === c.season);
      if (!season) { season = { number: c.season, episodes: [] }; t.seasons.push(season); }
      let ep = season.episodes.find((e) => e.episode === c.episode);
      if (!ep) {
        ep = { key: null, season: c.season, episode: c.episode, title: c.title, description: c.description, video: null, versions: [], titleKey };
        season.episodes.push(ep);
      }
      addVersion(ep.versions, it);
    }
  }

  for (const { t, image, key } of images) {
    if (image === 'portada') t.imageKey = key; else t.bannerKey = key;
  }

  const movies = []; const series = [];
  for (const t of Object.values(titles)) {
    if (t.type === 'movie') {
      if (!t.versions.length) { delete titles[t.titleKey]; continue; }
      finishVersions(t.versions);
      t.quality = t.versions[0].q;
      t.video = t.versions[0].parts[0].key;
      t.duration = t.versions[0].dur;
      for (const v of t.versions) for (const p of v.parts) byKey[p.key] = { titleKey: t.titleKey, slot: v.slot };
      byKey[t.video] = { titleKey: t.titleKey, slot: t.versions[0].slot, main: true };
      movies.push(t);
    } else {
      t.seasons.sort((a, b) => a.number - b.number);
      let any = false;
      for (const s of t.seasons) {
        s.episodes.sort((a, b) => a.episode - b.episode);
        for (const ep of s.episodes) {
          finishVersions(ep.versions);
          ep.video = ep.key = ep.versions[0].parts[0].key;
          ep.duration = ep.versions[0].dur;
          ep.quality = ep.versions[0].q;
          for (const v of ep.versions) for (const p of v.parts) byKey[p.key] = { titleKey: t.titleKey, slot: v.slot, season: s.number, episode: ep.episode };
          byKey[ep.video].main = true;
          any = true;
        }
      }
      if (!any) { delete titles[t.titleKey]; continue; }
      t.quality = t.seasons[0].episodes[0].quality;
      series.push(t);
    }
  }
  const byDate = (a, b) => b.date - a.date;
  movies.sort(byDate); series.sort(byDate);
  const recent = [...movies, ...series].sort(byDate).slice(0, 10);
  return { movies, series, unclassified, recent, byKey, titles };
}

export function filterKids(lib) {
  const movies = lib.movies.filter((t) => t.kids);
  const series = lib.series.filter((t) => t.kids);
  const keep = new Set([...movies, ...series].map((t) => t.titleKey));
  const titles = Object.fromEntries(Object.entries(lib.titles).filter(([k]) => keep.has(k)));
  const byKey = Object.fromEntries(Object.entries(lib.byKey).filter(([, v]) => keep.has(v.titleKey)));
  return { movies, series, unclassified: [], recent: lib.recent.filter((t) => keep.has(t.titleKey)), byKey, titles };
}

export function categoriesOf(lib) {
  const map = new Map();
  for (const t of [...lib.movies, ...lib.series]) for (const c of t.categories) {
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(t);
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length).map(([name, list]) => ({ name, titles: list }));
}

// ---------- Cuentas ----------
/** `persist: false` sirve para el tablero (?design=): no pisa la sesión guardada. */
export function setAccount(id, persist = true) {
  account = id; profileId = null;
  if (!persist) return;
  if (id) store.set('hf.web.account', id); else store.del('hf.web.account');
}
export function accountId() { return account; }
export function accounts() { return account ? [account] : []; }

// ---------- Perfiles ----------
const DEFAULT_PROFILES = [
  { id: 'familia', name: 'Familia', avatar: 0, kids: false, pin: null },
  { id: 'santi', name: 'Santi', avatar: 2, kids: false, pin: '1234' },
  { id: 'peques', name: 'Peques', avatar: 4, kids: true, pin: null },
];
export function profiles() { return store.get(ak('profiles'), DEFAULT_PROFILES); }
export function saveProfile(p) {
  const list = profiles();
  if (!p.id) p.id = `p${Date.now().toString(36)}`;
  const i = list.findIndex((x) => x.id === p.id);
  if (i >= 0) list[i] = { ...list[i], ...p }; else list.push(p);
  store.set(ak('profiles'), list);
  return p;
}
export function deleteProfile(id) { store.set(ak('profiles'), profiles().filter((p) => p.id !== id)); }
export function checkPin(id, pin) { const p = profiles().find((x) => x.id === id); return !!p && (!p.pin || p.pin === pin); }
export function setProfile(id) { profileId = id; if (id) store.set(ak('profile'), id); else store.del(ak('profile')); }
export function currentProfile() {
  if (!profileId) profileId = store.get(ak('profile'), null);
  return profiles().find((p) => p.id === profileId) || null;
}

export function enabledSources() { return store.get(pk('sources'), null); }
export function setEnabledSources(list) { store.set(pk('sources'), list); }

// ---------- Caché ----------
export function cachedItems() { return store.get(ak('items'), null); }
export function setCachedItems(items) { store.set(ak('items'), items); }

// ---------- Progreso ----------
export function allProgress() { return store.get(pk('progress'), {}); }
export function progress(key) { return allProgress()[key] || null; }
export function setProgress(key, t, d) {
  const all = allProgress();
  all[key] = { t: Math.round(t), d: Math.round(d), at: Date.now(), done: d > 0 && t / d > 0.94 };
  store.set(pk('progress'), all);
  return all[key];
}

// ---------- Mi lista ----------
export function myList() { return store.get(pk('mylist'), []); }
export function inMyList(titleKey) { return myList().includes(titleKey); }
export function toggleMyList(titleKey) {
  const list = myList();
  const i = list.indexOf(titleKey);
  if (i >= 0) list.splice(i, 1); else list.unshift(titleKey);
  store.set(pk('mylist'), list);
  return i < 0;
}

// ---------- Preferencias ----------
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
