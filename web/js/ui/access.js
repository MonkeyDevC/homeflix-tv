// Entrada: login (número / QR / código / contraseña), perfiles, editar perfil y PIN.
// El inicio de sesión es el de Telegram de verdad (HFTelegram en ../js/telegram.js): el mismo motor que la TV y el celular.
import { I, icon } from '../icons.js';
import * as L from '../data/library.js';
import { state, signIn, chooseProfile, sync } from '../state.js';
import { go, back } from '../router.js';
import { esc, logo, btn, navbar, avatar, avatarIds, toast } from './components.js';

const T = globalThis.HFTelegram;

/* Lo que se va guardando entre pantallas del inicio de sesión. */
const pending = { phone: '', hash: '', length: 5, via: 'app', until: 0, hint: '', qrAbort: null, pwResolve: null };

function errorText(e) { return T ? T.loginError(e) : String(e && e.message || e); }

/** Ya hay sesión de Telegram: guardar la cuenta y elegir perfil. */
function loggedIn(user) {
  pending.qrAbort = null;
  pending.pwResolve = null;
  signIn(user);
  sync();
  go('/perfiles', { replace: true });
}

function noEngine() {
  if (T && T.available() && T.credentials()) return false;
  toast(T && T.available() ? 'Falta la clave de Telegram en este servidor (.env)' : 'No se cargó el motor de Telegram');
  return true;
}

// ---------- Bienvenida ----------
export function login() {
  return {
    cls: 'v-login',
    html: `<div class="login-hero" aria-hidden="true">${mosaic()}</div>
    <div class="login-panel">
      ${logo('logo-lg')}
      <h1 class="login-title">Tus películas y series, donde estés</h1>
      <p class="login-text">Entra con tu cuenta de Telegram para ver lo que comparte tu grupo.</p>
      ${btn('Entrar con mi número', { ic: 'phone', href: '#/login/numero', cls: 'btn-block' })}
      ${btn('Usar código QR', { kind: 'secondary', ic: 'qr', href: '#/login/qr', cls: 'btn-block' })}
      <button class="link-btn" type="button" data-demo>Probar con datos de demostración</button>
    </div>`,
    mount(el) { el.querySelector('[data-demo]').onclick = enterDemo; },
  };
}

function mosaic() {
  /* Antes de entrar no hay biblioteca: el mosaico usa las portadas que trae la app (images/portadas/) */
  const posters = (globalThis.HF_PORTADAS || []).slice(0, 12);
  if (posters.length) return `<div class="mosaic">${posters.map((src, i) => `<img class="art ready" src="../${esc(src)}" alt="" style="--i:${i}">`).join('')}</div>`;
  const ts = state.full ? [...state.full.movies, ...state.full.series].slice(0, 12) : [];
  return `<div class="mosaic">${ts.map((t, i) => `<img class="art" data-img="${esc(t.imageKey)}" alt="" style="--i:${i}">`).join('')}</div>`;
}

function enterDemo() { signIn('demo'); go('/perfiles', { replace: true }); }

// ---------- QR ----------
export function loginQr() {
  return {
    cls: 'v-form',
    html: `${navbar({ title: '' })}
    <div class="form-wrap">
      <h1 class="form-title">Escanea con otro dispositivo</h1>
      <p class="form-text">Sirve si tienes Telegram abierto en otro teléfono, tablet o computadora.</p>
      <div class="qr-box" data-qr><span class="qr-wait">Preparando el código…</span></div>
      <ol class="steps">
        <li><span>1</span>Abre Telegram en el otro dispositivo</li>
        <li><span>2</span>Ve a <b>Ajustes → Dispositivos</b></li>
        <li><span>3</span>Toca <b>Vincular un dispositivo</b> y apunta a este código</li>
      </ol>
      <p class="fine" data-note>El código se renueva solo cada 30 segundos.</p>
    </div>`,
    mount(el) {
      if (noEngine()) return null;
      const box = el.querySelector('[data-qr]');
      const note = el.querySelector('[data-note]');
      const abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
      pending.qrAbort = abort;
      T.loginQr({
        onUrl: (url) => { box.innerHTML = T.qrSvg(url, 8); },
        onScanned: () => { note.textContent = 'Código escaneado, entrando…'; },
        askPassword: () => new Promise((resolve) => {
          /* la cuenta tiene verificación en dos pasos: la pantalla de contraseña le pasa la clave a este mismo inicio */
          pending.pwResolve = resolve;
          go('/login/clave');
        }),
        onBadPassword: () => { toast('La contraseña no es correcta'); },
        signal: abort ? abort.signal : undefined,
      }).then(loggedIn, (e) => {
        if (e && e.name === 'AbortError') return;
        if (abort && abort.signal.aborted) return;
        note.textContent = errorText(e);
      });
      /* al salir de la pantalla se corta el QR, salvo que se vaya a escribir la contraseña de dos pasos */
      return () => { setTimeout(() => { if (!pending.pwResolve && pending.qrAbort === abort && abort) { abort.abort(); pending.qrAbort = null; } }, 0); };
    },
  };
}

