// Entrada: login (número / QR / código / contraseña), perfiles, editar perfil y PIN.
import { I, icon } from '../icons.js';
import * as L from '../data/library.js';
import { state, signIn, chooseProfile } from '../state.js';
import { go, back } from '../router.js';
import { esc, logo, btn, navbar, avatar, AVATAR_COUNT, toast } from './components.js';

// ---------- Bienvenida ----------
export function login() {
  return {
    cls: 'v-login',
    html: `<div class="login-hero" aria-hidden="true">${mosaic()}</div>
    <div class="login-panel">
      ${logo('logo-lg')}
      <h1 class="login-title">Tus películas y series, en tu iPhone</h1>
      <p class="login-text">Entra con tu cuenta de Telegram para ver lo que comparte tu grupo.</p>
      ${btn('Entrar con mi número', { ic: 'phone', href: '#/login/numero', cls: 'btn-block' })}
      ${btn('Usar código QR', { kind: 'secondary', ic: 'qr', href: '#/login/qr', cls: 'btn-block' })}
      <button class="link-btn" type="button" data-demo>Probar con datos de demostración</button>
    </div>`,
    mount(el) { el.querySelector('[data-demo]').onclick = enterDemo; },
  };
}

function mosaic() {
  const ts = state.full ? [...state.full.movies, ...state.full.series].slice(0, 12) : [];
  return `<div class="mosaic">${ts.map((t, i) => `<img class="art" data-img="${esc(t.imageKey)}" alt="" style="--i:${i}">`).join('')}</div>`;
}

function enterDemo() { signIn('demo'); go('/perfiles', { replace: true }); }

// ---------- QR ----------
function fakeQr(seed = 7) {
  // Código de ejemplo (no es un QR real). El motor real lo dibuja con HFTelegram.qrSvg(url, celda).
  const N = 25; let x = seed; const r = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
  let cells = '';
  const finder = (cx, cy) => `<rect x="${cx}" y="${cy}" width="7" height="7" rx="1.5" fill="none" stroke="#111" stroke-width="1"/><rect x="${cx + 2}" y="${cy + 2}" width="3" height="3" rx=".6" fill="#111"/>`;
  for (let y = 0; y < N; y += 1) for (let xx = 0; xx < N; xx += 1) {
    const inF = (xx < 8 && y < 8) || (xx > N - 9 && y < 8) || (xx < 8 && y > N - 9);
    if (!inF && r() > 0.52) cells += `<rect x="${xx}" y="${y}" width="1" height="1" rx=".3" fill="#111"/>`;
  }
  return `<svg viewBox="-1.5 -1.5 ${N + 3} ${N + 3}" class="qr-svg"><rect x="-1.5" y="-1.5" width="${N + 3}" height="${N + 3}" rx="2" fill="#fff"/>${cells}${finder(0.5, 0.5)}${finder(N - 7.5, 0.5)}${finder(0.5, N - 7.5)}
    <circle cx="${N / 2}" cy="${N / 2}" r="3.2" fill="#fff"/><image href="icons/panda.png" x="${N / 2 - 2.6}" y="${N / 2 - 2.6}" width="5.2" height="5.2"/></svg>`;
}

export function loginQr() {
  return {
    cls: 'v-form',
    html: `${navbar({ title: '' })}
    <div class="form-wrap">
      <h1 class="form-title">Escanea con otro dispositivo</h1>
      <p class="form-text">Sirve si tienes Telegram abierto en otro teléfono, tablet o computadora.</p>
      <div class="qr-box">${fakeQr()}<span class="qr-badge">Código de ejemplo</span></div>
      <ol class="steps">
        <li><span>1</span>Abre Telegram en el otro dispositivo</li>
        <li><span>2</span>Ve a <b>Ajustes → Dispositivos</b></li>
        <li><span>3</span>Toca <b>Vincular un dispositivo</b> y apunta a este código</li>
      </ol>
      ${btn('Ya lo escaneé', { cls: 'btn-block', attrs: 'data-demo' })}
    </div>`,
    mount(el) { el.querySelector('[data-demo]').onclick = () => go('/login/clave'); },
  };
}

// ---------- Número ----------
export function loginPhone() {
  return {
    cls: 'v-form',
    html: `${navbar()}
    <form class="form-wrap" data-form autocomplete="on">
      <h1 class="form-title">Tu número</h1>
      <p class="form-text">Te enviaremos un código por Telegram.</p>
      <label class="field"><span>País y número</span>
        <input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+57 300 123 4567" required></label>
      <p class="fine">Esta opción todavía no está en el motor. En esta versión de prueba cualquier número sirve.</p>
      ${btn('Continuar', { cls: 'btn-block', attrs: 'type="submit"' })}
    </form>`,
    mount(el) {
      const f = el.querySelector('[data-form]');
      f.onsubmit = (e) => { e.preventDefault(); if (f.phone.value.replace(/\D/g, '').length < 7) { toast('Revisa el número'); return; } go('/login/codigo'); };
    },
  };
}

