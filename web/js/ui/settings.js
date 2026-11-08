// Ajustes, cuenta y guía para instalar en el iPhone.
import { I, icon } from '../icons.js';
import * as L from '../data/library.js';
import { CHAT_TITLE } from '../data/demo-items.js';
import { state, applyProfile, signOut, sync } from '../state.js';
import { go } from '../router.js';
import { esc, largeTitle, navbar, avatar, toast, btn } from './components.js';
import { openSheet, options, onPick } from './sheets.js';
import { standalone } from '../gestures.js';

const QUALITY = [
  { value: 'auto', label: 'Automática', note: 'La mejor que aguante tu conexión' },
  { value: '1080p', label: '1080p', note: 'Alta definición' },
  { value: '720p', label: '720p', note: 'Gasta menos datos' },
  { value: '360p', label: '360p', note: 'Para conexiones lentas' },
];

const cell = (ic, label, { href, value = '', attrs = '', danger = false, right = I.chevron } = {}) => {
  const inner = `<span class="cell-ic ${danger ? 'danger' : ''}">${icon(ic)}</span><span class="cell-text"><b>${label}</b></span><span class="cell-value">${value}</span>${right}`;
  return href ? `<a class="cell cell-link ${danger ? 'danger' : ''}" href="${href}" ${attrs}>${inner}</a>`
    : `<button class="cell cell-link ${danger ? 'danger' : ''}" type="button" ${attrs}>${inner}</button>`;
};

export function settings() {
  const p = state.profile;
  const pr = L.prefs();
  const src = L.enabledSources();
  const on = !src || src.includes(CHAT_TITLE);
  return {
    cls: 'v-settings',
    html: `${largeTitle('Ajustes', { back: true })}
    <a class="profile-card" href="#/perfiles">${p ? avatar(p, 'avatar-md') : ''}
      <span class="cell-text"><b>${esc(p?.name || 'Sin perfil')}</b><small>${p?.kids ? 'Perfil infantil · ' : ''}Cambiar de perfil</small></span>${I.chevron}</a>

    <h2 class="group-title">Reproducción</h2>
    <div class="group">
      ${cell('layers', 'Calidad preferida', { attrs: 'data-quality', value: `<span data-qv>${QUALITY.find((q) => q.value === pr.quality)?.label}</span>` })}
      <label class="cell"><span class="cell-ic">${I.next}</span><span class="cell-text"><b>Siguiente capítulo solo</b><small>Empieza el siguiente al terminar</small></span>
        <input type="checkbox" class="switch" data-autoplay ${pr.autoplay ? 'checked' : ''}></label>
    </div>

    <h2 class="group-title">Biblioteca</h2>
    <div class="group">
      <label class="cell"><span class="cell-ic">${I.tv}</span><span class="cell-text"><b>${esc(CHAT_TITLE)}</b><small>${state.full.movies.length} películas · ${state.full.series.length} series</small></span>
        <input type="checkbox" class="switch" data-source ${on ? 'checked' : ''}></label>
      ${cell('sync', 'Sincronizar ahora', { attrs: 'data-sync', value: `<span data-synced>${ago(state.syncedAt)}</span>`, right: '' })}
    </div>

    <h2 class="group-title">Perfiles y cuenta</h2>
    <div class="group">
      ${cell('user', 'Administrar perfiles', { href: '#/perfiles?editar=1' })}
      ${cell('lock', 'Cuenta de Telegram', { href: '#/cuenta' })}
    </div>

    <h2 class="group-title">App</h2>
    <div class="group">
      ${cell('addSquare', 'Instalar en tu iPhone', { href: '#/instalar', value: standalone() ? 'Instalada' : '' })}
    </div>
    <p class="fine center">HomeFlix web · versión de prueba con datos de demostración</p>`,
    mount(el) {
      el.querySelector('[data-quality]').onclick = () => openSheet({
        title: 'Calidad preferida',
        body: options(QUALITY, L.prefs().quality, 'pq'),
        onMount: (sh, api) => onPick(sh, (v) => {
          L.setPrefs({ quality: v });
          el.querySelector('[data-qv]').textContent = QUALITY.find((q) => q.value === v).label;
          setTimeout(api.close, 180);
        }),
      });
      el.querySelector('[data-autoplay]').onchange = (e) => L.setPrefs({ autoplay: e.target.checked });
      el.querySelector('[data-source]').onchange = (e) => {
        L.setEnabledSources(e.target.checked ? [CHAT_TITLE] : []);
        applyProfile();
        toast(e.target.checked ? `Mostrando ${CHAT_TITLE}` : `${CHAT_TITLE} oculto`);
      };
      el.querySelector('[data-sync]').onclick = async (e) => {
        const b = e.currentTarget;
        b.classList.add('spinning');
        await new Promise((r) => setTimeout(r, 900));
        sync();
        b.classList.remove('spinning');
        el.querySelector('[data-synced]').textContent = ago(state.syncedAt);
        toast('Biblioteca al día');
      };
    },
  };
}

function ago(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'Hace un momento';
  const m = Math.round(s / 60);
  return m < 60 ? `Hace ${m} min` : `Hace ${Math.round(m / 60)} h`;
}

export function account() {
  return {
    cls: 'v-settings',
    html: `${navbar({ title: 'Cuenta' })}
    <div class="account-head">
      <span class="account-av">${icon('user')}</span>
      <h1>Cuenta de demostración</h1>
      <p>Sesión de Telegram en este dispositivo</p>
    </div>
    <div class="group">
      <div class="cell"><span class="cell-text"><b>Grupo</b></span><span class="cell-value">${esc(CHAT_TITLE)}</span></div>
      <div class="cell"><span class="cell-text"><b>Perfiles</b></span><span class="cell-value">${L.profiles().length}</span></div>
    </div>
    <p class="fine">Tus perfiles, tu progreso y Mi lista se guardan solo en este dispositivo.</p>
    <div class="group">${cell('logout', 'Cerrar sesión', { attrs: 'data-out', danger: true, right: '' })}</div>`,
    mount(el) {
      el.querySelector('[data-out]').onclick = () => {
        if (!confirm('¿Cerrar sesión en este dispositivo?')) return;
        signOut();
        go('/login', { replace: true });
      };
    },
  };
}

export function guide() {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const done = standalone();
  return {
    cls: 'v-settings',
    html: `${navbar({ title: 'Instalar' })}
    <div class="guide">
      <img class="guide-icon" src="icons/apple-touch-icon.png" alt="" width="84" height="84">
      <h1>${done ? 'Ya tienes HomeFlix instalada' : 'Ten HomeFlix en tu pantalla de inicio'}</h1>
      <p>${done ? 'Ábrela desde su ícono, como cualquier app.' : 'Se abre a pantalla completa, como una app, sin pasar por la App Store.'}</p>
      ${done ? '' : `<ol class="guide-steps">
        <li><span class="gs-n">1</span><span>Abre esta página en <b>Safari</b>${ios ? '' : ' en tu iPhone'}</span></li>
        <li><span class="gs-n">2</span><span>Toca <b>Compartir</b> <span class="gs-ic">${I.share}</span> abajo en la barra</span></li>
        <li><span class="gs-n">3</span><span>Elige <b>Agregar a inicio</b> <span class="gs-ic">${I.addSquare}</span></span></li>
        <li><span class="gs-n">4</span><span>Toca <b>Agregar</b>. Listo</span></li>
      </ol>`}
      ${btn('Volver a ver', { kind: 'secondary', href: '#/inicio', cls: 'btn-block' })}
    </div>`,
  };
}
