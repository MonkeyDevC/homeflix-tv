// Estado único y pequeño: cuenta, perfil, biblioteca y ruta.
import * as L from './data/library.js';
import * as Art from './data/art.js';
import { demoItems, CHAT_TITLE } from './data/demo-items.js';

export const state = {
  account: L.accountId(),
  profile: null,
  full: null, // biblioteca completa
  lib: null, // biblioteca del perfil (filtrada si es infantil)
  route: null,
  tab: 'inicio',
  design: null,
  syncedAt: 0,
};

export function sync() {
  const items = demoItems();
  state.full = L.build(items);
  Art.register(state.full);
  state.syncedAt = Date.now();
  applyProfile();
}

export function applyProfile() {
  state.profile = state.account ? L.currentProfile() : null;
  if (!state.full) return;
  let lib = state.profile?.kids ? L.filterKids(state.full) : state.full;
  const sources = L.enabledSources();
  if (sources && !sources.includes(CHAT_TITLE)) {
    lib = { movies: [], series: [], unclassified: [], recent: [], byKey: {}, titles: {} };
  }
  state.lib = lib;
}

export function signIn(id = 'demo', persist = true) {
  L.setAccount(id, persist);
  state.account = id;
  // Progreso de ejemplo la primera vez, para que «Continuar viendo» tenga algo.
  seedDemo();
  applyProfile();
}

export function signOut() {
  L.setProfile(null);
  L.setAccount(null);
  state.account = null;
  state.profile = null;
}

export function chooseProfile(id) {
  L.setProfile(id);
  seedDemo();
  applyProfile();
}

function seedDemo() {
  if (!state.full || !L.currentProfile()) return;
  if (Object.keys(L.allProgress()).length) return;
  const f = state.full;
  const kids = L.currentProfile().kids;
  const pick = (k) => f.titles[k];
  const seeds = kids
    ? [['m:pequenos gigantes:2026', 0.42], ['s:los exploradores del patio', 0.6, 0, 1]]
    : [['m:orbita cero:2026', 0.36], ['s:casa solar', 0.55, 0, 1], ['m:el faro de lucia:2023', 0.78]];
  for (const [k, r, si, ei] of seeds) {
    const t = pick(k);
    if (!t) continue;
    if (t.type === 'movie') L.setProgress(t.video, t.duration * r, t.duration);
    else {
      const eps = t.seasons[si].episodes;
      for (let i = 0; i < ei; i += 1) L.setProgress(eps[i].video, eps[i].duration, eps[i].duration);
      L.setProgress(eps[ei].video, eps[ei].duration * r, eps[ei].duration);
    }
  }
  if (!L.myList().length) for (const k of kids ? ['m:bosque de papel:2024'] : ['m:la ultima estacion:2025', 's:frecuencia', 'm:marea alta:2025']) if (f.titles[k]) L.toggleMyList(k);
}

/** «Continuar viendo»: títulos con progreso sin terminar, el más reciente primero. */
export function continueWatching() {
  const lib = state.lib; const all = L.allProgress();
  const out = [];
  for (const [key, p] of Object.entries(all)) {
    const ref = lib.byKey[key];
    if (!ref || !ref.main) continue;
    const t = lib.titles[ref.titleKey];
    if (t.type === 'movie') { if (!p.done && p.t > 30) out.push({ t, p, at: p.at }); continue; }
    if (out.some((x) => x.t === t)) continue;
    const ep = L.nextEpisode(t);
    const ep_p = all[ep.video] || { t: 0, d: ep.duration };
    const last = Math.max(...t.seasons.flatMap((s) => s.episodes).map((e) => all[e.video]?.at || 0));
    out.push({ t, ep, p: ep_p, at: last });
  }
  return out.sort((a, b) => b.at - a.at);
}