// ---------- Código ----------
export function loginCode() {
  return {
    cls: 'v-form',
    html: `${navbar()}
    <form class="form-wrap" data-form>
      <h1 class="form-title">Escribe el código</h1>
      <p class="form-text">Lo mandamos a tu Telegram, en el chat de <b>Telegram</b>.</p>
      <div class="code-boxes" data-boxes>${'<span></span>'.repeat(5)}</div>
      <input class="code-input" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="5" pattern="[0-9]*" aria-label="Código">
      ${btn('Continuar', { cls: 'btn-block', attrs: 'type="submit"' })}
    </form>`,
    mount(el) {
      const f = el.querySelector('[data-form]');
      const boxes = [...el.querySelectorAll('[data-boxes] span')];
      const paint = () => {
        const v = f.code.value.replace(/\D/g, '').slice(0, 5);
        f.code.value = v;
        boxes.forEach((b, i) => { b.textContent = v[i] || ''; b.classList.toggle('cur', i === v.length); });
        if (v.length === 5) f.requestSubmit();
      };
      f.code.addEventListener('input', paint);
      el.querySelector('[data-boxes]').onclick = () => f.code.focus();
      f.onsubmit = (e) => { e.preventDefault(); if (f.code.value.length === 5) go('/login/clave'); };
      paint();
      setTimeout(() => f.code.focus(), 350);
    },
  };
}

// ---------- Contraseña de dos pasos ----------
export function loginPassword() {
  return {
    cls: 'v-form',
    html: `${navbar()}
    <form class="form-wrap" data-form>
      <h1 class="form-title">Tu contraseña</h1>
      <p class="form-text">Tu cuenta tiene verificación en dos pasos. Es la contraseña que pusiste en Telegram.</p>
      <input name="user" autocomplete="username" value="telegram" hidden>
      <label class="field field-pass"><span>Contraseña</span>
        <input name="pass" type="password" autocomplete="current-password" required>
        <button type="button" class="field-eye" data-eye aria-label="Mostrar contraseña">Mostrar</button></label>
      ${btn('Entrar', { cls: 'btn-block', attrs: 'type="submit"' })}
    </form>`,
    mount(el) {
      const f = el.querySelector('[data-form]');
      el.querySelector('[data-eye]').onclick = (e) => {
        const show = f.pass.type === 'password';
        f.pass.type = show ? 'text' : 'password';
        e.currentTarget.textContent = show ? 'Ocultar' : 'Mostrar';
      };
      f.onsubmit = (e) => { e.preventDefault(); enterDemo(); };
    },
  };
}

// ---------- Perfiles ----------
export function profiles(route) {
  const editing = route.query.editar === '1';
  const list = L.profiles();
  return {
    cls: 'v-profiles',
    html: `<header class="profiles-top">${logo()}<button class="link-btn" type="button" data-edit>${editing ? 'Listo' : 'Editar'}</button></header>
    <h1 class="profiles-title">${editing ? 'Editar perfiles' : '¿Quién está viendo?'}</h1>
    <div class="profiles-grid ${editing ? 'editing' : ''}">
      ${list.map((p) => `<button class="profile" type="button" data-id="${esc(p.id)}">
        <span class="profile-av">${avatar(p, 'avatar-lg')}${editing ? `<span class="profile-edit">${I.edit}</span>` : p.pin ? `<span class="profile-lock">${I.lock}</span>` : ''}</span>
        <span class="profile-name">${esc(p.name)}</span></button>`).join('')}
      ${list.length < 6 ? `<a class="profile" href="#/perfiles/editar/nuevo"><span class="profile-av profile-add">${icon('plus')}</span><span class="profile-name">Agregar</span></a>` : ''}
    </div>`,
    mount(el) {
      el.querySelector('[data-edit]').onclick = () => go(editing ? '/perfiles' : '/perfiles?editar=1', { replace: true });
      el.querySelectorAll('[data-id]').forEach((b) => {
        b.onclick = () => {
          const p = list.find((x) => x.id === b.dataset.id);
          if (editing) go(`/perfiles/editar/${encodeURIComponent(p.id)}`);
          else if (p.pin) go(`/pin/${encodeURIComponent(p.id)}`);
          else { chooseProfile(p.id); go('/inicio', { replace: true }); }
        };
      });
    },
  };
}

