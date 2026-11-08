// Reproductor: controles táctiles, teclado, siguiente capítulo, Media Session, PiP y pantalla completa.
import { I } from '../icons.js';
import * as L from '../data/library.js';
import * as P from '../data/playback.js';
import * as Art from '../data/art.js';
import { state, isDemo } from '../state.js';
import { go, back, playHref } from '../router.js';
import { esc, img, iconBtn, empty, backBtn } from './components.js';
import { sheetQuality, sheetTracks, closeTopSheet } from './sheets.js';

const SUBS = ['¿Escuchaste eso?', 'Viene de la estación.', 'No hay nadie más aquí.', 'Entonces, ¿quién encendió las luces?'];

function resolve(key) {
  const ref = state.lib.byKey[key];
  if (!ref) return null;
  const t = state.lib.titles[ref.titleKey];
  if (t.type === 'movie') return { t, video: t.video, versions: t.versions, title: t.name, sub: t.year ? String(t.year) : '' };
  const ep = t.seasons.find((s) => s.number === ref.season).episodes.find((e) => e.episode === ref.episode);
  return { t, ep, video: ep.video, versions: ep.versions, title: t.name, sub: `T${ep.season}:E${ep.episode} · ${ep.title}` };
}

export function player(route) {
  const it = resolve(route.params.key);
  if (!it) return { cls: 'v-player-missing', html: `<header class="navbar"><div class="navbar-inner">${backBtn()}</div></header><div class="pad-top">${empty('film', 'No encontramos este video', 'Puede que ya no esté en el grupo.')}</div>` };
  const nextEp = it.ep ? L.episodeAfter(it.t, it.video) : null;
  const canFs = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  return {
    cls: 'v-player',
    chrome: false,
    html: `<div class="player show" data-player tabindex="-1" style="--tint:${Art.color(it.t.titleKey, 14)}">
      <div class="stage" data-stage>
        <video class="video" id="playerVideo" data-video playsinline webkit-playsinline preload="metadata" hidden></video>
        <canvas id="playerSubPic" class="sub-pic" width="1920" height="1080"></canvas>
        <div id="playerSub" class="sub-lines"></div>
        <div id="playerSubTop" class="sub-top"></div>
        <div class="sim" data-sim>${img(it.t.bannerKey || it.t.imageKey, 'sim-img', '')}</div>
        <p class="subtitle" data-subline hidden></p>
        <p class="play-error" data-err hidden></p>
        <div class="spinner" data-spin></div>
        <div class="tap-zone left" data-dbl="-10"><span>${I.rew}</span></div>
        <div class="tap-zone right" data-dbl="10"><span>${I.fwd}</span></div>
      </div>
      <div class="controls" data-controls>
        <div class="ctl-top">
          ${iconBtn('down', 'Cerrar', 'data-close', 'icon-btn-glass')}
          <div class="ctl-titles"><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></div>
          ${iconBtn('captions', 'Audio y subtítulos', 'data-tracks', 'icon-btn-glass')}
          ${iconBtn('layers', 'Calidad', 'data-quality', 'icon-btn-glass')}
        </div>
        <div class="ctl-mid">
          ${iconBtn('rew', 'Atrás 10 segundos', 'data-seek="-10"', 'ctl-skip')}
          <button class="ctl-play" type="button" data-toggle aria-label="Reproducir">${I.play}</button>
          ${iconBtn('fwd', 'Adelante 10 segundos', 'data-seek="10"', 'ctl-skip')}
        </div>
        <div class="ctl-bottom">
          <div class="scrub" data-scrub role="slider" tabindex="0" aria-label="Posición" aria-valuemin="0">
            <div class="scrub-track"><i class="scrub-fill" data-fill></i><i class="scrub-thumb" data-thumb></i></div>
            <span class="scrub-tip" data-tip>0:00</span>
          </div>
          <div class="ctl-row">
            <span class="time" data-time>0:00</span>
            <span class="ctl-q" data-qbadge></span>
            <span class="time time-left" data-left>-0:00</span>
          </div>
          <div class="ctl-row ctl-actions">
            ${nextEp ? `<a class="pill-btn" href="${playHref(nextEp.video)}" data-nextbtn>${I.next}<span>Siguiente capítulo</span></a>` : '<span></span>'}
            <span class="ctl-right">
              ${iconBtn('pip', 'Imagen en imagen', 'data-pip hidden')}
              ${canFs ? iconBtn('expand', 'Pantalla completa', 'data-fs') : ''}
            </span>
          </div>
        </div>
      </div>
      ${nextEp ? `<aside class="next-card" data-next hidden>
        <span class="next-art">${img(it.t.imageKey, '', '')}</span>
        <span class="next-text"><small>Sigue en <b data-count>10</b></small><b>T${nextEp.season}:E${nextEp.episode} · ${esc(nextEp.title)}</b></span>
        <span class="next-actions"><a class="btn btn-primary" href="${playHref(nextEp.video)}" data-nextgo>${I.play}<span>Ver</span></a>
        <button class="btn btn-secondary" type="button" data-nextno>Ahora no</button></span>
      </aside>` : ''}
      ${isDemo() ? '<span class="demo-badge">Vista de demostración</span>' : ''}
    </div>`,
    mount(el) { return mountPlayer(el, it, route, nextEp); },
  };
}

