// Ficha de película y de serie.
import { I } from '../icons.js';
import * as L from '../data/library.js';
import * as Art from '../data/art.js';
import { state } from '../state.js';
import { playHref, go } from '../router.js';
import { esc, img, card, row, meta, btn, iconBtn, backBtn, empty, pct, toast, hydrate } from './components.js';
import { sheetQuality, openSheet, options, onPick } from './sheets.js';

const remaining = (p) => L.formatDuration(Math.max(60, p.d - p.t));

export function detail(route) {
  const t = state.lib.titles[route.params.key];
  if (!t) {
    return { cls: 'v-detail', html: `<header class="navbar"><div class="navbar-inner">${backBtn()}</div></header><div class="pad-top">${empty('info', 'No encontramos este título', 'Puede que ya no esté en el grupo o que este perfil no lo muestre.')}</div>` };
  }
  return t.type === 'movie' ? movie(t, route) : series(t, route);
}

function top(t) {
  return `<header class="navbar navbar-transparent detail-bar" data-navbar>
      <div class="navbar-inner">${backBtn()}<span class="navbar-title">${esc(t.name)}</span>
      <span class="nav-right">${iconBtn('share', 'Compartir', 'data-share', 'icon-btn-glass')}</span></div></header>
    <div class="detail-hero">${img(t.bannerKey || t.imageKey, 'detail-img', '')}</div>`;
}

function more(t) {
  const same = [...state.lib.movies, ...state.lib.series]
    .filter((x) => x !== t && x.categories.some((c) => t.categories.includes(c)))
    .slice(0, 10);
  return row(`También de ${esc(t.chatTitle || 'NETSUCKS')}`, '', same.map((x) => card(x)).join(''));
}

function common(el, t, extra = {}) {
  el.style.setProperty('--tint', Art.color(t.titleKey, 16));
  el.querySelector('[data-share]').onclick = async () => {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: t.name, text: `${t.name} en HomeFlix`, url });
      else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
    } catch { /* cancelado */ }
  };
  const ml = el.querySelector('[data-mylist]');
  if (ml) ml.onclick = () => {
    const added = L.toggleMyList(t.titleKey);
    ml.innerHTML = `${added ? I.check : I.plus}<span>Mi lista</span>`;
    ml.classList.toggle('on', added);
    toast(added ? 'Agregado a Mi lista' : 'Quitado de Mi lista');
  };
  return extra;
}

function chips(t) {
  return t.categories.length ? `<div class="chips-wrap">${t.categories.map((c) => `<a class="chip" href="#/categorias/${encodeURIComponent(c)}">${esc(c)}</a>`).join('')}</div>` : '';
}

// ---------- Película ----------
function movie(t, route) {
  const p = L.progress(t.video);
  const watching = p && !p.done && p.t > 30;
  const pref = L.prefs().quality;
  const sel = t.versions.find((v) => v.slot === pref) || t.versions.find((v) => v.q === '1080p') || t.versions[0];
  return {
    cls: 'v-detail',
    html: `${top(t)}
    <div class="detail-body">
      <h1 class="detail-title">${esc(t.name)}</h1>
      ${meta(t)}
      <div class="detail-actions">
        <a class="btn btn-primary btn-block btn-play" data-play href="${playHref(t.video, watching ? p.t : 0)}">${I.play}<span>${watching ? `Continuar · quedan ${remaining(p)}` : 'Ver ahora'}</span></a>
        ${watching ? `<div class="detail-progress"><span class="bar"><i style="width:${pct(p)}%"></i></span></div>` : ''}
        <div class="action-row">
          <button class="action ${L.inMyList(t.titleKey) ? 'on' : ''}" type="button" data-mylist>${L.inMyList(t.titleKey) ? I.check : I.plus}<span>Mi lista</span></button>
          <button class="action" type="button" data-quality>${I.layers}<span data-qlabel>${sel.q}</span></button>
          ${watching ? `<a class="action" href="${playHref(t.video, 0)}">${I.rew}<span>Desde el inicio</span></a>` : ''}
        </div>
      </div>
      <p class="detail-desc">${esc(t.description) || 'Sin descripción.'}</p>
      ${chips(t)}
      <h2 class="sec-title">Versiones</h2>
      <div class="group versions">${t.versions.map((v) => `<div class="cell"><span class="seal">${v.q}</span>
        <span class="cell-text"><b>${v.q === '4K' ? '4K Ultra HD' : v.q}</b><small>${L.formatSize(v.size)}${v.n > 1 ? ` · ${v.n} partes, se ven como una sola` : ''}</small></span></div>`).join('')}</div>
    </div>
    ${more(t)}`,
    mount(el) {
      let slot = sel.slot;
      const play = el.querySelector('[data-play]');
      const setQ = (s) => {
        slot = s;
        el.querySelector('[data-qlabel]').textContent = t.versions.find((v) => v.slot === s).q;
        play.href = `${playHref(t.video, watching ? p.t : 0)}${watching ? '&' : '?'}q=${encodeURIComponent(s)}`;
      };
      el.querySelector('[data-quality]').onclick = () => sheetQuality(t.versions, slot, setQ);
      common(el, t);
      if (route.query.sheet === 'quality') setTimeout(() => sheetQuality(t.versions, slot, setQ), 50);
    },
  };
}

