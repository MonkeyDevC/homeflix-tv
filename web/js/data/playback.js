// HFPlayback de demostración. Mismo contrato que js/playback.js del motor:
// open(item, startAt, events), play, pause, toggle, seek, time, duration, close,
// tracks, setAudio, setSub, qualities, setQuality, simulated.
// Sin Telegram no hay video real: el tiempo avanza con un reloj. Si el item trae `src`
// y se pasa un <video>, se usa ese elemento (sirve para probar con un MP4 local).

let cur = null;
let timer = 0;
let last = 0;

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

export const simulated = true;

/**
 * @param item {{ titleKey, video, versions, version?, src?, el? }}
 * @param startAt segundos
 * @param events {{ onTime?, onState?, onEnd?, onError? }}
 */
export function open(item, startAt = 0, events = {}) {
  close();
  const version = item.version || item.versions[0];
  cur = {
    item, version, events, t: startAt || 0, d: version.dur, rate: 1, state: 'loading',
    audio: 'es', sub: 'off', el: item.src && item.el ? item.el : null,
  };
  if (cur.el) {
    const v = cur.el;
    v.src = item.src;
    v.currentTime = startAt || 0;
    v.ontimeupdate = () => { cur.t = v.currentTime; cur.d = v.duration || cur.d; emit('onTime', cur.t, cur.d); };
    v.onplaying = () => setState('playing');
    v.onpause = () => setState('paused');
    v.onwaiting = () => setState('loading');
    v.onended = () => { setState('ended'); emit('onEnd'); };
    v.onerror = () => emit('onError', 'No se pudo reproducir');
    v.play().catch(() => setState('paused'));
  } else {
    setState('loading');
    setTimeout(() => { if (cur && cur.state === 'loading') play(); }, 700);
    timer = setInterval(tick, 250);
  }
  return cur;
}

export function play() {
  if (!cur) return;
  if (cur.el) { cur.el.play(); return; }
  if (cur.t >= cur.d) cur.t = 0;
  last = performance.now();
  setState('playing');
}
export function pause() { if (!cur) return; if (cur.el) cur.el.pause(); else { tick(); setState('paused'); } }
export function toggle() { if (!cur) return; (cur.state === 'playing' ? pause : play)(); }
export function seek(t) {
  if (!cur) return;
  cur.t = Math.max(0, Math.min(cur.d, t));
  if (cur.el) cur.el.currentTime = cur.t;
  last = performance.now();
  emit('onTime', cur.t, cur.d);
  if (cur.state === 'ended' && cur.t < cur.d) setState('paused');
}
export function time() { return cur ? cur.t : 0; }
export function duration() { return cur ? cur.d : 0; }
export function state() { return cur ? cur.state : 'idle'; }
export function close() {
  clearInterval(timer); timer = 0;
  if (cur?.el) { cur.el.pause(); cur.el.removeAttribute('src'); cur.el.load(); }
  cur = null;
}
export function tracks() { return { audio: TRACKS.audio, subs: TRACKS.subs, current: cur ? { audio: cur.audio, sub: cur.sub } : null }; }
export function setAudio(id) { if (cur) cur.audio = id; }
export function setSub(id) { if (cur) cur.sub = id; }
export function qualities() { return cur ? cur.item.versions.map((v) => ({ slot: v.slot, q: v.q, size: v.size, n: v.n, active: v.slot === cur.version.slot })) : []; }
/** Cambiar de versión conserva el punto (las partes cuentan como una sola película). */
export function setQuality(slot) {
  if (!cur) return;
  const v = cur.item.versions.find((x) => x.slot === slot);
  if (!v) return;
  const ratio = cur.d ? cur.t / cur.d : 0;
  cur.version = v; cur.d = v.dur; cur.t = ratio * v.dur;
  setState('loading');
  setTimeout(() => cur && play(), 500);
}
export function current() { return cur; }
