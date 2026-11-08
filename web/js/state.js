// Estado único y pequeño: cuenta, perfil, biblioteca y ruta.
//
// Dos modos:
//   - real: la cuenta de Telegram. La biblioteca sale de los chats que eligió el perfil (HFTelegram.scan), se guarda
//     en caché con el motor y Mi lista, progreso y perfiles se sincronizan con la TV y el celular (HFSync).
//   - demostración: la cuenta «demo» y el tablero (?design=). Títulos inventados, nada sale a Telegram.
import * as L from './data/library.js';
import * as Art from './data/art.js';
import { demoItems, CHAT_ID, CHAT_TITLE } from './data/demo-items.js';

const T = globalThis.HFTelegram;
const Sync = globalThis.HFSync;

export const state = {
  account: L.accountId(),
  user: null, // {id, name, username} de Telegram
  profile: null,
  full: null, // biblioteca completa
  lib: null, // biblioteca del perfil (filtrada por sus chats y, si es infantil, por #infantil)
  route: null,
  tab: 'inicio',
  design: null,
  syncedAt: 0,
  syncing: false,
  syncError: '',
};

const listeners = new Set();
/** fn() cuando cambió la biblioteca o llegaron cambios de otro dispositivo (para volver a pintar). */
export function onLibrary(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const notify = () => listeners.forEach((fn) => { try { fn(); } catch { /* nada */ } });

export const isDemo = () => !!state.design || state.account === 'demo';
const itemChat = (it) => String(it.chatId || String(it.key || '').split(':')[0]);

let items = [];

/** Vuelve a armar la biblioteca con lo que hay en memoria (y en el modo real, la caché del motor). */
export function rebuild() {
  if (isDemo()) {
    items = demoItems();
    state.full = L.build(items);
    Art.register(state.full);
  } else {
    if (!items.length && state.account) items = L.cachedItems() || [];
    const src = L.enabledSources() || {};
    Art.clear();
    state.full = L.build(items.filter((it) => !!src[itemChat(it)]));
  }
  applyProfile();
}

/**
 * Pone al día la biblioteca. En demostración es inmediato; con Telegram lee los chats del perfil
 * (uno por uno) y guarda el resultado en la caché. Devuelve una promesa.
 */
export function sync() {
  if (isDemo()) {
    rebuild();
    state.syncedAt = Date.now();
    return Promise.resolve();
  }
  if (!state.account) return Promise.resolve();
  if (!items.length) items = L.cachedItems() || [];
  rebuild();
  const ids = Object.keys(L.enabledSources() || {});
  if (state.syncing || !ids.length || !T) return Promise.resolve();
  state.syncing = true;
  state.syncError = '';
  const acc = state.account;
  const done = {};
  let all = [];
  let failed = 0;
  notify();
  return ids.reduce((p, id) => p.then(() => T.scan(id).then((list) => { all = all.concat(list); done[String(id)] = true; }, () => { failed += 1; })), Promise.resolve())
    .then(() => {
      if (state.account !== acc) return;
      const keep = L.allEnabledSources();
      items = items.filter((it) => { const c = itemChat(it); return !done[c] && !!keep[c]; })
        .concat(all.map((it) => (it.caption && it.caption.length > 800 ? { ...it, caption: it.caption.slice(0, 800) } : it)));
      L.setCachedItems(items);
      state.syncedAt = Date.now();
      state.syncError = failed ? `${failed} chat${failed === 1 ? '' : 's'} no se pudo leer` : '';
    })
    .finally(() => { state.syncing = false; rebuild(); notify(); });
}

export function applyProfile() {
  state.profile = state.account ? L.currentProfile() : null;
  if (!state.full) return;
  state.lib = state.profile?.kids ? L.filterKids(state.full) : state.full;
}

/** Entrar con una cuenta. user: {id, name, username} de Telegram, o 'demo' / 'design'. */
export function signIn(user, persist = true) {
  const id = typeof user === 'string' ? user : String(user.id);
  L.setAccount(id, persist);
  state.account = id;
  state.user = typeof user === 'string' ? null : user;
  items = [];
  if (isDemo()) {
    seedDemoAccount();
  } else {
    globalThis.HFLibrary.rememberAccount({ slot: T.slot(), id, name: user.name, username: user.username }, T.MAIN_SLOT);
    items = L.cachedItems() || [];
    Sync?.start();
  }
  rebuild();
}

export async function signOut() {
  if (!isDemo()) {
    try { await Sync?.stop(); } catch { /* nada */ }
    try { await T.logout(); } catch { /* nada */ }
  }
  L.setProfile(null);
  L.setAccount(null);
  state.account = null;
  state.user = null;
  state.profile = null;
  items = [];
  state.full = null;
  state.lib = null;
}

export function chooseProfile(id) {
  L.setProfile(id);
  if (isDemo()) seedDemo();
  rebuild();
}

/** La cuenta de demostración tiene el grupo de ejemplo activo y un PIN en Santiago (1234). */
function seedDemoAccount() {
  const H = globalThis.HFLibrary;
  for (const p of H.profiles()) {
    if (!H.enabledSources(p.id)) H.setEnabledSources({ [CHAT_ID]: CHAT_TITLE }, p.id);
  }
  const s = H.profiles().find((p) => p.id === 'p2');
  if (s && !s.pin) H.saveProfile({ id: s.id, name: s.name, avatar: s.avatar, kids: s.kids, pin: '1234' });
}

/** Progreso y Mi lista de ejemplo la primera vez, para que «Continuar viendo» tenga algo. */
function seedDemo() {
  rebuild();
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
  if (!lib) return out;
  for (const [key, p] of Object.entries(all)) {
    const ref = lib.byKey[key];
    if (!ref || !ref.main) continue;
    const t = lib.titles[ref.titleKey];
    if (!t) continue;
    if (t.type === 'movie') { if (!p.done && p.t > 30) out.push({ t, p, at: p.at }); continue; }
    if (out.some((x) => x.t === t)) continue;
    const ep = L.nextEpisode(t);
    const ep_p = all[ep.video] || { t: 0, d: ep.duration };
    const last = Math.max(...t.seasons.flatMap((s) => s.episodes).map((e) => all[e.video]?.at || 0));
    out.push({ t, ep, p: ep_p, at: last });
  }
  return out.sort((a, b) => b.at - a.at);
}

// Cambios que llegan de otro dispositivo (Mi lista, progreso, perfiles, chats): volver a armar y avisar.
Sync?.onRemote(() => { if (!isDemo()) { rebuild(); notify(); } });