// ---------- Editar perfil ----------
export function profileEdit(route) {
  const isNew = route.params.id === 'nuevo';
  const p = isNew ? { name: '', avatar: L.profiles().length % AVATAR_COUNT, kids: false, pin: null } : L.profiles().find((x) => x.id === route.params.id);
  if (!p) return { redirect: '/perfiles' };
  return {
    cls: 'v-form',
    html: `${navbar({ title: isNew ? 'Nuevo perfil' : 'Editar perfil' })}
    <form class="form-wrap" data-form>
      <div class="av-current" data-cur>${avatar(p, 'avatar-xl')}</div>
      <div class="av-pick" role="radiogroup" aria-label="Elige un avatar">${Array.from({ length: AVATAR_COUNT }, (_, i) => `
        <button type="button" role="radio" aria-checked="${i === p.avatar}" data-av="${i}" aria-label="Avatar ${i + 1}">${avatar({ avatar: i }, 'avatar-sm')}</button>`).join('')}</div>
      <label class="field"><span>Nombre</span><input name="name" maxlength="16" value="${esc(p.name)}" required autocomplete="off" autocapitalize="words"></label>
      <div class="group">
        <label class="cell"><span class="cell-text"><b>Perfil infantil</b><small>Solo muestra lo marcado como infantil</small></span>
          <input type="checkbox" class="switch" name="kids" ${p.kids ? 'checked' : ''}></label>
        <label class="cell"><span class="cell-text"><b>PIN de 4 números</b><small>Déjalo vacío para no pedirlo</small></span>
          <input class="pin-field" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" value="${esc(p.pin || '')}" autocomplete="off" aria-label="PIN"></label>
      </div>
      ${btn('Guardar', { cls: 'btn-block', attrs: 'type="submit"' })}
      ${!isNew && L.profiles().length > 1 ? btn('Eliminar perfil', { kind: 'danger', ic: 'trash', cls: 'btn-block', attrs: 'data-del' }) : ''}
    </form>`,
    mount(el) {
      const f = el.querySelector('[data-form]');
      let av = p.avatar;
      el.querySelectorAll('[data-av]').forEach((b) => {
        b.onclick = () => {
          av = +b.dataset.av;
          el.querySelectorAll('[data-av]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
          el.querySelector('[data-cur]').innerHTML = avatar({ avatar: av, kids: f.kids.checked }, 'avatar-xl');
        };
      });
      f.onsubmit = (e) => {
        e.preventDefault();
        const pin = f.pin.value.trim();
        if (pin && !/^\d{4}$/.test(pin)) { toast('El PIN son 4 números'); return; }
        L.saveProfile({ ...(isNew ? {} : { id: p.id }), name: f.name.value.trim() || 'Perfil', avatar: av, kids: f.kids.checked, pin: pin || null });
        back('/perfiles?editar=1');
      };
      const del = el.querySelector('[data-del]');
      if (del) del.onclick = () => { if (confirm(`¿Eliminar el perfil «${p.name}»?`)) { L.deleteProfile(p.id); back('/perfiles?editar=1'); } };
    },
  };
}

// ---------- PIN ----------
export function pin(route) {
  const p = L.profiles().find((x) => x.id === route.params.id);
  if (!p) return { redirect: '/perfiles' };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return {
    cls: 'v-pin',
    html: `${navbar()}
    <div class="pin-wrap">
      ${avatar(p, 'avatar-lg')}
      <h1 class="pin-title">PIN de ${esc(p.name)}</h1>
      <div class="pin-dots" data-dots>${'<i></i>'.repeat(4)}</div>
      <p class="pin-hint" data-hint>${state.design ? 'En la demostración el PIN de Santi es 1234' : '&nbsp;'}</p>
      <div class="keypad">${keys.map((k) => k === '' ? '<span></span>'
        : k === 'del' ? `<button type="button" class="key key-del" data-k="del" aria-label="Borrar">${I.back}</button>`
        : `<button type="button" class="key" data-k="${k}">${k}</button>`).join('')}</div>
    </div>`,
    mount(el) {
      let v = '';
      const dots = [...el.querySelectorAll('[data-dots] i')];
      const box = el.querySelector('[data-dots]');
      const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < v.length));
      const press = (k) => {
        if (k === 'del') v = v.slice(0, -1);
        else if (v.length < 4) v += k;
        paint();
        if (v.length === 4) {
          if (L.checkPin(p.id, v)) { chooseProfile(p.id); setTimeout(() => go('/inicio', { replace: true }), 120); }
          else {
            box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
            el.querySelector('[data-hint]').textContent = 'Ese no es. Inténtalo otra vez';
            setTimeout(() => { v = ''; paint(); }, 400);
          }
        }
      };
      el.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => press(b.dataset.k); });
      const onKey = (e) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    },
  };
}
