// Hojas desde abajo (estilo iOS) con arrastre para cerrar.
import { I } from '../icons.js';
import { esc } from './components.js';
import * as L from '../data/library.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const stack = [];

export function openSheet({ title, body, onMount, onClose, cls = '' }) {
  const layer = document.createElement('div');
  layer.className = `sheet-layer ${cls}`;
  layer.innerHTML = `<div class="sheet-backdrop" data-close></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grab" aria-hidden="true"></div>
      <header class="sheet-head"><h2>${title}</h2><button class="sheet-x" type="button" data-close aria-label="Cerrar">${I.close}</button></header>
      <div class="sheet-body">${body}</div>
    </section>`;
  document.getElementById('sheets').appendChild(layer);
  const sheet = layer.querySelector('.sheet');
  const prevFocus = document.activeElement;
  let closed = false;

  const api = {
    el: sheet,
    close() {
      if (closed) return;
      closed = true;
      stack.splice(stack.indexOf(api), 1);
      layer.classList.remove('open');
      sheet.style.transform = '';
      const done = () => { layer.remove(); prevFocus?.focus?.({ preventScroll: true }); onClose?.(); };
      if (reduced()) done(); else setTimeout(done, 320);
    },
  };
  stack.push(api);
  layer.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) api.close(); });
  dragToClose(sheet, api);
  onMount?.(sheet, api);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    layer.classList.add('open');
    (sheet.querySelector('.sheet-body [aria-checked="true"]') || sheet.querySelector('.sheet-body :is(button, input)'))?.focus({ preventScroll: true });
  }));
  return api;
}

export function closeTopSheet() { const s = stack[stack.length - 1]; if (s) { s.close(); return true; } return false; }

function dragToClose(sheet, api) {
  const body = sheet.querySelector('.sheet-body');
  let y0 = 0; let dy = 0; let t0 = 0; let dragging = false;
  sheet.addEventListener('touchstart', (e) => {
    const inBody = body.contains(e.target);
    if (inBody && body.scrollTop > 0) return;
    y0 = e.touches[0].clientY; dy = 0; t0 = performance.now(); dragging = true;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0) { sheet.style.transform = ''; return; }
    if (e.cancelable) e.preventDefault();
    sheet.classList.add('dragging');
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  sheet.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    const v = dy / Math.max(1, performance.now() - t0);
    if (dy > sheet.offsetHeight * 0.3 || v > 0.6) api.close();
    else sheet.style.transform = '';
  });
}

/** Lista de opciones con radio (una sola elección). */
export function options(list, current, name = 'opt') {
  return `<div class="opts" role="radiogroup">${list.map((o) => `
    <button class="opt" type="button" role="radio" name="${name}" data-value="${esc(o.value)}" aria-checked="${o.value === current}">
      <span class="opt-text"><b>${esc(o.label)}</b>${o.note ? `<small>${esc(o.note)}</small>` : ''}</span><span class="radio"></span>
    </button>`).join('')}</div>`;
}

export function onPick(sheetEl, fn) {
  sheetEl.addEventListener('click', (e) => {
    const b = e.target.closest('.opt');
    if (!b) return;
    b.parentElement.querySelectorAll('.opt').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    fn(b.dataset.value, b);
  });
}

// ---------- Hojas concretas ----------
export function qualityLabel(v) {
  const parts = v.n > 1 ? ` · ${v.n} partes` : '';
  return { value: v.slot, label: v.q === '4K' ? '4K Ultra HD' : v.q, note: `${L.formatSize(v.size)}${parts}` };
}

/** sheet-quality: elegir versión. */
export function sheetQuality(versions, current, pick) {
  const s = openSheet({
    title: 'Calidad',
    body: `<p class="sheet-note">Las versiones más livianas cargan más rápido con datos móviles.</p>${options(versions.map(qualityLabel), current, 'q')}`,
    onMount: (el, api) => onPick(el, (v) => { pick(v); setTimeout(api.close, 180); }),
  });
  return s;
}

/** sheet-tracks: audio y subtítulos. */
export function sheetTracks(tracks, current, { onAudio, onSub }) {
  const a = tracks.audio.map((t) => ({ value: t.id, label: t.label }));
  const s = tracks.subs.map((t) => ({ value: t.id, label: t.label }));
  return openSheet({
    title: 'Audio y subtítulos',
    body: `<h3 class="sheet-sub">Audio</h3><div data-g="a">${options(a, current.audio, 'a')}</div>
      <h3 class="sheet-sub">Subtítulos</h3><div data-g="s">${options(s, current.sub, 's')}</div>`,
    onMount: (el) => onPick(el, (v, b) => (b.closest('[data-g]').dataset.g === 'a' ? onAudio : onSub)(v)),
  });
}