// ---------- Número ----------
function fullPhone(text) {
  const raw = String(text || '').trim();
  const digits = raw.replace(/\D/g, '');
  return raw.startsWith('+') ? `+${digits}` : `+57${digits}`; // sin indicativo se toma Colombia
}

export function loginPhone() {
  return {
    cls: 'v-form',
    html: `${navbar()}
    <form class="form-wrap" data-form autocomplete="on">
      <h1 class="form-title">Tu número</h1>
      <p class="form-text">Te enviaremos un código por Telegram.</p>
      <label class="field"><span>País y número</span>
        <input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+57 300 123 4567" value="${esc(pending.phone)}" required></label>
      <p class="fine">Si no escribes el indicativo (+57, +1…) se toma Colombia.</p>
      ${btn('Continuar', { cls: 'btn-block', attrs: 'type="submit" data-send' })}
    </form>`,
    mount(el) {
      const f = el.querySelector('[data-form]');
      const b = el.querySelector('[data-send]');
      f.onsubmit = (e) => {
        e.preventDefault();
        if (noEngine()) return;
        const phone = fullPhone(f.phone.value);
        if (phone.replace(/\D/g, '').length < 8) { toast('Revisa el número'); return; }
        b.disabled = true;
        T.sendCode(phone).then((r) => {
          Object.assign(pending, { phone, hash: r.hash, length: r.length || 5, via: r.via, until: Date.now() + (r.timeout || 60) * 1000 });
          go('/login/codigo');
        }, (err) => { b.disabled = false; toast(errorText(err)); });
      };
    },
  };
}

// ---------- Código ----------
function viaText(v) {
  return v === 'sms' ? 'por SMS' : v === 'call' ? 'en una llamada' : v === 'email' ? 'a tu correo' : 'en el chat de <b>Telegram</b> de tus otros dispositivos';
}

