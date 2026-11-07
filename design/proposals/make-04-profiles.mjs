// Propuestas 04 (¿Quién está viendo?), 05 (Editar perfil), 06 (Chats de la biblioteca) y 06b (ayuda abierta).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { avatar, AVATAR_IDS, AVATAR_NAMES } from './avatars.mjs';

const here = join(fileURLToPath(import.meta.url), '..');

const ic = {
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M15 17l5-5-5-5"/><path d="M20 12H9"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  plane: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.5-2.7 4"/><path d="M12 17.3h.01"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  all: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12l3 3 5-6"/></svg>',
  none: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/></svg>',
};

const brand = `<div class="hf2-brand"><div class="hf2-logo"></div><div class="hf2-wordmark">Home<span>Flix</span></div></div>`;
const bg = `<div class="hf2-glow"></div>`;
const kidsBadge = `<em class="hf2-kids">${ic.star}Infantil</em>`;

/* ---------------- 04 · ¿Quién está viendo? ---------------- */
const profiles = [
  ['Familia', 'panda', false, true],
  ['Santiago', 'zorro', false],
  ['Kids', 'dino', true],
  ['Invitado', 'buho', false],
];

const p04 = `<div class="hf2" data-route="profiles">
  ${bg}${brand}
  <div class="hf2-top-actions">
    <div class="hf2-round" data-focusable="true" data-title="Cerrar sesión">${ic.logout}</div>
    <div class="hf2-round" data-focusable="true" data-title="Ajustes">${ic.gear}</div>
  </div>
  <h1 class="hf2-who">¿Quién está viendo?</h1>
  <div class="hf2-profiles">
    ${profiles.map(([n, a, kids, f]) => `<div class="hf2-profile" data-focusable="true"${f ? ' data-focused="true"' : ''}><div class="hf2-avatar pic">${avatar(a)}${kids ? kidsBadge : ''}</div><div class="hf2-pname">${n}</div></div>`).join('')}
    <div class="hf2-profile" data-focusable="true"><div class="hf2-avatar add">+</div><div class="hf2-pname">Agregar</div></div>
  </div>
  <div class="hf2-center-actions"><div class="hf2-btn ghost small icon" data-focusable="true">${ic.pencil}Editar perfiles</div></div>
  <div class="hf2-account">${ic.plane}Conectado con Telegram como <b>Usuario Demo</b> · @usuario</div>
  <div class="hf2-footer"><span>Elige quién va a ver</span><span class="keys">◀ ▶ Elegir · ▼ Editar perfiles · ▲ Ajustes · OK Entrar</span></div>
  <div class="hf2-version">HomeFlix v1.1.0</div>
</div>`;

/* ---------------- 05 · Editar perfil ---------------- */
const chosen = 'dino';
const p05 = `<div class="hf2" data-route="profile-edit">
  ${bg}${brand}
  <div class="hf2-panel edit">
    <div class="hf2-edit-preview">
      <div class="hf2-avatar pic big">${avatar(chosen)}${kidsBadge}</div>
      <div class="hf2-pname">Kids</div>
      <div class="hf2-preview-note">Así se verá en «¿Quién está viendo?»</div>
    </div>
    <div class="hf2-panel-main">
      <div class="hf2-kicker">Perfil</div>
      <h1 class="hf2-title small">Editar perfil</h1>
      <div class="hf2-field"><label>Nombre</label><div class="hf2-input">Kids</div></div>
      <div class="hf2-field" data-focusable="true" data-focused="true"><label>Imagen de perfil <span class="hf2-label-hint">${AVATAR_NAMES[chosen]}</span></label>
        <div class="hf2-avatar-grid">${AVATAR_IDS.map((id) => `<span class="hf2-avatar-opt${id === chosen ? ' on' : ''}${id === 'robot' ? ' cursor' : ''}">${avatar(id)}</span>`).join('')}</div>
      </div>
      <div class="hf2-field"><label>Perfil infantil</label>
        <div class="hf2-toggle-row"><span class="hf2-toggle on"><i></i></span><span>Solo ve películas y series marcadas como <b>infantiles</b></span></div>
      </div>
      <div class="hf2-actions">
        <div class="hf2-btn primary small" data-focusable="true">Guardar</div>
        <div class="hf2-btn ghost small danger" data-focusable="true">Borrar perfil</div>
        <div class="hf2-btn ghost small" data-focusable="true">Cancelar</div>
      </div>
    </div>
  </div>
  <div class="hf2-footer"><span>◀ ▶ ▲ ▼ para elegir la imagen · OK para confirmarla</span><span class="keys">OK Seleccionar · BACK Cancelar</span></div>
</div>`;

