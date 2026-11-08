// HFPlayback para la web. Mismo contrato que js/playback.js del motor:
// open(item, startAt, events), play, pause, toggle, seek, time, duration, close,
// tracks, setAudio, setSub, qualities, setQuality, simulated.
//
// Con la cuenta de Telegram usa el motor real (window.HFPlayback: MediaSource, partes como una sola película,
// calidad automática, audio y subtítulos). Necesita en la página los elementos del motor:
// <video id="playerVideo">, #playerSub, #playerSubTop y <canvas id="playerSubPic"> (los pone ui/player.js).
// En la demostración no hay video: el tiempo avanza con un reloj.
import * as L from './library.js';
import { isDemo } from '../state.js';

const R = globalThis.HFPlayback;

let cur = null;
let timer = 0;
let last = 0;
let realMode = false;
let realState = 'idle';
/** true mientras se simula (demostración o sin motor). Es una variable viva: cambia en cada open(). */
export let simulated = true;

const TRACKS = {
  audio: [{ id: 'es', label: 'Español latino' }, { id: 'en', label: 'Inglés' }],
  subs: [{ id: 'off', label: 'Desactivados' }, { id: 'es', label: 'Español' }, { id: 'en', label: 'Inglés' }],
};

function emit(name, ...args) { cur?.events?.[name]?.(...args); }

function tick() {
  if (!cur || cur.state !== 'playing') return;
  const now = performance.now();
  cur.t = Math.min(cur.d, cur.t + ((now - last) / 1000) * cur.rate);
  last = now;
  emit('onTime', cur.t, cur.d);
  if (cur.t >= cur.d) { setState('ended'); emit('onEnd'); }
}

function setState(s) { if (!cur) return; cur.state = s; emit('onState', s); }

/**
 * @param item {{ titleKey, video, versions, version? }}
 * @param startAt segundos
 * @param events {{ onTime?, onState?, onEnd?, onError? }}
 */
export function open(item, startAt = 0, events = {}) {
  close();
  const version = item.version || item.versions[0];
  /* video real solo con la cuenta de Telegram: en la demostración los títulos son inventados */
  const entry = !isDemo() && R && globalThis.HFTelegram?.available() ? L.realEntry(item.video) : null;
  cur = { item, version, events, t: startAt || 0, d: version.dur, rate: 1, state: 'loading', audio: 'es', sub: 'off' };
  realMode = !!entry;
  if (realMode) {
    realState = 'loading';
    R.open(entry, startAt || 0, {
      onTime: (t, d) => { cur.t = t; cur.d = d || cur.d; emit('onTime', cur.t, cur.d); },
      onState: (s) => { realState = s === 'buffering' ? 'loading' : s; cur.state = realState; emit('onState', realState); },
      onEnded: () => { realState = 'ended'; cur.state = 'ended'; emit('onState', 'ended'); emit('onEnd'); },
      onError: (msg) => emit('onError', msg),
      onNote: (msg) => emit('onNote', msg),
      onTracks: () => emit('onTracks'),
    });
    simulated = !!R.simulated;
    /* calidad elegida a mano (si no, la elige sola según la conexión) */
    if (item.version && item.version.slot && item.preferred) setQuality(item.version.slot);
    return cur;
  }
  simulated = true;
  setState('loading');
  setTimeout(() => { if (cur && cur.state === 'loading') play(); }, 700);
  timer = setInterval(tick, 250);
  return cur;
}

export function play() {
  if (!cur) return;
  if (realMode) { R.play(); return; }
  if (cur.t >= cur.d) cur.t = 0;
  last = performance.now();
  setState('playing');
}
export function pause() { if (!cur) return; if (realMode) { R.pause(); return; } tick(); setState('paused'); }
export function toggle() { if (!cur) return; if (realMode) { R.toggle(); return; } (cur.state === 'playing' ? pause : play)(); }
export function seek(t) {
  if (!cur) return;
  if (realMode) { R.seek(Math.max(0, Math.min(R.duration() || cur.d, t))); return; }
  cur.t = Math.max(0, Math.min(cur.d, t));
  last = performance.now();
  emit('onTime', cur.t, cur.d);
  if (cur.state === 'ended' && cur.t < cur.d) setState('paused');
}
export function time() { return cur ? (realMode ? R.time() : cur.t) : 0; }
export function duration() { return cur ? (realMode ? R.duration() || cur.d : cur.d) : 0; }
export function state() { return cur ? (realMode ? realState : cur.state) : 'idle'; }
export function close() {
  clearInterval(timer); timer = 0;
  if (realMode && cur) R.close();
  realMode = false;
  cur = null;
}

/** Pistas en la forma de la web: {audio:[{id,label}], subs:[{id,label}], current:{audio, sub}}. */
export function tracks() {
  if (!realMode) return { audio: TRACKS.audio, subs: TRACKS.subs, current: cur ? { audio: cur.audio, sub: cur.sub } : null };
  const t = R.tracks();
  const audio = (t.audio || []).map((a) => ({ id: String(a.key), label: a.label + (a.ok === false ? ' (no se puede aquí)' : '') }));
  const subs = [{ id: 'off', label: 'Desactivados' }].concat((t.subs || []).map((s) => ({ id: String(s.key), label: s.label })));
  const ca = (t.audio || []).find((a) => a.current);
  const cs = (t.subs || []).find((s) => s.current);
  return { audio, subs, current: { audio: ca ? String(ca.key) : audio[0]?.id, sub: cs ? String(cs.key) : 'off' } };
}
export function setAudio(id) { if (!cur) return; if (realMode) R.setAudio(id); else cur.audio = id; }
export function setSub(id) { if (!cur) return; if (realMode) R.setSub(id === 'off' ? null : id); else cur.sub = id; }

export function qualities() {
  if (!cur) return [];
  const active = current()?.version.slot;
  return cur.item.versions.map((v) => ({ slot: v.slot, q: v.q, size: v.size, n: v.n, active: v.slot === active }));
}
/** Cambiar de versión conserva el punto (las partes cuentan como una sola película). */
export function setQuality(slot) {
  if (!cur) return;
  if (realMode) {
    const q = R.qualities();
    const hit = q && (q.list || []).find((x) => x.q === slot);
    if (hit) R.setQuality(hit.key);
    return;
  }
  const v = cur.item.versions.find((x) => x.slot === slot);
  if (!v) return;
  const ratio = cur.d ? cur.t / cur.d : 0;
  cur.version = v; cur.d = v.dur; cur.t = ratio * v.dur;
  setState('loading');
  setTimeout(() => cur && play(), 500);
}
export function current() {
  if (!cur) return null;
  if (realMode) {
    const q = R.qualities();
    const slot = q && q.current && q.current.q;
    if (slot) return { ...cur, version: cur.item.versions.find((v) => v.slot === slot) || cur.version };
  }
  return cur;
}