export function loginCode() {
  if (!pending.hash) return { redirect: '/login/numero' };
  const n = pending.length || 5;
  return {
    cls: 'v-form',
    html: `${navbar()}
    <form class="form-wrap" data-form>
      <h1 class="form-title">Escribe el código</h1>
      <p class="form-text">Te lo enviamos ${viaText(pending.via)} (${esc(pending.phone)}).</p>
      <div class="code-boxes" data-boxes>${'<span></span>'.repeat(n)}</div>
      <input class="code-input" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="${n}" pattern="[0-9]*" aria-label="Código">
      ${btn('Continuar', { cls: 'btn-block', attrs: 'type="submit" data-go' })}
      <p class="fine center" data-resend></p>
    </form>`,
    mount(el) {
      const f = el.querySelector('[data-form]');
      const b = el.querySelector('[data-go]');
      const boxes = [...el.querySelectorAll('[data-boxes] span')];
      const rs = el.querySelector('[data-resend]');
      let busy = false;
      const paint = () => {
        const v = f.code.value.replace(/\D/g, '').slice(0, n);
        f.code.value = v;
        boxes.forEach((x, i) => { x.textContent = v[i] || ''; x.classList.toggle('cur', i === v.length); });
        if (v.length === n && !busy) f.requestSubmit();
      };
      const paintResend = () => {
        const left = Math.max(0, Math.ceil((pending.until - Date.now()) / 1000));
        rs.innerHTML = left ? `¿No te llegó? Puedes pedir otro en ${L.formatClock(left)}` : '<button class="link-btn" type="button" data-again>Enviar otro código</button>';
        const again = rs.querySelector('[data-again]');
        if (again) again.onclick = () => T.resendCode(pending.phone, pending.hash).then((r) => {
          Object.assign(pending, { hash: r.hash, via: r.via, length: r.length || n, until: Date.now() + (r.timeout || 60) * 1000 });
          toast('Te enviamos otro código');
          paintResend();
        }, (err) => toast(errorText(err)));
      };
      const timer = setInterval(paintResend, 1000);
      paintResend();
      f.code.addEventListener('input', paint);
      el.querySelector('[data-boxes]').onclick = () => f.code.focus();
      f.onsubmit = (e) => {
        e.preventDefault();
        if (f.code.value.length !== n || busy) return;
        busy = true; b.disabled = true;
        T.signInCode(pending.phone, pending.hash, f.code.value).then((r) => {
          if (r.password) { pending.hint = r.hint || ''; go('/login/clave'); return; }
          loggedIn(r.user);
        }, (err) => {
          busy = false; b.disabled = false;
          f.code.value = ''; paint();
          toast(errorText(err));
        });
      };
      paint();
      setTimeout(() => f.code.focus(), 350);
      return () => clearInterval(timer);
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
      ${pending.hint ? `<p class="fine">Pista: <b>${esc(pending.hint)}</b></p>` : ''}
      ${btn('Entrar', { cls: 'btn-block', attrs: 'type="submit" data-go' })}
    </form>`,
    mount(el) {
      const f = el.querySelector('[data-form]');
      const b = el.querySelector('[data-go]');
      el.querySelector('[data-eye]').onclick = (e) => {
        const show = f.pass.type === 'password';
        f.pass.type = show ? 'text' : 'password';
        e.currentTarget.textContent = show ? 'Ocultar' : 'Mostrar';
      };
      f.onsubmit = (e) => {
        e.preventDefault();
        if (!f.pass.value) return;
        if (pending.pwResolve) {
          /* viene del QR: el motor espera la contraseña y termina el inicio él mismo */
          const res = pending.pwResolve;
          pending.pwResolve = null;
          b.disabled = true;
          res(f.pass.value);
          return;
        }
        b.disabled = true;
        T.signInPassword(f.pass.value).then(loggedIn, (err) => { b.disabled = false; toast(errorText(err)); });
      };
      setTimeout(() => f.pass.focus(), 300);
    },
  };
}

/** Un perfil de la cuenta real que todavía no eligió de qué chats sale su biblioteca. */
function needsChats() {
  if (state.design || state.account === 'demo') return false;
  const src = L.enabledSources();
  return !src || !Object.keys(src).length;
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
          else { chooseProfile(p.id); go(needsChats() ? '/ajustes?chats=1' : '/inicio', { replace: true }); }
        };
      });
    },
  };
}

// ---------- Editar perfil ----------
export function profileEdit(route) {
  const isNew = route.params.id === 'nuevo';
  const ids = avatarIds();
  const p = isNew ? { name: '', avatar: ids[L.profiles().length % Math.max(1, ids.length)] || 0, kids: false, pin: null } : L.profiles().find((x) => x.id === route.params.id);
  if (!p) return { redirect: '/perfiles' };
  return {
    cls: 'v-form',
    html: `${navbar({ title: isNew ? 'Nuevo perfil' : 'Editar perfil' })}
    <form class="form-wrap" data-form>
      <div class="av-current" data-cur>${avatar(p, 'avatar-xl')}</div>
      <div class="av-pick" role="radiogroup" aria-label="Elige un avatar">${ids.map((id) => `
        <button type="button" role="radio" aria-checked="${id === p.avatar}" data-av="${esc(id)}" aria-label="${esc(id.replace(/^\d+-/, '').replace(/_/g, ' '))}">${avatar({ avatar: id }, 'avatar-sm')}</button>`).join('')}</div>
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
          av = b.dataset.av;
          el.querySelectorAll('[data-av]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
          el.querySelector('[data-cur]').innerHTML = avatar({ avatar: av, kids: f.kids.checked }, 'avatar-xl');
        };
      });
      f.onsubmit = (e) => {
        e.preventDefault();
        const pin = f.pin.value.trim();
        if (pin && !/^\d{4}$/.test(pin)) { toast('El PIN son 4 números'); return; }
        try {
          L.saveProfile({ ...(isNew ? {} : { id: p.id }), name: f.name.value.trim() || 'Perfil', avatar: av, kids: f.kids.checked, pin: pin || null });
        } catch (err) { toast(err.message); return; }
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
      <p class="pin-hint" data-hint>${state.design || state.account === 'demo' ? 'En la demostración el PIN de Santiago es 1234' : '&nbsp;'}</p>
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
          if (L.checkPin(p.id, v)) { chooseProfile(p.id); setTimeout(() => go(needsChats() ? '/ajustes?chats=1' : '/inicio', { replace: true }), 120); }
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
