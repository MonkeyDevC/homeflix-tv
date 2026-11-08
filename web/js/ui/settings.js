// Ajustes, cuenta y guía para instalar en el iPhone.
import { I, icon } from '../icons.js';
import * as L from '../data/library.js';
import { CHAT_ID, CHAT_TITLE } from '../data/demo-items.js';
import { state, applyProfile, signOut, sync, rebuild, isDemo } from '../state.js';
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

const KIND = { saved: 'Guardados', channel: 'Canal', group: 'Grupo', user: 'Chat privado', bot: 'Bot' };
let dialogs = null; // chats de la cuenta (se piden una vez por sesión)

function chatRows() {
  const src = L.enabledSources() || {};
  if (isDemo()) {
    return `<label class="cell"><span class="cell-ic">${I.tv}</span><span class="cell-text"><b>${esc(CHAT_TITLE)}</b><small>${state.full.movies.length} películas · ${state.full.series.length} series</small></span>
        <input type="checkbox" class="switch" data-chat="${esc(String(CHAT_ID))}" data-title="${esc(CHAT_TITLE)}" ${src[CHAT_ID] ? 'checked' : ''}></label>`;
  }
  if (!dialogs) return `<div class="cell"><span class="cell-text"><small>Cargando tus chats…</small></span></div>`;
  return dialogs.filter((c) => c.kind !== 'bot').map((c) => `<label class="cell"><span class="cell-ic">${c.kind === 'channel' ? I.tv : icon('user')}</span>
      <span class="cell-text"><b>${esc(c.title)}</b><small>${KIND[c.kind] || ''}</small></span>
      <input type="checkbox" class="switch" data-chat="${esc(c.id)}" data-title="${esc(c.title)}" ${src[c.id] ? 'checked' : ''}></label>`).join('');
}

export function settings(route) {
  const p = state.profile;
  const pr = L.prefs();
  const first = route?.query?.chats === '1';
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

    <h2 class="group-title">Chats de la biblioteca</h2>
    ${first ? `<p class="fine">Elige de qué chats de Telegram salen las películas y series de <b>${esc(p?.name || 'este perfil')}</b>. Cada perfil tiene los suyos.</p>` : ''}
    <div class="group" data-chats>${chatRows()}</div>
    <div class="group">
      ${cell('sync', 'Sincronizar ahora', { attrs: 'data-sync', value: `<span data-synced>${state.syncing ? 'Actualizando…' : ago(state.syncedAt)}</span>`, right: '' })}
    </div>
    ${first ? btn('Listo, ver mi biblioteca', { cls: 'btn-block', attrs: 'data-done' }) : ''}

    <h2 class="group-title">Perfiles y cuenta</h2>
    <div class="group">
      ${cell('user', 'Administrar perfiles', { href: '#/perfiles?editar=1' })}
      ${cell('lock', 'Cuenta de Telegram', { href: '#/cuenta' })}
    </div>

    <h2 class="group-title">App</h2>
    <div class="group">
      ${cell('addSquare', 'Instalar en tu iPhone', { href: '#/instalar', value: standalone() ? 'Instalada' : '' })}
    </div>
    <p class="fine center">${isDemo() ? 'HomeFlix web · datos de demostración' : 'HomeFlix web · Mi lista, progreso y perfiles iguales en la TV y el celular'}</p>`,
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
      let changed = false;
      const box = el.querySelector('[data-chats]');
      box.addEventListener('change', (e) => {
        const c = e.target.closest('[data-chat]');
        if (!c) return;
        const map = { ...(L.enabledSources() || {}) };
        if (c.checked) map[c.dataset.chat] = c.dataset.title; else delete map[c.dataset.chat];
        L.setEnabledSources(map);
        changed = true;
        rebuild();
        toast(c.checked ? `Mostrando ${c.dataset.title}` : `${c.dataset.title} oculto`);
      });
      if (!isDemo() && !dialogs) {
        globalThis.HFTelegram.dialogs(300).then((list) => { dialogs = list; box.innerHTML = chatRows(); },
          () => { box.innerHTML = '<div class="cell"><span class="cell-text"><small>No pude leer tus chats. Revisa tu conexión.</small></span></div>'; });
      }
      el.querySelector('[data-sync]').onclick = async (e) => {
        const b = e.currentTarget;
        b.classList.add('spinning');
        el.querySelector('[data-synced]').textContent = 'Actualizando…';
        globalThis.HFSync?.now();
        await sync();
        b.classList.remove('spinning');
        el.querySelector('[data-synced]').textContent = ago(state.syncedAt);
        toast(state.syncError || 'Biblioteca al día');
      };
      const done = el.querySelector('[data-done]');
      if (done) done.onclick = () => {
        if (!Object.keys(L.enabledSources() || {}).length) { toast('Elige al menos un chat'); return; }
        go('/inicio', { replace: true });
      };
      /* al salir, si cambiaron los chats: leerlos de nuevo */
      return () => { if (changed) sync(); };
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
      <h1>${isDemo() ? 'Cuenta de demostración' : esc(state.user?.name || 'Tu cuenta de Telegram')}</h1>
      <p>${isDemo() ? 'Sin conexión con Telegram' : state.user?.username ? `@${esc(state.user.username)} · Telegram` : 'Sesión de Telegram en este dispositivo'}</p>
    </div>
    <div class="group">
      <div class="cell"><span class="cell-text"><b>Chats</b></span><span class="cell-value">${esc(Object.values(L.enabledSources() || {}).join(', ') || 'Ninguno')}</span></div>
      <div class="cell"><span class="cell-text"><b>Perfiles</b></span><span class="cell-value">${L.profiles().length}</span></div>
      ${isDemo() ? '' : `<div class="cell"><span class="cell-text"><b>Sincronización</b></span><span class="cell-value">${esc(syncText())}</span></div>`}
    </div>
    <p class="fine">${isDemo() ? 'En la demostración todo se guarda solo en este dispositivo.' : 'Mi lista, el progreso y los perfiles se guardan en tus Mensajes guardados de Telegram (homeflix-sync.json) y son los mismos en la TV y el celular.'}</p>
    <div class="group">${cell('logout', 'Cerrar sesión', { attrs: 'data-out', danger: true, right: '' })}</div>`,
    mount(el) {
      el.querySelector('[data-out]').onclick = async () => {
        if (!confirm('¿Cerrar sesión en este dispositivo?')) return;
        await signOut();
        go('/login', { replace: true });
      };
    },
  };
}

function syncText() {
  const st = globalThis.HFSync?.status();
  if (!st || st.state === 'off') return 'Apagada';
  if (st.state === 'busy') return 'Sincronizando…';
  if (st.state === 'error') return 'Con error';
  return st.at ? ago(st.at) : 'Pendiente';
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