// ---------- Serie ----------
function episodeRow(ep, t) {
  const p = L.progress(ep.video);
  const w = p ? pct(p) : 0;
  return `<a class="episode" href="${playHref(ep.video, p && !p.done ? p.t : 0)}">
    <span class="ep-art">${img(t.imageKey, '', '')}<span class="ep-play">${I.play}</span>${w ? `<span class="bar"><i style="width:${w}%"></i></span>` : ''}</span>
    <span class="ep-text"><b>${ep.episode}. ${esc(ep.title)}</b><small>${L.formatDuration(ep.duration)}${p?.done ? ' · Visto' : ''}</small>
      <span class="ep-desc">${esc(ep.description)}</span></span>
  </a>`;
}

function series(t, route) {
  const next = L.nextEpisode(t);
  const p = L.progress(next.video);
  const started = Object.keys(L.allProgress()).some((k) => state.lib.byKey[k]?.titleKey === t.titleKey);
  let season = +(route.query.t || next.season);
  if (!t.seasons.some((s) => s.number === season)) season = t.seasons[0].number;
  const seasonHtml = (n) => t.seasons.find((s) => s.number === n).episodes.map((e) => episodeRow(e, t)).join('');
  const label = started ? `${p && !p.done && p.t > 30 ? 'Continuar' : 'Ver'} T${next.season}:E${next.episode}` : 'Ver T1:E1';
  return {
    cls: 'v-detail',
    html: `${top(t)}
    <div class="detail-body">
      <h1 class="detail-title">${esc(t.name)}</h1>
      ${meta(t)}
      <div class="detail-actions">
        <a class="btn btn-primary btn-block btn-play" href="${playHref(next.video, p && !p.done ? p.t : 0)}">${I.play}<span>${label}</span></a>
        ${p && !p.done && p.t > 30 ? `<div class="detail-progress"><span class="bar"><i style="width:${pct(p)}%"></i></span><small>${esc(next.title)} · quedan ${remaining(p)}</small></div>` : ''}
        <div class="action-row">
          <button class="action ${L.inMyList(t.titleKey) ? 'on' : ''}" type="button" data-mylist>${L.inMyList(t.titleKey) ? I.check : I.plus}<span>Mi lista</span></button>
        </div>
      </div>
      <p class="detail-desc">${esc(t.description) || 'Sin descripción.'}</p>
      ${chips(t)}
      <div class="season-head">
        ${t.seasons.length > 1 ? `<button class="season-btn" type="button" data-season>Temporada <span data-sn>${season}</span> ${I.down}</button>` : `<h2 class="sec-title">Temporada ${season}</h2>`}
        <span class="note">${t.seasons.find((s) => s.number === season).episodes.length} capítulos</span>
      </div>
      <div class="episodes" data-eps>${seasonHtml(season)}</div>
    </div>
    ${more(t)}`,
    mount(el) {
      common(el, t);
      const btnS = el.querySelector('[data-season]');
      if (btnS) btnS.onclick = () => openSheet({
        title: 'Temporadas',
        body: options(t.seasons.map((s) => ({ value: String(s.number), label: `Temporada ${s.number}`, note: `${s.episodes.length} capítulos` })), String(season), 'season'),
        onMount: (sh, api) => onPick(sh, (v) => {
          season = +v;
          el.querySelector('[data-sn]').textContent = v;
          el.querySelector('[data-eps]').innerHTML = seasonHtml(season);
          el.querySelector('.season-head .note').textContent = `${t.seasons.find((s) => s.number === season).episodes.length} capítulos`;
          hydrate(el);
          setTimeout(api.close, 180);
        }),
      });
    },
  };
}

export { go };