/* ---------------- 06 · Chats de la biblioteca ---------------- */
const chats = [
  ['Mensajes guardados', 'Guardados', 303, false],
  ['Películas Familia', 'Canal', 128, true, true],
  ['Series HD', 'Canal', 64, false],
  ['Grupo de la familia', 'Grupo', 13, false],
  ['Dibujos animados', 'Canal', 42, true],
  ['Documentales', 'Grupo', 7, false],
];

function settings(helpOpen) {
  return `<div class="hf2" data-route="settings">
  ${bg}${brand}
  <div class="hf2-top-actions">
    <div class="hf2-round" data-focusable="true"${helpOpen ? ' data-focused="true"' : ''} data-title="Ayuda">${ic.help}</div>
    <div class="hf2-btn primary small top" data-focusable="true">Listo</div>
  </div>
  <div class="hf2-settings">
    <div class="hf2-kicker">Ajustes</div>
    <h1 class="hf2-title">¿De qué chats sale tu biblioteca?</h1>
    <p class="hf2-text wide">Activa los grupos, canales o chats donde subes tus películas y series.</p>
    <div class="hf2-toolbar">
      <div class="hf2-pills">
        <span class="hf2-pill on">Canales y grupos <b>57</b></span>
        <span class="hf2-pill">Chats privados <b>242</b></span>
      </div>
      <div class="hf2-segment"><span class="on">Todos</span><span>Seleccionados <b>2</b></span></div>
      <div class="hf2-tools">
        <span class="hf2-tool">${ic.search}Buscar chat</span>
        <span class="hf2-tool">${ic.all}Seleccionar todo</span>
        <span class="hf2-tool">${ic.none}Desmarcar todo</span>
      </div>
    </div>
    <div class="hf2-chatlist">
      ${chats.map(([n, k, v, on, f]) => `<div class="hf2-chat${on ? ' on' : ''}" data-focusable="true"${f && !helpOpen ? ' data-focused="true"' : ''}><span class="hf2-check">${on ? ic.check : ''}</span><span class="hf2-chat-name">${n}</span><span class="hf2-chat-kind">${k}</span><span class="hf2-chat-count">${v} videos</span></div>`).join('')}
    </div>
  </div>
  ${helpOpen ? `<div class="hf2-help-pop">
    <div class="hf2-help-title">Cómo ordena HomeFlix tus videos</div>
    <p>Escribe esto en el comentario de cada video al subirlo a Telegram:</p>
    <div class="hf2-help-row"><span class="hf2-help-tag">Película</span><code>pelicula#Coco (2017)#Un niño viaja…</code></div>
    <div class="hf2-help-row"><span class="hf2-help-tag">Capítulo</span><code>serie(1/3)#Bluey#Juegan a los médicos</code></div>
    <div class="hf2-help-row"><span class="hf2-help-tag">Infantil</span><code>… #infantil</code><span class="hf2-help-note">al final, para los perfiles infantiles</span></div>
    <p class="dim">¿Ya los subiste sin comentario? Ábrelos en «Sin clasificar» y usa <b>Etiquetar</b> desde la TV.</p>
    <div class="hf2-btn ghost small" data-focusable="true" data-focused="true">Entendido</div>
  </div>` : ''}
  <div class="hf2-footer"><span>2 chats activos · Películas Familia, Dibujos animados</span><span class="keys">OK Activar / desactivar · ▲ Herramientas · BACK Guardar y salir</span></div>
</div>`;
}

writeFileSync(join(here, '04-profiles.html'), JSON.stringify({ label: '¿Quién está viendo?', html: p04 }));
writeFileSync(join(here, '05-profile-edit.html'), JSON.stringify({ label: 'Editar perfil', html: p05 }));
writeFileSync(join(here, '06-settings.html'), JSON.stringify({ label: 'Ajustes: chats de la biblioteca', html: settings(false) }));
writeFileSync(join(here, '06b-settings-help.html'), JSON.stringify({ label: 'Ajustes: ayuda del formato abierta', html: settings(true) }));
console.log('propuestas 04, 05, 06 y 06b listas');
