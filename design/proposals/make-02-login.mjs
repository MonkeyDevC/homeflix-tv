// Propuestas 02 (login con QR) y 03 (respaldo: clave de API). Mismo estilo que 01-splash.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { poster, POSTER_COUNT } from './posters.mjs';

const here = join(fileURLToPath(import.meta.url), '..');

// QR real de la captura actual
const snap = JSON.parse(readFileSync(join(here, '..', 'snapshots', '02-login-qr.html'), 'utf8'));
const qr = (/<div id="loginQr">([\s\S]*?<\/svg>)/.exec(snap.html) || [])[1] || '';

const wall = Array.from({ length: 7 }, (_, c) => {
  const tiles = Array.from({ length: 4 }, (_, k) => `<div class="hf2-tile">${poster((c * 5 + k * 3) % POSTER_COUNT)}</div>`).join('');
  return `<div class="hf2-col"><div class="hf2-reel still" style="transform:translate3d(0,-${(c * 137) % 400}px,0)">${tiles}</div></div>`;
}).join('');

const back = `<div class="hf2-wall dim">${wall}</div><div class="hf2-shade strong"></div>
  <div class="hf2-brand"><div class="hf2-logo"></div><div class="hf2-wordmark">Home<span>Flix</span></div></div>`;

const refresh = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>';

const loginQr = `<div class="hf2" data-route="login">
  ${back}
  <div class="hf2-panel">
    <div class="hf2-panel-main">
      <div class="hf2-kicker">Iniciar sesión</div>
      <h1 class="hf2-title">Escanea el código<br>con Telegram</h1>
      <ol class="hf2-steps">
        <li><span>1</span><div>Abre <b>Telegram</b> en tu teléfono.</div></li>
        <li><span>2</span><div>Ve a <b>Ajustes → Dispositivos</b>.</div></li>
        <li><span>3</span><div>Toca <b>Vincular un dispositivo</b> y apunta la cámara al código.</div></li>
      </ol>
      <div class="hf2-note">${refresh}El código se renueva solo cada 30 segundos.</div>
      <div class="hf2-actions">
        <div class="hf2-btn ghost small" data-focusable="true" data-focused="true">Volver</div>
      </div>
    </div>
    <div class="hf2-panel-side">
      <div class="hf2-qr">${qr}</div>
      <div class="hf2-qr-caption">Tu cuenta de Telegram es tu biblioteca:<br>nada que crear ni contraseñas que recordar.</div>
    </div>
  </div>
  <div class="hf2-footer"><span>Esperando que escanees el código…</span><span class="keys">BACK Volver</span></div>
</div>`;

const loginApi = `<div class="hf2" data-route="login">
  ${back}
  <div class="hf2-panel">
    <div class="hf2-panel-main">
      <div class="hf2-kicker">Configurar Telegram</div>
      <h1 class="hf2-title small">Telegram pidió una<br>clave nueva</h1>
      <p class="hf2-text">Pasa muy pocas veces. Escribe los dos valores de tu app de Telegram y seguimos.</p>
      <div class="hf2-field" data-focusable="true" data-focused="true"><label>api_id</label><div class="hf2-input">1234567<i></i></div></div>
      <div class="hf2-field" data-focusable="true"><label>api_hash</label><div class="hf2-input placeholder">32 caracteres</div></div>
      <div class="hf2-error">Telegram ya no acepta la clave incluida en esta versión.</div>
      <div class="hf2-actions">
        <div class="hf2-btn primary small" data-focusable="true">Guardar y continuar</div>
        <div class="hf2-btn ghost small" data-focusable="true">Volver</div>
      </div>
    </div>
    <div class="hf2-panel-side help">
      <div class="hf2-help-title">¿Dónde los consigo?</div>
      <ol class="hf2-steps compact">
        <li><span>1</span><div>Desde el teléfono entra a <b>my.telegram.org</b>.</div></li>
        <li><span>2</span><div>Abre <b>API development tools</b>.</div></li>
        <li><span>3</span><div>Crea una app y copia <b>api_id</b> y <b>api_hash</b>.</div></li>
      </ol>
      <div class="hf2-help-tip">Tip: con Apps2Samsung puedes escribir desde el teclado del teléfono.</div>
    </div>
  </div>
  <div class="hf2-footer"><span>OK para escribir con el teclado de la TV</span><span class="keys">▲ ▼ Navegar · OK Seleccionar · BACK Volver</span></div>
</div>`;

writeFileSync(join(here, '02-login-qr.html'), JSON.stringify({ label: 'Login: código QR de Telegram', html: loginQr }));
writeFileSync(join(here, '03-login-api.html'), JSON.stringify({ label: 'Login: clave de API (respaldo)', html: loginApi }));
console.log('propuestas 02 y 03 listas');
