// Gestos táctiles de iOS: deslizar desde el borde para volver y tirar para actualizar.
// La app instalada (pantalla de inicio) no tiene botón atrás ni gesto del navegador, así que lo ponemos nosotros.
// En Safari normal el navegador ya tiene su propio deslizar-para-volver; ahí no lo activamos para no pelear con él.

export const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

export function edgeSwipeBack(viewEl, { canGoBack, onBack }) {
  const EDGE = 24;
  let x0 = 0; let y0 = 0; let dx = 0; let t0 = 0; let active = false; let locked = false;
  const enabled = () => standalone() || new URLSearchParams(location.search).has('swipe');

  document.addEventListener('touchstart', (e) => {
    if (!enabled() || !canGoBack() || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX > EDGE) return;
    x0 = t.clientX; y0 = t.clientY; dx = 0; t0 = performance.now(); active = true; locked = false;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!active) return;
    const t = e.touches[0];
    dx = Math.max(0, t.clientX - x0);
    if (!locked) {
      if (Math.abs(t.clientY - y0) > 12 && Math.abs(t.clientY - y0) > dx) { active = false; return; }
      if (dx > 8) { locked = true; viewEl.classList.add('swiping'); }
    }
    if (locked) {
      if (e.cancelable) e.preventDefault();
      viewEl.style.transform = `translateX(${dx}px)`;
      viewEl.style.setProperty('--swipe', String(Math.min(1, dx / innerWidth)));
    }
  }, { passive: false });

  const end = () => {
    if (!active) return;
    active = false;
    if (!locked) return;
    const v = dx / Math.max(1, performance.now() - t0);
    const go = dx > innerWidth * 0.35 || v > 0.5;
    viewEl.classList.remove('swiping');
    viewEl.classList.add('swipe-release');
    viewEl.style.transform = go ? `translateX(${innerWidth}px)` : '';
    setTimeout(() => {
      viewEl.classList.remove('swipe-release');
      if (go) { viewEl.dataset.swiped = '1'; onBack(); }
      viewEl.style.transform = '';
    }, 220);
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
}

/** Tirar hacia abajo desde arriba para sincronizar. */
export function pullToRefresh(viewEl, indicator, { enabled, onRefresh }) {
  const MAX = 90; const TRIGGER = 70;
  let y0 = 0; let dy = 0; let pulling = false; let busy = false;
  document.addEventListener('touchstart', (e) => {
    if (busy || !enabled() || scrollY > 0 || e.touches.length !== 1) return;
    y0 = e.touches[0].clientY; dy = 0; pulling = true;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || scrollY > 0) { indicator.style.setProperty('--pull', '0'); return; }
    const d = Math.min(MAX, dy * 0.5);
    indicator.style.setProperty('--pull', String(d));
    indicator.classList.toggle('armed', d >= TRIGGER);
  }, { passive: true });
  document.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    const armed = indicator.classList.contains('armed');
    indicator.classList.remove('armed');
    if (!armed) { indicator.style.setProperty('--pull', '0'); return; }
    busy = true;
    indicator.classList.add('busy');
    try { await onRefresh(); } finally {
      busy = false;
      indicator.classList.remove('busy');
      indicator.style.setProperty('--pull', '0');
    }
  });
}