function mountPlayer(el, it, route, nextEp) {
  const $ = (s) => el.querySelector(s);
  const root = $('[data-player]');
  const video = $('[data-video]');
  const prefs = L.prefs();
  const want = route.query.q || prefs.quality;
  const version = it.versions.find((v) => v.slot === want) || it.versions.find((v) => v.q === '1080p') || it.versions[0];
  let start = route.query.t != null ? +route.query.t : (L.progress(it.video)?.done ? 0 : L.progress(it.video)?.t || 0);
  if (state.design === 'player-next') start = version.dur - 14;
  else if (state.design === 'player') start = version.dur * 0.38;
  let dur = version.dur; let cur = start; let hideT = 0; let saveT = 0; let nextTimer = 0; let nextDismissed = false; let scrubbing = false;

  const fmt = L.formatClock;
  const paint = () => {
    const r = dur ? cur / dur : 0;
    if (!scrubbing) {
      $('[data-fill]').style.width = `${r * 100}%`;
      $('[data-thumb]').style.left = `${r * 100}%`;
    }
    $('[data-time]').textContent = fmt(cur);
    $('[data-left]').textContent = `-${fmt(dur - cur)}`;
    const s = $('[data-scrub]');
    s.setAttribute('aria-valuemax', String(Math.round(dur)));
    s.setAttribute('aria-valuenow', String(Math.round(cur)));
    s.setAttribute('aria-valuetext', `${fmt(cur)} de ${fmt(dur)}`);
    const sub = P.tracks().current?.sub;
    const line = $('[data-subline]');
    line.hidden = !P.simulated || !sub || sub === 'off'; // con video real los subtítulos los pinta el motor
    if (!line.hidden) line.textContent = SUBS[Math.floor(cur / 4) % SUBS.length];
    if (nextEp && !nextDismissed && dur - cur <= 15 && dur - cur > 0) showNext();
  };

  const showControls = (stay = false) => {
    root.classList.add('show');
    clearTimeout(hideT);
    if (!stay && P.state() === 'playing') hideT = setTimeout(() => { if (!scrubbing) root.classList.remove('show'); }, 3200);
  };

  const save = () => { if (cur > 5 && !state.design) L.setProgress(it.video, cur, dur); };

  P.open({ titleKey: it.t.titleKey, video: it.video, versions: it.versions, version, preferred: want !== 'auto' }, start, {
    onTime: (t, d) => { cur = t; dur = d; paint(); },
    onError: (msg) => {
      const er = $('[data-err]');
      er.textContent = msg || 'No se pudo reproducir este video.';
      er.hidden = false;
      showControls(true);
    },
    onNote: (msg) => { const er = $('[data-err]'); er.textContent = msg; er.hidden = false; setTimeout(() => { er.hidden = true; }, 4000); },
    onState: (s) => {
      root.dataset.state = s;
      if (!P.simulated && s === 'playing') { video.hidden = false; $('[data-sim]').hidden = true; $('[data-err]').hidden = true; }
      $('[data-toggle]').innerHTML = s === 'playing' ? I.pause : I.play;
      $('[data-toggle]').setAttribute('aria-label', s === 'playing' ? 'Pausar' : 'Reproducir');
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s === 'playing' ? 'playing' : 'paused';
      showControls(s !== 'playing');
    },
    onEnd: () => {
      save();
      if (nextEp && L.prefs().autoplay && !nextDismissed) go(playHref(nextEp.video), { replace: true });
      else showControls(true);
    },
  });
  if (state.design) setTimeout(() => { P.pause(); showControls(true); if (state.design === 'player-next') showNext(); }, 750);
  $('[data-qbadge]').textContent = version.q;
  paint();

  // Guardado periódico del progreso.
  saveT = setInterval(save, 5000);

  // ---------- Controles ----------
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button, a');
    if (b) showControls();
    if (b?.matches('[data-close]')) { back(`/titulo/${encodeURIComponent(it.t.titleKey)}`); return; }
    if (b?.matches('[data-toggle]')) { P.toggle(); return; }
    if (b?.matches('[data-seek]')) { P.seek(P.time() + +b.dataset.seek); return; }
    if (b?.matches('[data-quality]')) {
      sheetQuality(it.versions, P.current()?.version.slot, (slot) => { P.setQuality(slot); $('[data-qbadge]').textContent = it.versions.find((v) => v.slot === slot).q; });
      return;
    }
    if (b?.matches('[data-tracks]')) {
      sheetTracks(P.tracks(), P.tracks().current, { onAudio: P.setAudio, onSub: (s) => { P.setSub(s); paint(); } });
      return;
    }
    if (b?.matches('[data-fs]')) { toggleFullscreen(root, video); return; }
    if (b?.matches('[data-pip]')) { togglePip(video); return; }
    if (b?.matches('[data-nextno]')) { nextDismissed = true; hideNext(); return; }
    if (b?.matches('[data-nextgo], [data-nextbtn]')) { e.preventDefault(); save(); go(b.getAttribute('href'), { replace: true }); }
  });

  // Toque en la imagen: muestra/oculta controles. Doble toque a los lados: ±10 s.
  let lastTap = 0;
  $('[data-stage]').addEventListener('click', (e) => {
    const z = e.target.closest('[data-dbl]');
    const now = performance.now();
    if (z && now - lastTap < 300) {
      P.seek(P.time() + +z.dataset.dbl);
      z.classList.remove('flash'); void z.offsetWidth; z.classList.add('flash');
      lastTap = 0;
      return;
    }
    lastTap = now;
    setTimeout(() => {
      if (lastTap !== now) return;
      if (root.classList.contains('show') && P.state() === 'playing') root.classList.remove('show'); else showControls();
    }, 280);
  });

  // Barra de tiempo: arrastre con el dedo o mouse; flechas con teclado.
  const scrub = $('[data-scrub]');
  const ratioAt = (x) => { const r = scrub.querySelector('.scrub-track').getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); };
  const preview = (r) => {
    $('[data-fill]').style.width = `${r * 100}%`;
    $('[data-thumb]').style.left = `${r * 100}%`;
    const tip = $('[data-tip]');
    tip.textContent = fmt(r * dur);
    tip.style.left = `${r * 100}%`;
  };
  scrub.addEventListener('pointerdown', (e) => {
    scrubbing = true; scrub.classList.add('active'); scrub.setPointerCapture(e.pointerId);
    preview(ratioAt(e.clientX)); showControls(true);
  });
  scrub.addEventListener('pointermove', (e) => { if (scrubbing) preview(ratioAt(e.clientX)); });
  const endScrub = (e) => {
    if (!scrubbing) return;
    scrubbing = false; scrub.classList.remove('active');
    P.seek(ratioAt(e.clientX) * dur); showControls();
  };
  scrub.addEventListener('pointerup', endScrub);
  scrub.addEventListener('pointercancel', () => { scrubbing = false; scrub.classList.remove('active'); paint(); });

  // Teclado: espacio, ←/→ 10 s, ↑/↓ volumen, F, M, Esc.
  const onKey = (e) => {
    if (e.target.matches('input, textarea') || document.querySelector('.sheet-layer.open')) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'k') { e.preventDefault(); P.toggle(); }
    else if (k === 'arrowleft') { e.preventDefault(); P.seek(P.time() - 10); }
    else if (k === 'arrowright') { e.preventDefault(); P.seek(P.time() + 10); }
    else if (k === 'arrowup' || k === 'arrowdown') { e.preventDefault(); video.volume = Math.max(0, Math.min(1, video.volume + (k === 'arrowup' ? 0.1 : -0.1))); }
    else if (k === 'f') toggleFullscreen(root, video);
    else if (k === 'm') video.muted = !video.muted;
    else if (k === 'escape' && !document.fullscreenElement) back(`/titulo/${encodeURIComponent(it.t.titleKey)}`);
    else return;
    showControls();
  };
  document.addEventListener('keydown', onKey);
  root.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') showControls(); });

  // Media Session: carátula y controles en la pantalla bloqueada / Centro de control.
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: it.ep ? it.sub : it.title, artist: it.ep ? it.title : 'HomeFlix', album: 'HomeFlix', artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }] });
      const h = { play: P.play, pause: P.pause, seekbackward: () => P.seek(P.time() - 10), seekforward: () => P.seek(P.time() + 10), seekto: (d) => P.seek(d.seekTime) };
      for (const [a, fn] of Object.entries(h)) navigator.mediaSession.setActionHandler(a, fn);
    } catch { /* no soportado */ }
  }

  // PiP solo con video real.
  if (!P.simulated && (document.pictureInPictureEnabled || video.webkitSupportsPresentationMode)) $('[data-pip]').hidden = false;

  const onVis = () => { if (document.hidden) save(); };
  document.addEventListener('visibilitychange', onVis);

  function showNext() {
    const card = $('[data-next]');
    if (!card || !card.hidden) return;
    card.hidden = false;
    requestAnimationFrame(() => card.classList.add('in'));
    if (!L.prefs().autoplay || state.design) { const c = $('[data-count]'); if (c) c.parentElement.textContent = 'Siguiente capítulo'; return; }
    let n = 10;
    clearInterval(nextTimer);
    nextTimer = setInterval(() => {
      if (P.state() !== 'playing') return;
      n -= 1;
      const c = $('[data-count]');
      if (c) c.textContent = String(Math.max(0, n));
      if (n <= 0) { clearInterval(nextTimer); save(); go(playHref(nextEp.video), { replace: true }); }
    }, 1000);
  }
  function hideNext() { clearInterval(nextTimer); const c = $('[data-next]'); c?.classList.remove('in'); setTimeout(() => { if (c) c.hidden = true; }, 250); }

  root.focus({ preventScroll: true });
  return () => {
    save();
    clearInterval(saveT); clearInterval(nextTimer); clearTimeout(hideT);
    closeTopSheet();
    P.close();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  };
}

function toggleFullscreen(root, video) {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
  const req = root.requestFullscreen || root.webkitRequestFullscreen;
  if (req) {
    Promise.resolve(req.call(root)).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  } else if (!P.simulated && video.webkitEnterFullscreen) {
    // iPhone: solo el <video> puede ir a pantalla completa.
    video.webkitEnterFullscreen();
  }
}

function togglePip(video) {
  if (document.pictureInPictureElement) document.exitPictureInPicture();
  else if (video.requestPictureInPicture) video.requestPictureInPicture().catch(() => {});
  else if (video.webkitSetPresentationMode) video.webkitSetPresentationMode(video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
}
