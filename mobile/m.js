/* HomeFlix · celular. Pantallas táctiles sobre el mismo motor que la TV (HFTelegram / HFLibrary / HFPlayback).
 *
 *   Flujo: Conectando → (sin sesión) número → código → contraseña de dos pasos  ·  o QR desde otro dispositivo
 *          → perfiles (→ PIN) → (sin chats) chats de la biblioteca → Inicio · Películas · Series · Buscar · Mi lista
 *          → ficha → reproductor (horizontal, pantalla completa)
 *
 * Navegación: una pila de vistas (S.stack). El botón Atrás de Android llama a HFMobile.back(): cierra la hoja o la capa
 * abierta, vuelve a la vista anterior o, en Inicio, deja salir de la app.
 * Con ?design=<vista> (tablero de diseño) se abre una vista con la biblioteca exportada, sin Telegram. */
var HFMobile = (function () {
  "use strict";

  var I = HFIcons;
  var root = document.getElementById("m");
  var DESIGN = /[?&]design=/.test(window.location.search);
  var android = window.HFAndroid || null;

  var items = [];                         // todo lo leído de los chats (caché por cuenta)
  var library = HFLibrary.build([]);      // lo que ve el perfil activo
  var profile = null;
  var account = null;

  var S = {
    view: "", arg: null, stack: [],
    sheet: null, overlay: null, toast: "",
    login: { cc: "+57", phone: "", code: "", password: "", error: "", busy: false, hash: "", via: "app", length: 5, until: 0, hint: "", qr: "", qrNote: "", qrAbort: null, pwResolve: null, showPw: false },
    season: 0, search: "", category: "",
    chats: null, chatsError: "", chatFilter: "all", chatQ: "", firstTime: false,
    pin: null, edit: null,
    syncing: false, syncError: "",
    player: null
  };

  /* ===================== Utilidades ===================== */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function byId(id) { return document.getElementById(id); }
  function dur(sec) { return HFLibrary.formatDuration(sec || 0); }
  function clock(sec) { return HFLibrary.formatClock(Math.max(0, sec || 0)); }
  function values(o) { return Object.keys(o || {}).map(function (k) { return o[k]; }); }
  function img(key) { return key ? ' data-img="' + esc(key) + '"' : ""; }
  /* Imagen del avatar. Los ids de antes (panda, zorro, búho…) no tienen archivo: reciben una imagen fija, la misma que
   * les da la TV (js/ui/core.js avatarSrc), así ningún perfil queda en gris. */
  var LEGACY_AVATARS = ["panda", "zorro", "buho", "dino", "robot", "astro", "gato", "conejo", "oso", "pinguino", "rana", "leon"];
  function avatarUrl(id) {
    var own = (typeof HF_AVATARES !== "undefined" && HF_AVATARES) || [];
    var ids = own.map(function (src) { return String(src).replace(/^.*\//, "").replace(/\.[a-z0-9]+$/i, ""); });
    id = id || "01-Spider-Man";
    if (ids.length && ids.indexOf(id) < 0) {
      var k = LEGACY_AVATARS.indexOf(id);
      var h = 0;
      for (var i = 0; i < id.length; i += 1) { h = (h * 31 + id.charCodeAt(i)) | 0; }
      id = ids[(k >= 0 ? k : Math.abs(h)) % ids.length];
    }
    return "../images/avatares/" + encodeURIComponent(id) + ".jpg";
  }
  function norm(x) { return String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function tick() { try { if (android) { android.tick(); } } catch (e) { /* nada */ } }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function titles() { return values(library.titles); }
  function movies() { return titles().filter(function (t) { return t.type === "movie"; }); }
  function series() { return titles().filter(function (t) { return t.type === "series"; }); }
  function byDate(a, b) { return (b.date || 0) - (a.date || 0); }
  function titleOf(key) { return library.titles[key] || null; }
  function itemChat(it) { return String(it.chatId || String(it.key || "").split(":")[0]); }
  function entryKey(e) { return e.video ? e.video.key : e.key; }

  /* Lo visto de un título: la marca de progreso más reciente entre sus videos. */
  function itemKeysOf(t) {
    var keys = [];
    function addVersions(list) {
      (list || []).forEach(function (v) { values(v.pieces).forEach(function (p) { keys.push(p.key); }); });
    }
    if (t.type === "series") {
      (t.seasons || []).forEach(function (s) { s.episodes.forEach(function (e) { keys.push(entryKey(e)); addVersions(e.versions); }); });
    } else {
      if (t.video) { keys.push(t.video.key); }
      addVersions(t.versions);
    }
    return keys;
  }
  function progressOf(t) {
    var best = null;
    itemKeysOf(t).forEach(function (k) {
      var p = HFLibrary.progress(k);
      if (p && !p.done && p.t > 0 && (!best || (p.at || 0) > (best.at || 0))) { best = p; }
    });
    return best;
  }
  function qualityOf(t) {
    var top = 0;
    (t.versions || []).forEach(function (v) { top = Math.max(top, v.h || 0); });
    return top >= 2000 ? "4K" : top ? top + "p" : t.quality || "";
  }
  function lengthOf(t) {
    var v = (t.versions || [])[0];
    return (v && v.dur) || (t.video && t.video.duration) || 0;
  }
  function chatTitles() {
    var src = HFLibrary.enabledSources() || {};
    return values(src).filter(Boolean);
  }

  /* ===================== Piezas ===================== */
  function logo(big) { return '<div class="m-logo' + (big ? " big" : "") + '"><i></i><b>Home<span>Flix</span></b></div>'; }

  function card(t, opts) {
    opts = opts || {};
    var p = opts.progress;
    var sub = opts.sub || (t.type === "series" ? plural((t.seasons || []).length, "temporada", "temporadas") : [t.year || "", dur(lengthOf(t))].filter(Boolean).join(" · "));
    return '<button class="m-card' + (opts.wide ? " wide" : "") + '" data-' + (opts.wide ? "play" : "open") + '="' + esc(t.titleKey) + '">' +
      '<div class="img"' + img(t.imageKey || (t.video && t.video.key)) + ">" +
      (t.imageKey ? "" : '<div class="fallback">' + esc(t.name) + "</div>") +
      '<span class="badge">' + (t.type === "series" ? "SERIE" : "PELÍCULA") + "</span>" +
      (t.kids && !opts.wide ? '<span class="kid">★</span>' : "") +
      (opts.wide ? '<span class="play"><b>' + I.play + "</b></span>" : "") +
      (p ? '<div class="bar"><i style="width:' + Math.min(100, Math.round((p.t / Math.max(1, p.d)) * 100)) + '%"></i></div>' : "") +
      "</div>" + '<div class="t">' + esc(t.name) + '</div><div class="s">' + esc(sub) + "</div></button>";
  }

  function row(title, list, opts) {
    opts = opts || {};
    if (!list.length) { return ""; }
    return '<section class="m-row"><div class="m-row-head"><h2>' + esc(title) + "</h2>" + (opts.note ? "<small>" + esc(opts.note) + "</small>" : "") + "</div>" +
      '<div class="m-track">' + list.map(function (x) { return opts.render ? opts.render(x) : card(x); }).join("") + "</div></section>";
  }

  /* Barra inferior: cápsula flotante; la pestaña activa se expande con su nombre, las demás solo llevan ícono.
   * navPop: se acaba de tocar una pestaña, así que la activa entra con una animación corta (y no en cada redibujado). */
  var navPop = false;
  function nav(on) {
    var tabs = [["home", "Inicio", I.home], ["movies", "Películas", I.film], ["series", "Series", I.tv], ["live", "TV en vivo", I.live], ["search", "Buscar", I.search], ["mylist", "Mi lista", I.bookmark]];
    if (profile && profile.kids) { tabs = tabs.filter(function (x) { return x[0] !== "live"; }); }
    return '<nav class="m-nav' + (navPop ? " pop" : "") + '">' + tabs.map(function (x) {
      return '<button class="' + (x[0] === on ? "on" : "") + '" data-tab="' + x[0] + '" aria-label="' + x[1] + '">' + x[2] + "<span>" + x[1] + "</span></button>";
    }).join("") + "</nav>";
  }

  /* Vibración corta al tocar la barra: la hace el APK (HFAndroid.haptic, sin permisos extra); en un APK anterior o en
   * el navegador se intenta navigator.vibrate y, si no hay, no pasa nada. */
  function tick() {
    try {
      if (android && android.haptic) { android.haptic(); } else if (navigator.vibrate) { navigator.vibrate(8); }
    } catch (e) { /* sin vibración */ }
  }

  function topbar() {
    return '<header class="m-top">' + logo() + '<div class="right">' +
      (S.syncing ? '<span class="m-sync" title="Actualizando">' + I.refresh + "</span>" : "") +
      '<button class="m-iconbtn" data-tab="search" aria-label="Buscar">' + I.search + "</button>" +
      '<button class="m-avatar" data-go="account" aria-label="Ajustes" style="background-image:url(' + avatarUrl(profile && profile.avatar) + ')"></button></div></header>';
  }

  function topTitle(title, opts) {
    opts = opts || {};
    return '<header class="m-top solid"><div class="m-tt">' + (opts.noBack ? "" : '<button class="m-iconbtn" data-back>' + I.back + "</button>") + "<b>" + esc(title) + "</b></div>" +
      (opts.right || "") + "</header>";
  }

  function toggle(on) { return '<span class="m-toggle' + (on ? " on" : "") + '"><i></i></span>'; }
  function errorBox(msg) { return msg ? '<div class="m-error">' + esc(msg) + "</div>" : ""; }

  /* ===================== Vistas ===================== */
  var V = {};

  V.boot = function () {
    return '<div class="m-center m-boot">' + logo(true) + '<div class="m-spin"></div><p>' + esc(S.bootNote || "Conectando con Telegram…") + "</p>" +
      (S.bootError ? errorBox(S.bootError) + '<button class="m-btn primary" data-act="boot">Reintentar</button>' : "") + "</div>";
  };

  /* ----- Acceso ----- */
  function wall() {
    var posters = ["SNWH", "TS5", "AVENDGAME", "IM3", "RCKY", "GMZ", "AVINFWAR", "SBND", "JW2", "IM1", "LYSLA", "STSM"];
    return '<div class="m-wall"><div class="grid">' + posters.map(function (p) { return '<i style="background-image:url(../images/portadas/' + p + '.jpg)"></i>'; }).join("") + "</div></div>";
  }

  V.login = function () {
    var L = S.login;
    return wall() + '<div class="m-login">' + logo(true) +
      "<h1>Tu biblioteca de Telegram,<br>en el celular</h1>" +
      '<p class="lead">Entra con tu cuenta de Telegram. No hay que crear nada nuevo.</p>' +
      '<div class="m-field"><label for="phone">Número de teléfono</label><div class="m-input">' +
      '<input class="cc" id="cc" data-model="login.cc" type="tel" inputmode="tel" value="' + esc(L.cc) + '" aria-label="Indicativo"/>' +
      '<input id="phone" data-model="login.phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="300 123 4567" value="' + esc(L.phone) + '"/></div></div>' +
      errorBox(L.error) +
      '<div class="m-hint">Telegram te enviará un código a la app (no por SMS) para confirmar que eres tú.</div>' +
      '<button class="m-btn primary block" data-act="send-code"' + (L.busy ? " disabled" : "") + ">" + (L.busy ? '<span class="m-spin sm"></span>Enviando…' : I.send + "Enviar código") + "</button>" +
      '<div class="m-or">o</div>' +
      '<button class="m-btn ghost block" data-go="login-qr">' + I.qr + "Escanear desde otro dispositivo</button>" +
      '<div class="legal">HomeFlix solo lee los videos de los chats que elijas.<br>Tu sesión queda guardada en este celular.</div></div>';
  };

  function codeBoxes() {
    var L = S.login;
    var out = "";
    for (var i = 0; i < L.length; i += 1) {
      out += "<i" + (i === L.code.length ? ' class="cur"' : "") + ">" + esc(L.code.charAt(i)) + "</i>";
    }
    return out;
  }
  function viaText(v) {
    return v === "sms" ? "por SMS" : v === "call" ? "en una llamada" : v === "email" ? "a tu correo" : "al chat de <b>Telegram</b> en tus otros dispositivos";
  }
  V["login-code"] = function () {
    var L = S.login;
    var left = Math.max(0, Math.ceil((L.until - Date.now()) / 1000));
    return '<div class="m-login">' + '<div class="m-head"><button class="m-iconbtn" data-back>' + I.back + "</button></div>" + logo(true) +
      "<h1>Escribe el código</h1>" +
      '<p class="lead">Te lo enviamos ' + viaText(L.via) + "<br>(" + esc(L.cc + " " + L.phone) + ").</p>" +
      '<label class="m-code" for="code">' + codeBoxes() +
      '<input id="code" data-model="login.code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="' + L.length + '" value="' + esc(L.code) + '" aria-label="Código"/></label>' +
      errorBox(L.error) +
      '<button class="m-btn primary block" style="margin-top:26px" data-act="verify-code"' + (L.busy ? " disabled" : "") + ">" + (L.busy ? '<span class="m-spin sm"></span>Revisando…' : "Continuar") + "</button>" +
      '<div class="m-hint" style="text-align:center;margin-top:16px" id="resend">' + resendText(left) + "</div>" +
      '<div class="legal">Si tu cuenta tiene verificación en dos pasos, después te pedimos la contraseña.</div></div>';
  };
  function resendText(left) {
    return left > 0 ? "¿No te llegó? Puedes pedir otro en <b style=\"color:var(--gold-text)\">" + clock(left) + "</b>"
      : '¿No te llegó? <button class="m-inlink" data-act="resend">Enviar otro código</button>';
  }

  V["login-password"] = function () {
    var L = S.login;
    return '<div class="m-login">' + '<div class="m-head"><button class="m-iconbtn" data-back>' + I.back + "</button></div>" + logo(true) +
      "<h1>Verificación en dos pasos</h1>" +
      '<p class="lead">Tu cuenta tiene una contraseña adicional.<br>Escríbela para terminar de entrar.</p>' +
      '<div class="m-field"><label for="pw">Contraseña de Telegram</label><div class="m-input">' +
      '<input id="pw" data-model="login.password" type="' + (L.showPw ? "text" : "password") + '" autocomplete="current-password" value="' + esc(L.password) + '"/>' +
      '<button class="m-eye" data-act="toggle-pw" aria-label="Mostrar contraseña">' + I.eye + "</button></div></div>" +
      (L.hint ? '<div class="m-hint">Pista: <b style="color:var(--muted)">' + esc(L.hint) + "</b></div>" : "") +
      errorBox(L.error) +
      '<button class="m-btn primary block" data-act="send-password"' + (L.busy ? " disabled" : "") + ">" + (L.busy ? '<span class="m-spin sm"></span>Entrando…' : "Entrar") + "</button>" +
      '<div class="legal">HomeFlix no guarda tu contraseña: solo la usa una vez para entrar.</div></div>';
  };

  V["login-qr"] = function () {
    var L = S.login;
    return '<div class="m-login">' + '<div class="m-head"><button class="m-iconbtn" data-back>' + I.back + "</button></div>" +
      "<h1 style=\"margin-top:6px\">Entra desde otro<br>dispositivo</h1>" +
      '<p class="lead">Si tienes Telegram abierto en otro celular, tablet o computador, escanea este código desde ahí.</p>' +
      '<div class="m-qr" id="qr">' + (L.qr || '<div class="m-spin"></div>') + "</div>" +
      '<ol class="m-steps"><li><span>1</span><div>Abre <b>Telegram</b> en el otro dispositivo.</div></li>' +
      "<li><span>2</span><div>Ve a <b>Ajustes → Dispositivos</b>.</div></li>" +
      "<li><span>3</span><div>Toca <b>Vincular un dispositivo</b> y apunta al código.</div></li></ol>" +
      errorBox(L.error) +
      '<div class="m-note" id="qrNote">' + I.refresh + esc(L.qrNote || "El código se renueva solo cada 30 segundos.") + "</div></div>";
  };

  /* ----- Perfiles ----- */
  V.profiles = function () {
    var list = HFLibrary.profiles();
    return '<div class="m-center m-profiles">' + logo(true) + "<h1>¿Quién está viendo?</h1>" +
      '<div class="m-pgrid">' + list.map(function (p) {
        return '<button data-act="profile" data-id="' + esc(p.id) + '"><span class="av" style="background-image:url(' + avatarUrl(p.avatar) + ')">' +
          (p.kids ? "<em>INFANTIL</em>" : "") + (p.pin ? '<span class="lockb">' + I.lock + "</span>" : "") + "</span>" + esc(p.name) + "</button>";
      }).join("") + (list.length < HFLibrary.MAX_PROFILES ? '<button data-act="new-profile"><span class="av add">' + I.plus + "</span>Agregar</button>" : "") + "</div>" +
      "</div>";
  };

  V.pin = function () {
    var P = S.pin || { profile: HFLibrary.profiles()[0], entered: "", error: "" };
    var keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
    var dots = "";
    for (var i = 0; i < 4; i += 1) { dots += "<i" + (i < P.entered.length ? ' class="on"' : "") + "></i>"; }
    return '<div class="m-center m-pin">' + '<span class="av" style="background-image:url(' + avatarUrl(P.profile.avatar) + ')"></span>' +
      '<div class="who">' + esc(P.profile.name) + "</div><h1>" + esc(P.title || "Escribe tu PIN") + "</h1>" +
      '<div class="dots' + (P.error ? " bad" : "") + '">' + dots + "</div>" + (P.error ? '<div class="m-pinerr">' + esc(P.error) + "</div>" : "") +
      '<div class="pad">' + keys.map(function (k) {
        return k === "" ? "<span></span>" : '<button data-act="pin-key" data-k="' + k + '"' + (k === "del" ? ' class="del" aria-label="Borrar"' : "") + ">" + (k === "del" ? I.del : k) + "</button>";
      }).join("") + "</div>" +
      '<button class="m-link" data-back>Cancelar</button></div>';
  };

  V["profile-edit"] = function () {
    var E = S.edit || { name: "", avatar: "01-Spider-Man", kids: false };
    var avs = (window.HF_AVATARES || []).map(function (src) { return String(src).replace(/^.*\//, "").replace(/\.[a-z]+$/i, ""); });
    if (!avs.length) { avs = ["01-Spider-Man", "02-Captain_Carter", "03-Iron_Man", "04-Spider-Man_comic", "05-Capitan_America", "07-Thor", "08-Doctor_Strange", "12-Groot", "16-Hulk"]; }
    return topTitle(E.id ? "Editar perfil" : "Nuevo perfil", { right: '<button class="m-textbtn" data-act="save-profile">Guardar</button>' }) + '<div class="m-scroll m-form">' +
      '<div class="m-pe-av"><span class="av" style="background-image:url(' + avatarUrl(E.avatar) + ')"></span></div>' +
      '<div class="m-avpick">' + avs.map(function (a) { return '<i data-act="avatar" data-id="' + esc(a) + '" class="' + (a === E.avatar ? "on" : "") + '" style="background-image:url(' + avatarUrl(a) + ')"></i>'; }).join("") + "</div>" +
      '<div class="m-field"><label for="pname">Nombre</label><div class="m-input"><input id="pname" data-model="edit.name" maxlength="20" value="' + esc(E.name) + '"/></div></div>' +
      errorBox(E.error) +
      '<div class="m-group">' +
      '<button class="m-opt" data-act="edit-kids"><div><b>Perfil infantil</b><small>Solo muestra lo marcado #infantil</small></div>' + toggle(E.kids) + "</button>" +
      (E.id ? '<button class="m-opt" data-act="edit-pin"><div><b>' + (E.hasPin ? "Cambiar o quitar PIN" : "Ponerle PIN") + "</b><small>" + (E.hasPin ? "Tiene PIN · ••••" : "Pide 4 números para entrar") + "</small></div>" + I.chev + "</button>" : "") +
      "</div>" +
      (E.id && HFLibrary.profiles().length > 1 ? '<button class="m-btn ghost block danger" data-act="delete-profile">' + I.trash + "Eliminar perfil</button>" : "") + "</div>";
  };

  /* ----- Catálogo ----- */
  function heroCard(t) {
    var p = progressOf(t);
    var tags = [t.year, t.type === "series" ? plural((t.seasons || []).length, "temporada", "temporadas") : dur(lengthOf(t))].concat(mainCat(t) ? [mainCat(t)] : []).filter(Boolean).slice(0, 4);
    /* El banner es 16:9 (hecho para la TV): se muestra entero arriba y la misma imagen, desenfocada, tiñe el fondo de la tarjeta. */
    var art = t.bannerKey || t.imageKey;
    return '<div class="m-hero"><div class="amb"' + img(art) + '></div><div class="art"' + img(art) + "></div>" +
      '<div class="copy"><h1' + (t.name.length > 18 ? ' class="long"' : "") + ">" + esc(t.name) + "</h1>" +
      '<div class="tags">' + tags.map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("") + "</div>" +
      '<div class="btns"><button class="m-btn primary" data-play="' + esc(t.titleKey) + '">' + I.play + (p ? "Continuar" : "Reproducir") + "</button>" +
      '<button class="m-btn ghost" data-open="' + esc(t.titleKey) + '">' + I.info + "Más info</button></div></div></div>";
  }
  function heroHtml(t) { return heroCard(t); }

  /* Carrusel del destacado: se desliza con el dedo entre hasta 6 títulos (se ajusta solo a cada tarjeta).
   * Los puntos siguen al dedo y al tocarlos se va a ese título. */
  var HERO_MAX = 6;
  function heroSlider(list) {
    var items = list.slice(0, HERO_MAX);
    if (items.length < 2) { return items.length ? heroCard(items[0]) : ""; }
    return '<div class="m-heros" id="heros">' + items.map(heroCard).join("") + "</div>" +
      '<div class="m-dots" id="heroDots">' + items.map(function (_, k) {
        return '<button data-act="hero-dot" data-i="' + k + '" aria-label="Destacado ' + (k + 1) + '"' + (k === heroPick % items.length ? ' class="on"' : "") + "></button>";
      }).join("") + "</div>";
  }
  function heroSetup() {
    var box = byId("heros");
    var dots = byId("heroDots");
    if (!box) { return; }
    var n = box.children.length;
    var paint = function (i) {
      if (!dots) { return; }
      Array.prototype.forEach.call(dots.children, function (d, k) { d.className = k === i ? "on" : ""; });
    };
    var start = heroPick % n;
    box.scrollLeft = box.children[start].offsetLeft - box.children[0].offsetLeft;
    paint(start);
    var t = null;
    box.addEventListener("scroll", function () {
      clearTimeout(t);
      t = setTimeout(function () {
        var w = box.children[0].offsetWidth + 10;
        var i = Math.max(0, Math.min(n - 1, Math.round(box.scrollLeft / w)));
        if (i !== heroPick % n) { heroPick = i; paint(i); }
      }, 60);
    }, { passive: true });
  }

  /* Categorías sin repetir aunque una venga con tilde y otra sin ella («Accion» = «Acción»), como en la TV.
   * Se muestra la forma con tilde si alguna la trae. */
  /* Cada título va en UNA sola categoría: la de más prioridad del catálogo (js/library.js primaryCategory:
   * Marvel > Infantil > género). En el perfil Kids lo infantil se agrupa por su género. */
  function withKidsRow() { return !(profile && profile.kids); }
  function mainCat(t) { return HFLibrary.primaryCategory(t, withKidsRow()); }
  function catsOf(list) {
    var out = [];
    list.forEach(function (t) {
      var c = mainCat(t);
      if (c && out.indexOf(c) < 0) { out.push(c); }
    });
    return out;
  }
  function inCategory(t, c) {
    return mainCat(t) === c;
  }

  function categoryRows(list) {
    return catsOf(list).map(function (c) {
      /* Marvel: en el orden de la historia (js/library.js sortForCategory); las demás, tal cual */
      var g = HFLibrary.sortForCategory(c, list.filter(function (t) { return inCategory(t, c); }));
      return row(c, g, { note: plural(g.length, "título", "títulos") + (HFLibrary.isChronoCategory(c) ? " · orden cronológico" : "") });
    }).join("");
  }

  function emptyLibrary() {
    if (S.syncing) {
      return '<div class="m-empty"><div class="m-spin"></div><b>Cargando tu biblioteca…</b>Leyendo los videos de ' + esc(chatTitles().join(", ") || "tus chats") + ".</div>";
    }
    return '<div class="m-empty">' + I.film + "<b>Todavía no hay nada aquí</b>" + (S.syncError ? esc(S.syncError) + "<br>" : "") +
      'Revisa qué chats usa este perfil.<br><button class="m-btn ghost" style="margin-top:14px" data-go="settings">Elegir chats</button></div>';
  }

  /* Destacado: cambia cada vez que se abre Inicio (entre los que tienen imagen). */
  var heroPick = 0;
  V.home = function () {
    var all = titles().sort(byDate);
    var featured = all.filter(function (t) { return t.bannerKey || t.imageKey; });
    var cont = all.filter(function (t) { return progressOf(t); }).sort(function (a, b) { return (progressOf(b).at || 0) - (progressOf(a).at || 0); });
    return topbar() + '<div class="m-scroll">' +
      '<div class="m-chips">' +
      '<button class="m-chip" data-act="categories">Categorías ' + I.down + "</button></div>" +
      (!all.length ? emptyLibrary() :
        heroSlider(featured) +
        row("Continuar viendo", cont, { render: function (t) {
          var p = progressOf(t);
          return card(t, { wide: true, progress: p, sub: "Quedan " + dur(Math.max(0, p.d - p.t)) });
        } }) +
        row("Agregados recientemente", all.slice(0, 5), { note: "los últimos 5" }) +
        categoryRows(all) +
        row("Todas las películas", movies().sort(byDate)) +
        row("Series", series())) +
      "</div>" + nav("home");
  };

  function section(kind) {
    var list = (kind === "series" ? series() : movies()).sort(byDate);
    var feat = list.filter(function (t) { return t.bannerKey || t.imageKey; })[0];
    return topbar() + '<div class="m-scroll">' +
      '<div class="m-chips"><button class="m-chip on" data-tab="home">' + (kind === "series" ? "Series" : "Películas") + ' <span class="x">×</span></button>' +
      '<button class="m-chip" data-act="categories">Categorías ' + I.down + "</button></div>" +
      (feat ? heroHtml(feat) : "") +
      (list.length ? categoryRows(list) + row(kind === "series" ? "Todas las series" : "Todas las películas", list)
        : !titles().length ? emptyLibrary()
        : '<div class="m-empty">' + I.tv + "<b>Todavía no hay " + (kind === "series" ? "series" : "películas") + "</b>Publica un capítulo con <code>serie(1/1)#Nombre#…</code> en tu grupo y aparecerá aquí.</div>") +
      "</div>" + nav(kind);
  }
  V.movies = function () { return section("movies"); };
  V.series = function () { return section("series"); };

  V.category = function () {
    var c = S.category;
    var list = HFLibrary.sortForCategory(c, titles().filter(function (t) { return inCategory(t, c); }).sort(byDate));
    return topTitle(c) + '<div class="m-scroll"><div class="m-sub">' + plural(list.length, "título", "títulos") + (HFLibrary.isChronoCategory(c) ? " · en orden cronológico" : "") + '</div><div class="m-grid">' +
      list.map(function (t) { return card(t); }).join("") + "</div></div>" + nav("");
  };

  V.mylist = function () {
    var list = HFLibrary.myList().map(titleOf).filter(Boolean);
    return '<header class="m-top solid"><b class="m-h">Mi lista</b></header>' +
      '<div class="m-scroll"><div class="m-sub">' + plural(list.length, "título", "títulos") + " · se guarda por perfil</div>" +
      '<div class="m-grid">' + list.map(function (t) { return card(t); }).join("") + "</div>" +
      '<div class="m-tipbox">' + I.plus + "<div>Toca <b>Mi lista</b> en la ficha de una película o serie para guardarla aquí.</div></div></div>" + nav("mylist");
  };

  function searchResults() {
    var q = norm(S.search).trim();
    if (!q) {
      return '<div class="m-sub">Lo más nuevo</div><div class="m-grid">' + titles().sort(byDate).slice(0, 10).map(function (t) { return card(t); }).join("") + "</div>";
    }
    var res = titles().filter(function (t) { return norm(t.name).indexOf(q) >= 0 || norm(t.description).indexOf(q) >= 0; });
    var rest = titles().filter(function (t) { return res.indexOf(t) < 0; }).sort(byDate);
    return '<div class="m-sub">' + (res.length ? plural(res.length, "resultado", "resultados") : "Nada con «" + esc(S.search) + "»") + "</div>" +
      '<div class="m-grid">' + res.map(function (t) { return card(t); }).join("") + "</div>" +
      (rest.length ? '<div class="m-sub" style="margin-top:22px">También te puede gustar</div><div class="m-grid">' + rest.slice(0, 6).map(function (t) { return card(t); }).join("") + "</div>" : "");
  }
  V.search = function () {
    return '<div class="m-search"><div class="m-input">' + I.search + '<input id="q" data-model="search" type="search" enterkeyhint="search" placeholder="Película o serie" value="' + esc(S.search) + '"/></div></div>' +
      '<div class="m-scroll" id="results">' + searchResults() + "</div>" + nav("search");
  };

  /* ----- Ficha ----- */
  /* Botones de reproducir de la ficha, como en Netflix: si ya se empezó, arriba la barra con lo que falta; luego el
   * principal (dorado) y debajo un botón propio para «Ver desde el principio» (en series, el capítulo que toca). */
  function playButtons(t, label, p) {
    return (p ? '<div class="m-resume"><div class="bar"><i style="width:' + Math.round((p.t / Math.max(1, p.d)) * 100) + '%"></i></div>' +
        "<small>Quedan " + dur(Math.max(0, p.d - p.t)) + "</small></div>" : "") +
      '<button class="m-btn primary block" data-play="' + esc(t.titleKey) + '">' + I.play + esc(label) + "</button>" +
      (p ? '<button class="m-btn ghost block m-restart" data-act="play-start" data-key="' + esc(t.titleKey) + '">' + I.replay + "Ver desde el principio</button>" : "");
  }
  function actions(t) {
    var inList = HFLibrary.inMyList(t.titleKey);
    return '<div class="m-acts"><button data-act="mylist" data-key="' + esc(t.titleKey) + '">' + (inList ? I.check : I.plus) + "Mi lista</button>" +
      (t.versions && t.versions.length > 1 ? '<button data-act="sheet" data-sheet="quality">' + I.quality + "Calidad</button>" : "") +
      '<button data-act="sheet" data-sheet="info">' + I.info + "Detalles</button></div>";
  }

  /* Acciones de los botones (data-act): se declara aquí, antes de que cualquier bloque registre las suyas */
  var ACT = {};

  V.detail = function () {
    var t = titleOf(S.arg);
    if (!t) { return topTitle("No encontrado") + '<div class="m-empty"><b>Este título ya no está</b>Puede que lo hayan borrado del grupo.</div>'; }
    var p = progressOf(t);
    var q = qualityOf(t);
    var more = titles().filter(function (x) { return x !== t; }).sort(byDate);
    var meta = (t.year ? '<span class="year">' + esc(t.year) + "</span>" : "") +
      (t.type === "series" ? "<span>" + plural((t.seasons || []).length, "temporada", "temporadas") + "</span>" : "<span>" + dur(lengthOf(t)) + "</span>") +
      (q ? '<span class="q">' + esc(q) + "</span>" : "") + (t.kids ? '<span class="kids">INFANTIL</span>' : "");
    var body;
    if (t.type === "series") {
      var next = HFLibrary.nextEpisode(t) || {};
      var ep = next.episode;
      var si = Math.min(S.season, (t.seasons || []).length - 1);
      var season = (t.seasons || [])[Math.max(0, si)] || { episodes: [] };
      var epP = ep && next.started && next.resume > 0 ? HFLibrary.progress(entryKey(ep)) : null;
      body = playButtons(t, ep ? (next.started ? "Continuar" : "Ver") + " T" + ep.season + ":E" + ep.episode : "Reproducir", epP && !epP.done ? epP : null) +
        (ep && ep.description ? '<p class="m-desc"><b>' + ep.episode + ". " + esc(ep.title) + "</b> · " + esc(ep.description) + "</p>" : t.description ? '<p class="m-desc">' + esc(t.description) + "</p>" : "") +
        actions(t) +
        ((t.seasons || []).length > 1 ? '<div class="m-seasons">' + t.seasons.map(function (s, i) { return '<button data-act="season" data-i="' + i + '" class="' + (i === si ? "on" : "") + '">Temporada ' + s.number + "</button>"; }).join("") + "</div>" : '<div class="m-gtitle" style="margin-top:18px">Temporada ' + (season.number || 1) + "</div>") +
        season.episodes.map(function (e) {
          var ep2 = HFLibrary.progress(entryKey(e));
          return '<button class="m-ep' + (ep && ep.key === e.key ? " now" : "") + '" data-act="play-ep" data-key="' + esc(e.key) + '"><div class="img"' + img(entryKey(e)) + '><span class="play"><b>' + I.play + "</b></span>" +
            (ep2 && !ep2.done && ep2.t ? '<div class="bar"><i style="width:' + Math.round((ep2.t / Math.max(1, ep2.d)) * 100) + '%"></i></div>' : "") + "</div>" +
            '<div><div class="n">' + e.episode + ". " + esc(e.title || "Capítulo " + e.episode) + '</div><div class="d">' + dur(e.video ? e.video.duration : 0) + (ep2 && ep2.done ? " · Visto" : "") + "</div></div>" +
            (e.description ? "<p>" + esc(e.description) + "</p>" : "") + "</button>";
        }).join("");
    } else {
      body = playButtons(t, p ? "Continuar" : "Reproducir", p) +
        (t.description ? '<p class="m-desc">' + esc(t.description) + "</p>" : "") +
        (mainCat(t) ? '<div class="m-cats"><button data-act="category" data-c="' + esc(mainCat(t)) + '">' + esc(mainCat(t)) + '</button></div>' : '') +
        actions(t);
    }
    var from = (t.video && t.video.chatTitle) || chatTitles()[0] || "tus chats";
    return '<div class="m-scroll"><div class="m-dt-art"' + img(t.bannerKey || t.imageKey) + '><div class="bar-top"><button class="m-iconbtn" data-back>' + I.back + "</button></div></div>" +
      '<div class="m-dt"><h1>' + esc(t.name) + '</h1><div class="m-meta">' + meta + "</div>" + body + '<div class="m-sep"></div></div>' +
      row("También de " + from, more.slice(0, 10)) + "</div>" + nav(t.type === "series" ? "series" : "movies");
  };

  /* ----- Hojas (sobre la vista actual) ----- */
  function sheetHtml(title, body, note) {
    return '<div class="m-backdrop" data-act="close-sheet"></div><div class="m-sheet"><div class="grab"></div><div class="sh-head"><b>' + esc(title) + "</b>" +
      '<button class="m-iconbtn" data-act="close-sheet">' + I.x + "</button></div>" + body + (note ? '<div class="sh-note">' + note + "</div>" : "") + "</div>";
  }
  function radio(label, sub, on, attrs) {
    return '<button class="m-radio' + (on ? " on" : "") + '" ' + (attrs || "") + '><span class="r"></span><div><b>' + label + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + "</div>" + (on ? I.check : "") + "</button>";
  }
  /* Audio y subtítulos de un video (el de aquí o el de la TV). Dos columnas: en vertical una debajo de otra; con el
   * celular de lado, una al lado de la otra (m.css). */
  function tracksSheet(tr, actAudio, actSub, note) {
    var audio = tr.audio || [];
    var subs = tr.subs || [];
    var anySub = subs.some(function (s) { return s.current; });
    return sheetHtml("Audio y subtítulos",
      '<div class="sh-cols"><div class="sh-col"><div class="sh-sec">Audio</div>' + (audio.length ? audio.map(function (a) { return radio(esc(a.label), a.ok === false ? "No se puede reproducir aquí" : "", a.current, 'data-act="' + actAudio + '" data-k="' + esc(a.key) + '"'); }).join("") : '<div class="m-sub">Una sola pista</div>') +
      '</div><div class="sh-col"><div class="sh-sec">Subtítulos</div>' + radio("Desactivados", "", !anySub, 'data-act="' + actSub + '" data-k=""') +
      subs.map(function (s) { return radio(esc(s.label), "", s.current, 'data-act="' + actSub + '" data-k="' + esc(s.key) + '"'); }).join("") + "</div></div>",
      I.info + note);
  }
  var SHEETS = {
    quality: function () {
      var t = titleOf(S.arg) || (S.player && S.player.title);
      var vs = ((t && t.versions) || []).slice().sort(function (a, b) { return b.h - a.h; });
      var pref = qualityPref();
      var gb = function (v) { return (v.size / 1073741824).toFixed(1).replace(".", ",") + " GB" + (v.n > 1 ? " · " + v.n + " partes" : ""); };
      return sheetHtml("Calidad",
        radio("Automática", "Elige sola según tu internet", !pref, 'data-act="quality" data-q=""') +
        vs.map(function (v) { return radio(esc(v.q), gb(v) + (v.h >= 2000 ? " · necesita buena conexión" : v.h <= 400 ? " · gasta menos datos" : ""), pref === v.q, 'data-act="quality" data-q="' + esc(v.q) + '"'); }).join(""),
        I.info + "Se aplica a lo que veas desde ahora.");
    },
    tracks: function () {
      return tracksSheet(HFPlayback.tracks(), "audio", "sub", "Se recuerda para este video.");
    },
    info: function () {
      var t = titleOf(S.arg);
      var vs = ((t && t.versions) || []).slice().sort(function (a, b) { return b.h - a.h; });
      return sheetHtml("Detalles", '<div class="m-kv">' +
        "<div><span>Publicado en</span><b>" + esc((t.video && t.video.chatTitle) || "") + "</b></div>" +
        (vs.length ? "<div><span>Versiones</span><b>" + vs.map(function (v) { return esc(v.q) + (v.n > 1 ? " (" + v.n + " partes)" : ""); }).join(" · ") + "</b></div>" : "") +
        (t.categories && t.categories.length ? "<div><span>Categorías</span><b>" + esc(t.categories.join(", ")) + "</b></div>" : "") +
        (t.video && t.video.fileName ? "<div><span>Archivo</span><b>" + esc(t.video.fileName) + "</b></div>" : "") + "</div>");
    },
    logout: function () {
      return sheetHtml("Cerrar sesión", '<p class="m-desc" style="margin-top:4px">Se borra la sesión de Telegram de este celular. Tus perfiles, progreso y Mi lista se quedan guardados aquí.</p>' +
        '<button class="m-btn block danger-fill" data-act="logout">Cerrar sesión</button><button class="m-btn ghost block" style="margin-top:10px" data-act="close-sheet">Cancelar</button>');
    },
    "delete-profile": function () {
      return sheetHtml("Eliminar perfil", '<p class="m-desc" style="margin-top:4px">Se borran el perfil «' + esc(S.edit && S.edit.name) + "», su progreso y su lista. No se puede deshacer.</p>" +
        '<button class="m-btn block danger-fill" data-act="confirm-delete-profile">Eliminar</button><button class="m-btn ghost block" style="margin-top:10px" data-act="close-sheet">Cancelar</button>');
    }
  };

  /* ----- Ajustes ----- */
  V.settings = function () {
    var src = HFLibrary.enabledSources() || {};
    var active = Object.keys(src).length;
    return topTitle("Chats de la biblioteca", { noBack: S.firstTime, right: S.firstTime ? '<button class="m-textbtn" data-act="chats-done">Listo</button>' : "" }) + '<div class="m-scroll m-form">' +
      '<p class="m-intro">' + (S.firstTime ? "<b>¡Bienvenido!</b> " : "") + "Elige de qué chats de Telegram salen las películas y series de <b>" + esc(profile ? profile.name : "este perfil") + "</b>. Cada perfil tiene los suyos.</p>" +
      '<div class="m-input sm">' + I.search + '<input id="chatq" data-model="chatQ" type="search" placeholder="Buscar chat" value="' + esc(S.chatQ) + '"/></div>' +
      '<div class="m-chips tight">' + [["all", "Todos"], ["group", "Grupos"], ["channel", "Canales"], ["on", "Activos · " + active]].map(function (f) {
        return '<button class="m-chip' + (S.chatFilter === f[0] ? " on" : "") + '" data-act="chat-filter" data-f="' + f[0] + '">' + f[1] + "</button>";
      }).join("") + "</div>" +
      '<div id="chatList">' + chatList() + "</div>" +
      (S.firstTime ? '<button class="m-btn primary block" data-act="chats-done"' + (active ? "" : " disabled") + ">" + (active ? "Listo, ver mi biblioteca" : "Elige al menos un chat") + "</button>" : "") + "</div>";
  };
  var KIND = { saved: "Guardados", channel: "Canal", group: "Grupo", user: "Chat privado", bot: "Bot" };
  function chatList() {
    if (S.chatsError) { return errorBox(S.chatsError) + '<button class="m-btn ghost block" data-act="load-chats">Reintentar</button>'; }
    if (!S.chats) { return '<div class="m-empty"><div class="m-spin"></div>Cargando tus chats…</div>'; }
    var src = HFLibrary.enabledSources() || {};
    var q = norm(S.chatQ).trim();
    var list = S.chats.filter(function (c) {
      if (q && norm(c.title).indexOf(q) < 0) { return false; }
      if (S.chatFilter === "group") { return c.kind === "group"; }
      if (S.chatFilter === "channel") { return c.kind === "channel"; }
      if (S.chatFilter === "on") { return !!src[c.id]; }
      return c.kind !== "bot";
    });
    if (!list.length) { return '<div class="m-sub">No hay chats con ese filtro.</div>'; }
    return '<div class="m-group">' + list.map(function (c) {
      return '<button class="m-opt chat" data-act="chat" data-id="' + esc(c.id) + '"><span class="ci">' + esc((c.title || "?").slice(0, 1).toUpperCase()) + '</span><div><b>' + esc(c.title) + "</b><small>" + (KIND[c.kind] || "") + "</small></div>" + toggle(!!src[c.id]) + "</button>";
    }).join("") + "</div>";
  }

  V.account = function () {
    var ver = "";
    try { ver = android ? android.version() : ""; } catch (e) { ver = ""; }
    return '<header class="m-top solid"><div class="m-tt"><button class="m-iconbtn" data-back>' + I.back + '</button><b>Ajustes</b></div></header><div class="m-scroll m-form">' +
      (account ? '<div class="m-acc"><span class="m-logo"><i></i></span><div><b>' + esc(account.name) + "</b><small>" + (account.username ? "@" + esc(account.username) + " · " : "") + "Telegram</small></div>" +
        '<span class="ok">Conectada</span></div>' : "") +
      '<div class="m-gtitle">Perfil · ' + esc(profile ? profile.name : "") + "</div>" +
      '<div class="m-group">' +
      '<button class="m-opt" data-go="settings"><div><b>Chats de la biblioteca</b><small>' + esc(chatTitles().join(", ") || "Ninguno") + "</small></div>" + I.chev + "</button>" +
      '<button class="m-opt" data-act="edit-profile"><div><b>Editar perfil</b><small>Nombre, avatar y PIN</small></div>' + I.chev + "</button>" +
      '<button class="m-opt" data-act="switch-profile"><div><b>Cambiar de perfil</b></div>' + I.chev + "</button>" +
      '<button class="m-opt" data-act="sync"><div><b>Actualizar biblioteca</b><small>' + (S.syncing ? "Actualizando…" : "Vuelve a leer los chats") + "</small></div>" + I.refresh + "</button></div>" +
      (profile && profile.kids ? "" : '<div class="m-gtitle">TV en vivo</div><div class="m-group"><button class="m-opt" data-go="iptv"><div><b>Lista IPTV (enlace M3U)</b><small>' +
        esc(HFLibrary.iptv() ? iptvShort(HFLibrary.iptv().url) + " · se ve en la TV" : "Sin lista · pon el enlace de tu proveedor") + "</small></div>" + I.chev + "</button></div>") +
      '<div class="m-gtitle">Sincronización</div><div class="m-group"><div class="m-opt"><div><b>Mi lista, progreso y perfiles</b><small>' + esc(syncText()) + "</small></div></div></div>" +
      '<div class="m-gtitle">Actualizaciones</div><div class="m-group">' + updateRow() + "</div>" +
      '<div class="m-gtitle">Cuenta</div><div class="m-group">' +
      '<button class="m-opt danger" data-act="sheet" data-sheet="logout"><div><b>Cerrar sesión</b><small>Se borra la sesión de este celular</small></div></button></div>' +
      '<div class="m-foot">HomeFlix' + (typeof HF_VERSION !== "undefined" && HF_VERSION ? " v" + esc(HF_VERSION) : "") + (ver && ver !== HF_VERSION ? " · programa v" + esc(ver) : "") + " · celular</div></div>" + nav("");
  };

  /* ----- TV en vivo (IPTV): el enlace M3U de la cuenta; se sincroniza y la TV lo usa en «TV en vivo» ----- */
  function iptvShort(u) {
    var m = /^https?:\/\/([^\/?#]+)/i.exec(String(u || ""));
    return m ? m[1] : String(u || "").slice(0, 40);
  }
  V.iptv = function () {
    var cfg = HFLibrary.iptv();
    if (S.iptvUrl === undefined) { S.iptvUrl = cfg ? cfg.url : ""; }
    return topTitle("TV en vivo") + '<div class="m-scroll m-form">' +
      '<p class="m-intro">Pon el enlace M3U de <b>tu proveedor de IPTV</b>. HomeFlix solo reproduce la lista que tú contratas: no incluye canales.</p>' +
      '<div class="m-field"><label for="iptvUrl">Enlace de la lista</label><div class="m-input"><input id="iptvUrl" data-model="iptvUrl" type="url" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="http://… (enlace M3U)" value="' + esc(S.iptvUrl) + '"/></div></div>' +
      errorBox(S.iptvError) +
      '<button class="m-btn primary block" data-act="iptv-save">' + (cfg ? "Guardar cambios" : "Guardar") + "</button>" +
      (cfg ? '<button class="m-btn ghost block" style="margin-top:12px" data-act="iptv-del">Quitar la lista</button>' : "") +
      '<p class="m-sub" style="margin-top:22px">Llega sola a la TV: abre <b>TV en vivo</b> en el menú de arriba. Los canales también se ven aquí, en la pestaña <b>TV en vivo</b>.</p></div>' + nav("");
  };
  ACT["iptv-save"] = function () {
    var url = String(S.iptvUrl || "").trim();
    if (!/^https?:\/\/\S+$/i.test(url)) { S.iptvError = "Escribe un enlace que empiece con http:// o https://"; render(true); return; }
    S.iptvError = "";
    HFLibrary.setIptv(url);
    toast("Lista guardada: ya está en «TV en vivo», aquí y en la TV");
    S.iptvUrl = undefined;
    render(true);
  };
  ACT["iptv-del"] = function () {
    HFLibrary.setIptv("");
    S.iptvUrl = "";
    S.iptvError = "";
    toast("Lista quitada");
    render(true);
  };

  /* (ACT, el mapa de acciones de los botones, está declarado arriba: antes de la ficha, que ya registra las suyas) */

  /* ----- Actualizaciones (js/update.js): la interfaz se baja y se usa al reiniciar; si hace falta, el APK nuevo ----- */
  var UP ={ info: null, state: "", pct: 0, error: "", checking: false };
  function updateRow() {
    var i = UP.info;
    var sub;
    var act = "update-check";
    var label = "Buscar actualizaciones";
    if (UP.checking) { sub = "Buscando…"; }
    else if (UP.state === "bajando") { sub = "Bajando la versión " + esc(i.version) + "… " + UP.pct + " %"; label = "Actualizando"; act = ""; }
    else if (UP.state === "lista") { sub = "Lista. Toca para abrir la versión nueva."; label = "Reiniciar con v" + esc(i.version); act = "update-restart"; }
    else if (i && i.hay && i.programa) { sub = "Esta versión necesita instalar la app nueva (se baja y Android te pide confirmar)."; label = "Instalar HomeFlix v" + esc(i.version); act = "update-apk"; }
    else if (i && i.hay) { sub = (i.notas ? esc(String(i.notas).split("\n")[0]) : "Hay una versión nueva") + (UP.error ? " · " + esc(UP.error) : ""); label = "Actualizar a v" + esc(i.version); act = "update-go"; }
    else if (i) { sub = "Tienes la última versión" + (UP.error ? " · " + esc(UP.error) : ""); }
    else { sub = UP.error ? esc(UP.error) : "Se revisa sola al abrir la app"; }
    return '<button class="m-opt"' + (act ? ' data-act="' + act + '"' : "") + "><div><b>" + label + "</b><small>" + sub + "</small></div>" + I.refresh + "</button>";
  }
  function updatePaint() { if (S.view === "account") { render(true); } }
  ACT["update-check"] = function () {
    UP.checking = true; UP.error = ""; updatePaint();
    HFUpdate.check().then(function (info) { UP.checking = false; UP.info = info; updatePaint(); }, function (e) { UP.checking = false; UP.error = e.message; updatePaint(); });
  };
  ACT["update-go"] = function () {
    var i = UP.info;
    if (!i || !i.web) { return; }
    UP.state = "bajando"; UP.pct = 0; UP.error = ""; updatePaint();
    HFUpdate.install(i.manifest, function (p) {
      var pct = p.total ? Math.round(p.got / p.total * 100) : 0;
      if (pct !== UP.pct) { UP.pct = pct; updatePaint(); }
    }).then(function () { UP.state = "lista"; updatePaint(); toast("Actualización lista"); }, function (e) { UP.state = ""; UP.error = e.message; updatePaint(); });
  };
  ACT["update-restart"] = function () { HFUpdate.restart(); };
  ACT["update-apk"] = function () {
    if (!UP.info || !HFUpdate.installNative(UP.info.manifest)) { toast("Instálala desde el archivo .apk de la versión nueva"); return; }
    toast("Bajando la app nueva…");
  };

  function syncText() {
    var st = HFSync.status();
    if (st.state === "off") { return "Se guardan en el servidor de HomeFlix"; }
    if (st.state === "busy") { return "Sincronizando…"; }
    if (st.state === "error") { return "No se pudo sincronizar: " + st.error; }
    if (!st.at) { return "Iguales en la TV y el celular"; }
    var min = Math.round((Date.now() - st.at) / 60000);
    return "Iguales en la TV y el celular · " + (min < 1 ? "hace un momento" : "hace " + plural(min, "minuto", "minutos"));
  }

  /* ----- Reproductor ----- */
  /* El reproductor, con la distribución del de Netflix y los colores de HomeFlix:
   *   arriba  ← · título (película: nombre; serie: «T5:E11 «Título»» y debajo la serie) · Ver en la TV · Bloquear
   *   izq.    brillo (solo en la app de Android)
   *   centro  -10 · pausa · +10
   *   abajo   barra de tiempo con lo que falta · Recortar · Velocidad · Episodios* · Audio y subtítulos · Calidad* · Sig. epi.*
   * (* solo si aplica). Bloqueado: no responde a toques salvo para desbloquear. Recortando: vista propia (clipHtml). */
  function rateLabel(r) { return String(r).replace(".", ",") + "x"; }
  function brightAvailable() { return !!(android && typeof android.setBrightness === "function"); }
  V.player = function () {
    var P = S.player || {};
    if (P.clip) { return clipHtml(P); }
    var ep = P.series ? P.entry : null;
    var big = ep ? "T" + ep.season + ":E" + ep.episode + (ep.title ? " «" + ep.title + "»" : "") : (P.name || "");
    var small = ep ? P.name : P.sub;
    var tool = function (attrs, icon, label, id) { return "<button " + attrs + (id ? ' id="' + id + '"' : "") + ">" + icon + "<span>" + label + "</span></button>"; };
    return '<div class="m-player np' + (P.locked ? " locked" : "") + '" id="pl"><div class="frame" id="plPoster"' + img(P.poster) + '></div><div class="scrim"></div>' +
      '<div class="ptop"><button class="m-iconbtn" data-act="close-player" aria-label="Volver">' + I.back + "</button>" +
      '<div class="ttl"><b>' + esc(big) + "</b>" + (small ? "<small>" + esc(small) + "</small>" : "") + "</div>" +
      '<button class="m-iconbtn" data-act="cast" aria-label="Ver en la TV">' + I.cast + "</button>" +
      '<button class="m-iconbtn" data-act="lock" aria-label="Bloquear la pantalla">' + I.lockOpen + "</button></div>" +
      (brightAvailable() ? '<div class="bright" id="plBright">' + I.sun + '<div class="vtrack" id="plBrightTrack"><i id="plBrightFill"></i></div></div>' : "") +
      '<div class="mid"><button class="skip" data-act="seek-rel" data-s="-10" aria-label="Atrás 10 segundos">' + I.rew + "<em>10</em></button>" +
      '<button class="pp" data-act="toggle-play" id="plPP" aria-label="Pausa o seguir">' + I.pause + '</button><button class="skip" data-act="seek-rel" data-s="10" aria-label="Adelante 10 segundos">' + I.fwd + "<em>10</em></button></div>" +
      '<div class="m-plmsg" id="plMsg"></div>' +
      '<div class="pbot"><div class="seek"><div class="track" id="plTrack"><div class="buf" id="plBuf"></div><div class="now" id="plNow"></div><div class="knob" id="plKnob"></div></div><span id="plD">0:00</span></div>' +
      '<div class="tools">' +
      tool('data-act="clip"', I.scissors, "Recortar") +
      tool('data-act="sheet" data-sheet="speed"', I.speed, "Velocidad (" + rateLabel(HFPlayback.rate()) + ")", "plRate") +
      (P.series ? tool('data-act="sheet" data-sheet="episodes"', I.episodes, "Episodios") : "") +
      tool('data-act="sheet" data-sheet="tracks"', I.subs, "Audio y subtítulos") +
      (P.qualities ? tool('data-act="sheet" data-sheet="quality"', I.quality, 'Calidad <em class="q" id="plQ">AUTO</em>') : "") +
      (P.nextEp ? tool('data-act="next-ep"', I.next, "Sig. epi.") : "") +
      "</div></div>" +
      '<div class="m-next" id="plNext" hidden></div>' +
      '<button class="unlock" data-act="unlock" id="plUnlock">' + I.lock + "<span><b>Pantalla bloqueada</b><small>Toca aquí para desbloquear</small></span></button></div>";
  };

  /* ===================== Navegación ===================== */
  var TABS = { home: 1, movies: 1, series: 1, live: 1, search: 1, mylist: 1 };

  /* Scroll de la hoja abierta y de sus columnas, para no perderlo si se vuelve a pintar con la misma hoja. */
  function sheetScroll() {
    return Array.prototype.map.call(root.querySelectorAll(".m-sheet, .m-sheet .sh-col"), function (el) { return el.scrollTop; });
  }
  function render(keepScroll) {
    var y = window.scrollY;
    var sheetWas = root.getAttribute("data-sheet") || "";
    var sy = sheetScroll();
    if (S.view === "live" && byId("mlList")) { S.live.scroll = byId("mlList").scrollTop; }
    root.setAttribute("data-view", S.view);
    root.setAttribute("data-sheet", S.sheet || "");
    root.innerHTML = (V[S.view] || V.home)() + castBar() + (S.sheet && SHEETS[S.sheet] ? SHEETS[S.sheet]() : "") + overlayHtml() + (S.toast ? '<div class="m-toast">' + esc(S.toast) + "</div>" : "");
    navPop = false;
    hydrate();
    window.scrollTo(0, keepScroll ? y : 0);
    if (S.sheet && S.sheet === sheetWas) {
      Array.prototype.forEach.call(root.querySelectorAll(".m-sheet, .m-sheet .sh-col"), function (el, i) { el.scrollTop = sy[i] || 0; });
    }
    if (AFTER[S.view]) { AFTER[S.view](); }
  }

  function go(view, arg, opts) {
    opts = opts || {};
    root.classList.remove("nav-hidden"); // al cambiar de pantalla la barra vuelve
    leave(view);
    if (opts.root) {
      S.stack = [];
    } else if (TABS[view] && TABS[S.view]) {
      S.stack = view === "home" ? [] : [{ view: "home", arg: null, y: 0 }];
    } else if (S.view && S.view !== "boot" && !opts.replace) {
      S.stack.push({ view: S.view, arg: S.arg, y: window.scrollY });
    }
    S.view = view;
    S.arg = arg === undefined ? null : arg;
    S.sheet = null;
    S.overlay = null;
    if (view === "home" && !opts.keep) { heroPick += 1; }
    render();
  }

  function back() {
    if (HFIntro.active()) { HFIntro.skip(); return true; }
    if (S.sheet) { S.sheet = null; render(true); return true; }
    if (S.overlay) { S.overlay = null; render(true); return true; }
    if (S.view === "live" && S.live.full) { liveFull(false); return true; }
    if (S.view === "player" && S.player && S.player.locked) { showUnlock(); return true; }
    if (S.view === "player" && S.player && S.player.clip) { if (S.player.clip.saving) { clipRecStop(false); } else { clipExit(); } return true; }
    if (S.view === "player") { closePlayer(); return true; }
    if (S.view === "settings" && S.firstTime) { return false; }
    var prev = S.stack.pop();
    if (prev) {
      leave(prev.view);
      S.view = prev.view;
      S.arg = prev.arg;
      render();
      window.scrollTo(0, prev.y || 0);
      if (prev.view === "settings" || S.view === "home") { /* nada */ }
      return true;
    }
    if (TABS[S.view] && S.view !== "home") { go("home", null, { root: true }); return true; }
    return false;
  }

  /* Al salir de una vista: cortar lo que esté corriendo (QR, contador del código). */
  function leave(next) {
    S.castLive = null;
    if (S.view === "live" && next !== "live" && next !== "iptv" && HFLive.current()) { liveStop(); }
    if (S.view === "live" && next !== "live") { document.documentElement.classList.remove("m-live-on"); }
    if (S.view === "login-qr" && next !== "login-password" && S.login.qrAbort) {
      S.login.qrAbort.abort();
      S.login.qrAbort = null;
    }
    if (S.view === "login-code" && codeTimer) { clearInterval(codeTimer); codeTimer = null; }
    if (S.view === "settings" && next !== "settings" && chatsChanged) {
      chatsChanged = false;
      rebuild();
      sync();
    }
  }

  function toast(msg) {
    S.toast = msg;
    var el = root.querySelector(".m-toast");
    if (el) { el.textContent = msg; } else { root.insertAdjacentHTML("beforeend", '<div class="m-toast">' + esc(msg) + "</div>"); }
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { S.toast = ""; var e = root.querySelector(".m-toast"); if (e) { e.remove(); } }, 2600);
  }

  function overlayHtml() {
    if (S.overlay !== "categories") { return ""; }
    var cats = catsOf(titles());
    return '<div class="m-overlay"><div class="m-catlist">' +
      '<button data-act="cat-go" data-c="" class="on">Inicio</button><button data-act="cat-tab" data-t="movies">Películas</button><button data-act="cat-tab" data-t="series">Series</button><button data-act="cat-tab" data-t="mylist">Mi lista</button>' +
      cats.map(function (c) { return '<button data-act="category" data-c="' + esc(c) + '">' + esc(c) + "</button>"; }).join("") +
      '</div><button class="m-close" data-act="close-overlay" aria-label="Cerrar">' + I.x + "</button></div>";
  }

  /* Después de pintar: enfocar campos, arrancar el QR, contadores. */
  var codeTimer = null;
  var AFTER = {
    home: function () { heroSetup(); },
    login: function () { var p = byId("phone"); if (p && !S.login.phone) { p.focus(); } },
    "login-code": function () {
      var c = byId("code");
      if (c) { c.focus(); }
      codeTimer = setInterval(function () {
        var el = byId("resend");
        var left = Math.max(0, Math.ceil((S.login.until - Date.now()) / 1000));
        if (el) { el.innerHTML = resendText(left); }
        if (!left) { clearInterval(codeTimer); codeTimer = null; }
      }, 1000);
    },
    "login-password": function () { var p = byId("pw"); if (p) { p.focus(); } },
    "login-qr": function () { if (!S.login.qrAbort) { startQr(); } },
    settings: function () { if (!S.chats && !S.chatsError) { loadChats(); } },
    /* El video arranca una sola vez por S.player. Si la pantalla se vuelve a pintar (abrir una hoja, cambian las
     * pistas…) solo se repone el estado: arrancarlo de nuevo reabría el video, eso volvía a avisar de las pistas,
     * que volvía a pintar… en bucle (~20 veces por segundo, sin dejar hacer scroll en «Audio y subtítulos»). */
    player: function () {
      if (!S.player) { return; }
      if (S.player.started) { paintPlayer(); return; }
      S.player.started = true;
      startPlayback();
    }
  };

  /* ===================== Acciones ===================== */
  /* ACT (el mapa de acciones) se declara más arriba, antes del bloque de Actualizaciones, que ya registra las suyas */

  /* ----- Inicio de sesión ----- */
  function fullPhone() {
    var cc = "+" + String(S.login.cc).replace(/\D/g, "");
    return cc + String(S.login.phone).replace(/\D/g, "");
  }
  function setLogin(patch) { Object.keys(patch).forEach(function (k) { S.login[k] = patch[k]; }); render(true); }

  ACT["send-code"] = function () {
    var digits = String(S.login.phone).replace(/\D/g, "");
    if (digits.length < 6) { setLogin({ error: "Escribe tu número completo, sin el indicativo." }); return; }
    setLogin({ busy: true, error: "" });
    HFTelegram.sendCode(fullPhone()).then(function (r) {
      S.login.busy = false;
      S.login.hash = r.hash;
      S.login.via = r.via;
      S.login.length = r.length || 5;
      S.login.code = "";
      S.login.until = Date.now() + (r.timeout || 60) * 1000;
      go("login-code");
    }, function (e) {
      setLogin({ busy: false, error: HFTelegram.loginError(e) });
    });
  };

  ACT["verify-code"] = function () {
    var L = S.login;
    if (L.busy) { return; }
    if (L.code.length < L.length) { setLogin({ error: "Faltan números del código." }); return; }
    setLogin({ busy: true, error: "" });
    HFTelegram.signInCode(fullPhone(), L.hash, L.code).then(function (r) {
      S.login.busy = false;
      if (r.password) {
        S.login.hint = r.hint || "";
        S.login.password = "";
        go("login-password");
      } else {
        loggedIn(r.user);
      }
    }, function (e) {
      setLogin({ busy: false, code: "", error: HFTelegram.loginError(e) });
      tick();
    });
  };

  ACT.resend = function () {
    var L = S.login;
    HFTelegram.resendCode(fullPhone(), L.hash).then(function (r) {
      L.hash = r.hash;
      L.via = r.via;
      L.length = r.length || L.length;
      L.until = Date.now() + (r.timeout || 60) * 1000;
      L.error = "";
      render(true);
      toast("Te enviamos otro código");
    }, function (e) { setLogin({ error: HFTelegram.loginError(e) }); });
  };

  ACT["toggle-pw"] = function () { setLogin({ showPw: !S.login.showPw }); };

  ACT["send-password"] = function () {
    var L = S.login;
    if (!L.password) { setLogin({ error: "Escribe tu contraseña." }); return; }
    if (L.pwResolve) {
      /* viene del QR: el motor espera la contraseña */
      var res = L.pwResolve;
      L.pwResolve = null;
      setLogin({ busy: true, error: "" });
      res(L.password);
      return;
    }
    setLogin({ busy: true, error: "" });
    HFTelegram.signInPassword(L.password).then(function (u) {
      S.login.busy = false;
      loggedIn(u);
    }, function (e) {
      setLogin({ busy: false, error: HFTelegram.loginError(e) });
      tick();
    });
  };

  function startQr() {
    var L = S.login;
    L.qrAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
    L.error = "";
    HFTelegram.loginQr({
      onUrl: function (url) {
        L.qr = HFTelegram.qrSvg(url, 6);
        L.qrNote = "";
        var el = byId("qr");
        if (el) { el.innerHTML = L.qr; }
      },
      onScanned: function () {
        L.qrNote = "Código escaneado, entrando…";
        var n = byId("qrNote");
        if (n) { n.innerHTML = I.check + esc(L.qrNote); }
      },
      askPassword: function () {
        return new Promise(function (resolve) {
          L.pwResolve = resolve;
          L.password = "";
          L.busy = false;
          go("login-password");
        });
      },
      onBadPassword: function () {
        S.login.busy = false;
        S.login.error = "La contraseña no es correcta.";
        if (S.view === "login-password") { render(true); }
      },
      signal: L.qrAbort ? L.qrAbort.signal : undefined
    }).then(function (u) {
      L.qrAbort = null;
      L.busy = false;
      loggedIn(u);
    }, function (e) {
      L.qrAbort = null;
      if (e && e.name === "AbortError") { return; }
      L.error = HFTelegram.loginError(e);
      if (S.view === "login-qr") { render(true); }
    });
  }

  function loggedIn(user) {
    account = user;
    HFLibrary.setAccount(user.id);
    HFLibrary.rememberAccount({ slot: HFTelegram.slot(), id: user.id, name: user.name, username: user.username }, HFTelegram.MAIN_SLOT);
    S.login.password = "";
    S.login.code = "";
    S.login.qr = "";
    items = HFLibrary.cachedItems() || [];
    HFSync.start(); // Mi lista, progreso y perfiles iguales en la TV y el celular (js/sync.js)
    /* llegó hasta aquí: esta interfaz arranca bien; y se revisa si hay una versión nueva */
    setTimeout(function () { HFUpdate.ok(); }, 5000);
    HFUpdate.auto(function (info) {
      UP.info = info;
      toast(info.programa ? "Hay una versión nueva de HomeFlix: instálala en Ajustes" : "Hay una versión nueva de HomeFlix: actualiza en Ajustes");
    });
    HFRemote.start(); // «Ver en la TV»: recibir el estado de la TV que se controla
    go("profiles", null, { root: true });
  }

  /* Llegaron cambios de otro dispositivo: volver a armar y pintar, salvo donde se está escribiendo o viendo algo. */
  var QUIET = { player: 1, login: 1, "login-code": 1, "login-password": 1, "login-qr": 1, "profile-edit": 1, pin: 1, search: 1, settings: 1, boot: 1 };
  function onSyncRemote() {
    if (profile) {
      var p = HFLibrary.profiles().filter(function (x) { return x.id === profile.id; })[0];
      if (!p) {
        /* borraron este perfil en otro dispositivo */
        profile = null;
        if (!QUIET[S.view]) { go("profiles", null, { root: true }); }
        return;
      }
      profile = p;
    }
    rebuild();
    if (!QUIET[S.view] && !S.sheet) { render(true); }
  }
  if (!DESIGN) { HFSync.onRemote(onSyncRemote); }

  ACT.boot = function () { boot(); };

  /* ----- Perfiles y PIN ----- */
  ACT.profile = function (el) {
    var p = HFLibrary.profiles().filter(function (x) { return x.id === el.getAttribute("data-id"); })[0];
    if (!p) { return; }
    if (p.pin) {
      S.pin = { profile: p, entered: "", error: "", onOk: function () { enterProfile(p); } };
      go("pin");
    } else {
      enterProfile(p);
    }
  };

  ACT["pin-key"] = function (el) {
    var P = S.pin;
    var k = el.getAttribute("data-k");
    tick();
    if (k === "del") { P.entered = P.entered.slice(0, -1); P.error = ""; render(true); return; }
    if (P.entered.length >= 4) { return; }
    P.entered += k;
    P.error = "";
    if (P.entered.length < 4) { render(true); return; }
    if (P.mode === "set") {
      /* poner un PIN nuevo: escribirlo dos veces */
      if (!P.first) { P.first = P.entered; P.entered = ""; P.title = "Repítelo"; render(true); return; }
      if (P.first !== P.entered) { P.first = ""; P.entered = ""; P.title = "Escribe el PIN nuevo"; P.error = "No coinciden. Empieza otra vez."; render(true); return; }
      P.onOk(P.entered);
      return;
    }
    if (HFLibrary.checkPin(P.profile.id, P.entered)) {
      P.onOk();
    } else {
      P.entered = "";
      P.error = "PIN incorrecto";
      render(true);
    }
  };

  function enterProfile(p) {
    profile = p;
    HFLibrary.setProfile(p.id);
    rebuild();
    var src = HFLibrary.enabledSources();
    if (!src || !Object.keys(src).length) {
      S.firstTime = true;
      S.chats = null;
      go("settings", null, { root: true });
      return;
    }
    S.firstTime = false;
    go("home", null, { root: true });
    sync();
  }

  ACT["new-profile"] = function () {
    S.edit = { id: "", name: "", avatar: "05-Capitan_America", kids: false, error: "" };
    go("profile-edit");
  };
  ACT["edit-profile"] = function () {
    var p = profile || HFLibrary.profiles()[0];
    S.edit = { id: p.id, name: p.name, avatar: p.avatar, kids: !!p.kids, hasPin: !!p.pin, error: "" };
    go("profile-edit");
  };
  ACT.avatar = function (el) { S.edit.avatar = el.getAttribute("data-id"); render(true); };
  ACT["edit-kids"] = function () { S.edit.kids = !S.edit.kids; render(true); };
  ACT["save-profile"] = function () {
    var E = S.edit;
    var r = HFLibrary.saveProfile({ id: E.id || undefined, name: E.name, avatar: E.avatar, kids: E.kids });
    if (r && r.error) { E.error = r.error; render(true); return; }
    if (profile && E.id === profile.id) {
      profile = HFLibrary.profiles().filter(function (x) { return x.id === E.id; })[0] || profile;
      rebuild();
    }
    toast("Perfil guardado");
    back();
  };
  ACT["edit-pin"] = function () {
    var E = S.edit;
    var p = HFLibrary.profiles().filter(function (x) { return x.id === E.id; })[0];
    S.pin = { profile: p, entered: "", error: "", mode: "set", title: "Escribe el PIN nuevo", onOk: function (pin) {
      HFLibrary.saveProfile({ id: p.id, name: p.name, avatar: p.avatar, kids: p.kids, pin: pin });
      E.hasPin = true;
      toast("PIN guardado");
      back();
    } };
    go("pin");
  };
  ACT["delete-profile"] = function () { S.sheet = "delete-profile"; render(true); };
  ACT["confirm-delete-profile"] = function () {
    HFLibrary.deleteProfile(S.edit.id);
    S.sheet = null;
    go("profiles", null, { root: true });
  };
  ACT["switch-profile"] = function () { go("profiles", null, { root: true }); };

  /* ----- Chats ----- */
  var chatsChanged = false;
  function loadChats() {
    S.chatsError = "";
    HFTelegram.dialogs(300).then(function (list) {
      S.chats = list;
      if (S.view === "settings") { byId("chatList").innerHTML = chatList(); }
    }, function (e) {
      S.chatsError = "No pude leer tus chats: " + HFTelegram.loginError(e);
      if (S.view === "settings") { render(true); }
    });
  }
  ACT["load-chats"] = function () { S.chats = null; render(true); loadChats(); };
  ACT.chat = function (el) {
    var id = el.getAttribute("data-id");
    var map = HFLibrary.enabledSources() || {};
    var c = (S.chats || []).filter(function (x) { return x.id === id; })[0];
    if (map[id]) { delete map[id]; } else { map[id] = c ? c.title : id; }
    HFLibrary.setEnabledSources(map);
    chatsChanged = true;
    tick();
    render(true);
  };
  ACT["chat-filter"] = function (el) { S.chatFilter = el.getAttribute("data-f"); render(true); };
  ACT["chats-done"] = function () {
    var src = HFLibrary.enabledSources() || {};
    if (!Object.keys(src).length) { toast("Elige al menos un chat"); return; }
    S.firstTime = false;
    chatsChanged = false;
    rebuild();
    go("home", null, { root: true });
    sync();
  };

  /* ----- Catálogo y ficha ----- */
  ACT.categories = function () { S.overlay = "categories"; render(true); };
  ACT["hero-dot"] = function (el) {
    var box = byId("heros");
    var i = Number(el.getAttribute("data-i")) || 0;
    if (!box || !box.children[i]) { return; }
    box.scrollTo({ left: box.children[i].offsetLeft - box.children[0].offsetLeft, behavior: "smooth" });
  };
  ACT["close-overlay"] = function () { S.overlay = null; render(true); };
  ACT.category = function (el) { S.category = el.getAttribute("data-c"); S.overlay = null; go("category"); };
  ACT["cat-tab"] = function (el) { S.overlay = null; go(el.getAttribute("data-t")); };
  ACT["cat-go"] = function () { S.overlay = null; go("home", null, { root: true }); };
  ACT.season = function (el) { S.season = Number(el.getAttribute("data-i")) || 0; render(true); };
  ACT.mylist = function (el) {
    var k = el.getAttribute("data-key");
    HFLibrary.toggleMyList(k);
    tick();
    toast(HFLibrary.inMyList(k) ? "Agregado a Mi lista" : "Quitado de Mi lista");
    render(true);
  };
  ACT.sheet = function (el) { S.sheet = el.getAttribute("data-sheet"); render(true); };
  ACT["close-sheet"] = function () { S.sheet = null; S.castLive = null; render(true); };
  ACT.logout = function () {
    S.sheet = null;
    toast("Cerrando sesión…");
    if (S.cast) { castEnd(""); }
    HFRemote.stop();
    HFSync.stop().then(function () { return HFTelegram.logout(); }).then(function () {
      /* se recarga para que la próxima cuenta empiece con el motor de Telegram limpio (js/telegram.js logout) */
      window.location.reload();
    });
  };
  ACT.sync = function () { HFSync.now(); sync(true); };

  /* ----- Reproducir ----- */
  function qualityPref() { try { return localStorage.getItem("hf.m.quality") || ""; } catch (e) { return ""; } }
  ACT.quality = function (el) {
    var q = el.getAttribute("data-q");
    try { if (q) { localStorage.setItem("hf.m.quality", q); } else { localStorage.removeItem("hf.m.quality"); } } catch (e) { /* nada */ }
    S.sheet = null;
    if (S.view === "player" && HFPlayback.qualities()) {
      var list = HFPlayback.qualities().list || [];
      var v = list.filter(function (x) { return x.q === q; })[0];
      HFPlayback.setQuality(v ? v.key : "auto");
    }
    toast(q ? "Calidad: " + q : "Calidad automática");
    render(true);
  };

  function play(t, opts) {
    opts = opts || {};
    if (!t) { return; }
    var entry = t;
    var series = null;
    var start = 0;
    if (t.type === "series") {
      var n = HFLibrary.nextEpisode(t) || {};
      entry = opts.episode || n.episode;
      series = t;
      if (!entry) { return; }
      var pe = HFLibrary.progress(entryKey(entry));
      start = opts.fromStart ? 0 : (pe && !pe.done ? pe.t : 0);
    } else {
      var p = HFLibrary.progress(entryKey(t));
      start = opts.fromStart ? 0 : (p && !p.done ? p.t : 0);
    }
    var nextEp = series ? HFLibrary.episodeAfter(series, entry) : null;
    S.player = {
      entry: entry, series: series, title: t, start: start, nextEp: nextEp,
      name: series ? series.name : t.name,
      sub: series ? "T" + entry.season + ":E" + entry.episode + (entry.title ? " · " + entry.title : "") : [t.year, qualityOf(t)].filter(Boolean).join(" · "),
      poster: series ? entryKey(entry) : (t.bannerKey || t.imageKey),
      qualities: (entry.versions || []).length > 1,
      lastSave: 0, nextShown: false
    };
    go("player");
  }
  ACT["play-ep"] = function (el) {
    var t = titleOf(S.arg);
    var key = el.getAttribute("data-key");
    var ep = null;
    (t.seasons || []).forEach(function (s) { s.episodes.forEach(function (e) { if (e.key === key) { ep = e; } }); });
    play(t, { episode: ep });
  };
  ACT["play-start"] = function (el) { play(titleOf(el.getAttribute("data-key")), { fromStart: true }); };

  var hideTimer = null;
  function showChrome() {
    var pl = byId("pl");
    if (!pl || (S.player && S.player.locked)) { return; }
    pl.classList.remove("idle");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { if (HFPlayback.playing() && byId("pl") && !S.sheet) { byId("pl").classList.add("idle"); } }, 3500);
  }

  function startPlayback() {
    var P = S.player;
    if (!P) { return; }
    try { if (android) { android.setPlayerMode(true); } } catch (e) { /* nada */ }
    var host = byId("mplayer");
    host.hidden = false;
    var pref = qualityPref();
    HFPlayback.open(P.entry, P.start || 0, {
      onTime: function (t, d, buffered) {
        var pct = d ? (t / d) * 100 : 0;
        thumbMaybe(P, t); // cuadritos para la tira de «Recortar»
        if (P.clip) { clipOnTime(t); return; } // recortando: ni barra, ni progreso, ni «siguiente capítulo»
        if (!byId("plD")) { return; }
        byId("plD").textContent = clock(Math.max(0, d - t)); // lo que falta, como en Netflix
        byId("plNow").style.width = pct + "%";
        byId("plKnob").style.left = pct + "%";
        byId("plBuf").style.width = (d ? (buffered / d) * 100 : 0) + "%";
        var q = HFPlayback.qualities();
        if (q && byId("plQ")) { byId("plQ").textContent = (q.auto ? "AUTO · " : "") + (q.current && q.current.q || ""); }
        if (Date.now() - P.lastSave > 10000 && t > 5) {
          P.lastSave = Date.now();
          HFLibrary.setProgress(entryKey(P.entry), t, d);
        }
        if (P.nextEp && d - t <= 15 && d - t > 0) { showNext(Math.ceil(d - t)); }
      },
      onState: function (s) {
        P.state = s;
        P.msg = s === "loading" ? '<div class="m-spin"></div>Abriendo…' : s === "buffering" ? '<div class="m-spin"></div>Cargando…' : "";
        if (s === "playing") { P.played = true; }
        /* grabando un recorte: si el video se queda cargando, la grabación espera (no se graba la imagen congelada) */
        var rec = P.clip && P.clip.rec;
        if (rec && (s === "buffering" || s === "loading") && rec.state === "recording") { rec.pause(); }
        if (rec && s === "playing" && rec.state === "paused") { rec.resume(); }
        paintPlayer();
        if (s === "playing" || s === "paused") { showChrome(); }
      },
      onEnded: function () {
        if (P.clip) { if (P.clip.rec) { clipRecStop(true); } return; } // el recorte llegaba hasta el final
        HFLibrary.setProgress(entryKey(P.entry), HFPlayback.duration(), HFPlayback.duration());
        if (P.nextEp) { play(P.series, { episode: P.nextEp, fromStart: true }); return; }
        closePlayer();
      },
      onError: function (m) {
        P.msg = '<div class="m-error">' + esc(m) + '</div><button class="m-btn primary" data-act="close-player">Volver</button>';
        paintPlayer();
      },
      onNote: function (m) { toast(m); },
      onTracks: function () { if (S.sheet === "tracks") { render(true); } }
    });
    if (pref && HFPlayback.qualities()) {
      var v = (HFPlayback.qualities().list || []).filter(function (x) { return x.q === pref; })[0];
      if (v) { HFPlayback.setQuality(v.key); }
    }
    showChrome();
  }

  /* Lo que muestra la pantalla del reproductor según el estado del video (también al volver a pintarla). */
  function paintPlayer() {
    var P = S.player;
    if (!P) { return; }
    var s = P.state || "loading";
    var pp = byId("plPP");
    var msg = byId("plMsg");
    var po = byId("plPoster");
    if (pp) { pp.innerHTML = s === "playing" || s === "buffering" ? I.pause : I.play; }
    if (msg) { msg.innerHTML = P.msg || ""; }
    if (po && P.played) { po.style.opacity = HFPlayback.simulated ? "1" : "0"; }
    paintBright();
    if (P.clip) { paintClip(); }
  }

  function showNext(sec) {
    var P = S.player;
    var el = byId("plNext");
    if (!el || !P.nextEp) { return; }
    el.hidden = false;
    el.innerHTML = '<div class="img"' + img(entryKey(P.nextEp)) + '><span class="cd">' + sec + '</span></div><div class="tx"><small>Siguiente capítulo</small><b>T' + P.nextEp.season + ":E" + P.nextEp.episode + (P.nextEp.title ? " · " + esc(P.nextEp.title) : "") + "</b>" +
      '<div class="bt"><button class="m-btn primary" data-act="next-ep">' + I.play + 'Ver ahora</button><button class="m-btn ghost" data-act="hide-next">Ver créditos</button></div></div>';
    hydrate();
  }

  /* then: la vista a la que se pasa en lugar de volver (p. ej. «remote» al mandar el video a la TV). */
  function closePlayer(then) {
    var P = S.player;
    if (P && HFPlayback.time() > 5) { HFLibrary.setProgress(entryKey(P.entry), HFPlayback.time(), HFPlayback.duration()); }
    HFPlayback.close();
    byId("mplayer").hidden = true;
    byId("mplayer").classList.remove("clip");
    clipUnfit();
    try { if (android) { android.setPlayerMode(false); } } catch (e) { /* nada */ }
    S.player = null;
    S.sheet = null;
    if (typeof then === "string") {
      S.view = then;
      S.arg = null;
      render();
      return;
    }
    var prev = S.stack.pop();
    S.view = prev ? prev.view : "home";
    S.arg = prev ? prev.arg : null;
    render();
    if (prev) { window.scrollTo(0, prev.y || 0); }
  }
  ACT["close-player"] = closePlayer;
  ACT["toggle-play"] = function () { HFPlayback.toggle(); showChrome(); };
  ACT["seek-rel"] = function (el) { HFPlayback.seek(Math.max(0, HFPlayback.time() + Number(el.getAttribute("data-s")))); showChrome(); };
  ACT["next-ep"] = function () {
    var P = S.player;
    HFLibrary.setProgress(entryKey(P.entry), HFPlayback.duration(), HFPlayback.duration());
    HFPlayback.close();
    S.view = S.stack.length ? S.view : S.view;
    play(P.series, { episode: P.nextEp, fromStart: true });
    S.stack.pop(); // el reproductor anterior no queda en la pila
  };
  ACT["hide-next"] = function () { S.player.nextEp = null; var el = byId("plNext"); if (el) { el.hidden = true; } };
  ACT.audio = function (el) { HFPlayback.setAudio(el.getAttribute("data-k")); S.sheet = null; render(true); };
  ACT.sub = function (el) { HFPlayback.setSub(el.getAttribute("data-k") || null); S.sheet = null; render(true); };

  /* Tocar la barra de progreso salta a ese punto. */
  function seekFromTouch(e) {
    var tr = byId("plTrack");
    if (!tr || !HFPlayback.duration() || (S.player && S.player.locked)) { return; }
    var r = tr.getBoundingClientRect();
    var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    HFPlayback.seek(Math.max(0, Math.min(1, x / r.width)) * HFPlayback.duration());
    showChrome();
  }

  /* ===================== Reproductor: brillo, bloqueo, velocidad, episodios ===================== */

  /* Brillo (barra vertical a la izquierda): cambia el de esta pantalla mientras dura el video (MainActivity). */
  function paintBright() {
    var f = byId("plBrightFill");
    if (!f || !brightAvailable()) { return; }
    var v = S.player && S.player.bright !== undefined ? S.player.bright : (function () { try { return android.getBrightness(); } catch (e) { return 0.5; } })();
    f.style.height = Math.round(Math.max(0, Math.min(1, v)) * 100) + "%";
  }
  /* Se arrastra en relativo, como el brillo del sistema: el dedo puede caer en cualquier parte de la columna
   * (el sol, al lado de la barra…) y el brillo solo cambia lo que se mueva, sin saltar a donde se tocó. */
  var brightDrag = null;
  function touchY(e) { return e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY; }
  function currentBright() {
    if (S.player && S.player.bright !== undefined) { return S.player.bright; }
    try { return android.getBrightness(); } catch (e) { return 0.5; }
  }
  root.addEventListener("touchstart", function (e) {
    if (!(e.target.closest && e.target.closest("#plBright")) || !S.player || S.player.locked) { return; }
    var tr = byId("plBrightTrack");
    brightDrag = { y: touchY(e), v: currentBright(), h: tr ? tr.getBoundingClientRect().height || 128 : 128 };
    showChrome();
  }, { passive: true });
  root.addEventListener("touchmove", function (e) {
    if (!brightDrag || !S.player) { return; }
    var v = Math.max(0.02, Math.min(1, brightDrag.v - (touchY(e) - brightDrag.y) / brightDrag.h));
    S.player.bright = v;
    try { android.setBrightness(v); } catch (er) { /* nada */ }
    paintBright();
    showChrome();
  }, { passive: true });
  root.addEventListener("touchend", function () { brightDrag = null; }, { passive: true });
  root.addEventListener("touchcancel", function () { brightDrag = null; }, { passive: true });

  /* Bloquear: los controles desaparecen y los toques no hacen nada (para que no se pause en el bolsillo o con un niño);
   * tocar muestra el botón para desbloquear unos segundos. */
  var unlockTimer = null;
  function showUnlock() {
    var pl = byId("pl");
    if (!pl) { return; }
    pl.classList.add("show-unlock");
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(function () { var p = byId("pl"); if (p) { p.classList.remove("show-unlock"); } }, 3000);
  }
  ACT.lock = function () {
    if (!S.player) { return; }
    S.player.locked = true;
    S.sheet = null;
    var pl = byId("pl");
    if (pl) { pl.classList.add("locked"); pl.classList.add("idle"); }
    showUnlock();
  };
  ACT.unlock = function () {
    if (!S.player) { return; }
    S.player.locked = false;
    var pl = byId("pl");
    if (pl) { pl.classList.remove("locked"); pl.classList.remove("show-unlock"); }
    showChrome();
  };

  /* Velocidad: cinco puntos sobre una línea, como en Netflix. */
  var RATES = [0.5, 0.75, 1, 1.25, 1.5];
  SHEETS.speed = function () {
    var cur = HFPlayback.rate();
    return sheetHtml("Velocidad de reproducción", '<div class="m-speed">' + RATES.map(function (r) {
      return '<button data-act="rate" data-r="' + r + '" class="' + (r === cur ? "on" : "") + '"><i></i><span>' + rateLabel(r) + (r === 1 ? " (normal)" : "") + "</span></button>";
    }).join("") + "</div>");
  };
  ACT.rate = function (el) {
    HFPlayback.setRate(Number(el.getAttribute("data-r")) || 1);
    S.sheet = null;
    render(true);
    showChrome();
  };

  /* Episodios sin salir del video: temporadas arriba, capítulos con su avance; el que se está viendo, marcado. */
  SHEETS.episodes = function () {
    var P = S.player;
    var t = P && P.series;
    if (!t) { return ""; }
    var cur = P.entry;
    if (P.epSeason === undefined) {
      P.epSeason = Math.max(0, (t.seasons || []).map(function (s) { return s.number; }).indexOf(cur.season));
    }
    var season = t.seasons[P.epSeason] || t.seasons[0];
    return sheetHtml(t.name,
      ((t.seasons || []).length > 1 ? '<div class="m-seasons">' + t.seasons.map(function (s, i) { return '<button data-act="pl-season" data-i="' + i + '" class="' + (i === P.epSeason ? "on" : "") + '">Temporada ' + s.number + "</button>"; }).join("") + "</div>" : '<div class="sh-sec">Temporada ' + (season.number || 1) + "</div>") +
      '<div class="m-eplist">' + season.episodes.map(function (e) {
        var pr = HFLibrary.progress(entryKey(e));
        var now = cur && e.key === cur.key;
        return '<button class="m-ep' + (now ? " now" : "") + '" data-act="' + (now ? "close-sheet" : "pl-ep") + '" data-key="' + esc(e.key) + '"><div class="img"' + img(entryKey(e)) + '><span class="play"><b>' + I.play + "</b></span>" +
          (pr && !pr.done && pr.t ? '<div class="bar"><i style="width:' + Math.round((pr.t / Math.max(1, pr.d)) * 100) + '%"></i></div>' : "") + "</div>" +
          '<div><div class="n">' + e.episode + ". " + esc(e.title || "Capítulo " + e.episode) + '</div><div class="d">' + (now ? "Viendo ahora" : dur(e.video ? e.video.duration : 0) + (pr && pr.done ? " · Visto" : "")) + "</div>" +
          (e.description ? "<p>" + esc(e.description) + "</p>" : "") + "</div></button>";
      }).join("") + "</div>");
  };
  ACT["pl-season"] = function (el) { if (S.player) { S.player.epSeason = Number(el.getAttribute("data-i")) || 0; render(true); } };
  /* Cambiar de capítulo desde el reproductor: guarda lo visto y abre el otro (donde se había quedado, si se empezó). */
  ACT["pl-ep"] = function (el) {
    var P = S.player;
    var key = el.getAttribute("data-key");
    var ep = null;
    if (!P || !P.series) { return; }
    P.series.seasons.forEach(function (s) { s.episodes.forEach(function (e) { if (e.key === key) { ep = e; } }); });
    if (!ep) { return; }
    if (HFPlayback.time() > 5) { HFLibrary.setProgress(entryKey(P.entry), HFPlayback.time(), HFPlayback.duration()); }
    HFPlayback.close();
    S.sheet = null;
    play(P.series, { episode: ep });
    S.stack.pop(); // el reproductor anterior no queda en la pila
  };

  /* ===================== Recortar un momento =====================
   * Se eligen inicio y fin (3 s a 60 s) sobre una tira de toda la película que se desliza con el dedo (empieza
   * alrededor de donde se iba); el video se ve en el
   * recuadro del centro, repitiendo lo elegido. «Guardar» lo vuelve a reproducir de inicio a fin grabándolo
   * (captureStream + MediaRecorder: MP4 H.264/AAC en el celular) y lo deja en Descargas/HomeFlix. */
  var CLIP_MIN = 3;
  var CLIP_MAX = 60;

  function clipName(P) {
    var ep = P.series ? P.entry : null;
    var t = Math.floor(P.clip.from);
    var base = ep ? P.name + " T" + ep.season + "E" + ep.episode : P.name;
    return ("HomeFlix - " + base + " - " + Math.floor(t / 60) + "m" + ("0" + (t % 60)).slice(-2) + "s").replace(/[\\/:*?"<>|]+/g, " ");
  }

  /* ----- Cuadritos de la película para la tira -----
   * Mientras se ve el video se guarda en memoria un cuadro chico (128×72, JPEG) cada 4 s: al abrir «Recortar» la tira
   * ya tiene casi todo lo que se acaba de ver; lo que falte se completa cuando la vista previa pasa por ahí. */
  var thumbCanvas = null;
  function thumbGrab(P, t) {
    var v = HFPlayback.element();
    if (!v || v.readyState < 2 || !v.videoWidth) { return ""; }
    if (!thumbCanvas) { thumbCanvas = document.createElement("canvas"); thumbCanvas.width = 128; thumbCanvas.height = 72; }
    var cx = thumbCanvas.getContext("2d");
    var vw = v.videoWidth;
    var vh = v.videoHeight;
    var want = 128 / 72;
    var sw = vw / vh > want ? vh * want : vw; // recorte al centro para llenar el cuadro (sin barras negras)
    var sh = vw / vh > want ? vh : vw / want;
    try {
      cx.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, 128, 72);
      var url = thumbCanvas.toDataURL("image/jpeg", 0.6);
      P.thumbs = P.thumbs || {};
      P.thumbs[Math.round(t)] = url;
      P.lastThumb = t;
      return url;
    } catch (e) {
      return "";
    }
  }
  function thumbMaybe(P, t) {
    if (!HFPlayback.playing() || (P.lastThumb !== undefined && Math.abs(t - P.lastThumb) < 4)) { return; }
    thumbGrab(P, t);
  }
  function thumbNear(P, t, tol) {
    var best = "";
    var bd = tol;
    Object.keys(P.thumbs || {}).forEach(function (k) {
      var d = Math.abs(Number(k) - t);
      if (d <= bd) { bd = d; best = P.thumbs[k]; }
    });
    return best;
  }
  /* Hojas de miniaturas publicadas con la película (tools/preparador): un cuadro cada «every» segundos en hojas de
   * cols×rows. Con ellas la tira de «Recortar» muestra toda la película al instante, sin haberla visto. */
  function sheetsOf(P) {
    var th = P && (P.series ? P.entry && P.entry.thumbs : P.title && P.title.thumbs);
    return th && th.sheets && th.sheets.length ? th : null;
  }
  function sheetLoad(P) {
    var th = sheetsOf(P);
    if (!th || P.sheetUrls) { return; }
    P.sheetUrls = {};
    th.sheets.forEach(function (key, i) {
      HFTelegram.fileUrl(key).then(function (u) {
        if (!u || S.player !== P) { return; }
        P.sheetUrls[i] = u;
        paintSheetTiles(P);
      }, function () {});
    });
  }
  /* estilo del cuadro de la hoja más cercano al segundo t, o "" si esa hoja aún no llegó */
  function sheetStyle(P, t) {
    var th = sheetsOf(P);
    if (!th || !P.sheetUrls) { return ""; }
    var per = th.cols * th.rows;
    var last = P.clip && P.clip.dur ? Math.max(0, Math.ceil(P.clip.dur / th.every) - 1) : Infinity; // la última hoja no viene llena
    var idx = Math.max(0, Math.min(last, Math.round(t / th.every)));
    var sh = Math.floor(idx / per);
    var cell = idx % per;
    if (sh >= th.sheets.length) { sh = th.sheets.length - 1; cell = per - 1; }
    var u = P.sheetUrls[sh];
    if (!u) { return ""; }
    var cx = cell % th.cols;
    var cy = Math.floor(cell / th.cols);
    return "background-image:url(" + u + ");background-size:" + (th.cols * 100) + "% " + (th.rows * 100) + "%;background-position:" +
      (th.cols > 1 ? (cx / (th.cols - 1) * 100).toFixed(3) : 0) + "% " + (th.rows > 1 ? (cy / (th.rows - 1) * 100).toFixed(3) : 0) + "%";
  }
  /* llegó una hoja: hay que volver a dibujar aunque se vean los mismos cuadros (si no, se quedaban en gris) */
  function paintSheetTiles(P) { if (P.clip) { P.clip.tilesDirty = true; clipTiles(); } }

  /* ----- La tira: toda la película, desplazable con el dedo -----
   * Escala fija (unos 4 minutos a lo ancho de la pantalla). Cada cuadro es 16:9, como las hojas y los cuadritos
   * guardados, para que no se deformen. Solo se dibujan los cuadros que se ven (una película son cientos).
   * El recorte va en segundos de la película: los extremos se arrastran, el tramo entero también, y un toque en la
   * tira lo lleva ahí. Si un extremo llega al borde, la tira avanza sola. */
  var CLIP_VIEW = 240;      // segundos que caben a lo ancho
  var CLIP_PAD = 28;        // margen a cada lado de la tira (para los tiradores en el principio y el final)
  function clipGeom(C) {
    var sc = byId("clipScroll");
    var vw = sc ? sc.clientWidth : 800;
    var tb = byId("clipTiles");
    var th = tb && tb.clientHeight ? tb.clientHeight : 54; // alto de los cuadros (sin la regla de arriba)
    var pxs = Math.max(1, (vw - 2 * CLIP_PAD) / CLIP_VIEW);
    var tw = Math.round(th * 16 / 9);
    return { sc: sc, vw: vw, pxs: pxs, tw: tw, ts: tw / pxs, width: Math.ceil(C.dur * pxs) + 2 * CLIP_PAD };
  }
  function clipX(C, g, t) { return CLIP_PAD + t * g.pxs; }
  function clipT(C, g, clientX) {
    var r = g.sc.getBoundingClientRect();
    return Math.max(0, Math.min(C.dur, (clientX - r.left + g.sc.scrollLeft - CLIP_PAD) / g.pxs));
  }
  /* dibuja los cuadros visibles (y unos de más a cada lado) */
  function clipTiles() {
    var P = S.player;
    var C = P && P.clip;
    var box = byId("clipTiles");
    if (!C || !box) { return; }
    var g = clipGeom(C);
    var n = Math.ceil(C.dur / g.ts);
    var a = Math.max(0, Math.floor((g.sc.scrollLeft - CLIP_PAD) / g.tw) - 3);
    var b = Math.min(n - 1, Math.ceil((g.sc.scrollLeft + g.vw) / g.tw) + 3);
    if (C.tilesFrom === a && C.tilesTo === b && !C.tilesDirty && box.firstChild) { return; }
    C.tilesFrom = a;
    C.tilesTo = b;
    C.tilesDirty = false;
    var html = "";
    for (var i = a; i <= b; i++) {
      var t = Math.min(C.dur, (i + 0.5) * g.ts);
      var url = thumbNear(P, t, g.ts / 2 + 4);
      var sst = url ? "background-image:url(" + url + ")" : sheetStyle(P, t);
      html += '<i data-i="' + i + '" style="left:' + (CLIP_PAD + i * g.tw) + "px;width:" + (i === n - 1 ? Math.max(4, Math.ceil(C.dur * g.pxs) - i * g.tw) : g.tw) + "px;" + sst + '"' +
        (sst ? "" : ' class="wait"') + ">" + (sst ? "" : "<em>" + clock(t) + "</em>") + "</i>";
    }
    box.innerHTML = html;
  }
  /* regla de tiempos sobre la tira, de toda la película (cada 30 s si hay espacio, si no cada minuto) */
  function clipRuler(C, g) {
    var step = g.pxs * 30 >= 80 ? 30 : 60;
    var html = "";
    for (var t = 0; t <= C.dur; t += step) { html += '<span style="left:' + clipX(C, g, t) + 'px">' + clock(t) + "</span>"; }
    return html;
  }
  /* lleva la tira a que se vea el segundo t (al centro si center) */
  function clipScrollTo(C, t, center) {
    var g = clipGeom(C);
    if (!g.sc) { return; }
    var x = clipX(C, g, t);
    if (center) { g.sc.scrollLeft = x - g.vw / 2; return; }
    if (x < g.sc.scrollLeft + 40) { g.sc.scrollLeft = x - 40; } else if (x > g.sc.scrollLeft + g.vw - 40) { g.sc.scrollLeft = x - g.vw + 40; }
  }

  /* El recuadro de la vista previa toma la forma del video (sin franjas negras a los lados ni arriba): el mayor tamaño
   * que cabe entre la barra de arriba y la tira, dejando a los lados sitio para «Inicio» y «Fin». El video va encima. */
  function clipFit(C) {
    var box = byId("clipBox");
    var mv = byId("mplayer");
    var v = HFPlayback.element();
    var ar = v && v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9;
    var W = window.innerWidth;
    var H = window.innerHeight;
    var key = W + "x" + H + "@" + ar.toFixed(3);
    if (!box || (C.fitKey === key && box.style.width)) { return; }
    C.fitKey = key;
    var top = 64;
    var bottom = 128;
    var h = Math.max(60, H - top - bottom);
    var w = h * ar;
    var maxW = W * 0.48;
    if (w > maxW) { w = maxW; h = w / ar; }
    var r = { left: Math.round((W - w) / 2), top: Math.round(top + (H - top - bottom - h) / 2), width: Math.round(w), height: Math.round(h) };
    [box, mv].forEach(function (el) {
      if (!el) { return; }
      el.style.left = r.left + "px";
      el.style.top = r.top + "px";
      el.style.width = r.width + "px";
      el.style.height = r.height + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    });
  }
  function clipUnfit() {
    var mv = byId("mplayer");
    if (mv) { ["left", "top", "width", "height", "right", "bottom"].forEach(function (k) { mv.style[k] = ""; }); }
  }

  function clipHtml(P) {
    var C = P.clip;
    var grip = "<i></i>";
    return '<div class="m-player m-clip" id="pl">' +
      '<div class="ctop"><button class="m-iconbtn" data-act="clip-cancel" aria-label="Volver al video">' + I.back + "</button><b>Recortar un momento</b>" +
      '<button class="m-btn primary csave" data-act="clip-save" id="clipSave">' + I.download + "Guardar</button></div>" +
      '<div class="cside l"><small>Inicio</small><b id="clipFrom"></b></div><div class="cside r"><small>Fin</small><b id="clipTo"></b></div>' +
      '<div class="cbox" id="clipBox"><button class="cpp" data-act="clip-pp" id="clipPP" aria-label="Pausa o seguir">' + I.pause + "</button>" +
      '<button class="crep" data-act="clip-replay" aria-label="Ver desde el inicio">' + I.replay + "</button></div>" +
      '<div class="clen" id="clipLen"></div>' +
      '<div class="cstrip" id="clipStrip"><div class="cscroll" id="clipScroll" data-act="clip-tap"><div class="ctrack" id="clipTrack">' +
      '<div class="ruler" id="clipRuler"></div><div class="tiles" id="clipTiles"></div>' +
      '<div class="sel" id="clipSel"><span class="h s" data-h="from">' + grip + '</span><span class="h e" data-h="to">' + grip + "</span></div>" +
      '<b class="head" id="clipHead"></b></div></div>' +
      '<div class="cedge l"></div><div class="cedge r"></div></div>' +
      '<div class="cwork" id="clipWork" hidden></div></div>';
  }

  function paintClip() {
    var P = S.player;
    var C = P && P.clip;
    if (!C || !byId("clipFrom")) { return; }
    clipFit(C);
    var g = clipGeom(C);
    byId("clipFrom").textContent = clock(C.from);
    byId("clipTo").textContent = clock(C.to);
    byId("clipLen").textContent = (C.to - C.from).toFixed(1).replace(".", ",") + " s";
    var track = byId("clipTrack");
    if (track.offsetWidth !== g.width) { track.style.width = g.width + "px"; C.tilesDirty = true; byId("clipRuler").innerHTML = clipRuler(C, g); }
    if (!g.sc.hfRestored) { g.sc.hfRestored = true; if (C.scroll !== undefined) { g.sc.scrollLeft = C.scroll; } } // se volvió a pintar la pantalla
    var sel = byId("clipSel");
    sel.style.left = clipX(C, g, C.from) + "px";
    sel.style.width = Math.max(2, (C.to - C.from) * g.pxs) + "px";
    sel.classList.toggle("drag-from", clipDrag === "from");
    sel.classList.toggle("drag-to", clipDrag === "to");
    sel.classList.toggle("move", clipDrag === "move");
    var now = HFPlayback.time();
    byId("clipHead").style.left = clipX(C, g, Math.max(0, Math.min(C.dur, now))) + "px";
    byId("clipHead").hidden = now < C.from - 0.5 || now > C.to + 0.5;
    clipTiles();
    byId("clipPP").innerHTML = HFPlayback.playing() ? I.pause : I.play;
    var w = byId("clipWork");
    var save = byId("clipSave");
    w.className = "cwork " + (C.saving && !C.done ? "rec" : "full"); // grabando: abajo, para seguir viendo el video
    if (C.done) {
      w.hidden = false;
      w.innerHTML = '<div class="cw">' + I.check + "<b>Recorte guardado</b><small>Está en Descargas › HomeFlix (" + clock(C.to - C.from) + ")</small>" +
        '<div class="bt">' + (C.done.uri && android && android.shareFile ? '<button class="m-btn ghost" data-act="clip-share">' + I.share + "Compartir</button>" : "") +
        '<button class="m-btn primary" data-act="clip-cancel">Listo</button></div></div>';
    } else if (C.saving) {
      var pct = Math.max(0, Math.min(1, (now - C.from) / Math.max(1, C.to - C.from)));
      w.hidden = false;
      w.innerHTML = '<div class="cw"><div class="m-spin"></div><b>' + (C.writing ? "Guardando el archivo…" : "Grabando el recorte… " + Math.round(pct * 100) + "%") + "</b>" +
        "<small>No cierres la app: se graba mientras se reproduce.</small>" +
        '<div class="pbar"><i style="width:' + Math.round((C.writing ? 1 : pct) * 100) + '%"></i></div>' +
        (C.writing ? "" : '<div class="bt"><button class="m-btn ghost" data-act="clip-stop">Cancelar</button></div>') + "</div>";
    } else if (C.error) {
      w.hidden = false;
      w.innerHTML = '<div class="cw">' + errorBox(C.error) + '<div class="bt"><button class="m-btn primary" data-act="clip-dismiss">Entendido</button></div></div>';
    } else {
      w.hidden = true;
    }
    if (save) { save.disabled = !!(C.saving || C.done); }
  }

  ACT.clip = function () {
    var P = S.player;
    var v = HFPlayback.element();
    if (!P) { return; }
    if (!v || !v.captureStream || !window.MediaRecorder) { toast("Este video no se puede recortar aquí"); return; }
    var d = HFPlayback.duration() || 0;
    var t = HFPlayback.time();
    var from = Math.max(0, t - 30);
    var to = Math.max(from + CLIP_MIN, t);
    if (t < CLIP_MIN + 2) { from = t; to = Math.min(d || t + 30, t + 30); }
    P.clip = { from: from, to: to, dur: Math.max(d, to), back: t, wasPlaying: HFPlayback.playing(), rate: HFPlayback.rate(), seekAt: 0 };
    sheetLoad(P); // con hojas de miniaturas, la tira se llena sola (en cualquier parte de la película)
    HFPlayback.setRate(1);
    S.sheet = null;
    byId("mplayer").classList.add("clip");
    render(true);
    paintClip();
    clipScrollTo(P.clip, (from + to) / 2, true);
    clipTiles();
    /* la vista previa arranca ya: la tira muestra lo guardado y lo que falte se completa al pasar por ahí */
    clipSeek(from);
    HFPlayback.play();
  };

  function clipSeek(t) {
    var C = S.player && S.player.clip;
    if (C) { C.seekAt = Date.now(); }
    HFPlayback.seek(t);
  }

  /* Cada cuarto de segundo mientras se recorta: repetir lo elegido o, si se está grabando, cortar al llegar al fin. */
  function clipOnTime(t) {
    var C = S.player.clip;
    /* si la vista previa pasa por un cuadro que quedó en gris, se completa con lo que se está viendo */
    if (HFPlayback.playing() && byId("clipScroll")) {
      var g = clipGeom(C);
      Array.prototype.forEach.call(root.querySelectorAll("#clipTiles i.wait"), function (tile) {
        var i = Number(tile.getAttribute("data-i"));
        if (Math.abs((i + 0.5) * g.ts - t) < g.ts / 2) {
          var url = thumbGrab(S.player, t);
          if (url) { tile.style.backgroundImage = "url(" + url + ")"; tile.classList.remove("wait"); tile.textContent = ""; }
        }
      });
    }
    if (C.saving && !C.writing) {
      if (!C.rec && HFPlayback.playing() && t >= C.from - 0.3 && Date.now() - C.seekAt > 400) { clipRecStart(); }
      if (C.rec && t >= C.to) { clipRecStop(true); }
    } else if (!C.saving && !C.done && Date.now() - C.seekAt > 900 && (t >= C.to || t < C.from - 1)) {
      clipSeek(C.from); // vuelve a empezar, como la vista previa de Netflix
    }
    paintClip();
  }

  function clipExit() {
    var P = S.player;
    var C = P && P.clip;
    if (!C) { return; }
    if (C.rec) { clipRecStop(false); }
    P.clip = null;
    byId("mplayer").classList.remove("clip");
    clipUnfit();
    HFPlayback.setRate(C.rate);
    HFPlayback.seek(C.back);
    if (!C.wasPlaying) { HFPlayback.pause(); } else { HFPlayback.play(); }
    render(true);
    showChrome();
  }
  ACT["clip-cancel"] = clipExit;
  ACT["clip-pp"] = function () { HFPlayback.toggle(); paintClip(); };
  ACT["clip-replay"] = function () { clipSeek(S.player.clip.from); HFPlayback.play(); };
  ACT["clip-dismiss"] = function () { var C = S.player && S.player.clip; if (C) { C.error = ""; paintClip(); } };
  ACT["clip-share"] = function () { var C = S.player && S.player.clip; if (C && C.done) { try { android.shareFile(C.done.uri, C.done.mime); } catch (e) { /* nada */ } } };
  ACT["clip-stop"] = function () { clipRecStop(false); };

  ACT["clip-save"] = function () {
    var C = S.player && S.player.clip;
    if (!C || C.saving) { return; }
    var types = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
    C.mime = types.filter(function (x) { return MediaRecorder.isTypeSupported(x); })[0] || "";
    C.saving = true;
    C.error = "";
    C.chunks = [];
    clipSeek(C.from);
    HFPlayback.play();
    paintClip();
  };

  function clipRecStart() {
    var C = S.player.clip;
    var v = HFPlayback.element();
    try {
      var stream = v.captureStream();
      C.rec = new MediaRecorder(stream, C.mime ? { mimeType: C.mime, videoBitsPerSecond: 6000000, audioBitsPerSecond: 160000 } : undefined);
      C.rec.ondataavailable = function (e) { if (e.data && e.data.size) { C.chunks.push(e.data); } };
      C.rec.onstop = function () { clipRecDone(); };
      C.rec.start(1000);
    } catch (e) {
      C.rec = null;
      C.saving = false;
      C.error = "No se pudo grabar el recorte: " + ((e && e.message) || e);
      paintClip();
    }
  }

  /* keep: true al llegar al fin (se guarda); false al cancelar o salir (se descarta). */
  function clipRecStop(keep) {
    var C = S.player && S.player.clip;
    if (!C) { return; }
    HFPlayback.pause();
    if (!keep) { C.saving = false; C.chunks = []; C.cancelled = true; }
    if (C.rec && C.rec.state !== "inactive") { C.writing = keep; C.rec.stop(); } else if (!keep) { C.rec = null; }
    paintClip();
  }

  function clipRecDone() {
    var C = S.player && S.player.clip;
    if (!C) { return; }
    var rec = C.rec;
    C.rec = null;
    if (C.cancelled || !C.chunks.length) { C.cancelled = false; C.saving = false; C.writing = false; paintClip(); return; }
    var type = (rec && rec.mimeType) || C.mime || "video/webm";
    var mime = type.split(";")[0];
    var blob = new Blob(C.chunks, { type: mime });
    C.chunks = [];
    var name = clipName(S.player) + (mime === "video/mp4" ? ".mp4" : ".webm");
    saveFile(blob, name, mime).then(function (uri) {
      C.saving = false;
      C.writing = false;
      C.done = { uri: uri, mime: mime };
      paintClip();
    }, function (e) {
      C.saving = false;
      C.writing = false;
      C.error = "No se pudo guardar: " + ((e && e.message) || e);
      paintClip();
    });
  }

  /* Guardar un archivo: en la app de Android, en Descargas/HomeFlix por partes (MainActivity.saveBegin/Chunk/End);
   * en el navegador, como una descarga normal. */
  function saveFile(blob, name, mime) {
    if (!(android && android.saveBegin)) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      return Promise.resolve("");
    }
    var id = android.saveBegin(name, mime);
    if (!id) { return Promise.reject(new Error("el celular no dejó crear el archivo")); }
    var SLICE = 768 * 1024;
    var off = 0;
    function next() {
      if (off >= blob.size) {
        var uri = android.saveEnd(id);
        return uri ? Promise.resolve(uri) : Promise.reject(new Error("no se pudo cerrar el archivo"));
      }
      var part = blob.slice(off, off + SLICE);
      off += SLICE;
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result).split(",")[1] || ""); };
        fr.onerror = function () { reject(fr.error); };
        fr.readAsDataURL(part);
      }).then(function (b64) {
        if (!android.saveChunk(id, b64)) { throw new Error("no se pudo escribir el archivo"); }
        return next();
      });
    }
    return next().catch(function (e) { try { android.saveCancel(id); } catch (er) { /* nada */ } throw e; });
  }

  /* Arrastrar los extremos verde (inicio) y rojo (fin) del recorte. Al soltar, la vista previa vuelve al inicio. */
  /* clipDrag: "from" | "to" | "move" (el tramo entero). Se mide en relativo desde donde se tocó, así el extremo no
   * salta bajo el dedo. Cerca de los bordes la tira avanza sola (clipEdge) y el extremo la sigue. */
  var clipDrag = null;
  var clipDragX = 0;      // último x del dedo
  var clipGrab = null;    // {x0, from0, to0} al empezar
  var clipEdgeTimer = null;
  var clipHold = null;    // espera de «mantener presionado» sobre un tirador
  function clipDragApply() {
    var C = S.player && S.player.clip;
    if (!C || !clipDrag || !clipGrab) { return; }
    var g = clipGeom(C);
    var dt = (clipDragX - clipGrab.x0 + (g.sc.scrollLeft - clipGrab.s0)) / g.pxs;
    if (clipDrag === "from") {
      C.from = Math.max(0, Math.max(C.to - CLIP_MAX, Math.min(clipGrab.from0 + dt, C.to - CLIP_MIN)));
    } else if (clipDrag === "to") {
      C.to = Math.min(C.dur, Math.min(C.from + CLIP_MAX, Math.max(clipGrab.to0 + dt, C.from + CLIP_MIN)));
    } else {
      var len = clipGrab.to0 - clipGrab.from0;
      var f = Math.max(0, Math.min(C.dur - len, clipGrab.from0 + dt));
      C.from = f;
      C.to = f + len;
    }
    paintClip();
  }
  function clipEdge() {
    var C = S.player && S.player.clip;
    var sc = byId("clipScroll");
    if (!clipDrag || !C || !sc) { clipEdgeTimer = null; return; }
    var r = sc.getBoundingClientRect();
    var zone = 44;
    var v = clipDragX < r.left + zone ? -(r.left + zone - clipDragX) : clipDragX > r.right - zone ? clipDragX - (r.right - zone) : 0;
    if (v) { sc.scrollLeft += Math.max(-14, Math.min(14, v / 3)); clipDragApply(); }
    clipEdgeTimer = setTimeout(clipEdge, 16);
  }
  root.addEventListener("touchstart", function (e) {
    var C = S.player && S.player.clip;
    if (!C || C.saving || C.done || !(e.target.closest && e.target.closest("#clipSel"))) { return; }
    var h = e.target.closest(".h");
    var sc = byId("clipScroll");
    clipDrag = h ? h.getAttribute("data-h") : "move";
    clipDragX = e.touches[0].clientX;
    clipGrab = { x0: clipDragX, s0: sc.scrollLeft, from0: C.from, to0: C.to };
    HFPlayback.pause();
    /* mantener un tirador quieto un momento: se toman los dos bordes y se mueve el tramo entero */
    clearTimeout(clipHold);
    if (h) {
      clipHold = setTimeout(function () {
        clipHold = null;
        var C2 = S.player && S.player.clip;
        if (!clipDrag || !C2 || Math.abs(clipDragX - clipGrab.x0) > 8) { return; }
        clipDrag = "move";
        clipGrab = { x0: clipDragX, s0: byId("clipScroll").scrollLeft, from0: C2.from, to0: C2.to };
        paintClip();
      }, 380);
    }
    paintClip();
    if (!clipEdgeTimer) { clipEdge(); }
  }, { passive: true });
  root.addEventListener("touchmove", function (e) {
    if (!clipDrag) { return; }
    clipDragX = e.touches[0].clientX;
    if (clipHold && Math.abs(clipDragX - clipGrab.x0) > 8) { clearTimeout(clipHold); clipHold = null; } // ya arrastra: solo ese borde
    clipDragApply();
  }, { passive: true });
  function clipDragEnd() {
    clearTimeout(clipHold);
    clipHold = null;
    if (!clipDrag) { return; }
    var which = clipDrag;
    clipDrag = null;
    clipGrab = null;
    var C = S.player && S.player.clip;
    if (!C) { return; }
    paintClip();
    clipSeek(which === "to" ? Math.max(C.from, C.to - 3) : C.from); // al mover el fin se ven sus últimos segundos
    HFPlayback.play();
  }
  root.addEventListener("touchend", clipDragEnd, { passive: true });
  root.addEventListener("touchcancel", clipDragEnd, { passive: true });
  /* desplazar la tira: dibujar los cuadros que van apareciendo (y recordar dónde quedó si se vuelve a pintar todo) */
  root.addEventListener("scroll", function (e) {
    if (e.target && e.target.id === "clipScroll" && S.player && S.player.clip) {
      S.player.clip.scroll = e.target.scrollLeft;
      clipTiles();
    }
  }, true);
  /* un toque en la tira (fuera del tramo) lleva el tramo ahí, centrado donde se tocó */
  ACT["clip-tap"] = function (el, e) {
    var C = S.player && S.player.clip;
    if (!C || C.saving || C.done || (e.target.closest && e.target.closest("#clipSel"))) { return; }
    var g = clipGeom(C);
    var len = C.to - C.from;
    var f = Math.max(0, Math.min(C.dur - len, clipT(C, g, e.clientX) - len / 2));
    C.from = f;
    C.to = f + len;
    paintClip();
    clipSeek(C.from);
    HFPlayback.play();
  };

  /* ===================== Ver en la TV (control remoto) =====================
   * Desde el reproductor: buscar las TVs de la cuenta con HomeFlix abierta (HFRemote, js/remote.js), mandarle la
   * película en este minuto con el perfil, el audio y los subtítulos de aquí, y quedar como control remoto. La TV
   * contesta con su estado (js/ui/cast.js); entre mensaje y mensaje el tiempo se calcula aquí. */
  var castWaiter = null;
  var castTimer = null;
  var castDrag = null; // segundo al que se está arrastrando la barra

  function castNow() {
    var C = S.cast;
    if (!C) { return 0; }
    var t = C.time + (C.state === "playing" ? (Date.now() - C.at) / 1000 : 0);
    return Math.max(0, C.dur ? Math.min(C.dur, t) : t);
  }

  function castStartTick() {
    clearInterval(castTimer);
    castTimer = setInterval(function () { if (S.view === "remote") { paintRemote(); } }, 500);
  }

  /* Termina el control (la TV salió del video, se detuvo o se perdió la conexión). */
  function castEnd(msg) {
    S.cast = null;
    clearInterval(castTimer);
    castTimer = null;
    if (S.sheet === "rc-tracks") { S.sheet = null; }
    if (S.view === "remote") { if (!back()) { go("home", null, { root: true }); } } else { var bar = root.querySelector(".m-castbar"); if (bar) { bar.remove(); } }
    if (msg) { toast(msg); }
  }

  function castSend(msg) {
    var C = S.cast;
    if (!C) { return Promise.resolve(); }
    return HFRemote.send(C.id, msg).catch(function () { castEnd("Se perdió la conexión con la TV"); });
  }

  /* ----- TVs de la casa con HomeFlix cerrada (solo en la app de Android: MainActivity.tvScan / tvLaunch) -----
   * Además de las TVs con HomeFlix abierta (servidor), se buscan las TVs Samsung de la red con HomeFlix instalada.
   * Al elegir una cerrada: se enciende si hace falta (Wake-on-LAN), se abre HomeFlix, se espera a que entre a la cuenta
   * y se le manda el video como a cualquier otra. Las TVs encontradas se recuerdan (IP y MAC) para poder despertarlas
   * aunque estén apagadas del todo. */
  var TV_APP_ID = "etDyBtbRRH.homeflix"; // config.xml → tizen:application id
  var nativeCbs = {};
  var nativeN = 0;
  window.HFNative = {
    live: function (st, detail) { HFLive.nativeEvent(st, detail); },
    done: function (id, json) {
      var f = nativeCbs[id];
      delete nativeCbs[id];
      if (f) { var v = null; try { v = JSON.parse(json); } catch (e) { v = null; } f(v); }
    }
  };
  function nativeCall(fn, args) {
    return new Promise(function (resolve) {
      if (!android || typeof android[fn] !== "function") { resolve(null); return; }
      nativeN += 1;
      nativeCbs[nativeN] = resolve;
      try { android[fn].apply(android, [nativeN].concat(args)); } catch (e) { delete nativeCbs[nativeN]; resolve(null); }
    });
  }
  function knownTvs() { try { return JSON.parse(window.localStorage.getItem("hf.tvs") || "[]"); } catch (e) { return []; } }
  function rememberTvs(list) {
    var byIp = {};
    knownTvs().concat(list).forEach(function (t) { if (t && t.ip) { byIp[t.mac || t.ip] = { ip: t.ip, mac: t.mac || "", name: t.name || "TV", model: t.model || "" }; } });
    try { window.localStorage.setItem("hf.tvs", JSON.stringify(Object.keys(byIp).map(function (k) { return byIp[k]; }).slice(0, 8))); } catch (e) { /* nada */ }
  }

  /* El nombre que le puso el dueño a la TV («TV 55») en lugar del técnico («TV Samsung QN55Q65BAKXZL»), si se conoce. */
  function tvLabel(nombre) {
    var t = knownTvs().filter(function (k) { return k.model && String(nombre || "").indexOf(k.model) >= 0; })[0];
    return t ? t.name : (nombre || "TV");
  }

  SHEETS.cast = function () {
    var body;
    var lan = S.castLan || [];
    if (S.castSending) {
      body = '<div class="m-cast-wait"><div class="m-spin"></div>' + esc(S.castSending.msg || "Enviando a " + S.castSending.nombre + "…") + "</div>";
    } else if (S.castErr) {
      body = errorBox(S.castErr) + '<button class="m-btn ghost block" style="margin-top:12px" data-act="cast">' + I.refresh + "Buscar otra vez</button>";
    } else if (!S.castList) {
      body = '<div class="m-cast-wait"><div class="m-spin"></div>Buscando televisores…</div>';
    } else if (!S.castList.length && !lan.length && !S.castScanning) {
      body = '<div class="m-cast-none">' + I.tv + "<b>No hay ninguna TV disponible</b>Abre HomeFlix en la TV, con esta misma cuenta de Telegram, y vuelve a buscar.</div>" +
        '<button class="m-btn ghost block" data-act="cast">' + I.refresh + "Buscar otra vez</button>";
    } else {
      body = S.castList.map(function (d) {
        return '<button class="m-opt" data-act="cast-to" data-id="' + esc(d.id) + '" data-name="' + esc(tvLabel(d.nombre)) + '">' + I.tv +
          "<div><b>" + esc(tvLabel(d.nombre)) + "</b><small>HomeFlix abierta</small></div>" + I.chev + "</button>";
      }).join("") +
        lan.map(function (t) {
          var off = t.power !== "on";
          return '<button class="m-opt" data-act="cast-wake" data-ip="' + esc(t.ip) + '" data-mac="' + esc(t.mac || "") + '" data-name="' + esc(t.name) + '">' + I.tv +
            "<div><b>" + esc(t.name) + (t.model ? ' <span class="m-dim">· ' + esc(t.model) + "</span>" : "") + "</b><small>" +
            (off ? "Apagada · se enciende y abre HomeFlix" : "HomeFlix cerrada · se abre sola") + "</small></div>" + I.chev + "</button>";
        }).join("") +
        (S.castScanning ? '<div class="m-cast-scan"><span class="m-spin sm"></span>Buscando TVs en tu red…</div>' : "");
    }
    return sheetHtml("Ver en la TV", body, I.info + "Sigue en la TV desde este minuto, con este perfil, y el celular queda como control remoto.");
  };

  ACT.cast = function () {
    S.sheet = "cast";
    S.castList = null;
    S.castLan = [];
    S.castErr = "";
    S.castSending = null;
    S.castScanning = !!(android && android.tvScan);
    render(true);
    var online = HFRemote.devices().then(function (list) {
      S.castList = list.filter(function (d) { return d.tipo === "tv"; });
    }, function (e) {
      S.castList = [];
      if (!S.castScanning) {
        S.castErr = e && e.status === 404 ? "Todavía no se sincronizó esta cuenta con el servidor de HomeFlix. Espera un momento y vuelve a buscar." : "No se pudo buscar: " + ((e && e.message) || e);
      }
    }).then(function () { if (S.sheet === "cast") { render(true); } });
    if (!S.castScanning) { return; }
    var known = knownTvs();
    nativeCall("tvScan", [JSON.stringify(known.map(function (t) { return t.ip; })), TV_APP_ID]).then(function (found) {
      return online.then(function () { return found || []; });
    }).then(function (found) {
      var withApp = found.filter(function (t) { return t.installed; });
      rememberTvs(withApp);
      var seen = {};
      withApp.forEach(function (t) { seen[t.mac || t.ip] = true; });
      /* las recordadas que no respondieron: apagadas del todo (se intentará despertarlas) */
      known.forEach(function (t) { if (!seen[t.mac || t.ip] && t.mac) { withApp.push({ ip: t.ip, mac: t.mac, name: t.name, model: t.model, power: "off", installed: true }); } });
      /* la que tiene HomeFlix al frente ya está en la lista de arriba (si inició sesión) */
      S.castLan = withApp.filter(function (t) { return !(t.running && t.power === "on" && S.castList.length); });
      S.castScanning = false;
      if (S.sheet === "cast" && !S.castSending) { render(true); }
    });
  };

  /* Encender / abrir HomeFlix en esa TV, esperar a que aparezca conectada y mandarle el video. */
  ACT["cast-wake"] = function (el) {
    if ((!S.player && !S.castLive) || S.castSending) { return; }
    var ip = el.getAttribute("data-ip");
    var mac = el.getAttribute("data-mac");
    var name = el.getAttribute("data-name") || "la TV";
    var before = {};
    (S.castList || []).forEach(function (d) { before[d.id] = true; });
    var wait = function (msg) { S.castSending = { nombre: name, msg: msg }; if (S.sheet === "cast") { render(true); } };
    wait("Abriendo HomeFlix en " + name + "…");
    nativeCall("tvLaunch", [ip, mac || "", TV_APP_ID]).then(function (r) {
      if (!r || !r.ok) {
        var why = r && r.error;
        throw new Error(why === "unreachable" ? name + " no responde. Revisa que esté conectada a la misma red (y, si está apagada, que tenga activado «Encender con el móvil»)."
          : why === "standby" ? name + " no se encendió. En la TV: Configuración › General › Administrador de dispositivos externos › Encender con el móvil."
          : "La TV no dejó abrir HomeFlix (" + (why || "sin respuesta") + ").");
      }
      wait("Esperando a que HomeFlix entre a tu cuenta en " + name + "…");
      /* la TV aparece en el servidor cuando HomeFlix terminó de iniciar sesión */
      var until = Date.now() + 60000;
      var poll = function () {
        if ((!S.player && !S.castLive) || S.sheet !== "cast") { return Promise.reject(new Error("")); }
        return HFRemote.devices().then(function (list) {
          var tvs = list.filter(function (d) { return d.tipo === "tv"; });
          return tvs.filter(function (d) { return !before[d.id]; })[0] || (tvs.length === 1 ? tvs[0] : null);
        }, function () { return null; }).then(function (dev) {
          if (dev) { return dev; }
          if (Date.now() > until) { throw new Error("HomeFlix se abrió en " + name + " pero no entró a la cuenta. Revisa la TV y vuelve a intentar."); }
          return new Promise(function (r2) { setTimeout(r2, 1500); }).then(poll);
        });
      };
      return poll();
    }).then(function (dev) {
      S.castSending = null;
      castTo({ id: dev.id, nombre: name });
    }).catch(function (e) {
      S.castSending = null;
      if (e && e.message) { S.castErr = e.message; }
      if (S.sheet === "cast") { render(true); }
    });
  };

  ACT["cast-to"] = function (el) {
    castTo({ id: el.getAttribute("data-id"), nombre: el.getAttribute("data-name") || "TV" });
  };

  function castTo(dev) {
    if (S.castLive) { liveCastTo(dev); return; }
    var P = S.player;
    if (!P || S.castSending) { return; }
    var tr = HFPlayback.tracks();
    var a = (tr.audio || []).filter(function (x) { return x.current; })[0];
    var s = (tr.subs || []).filter(function (x) { return x.current; })[0];
    var start = Math.max(0, HFPlayback.time() - 2);
    var msg = { t: "play", key: entryKey(P.entry), start: start, profile: profile && profile.id, audio: a ? a.key : "", sub: s ? s.key : "" };
    S.castSending = dev;
    render(true);
    var reply = new Promise(function (resolve) {
      var noAnswer = function () { resolve({ t: "error", m: "La TV no respondió. ¿Sigue abierta HomeFlix en la TV?" }); };
      castWaiter = {
        id: dev.id,
        done: resolve,
        timer: setTimeout(noAnswer, 15000),
        /* la TV avisó que está actualizando su catálogo: se espera más y se muestra lo que dice */
        wait: function (m) {
          clearTimeout(castWaiter.timer);
          castWaiter.timer = setTimeout(noAnswer, 90000);
          S.castSending = { nombre: dev.nombre, msg: m || "La TV está actualizando su catálogo…" };
          if (S.sheet === "cast") { render(true); }
        }
      };
    });
    HFRemote.send(dev.id, msg).then(function () { return reply; }).then(function (r) {
      castWaiter = null;
      if (!r || r.t !== "ok") { throw new Error((r && r.m) || "La TV no pudo abrir el video"); }
      S.castSending = null;
      S.cast = {
        id: dev.id, nombre: dev.nombre, key: msg.key, name: P.name, sub: P.sub, poster: P.poster,
        state: "loading", error: "", time: start, dur: HFPlayback.duration(), at: Date.now(), tracks: tr
      };
      castStartTick();
      closePlayer("remote"); // guarda el progreso y apaga el video aquí
    }).catch(function (e) {
      castWaiter = null;
      S.castSending = null;
      S.castErr = (e && e.message) || String(e);
      if (S.sheet === "cast") { render(true); }
    });
  }

  /* Mensajes de la TV */
  function onRemoteMsg(msg, de) {
    if (castWaiter && de.id === castWaiter.id && msg.t === "wait") {
      castWaiter.wait(msg.m);
      return;
    }
    if (castWaiter && de.id === castWaiter.id && (msg.t === "ok" || msg.t === "error")) {
      clearTimeout(castWaiter.timer);
      castWaiter.done(msg);
      return;
    }
    var C = S.cast;
    if (!C || de.id !== C.id) { return; }
    if (msg.t === "closed") { castEnd("La TV dejó de reproducir"); return; }
    if (msg.t !== "state") { return; }
    var newVideo = msg.key && msg.key !== C.key;
    var tracksChanged = JSON.stringify(msg.tracks || {}) !== JSON.stringify(C.tracks || {});
    C.key = msg.key || C.key;
    C.name = msg.name || C.name;
    C.sub = msg.sub || "";
    C.poster = msg.poster || C.poster;
    C.state = msg.state || C.state;
    C.error = msg.error || "";
    C.time = Number(msg.time) || 0;
    C.dur = Number(msg.dur) || C.dur;
    C.at = Date.now(); // la hora de aquí: los relojes de la TV y el celular no tienen por qué coincidir
    C.tracks = msg.tracks || C.tracks;
    if (S.view === "remote" && (newVideo || (tracksChanged && S.sheet === "rc-tracks"))) { render(true); } else { paintRemote(); }
  }

  V.remote = function () {
    var C = S.cast || {};
    return '<div class="m-remote"><div class="bg"' + img(C.poster) + '></div><div class="shade"></div>' +
      '<header class="m-top"><div class="m-tt"><button class="m-iconbtn" data-back>' + I.back + "</button><b></b></div></header>" +
      '<div class="rc"><div class="rc-dev">' + I.cast + "<span>Reproduciendo en <b>" + esc(C.nombre || "la TV") + "</b></span></div>" +
      '<div class="rc-art"' + img(C.poster) + "></div>" +
      "<h1>" + esc(C.name || "") + "</h1>" + (C.sub ? "<p>" + esc(C.sub) + "</p>" : "") +
      '<div class="rc-msg" id="rcMsg"></div>' +
      '<div class="rc-seek"><span id="rcT">0:00</span><div class="track" id="rcTrack"><div class="now" id="rcNow"></div><div class="knob" id="rcKnob"></div></div><span id="rcD">-0:00</span></div>' +
      '<div class="rc-mid"><button class="skip" data-act="rc-seek" data-s="-10" aria-label="Atrás 10 segundos">' + I.rew + "<em>10</em></button>" +
      '<button class="pp" data-act="rc-toggle" id="rcPP" aria-label="Pausa o seguir">' + I.pause + "</button>" +
      '<button class="skip" data-act="rc-seek" data-s="10" aria-label="Adelante 10 segundos">' + I.fwd + "<em>10</em></button></div>" +
      '<div class="rc-tools"><button data-act="sheet" data-sheet="rc-tracks">' + I.subs + "Audio y subtítulos</button>" +
      '<button data-act="rc-here">' + I.play + "Ver en el celular</button>" +
      '<button class="danger" data-act="rc-stop">' + I.x + "Detener</button></div></div></div>";
  };

  function paintRemote() {
    var C = S.cast;
    if (!C || !byId("rcT")) { return; }
    var t = castDrag !== null ? castDrag : castNow();
    var d = C.dur || 0;
    var pct = d ? (t / d) * 100 : 0;
    byId("rcT").textContent = clock(t);
    byId("rcD").textContent = "-" + clock(Math.max(0, d - t));
    byId("rcNow").style.width = pct + "%";
    byId("rcKnob").style.left = pct + "%";
    byId("rcPP").innerHTML = C.state === "playing" || C.state === "buffering" || C.state === "loading" ? I.pause : I.play;
    byId("rcMsg").innerHTML = C.state === "error" ? '<div class="m-error">' + esc(C.error || "La TV no pudo reproducir el video") + "</div>"
      : C.state === "loading" ? '<span class="m-spin sm"></span>Abriendo en la TV…'
      : C.state === "buffering" ? '<span class="m-spin sm"></span>Cargando…' : "";
  }
  AFTER.remote = function () {
    paintRemote();
    if (S.cast) { castSend({ t: "get" }); }
  };

  ACT["rc-open"] = function () { if (S.cast) { go("remote"); } };
  ACT["rc-toggle"] = function () {
    var C = S.cast;
    if (!C) { return; }
    C.time = castNow();
    C.at = Date.now();
    C.state = C.state === "paused" ? "playing" : "paused";
    paintRemote();
    var bar = root.querySelector(".m-castbar .pp");
    if (bar) { bar.innerHTML = C.state === "paused" ? I.play : I.pause; }
    castSend({ t: "cmd", c: C.state === "paused" ? "pause" : "play" });
  };
  function castSeek(to) {
    var C = S.cast;
    if (!C) { return; }
    C.time = Math.max(0, C.dur ? Math.min(C.dur - 1, to) : to);
    C.at = Date.now();
    paintRemote();
    castSend({ t: "cmd", c: "seek", v: C.time });
  }
  ACT["rc-seek"] = function (el) { castSeek(castNow() + Number(el.getAttribute("data-s"))); };
  ACT["rc-stop"] = function () {
    castSend({ t: "stop" });
    castEnd("");
  };
  /* Seguir aquí: la TV se detiene y el video sigue en el celular en el mismo minuto. */
  ACT["rc-here"] = function () {
    var C = S.cast;
    if (!C) { return; }
    var t = castNow();
    var entry = library.byKey[C.key];
    var series = entry && entry.type === "episode" ? library.titles[entry.seriesKey] : null;
    castSend({ t: "stop" });
    if (!entry) { castEnd("Este video no está en la biblioteca de este perfil"); return; }
    if (C.dur) { HFLibrary.setProgress(C.key, t, C.dur); }
    S.cast = null;
    clearInterval(castTimer);
    castTimer = null;
    /* la pantalla del control no queda en el historial: al cerrar el video se vuelve a donde se estaba antes */
    var prev = S.stack.pop();
    S.view = prev ? prev.view : "home";
    S.arg = prev ? prev.arg : null;
    if (series) { play(series, { episode: entry }); } else { play(entry); }
  };

  SHEETS["rc-tracks"] = function () {
    var tr = (S.cast && S.cast.tracks) || {};
    return tracksSheet(tr, "rc-audio", "rc-sub", "Se cambia en la TV.");
  };
  ACT["rc-audio"] = function (el) {
    var k = el.getAttribute("data-k");
    var tr = S.cast && S.cast.tracks;
    if (tr && tr.audio) { tr.audio.forEach(function (a) { a.current = a.key === k; }); }
    castSend({ t: "audio", k: k });
    S.sheet = null;
    render(true);
  };
  ACT["rc-sub"] = function (el) {
    var k = el.getAttribute("data-k") || "";
    var tr = S.cast && S.cast.tracks;
    if (tr && tr.subs) { tr.subs.forEach(function (s) { s.current = s.key === k; }); }
    castSend({ t: "sub", k: k });
    S.sheet = null;
    render(true);
  };

  /* Barrita «en la TV» abajo, en las demás pantallas, para volver al control. */
  function castBar() {
    var C = S.cast;
    if (!C || S.view === "remote" || S.view === "player") { return ""; }
    return '<div class="m-castbar"><button class="open" data-act="rc-open">' + I.cast + "<div><b>" + esc(C.name || "") + "</b><small>En " + esc(C.nombre || "la TV") + "</small></div></button>" +
      '<button class="pp" data-act="rc-toggle" aria-label="Pausa o seguir">' + (C.state === "paused" ? I.play : I.pause) + "</button></div>";
  }

  /* Arrastrar la barra de tiempo del control: se ve al instante y se manda al soltar. */
  function castDragAt(e) {
    var tr = byId("rcTrack");
    var C = S.cast;
    if (!tr || !C || !C.dur) { return; }
    var r = tr.getBoundingClientRect();
    var x = (e.touches && e.touches[0] ? e.touches[0].clientX : e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : e.clientX) - r.left;
    castDrag = Math.max(0, Math.min(1, x / r.width)) * C.dur;
    paintRemote();
  }
  root.addEventListener("touchstart", function (e) { if (e.target.closest && e.target.closest("#rcTrack")) { castDragAt(e); } }, { passive: true });
  root.addEventListener("touchmove", function (e) { if (castDrag !== null) { castDragAt(e); } }, { passive: true });
  root.addEventListener("touchend", function () {
    if (castDrag === null) { return; }
    var to = castDrag;
    castDrag = null;
    castSeek(to);
  }, { passive: true });

  /* Al volver a la app con el control activo: pedirle a la TV cómo va. */
  document.addEventListener("visibilitychange", function () { if (!document.hidden && S.cast) { castSend({ t: "get" }); } }, false);
  if (!DESIGN) { HFRemote.onMessage(onRemoteMsg); }

  /* ===================== TV en vivo (IPTV) =====================
   * Arriba el reproductor (el video va DETRÁS de la interfaz, como el de películas: la zona del reproductor es
   * transparente), debajo las categorías en pestañas y la lista de canales con miniatura, «quedan Xm» y barra.
   *   · Con el APK nuevo el video lo da ExoPlayer (HFAndroid.liveOpen…) y la lista se baja desde Java (sin CORS).
   *   · Con el APK anterior, o en el navegador de la PC, se prueba con <video> + hls.js (solo canales https con CORS).
   * La lista, los favoritos y la guía son los mismos que usa la TV (js/iptv.js). */
  var LIVE_MAX = 300; // filas por categoría
  var liveCtlTimer = null;

  S.live = { data: null, loading: false, error: "", group: "__all", ch: null, st: "", detail: "", full: false, ui: true, scroll: 0, epg: false, tabScroll: 0 };

  /* En el celular la página está en https: el lector nativo baja la M3U / la guía desde Java. */
  if (android && typeof android.httpText === "function") {
    HFIptv.setFetcher(function (url, mode) {
      return nativeCall("httpText", [url, mode || ""]).then(function (r) { return r && r.ok ? r.text : null; });
    });
  }

  function liveAllowed() { return !(profile && profile.kids); }
  function liveGroups() {
    var d = S.live.data;
    var favN = Object.keys(HFLibrary.iptvFavs()).length;
    var out = [{ id: "__all", label: "Destacado", count: d ? d.channels.length : 0 }];
    if (favN) { out.push({ id: "__fav", label: "Favoritos", count: favN }); }
    (d ? d.groups : []).forEach(function (g) { out.push({ id: g.name, label: g.name, count: g.count }); });
    return out;
  }
  function liveList() { return S.live.data ? HFIptv.byGroup(S.live.data, S.live.group).slice(0, LIVE_MAX) : []; }
  function liveChannel() { return S.live.ch; }
  function hm(ms) { var d = new Date(ms); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  function liveInitial(c) { return esc((c.name || "?").replace(/^[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]+/, "").slice(0, 2).toUpperCase()); }
  function bgUrl(u) { return "background-image:url('" + esc(u).replace(/'/g, "%27") + "')"; }

  function liveLoad(force) {
    var L = S.live;
    if (!HFIptv.config()) { L.data = null; return; }
    L.loading = true;
    L.error = "";
    paintLive();
    HFIptv.load({ force: !!force }).then(function (d) {
      L.loading = false;
      L.data = d;
      if (L.group !== "__all" && L.group !== "__fav" && !d.groups.some(function (g) { return g.name === L.group; })) { L.group = "__all"; }
      paintLive();
      HFIptv.loadEpg(d).then(function (ok) { if (ok && S.view === "live") { L.epg = true; paintLive(); } });
    }, function (e) {
      L.loading = false;
      L.error = (e && e.message) || String(e);
      paintLive();
    });
  }

  function liveRow(c, favs, playingKey) {
    var n = HFIptv.now(c);
    var thumb = n && n.icon ? n.icon : c.logo;
    var on = playingKey === c.key;
    return '<div class="m-chrow' + (on ? " on" : "") + '" data-act="live-play" data-k="' + esc(c.key) + '" role="button" tabindex="0">' +
      '<span class="lg"' + (c.logo ? ' style="' + bgUrl(c.logo) + '"' : "") + ">" + (c.logo ? "" : "<i>" + liveInitial(c) + "</i>") + "</span>" +
      '<span class="th' + (n && n.icon ? "" : " plain") + '"' + (thumb ? ' style="' + bgUrl(thumb) + '"' : "") + ">" + (on ? '<em class="eq"><u></u><u></u><u></u></em>' : "") + "</span>" +
      '<span class="tx"><b>' + esc(n && n.title ? n.title : c.name) + "</b><small>" + (n ? esc(HFIptv.leftText(n.left)) : '<i class="dot"></i>En vivo · ' + esc(c.group)) + "</small>" +
      (n ? '<span class="bar"><i style="width:' + Math.round(n.pct) + '%"></i></span>' : "") + "</span>" +
      (favs[c.key] ? '<span class="fv">' + I.heartOn + "</span>" : "") +
      '<button class="inf" data-act="live-info" data-k="' + esc(c.key) + '" aria-label="Información">' + I.info + "</button></div>";
  }

  /* El panel del reproductor (encima del video, en la zona transparente): íconos arriba, barra de tiempo y acciones abajo */
  function liveCtlHtml() {
    var L = S.live;
    var c = liveChannel();
    var n = c ? HFIptv.now(c) : null;
    var fav = c && HFLibrary.iptvFavs()[c.key];
    if (!c) {
      return '<div class="idle-msg">' + I.live + "<b>Elige un canal</b><small>" + (L.data ? "Toca uno de la lista para verlo aquí" : "") + "</small></div>";
    }
    var msg = L.st === "error" ? '<div class="m-plmsg"><div class="m-error">' + esc(L.detail || "No se pudo reproducir") + '</div><button class="m-btn ghost" data-act="live-restart">' + I.refresh + "Reintentar</button></div>" :
      L.st && L.st !== "reproduciendo" ? '<div class="m-plmsg"><div class="m-spin"></div></div>' : "";
    return '<div class="scrim"></div>' +
      '<div class="ctop"><span class="clogo"' + (c.logo ? ' style="' + bgUrl(c.logo) + '"' : "") + ">" + (c.logo ? "" : liveInitial(c)) + "</span>" +
      '<div class="ctitle"><b>' + esc(n && n.title ? n.title : c.name) + "</b><small>" + esc(c.name) + (L.st === "reproduciendo" ? " · EN VIVO" : "") + "</small></div>" +
      '<div class="cbtns"><button data-act="live-pip" aria-label="Imagen en imagen">' + I.pip + '</button><button data-act="live-gear" aria-label="Ajustes">' + I.gear +
      '</button><button data-act="live-cast" aria-label="Enviar a la TV">' + I.cast + '</button><button data-act="live-full" aria-label="' + (L.full ? "Salir de pantalla completa" : "Pantalla completa") + '">' + (L.full ? I.shrink : I.expand) + "</button></div></div>" +
      msg +
      '<div class="cbot">' + (n ? '<div class="ctime"><span>' + hm(n.start) + '</span><div class="cbar"><i style="width:' + Math.round(n.pct) + '%"></i></div><span>-' + esc(HFIptv.leftText(n.left).replace("quedan ", "")) + "</span></div>" :
        '<div class="ctime"><span class="livechip"><i class="dot"></i>EN VIVO</span></div>') +
      '<div class="cact"><button data-act="live-restart">' + I.replay + "Reiniciar</button>" +
      '<button data-act="live-fav" class="' + (fav ? "on" : "") + '">' + (fav ? I.heartOn : I.heart) + "Favorito</button>" +
      '<button data-act="live-cast">' + I.send + "Enviar a la TV</button></div></div>";
  }

  function liveBodyHtml() {
    var L = S.live;
    var cfg = HFIptv.config();
    var favs = HFLibrary.iptvFavs();
    var list;
    if (!cfg) {
      return '<div class="m-chempty">' + I.live + "<h2>TV en vivo</h2><p>Pon el enlace M3U de <b>tu proveedor de IPTV</b> y tus canales aparecen aquí y en la TV.</p>" +
        '<button class="m-btn primary" data-go="iptv">Poner el enlace</button></div>';
    }
    if (L.loading && !L.data) { return '<div class="m-chempty"><div class="m-spin"></div><p>Descargando tu lista de canales…</p></div>'; }
    if (L.error && !L.data) {
      return '<div class="m-chempty">' + errorBox(L.error) + '<button class="m-btn primary" data-act="live-reload">' + I.refresh + 'Reintentar</button><button class="m-btn ghost" data-go="iptv">Cambiar el enlace</button></div>';
    }
    list = liveList();
    return '<div class="m-chtabs" id="mlTabs">' + liveGroups().map(function (g) {
      return '<button class="' + (g.id === L.group ? "on" : "") + '" data-act="live-group" data-g="' + esc(g.id) + '">' + esc(g.label) + "</button>";
    }).join("") + "</div>" +
      '<div class="m-chlist" id="mlList">' + (list.length ? list.map(function (c) { return liveRow(c, favs, L.ch && L.ch.key); }).join("") :
        '<div class="m-chnone">' + (L.group === "__fav" ? "Aún no tienes favoritos. Toca el corazón mientras ves un canal." : "Este grupo no tiene canales.") + "</div>") +
      "</div>";
  }

  V.live = function () {
    var L = S.live;
    if (!liveAllowed()) { return topTitle("TV en vivo") + '<div class="m-center"><p class="m-sub">Este perfil no tiene TV en vivo.</p></div>' + nav(""); }
    var idle = !L.ch;
    return '<div class="m-live' + (L.full ? " full" : "") + (idle ? " idle" : "") + '">' +
      '<div class="m-live-top"></div>' +
      '<div class="m-live-stage" id="mlStage"><div class="m-live-ctl' + (L.ui || idle ? "" : " hide") + '" id="mlCtl">' + liveCtlHtml() + "</div></div>" +
      '<div class="m-live-body" id="mlBody">' + liveBodyHtml() + "</div></div>" + nav("live");
  };

  /* Repinta lo que cambió sin tocar el reproductor (ni perder el scroll de la lista) */
  function paintLive() {
    var L = S.live;
    var ctl = byId("mlCtl");
    var body = byId("mlBody");
    var list = byId("mlList");
    if (S.view !== "live" || !ctl || !body) { return; }
    if (list) { L.scroll = list.scrollTop; }
    var tabs = byId("mlTabs");
    if (tabs) { L.tabScroll = tabs.scrollLeft; }
    ctl.innerHTML = liveCtlHtml();
    body.innerHTML = liveBodyHtml();
    var m = root.querySelector(".m-live");
    if (m) { m.classList.toggle("idle", !L.ch); m.classList.toggle("full", L.full); }
    ctl.classList.toggle("hide", !(L.ui || !L.ch));
    list = byId("mlList");
    if (list) { list.scrollTop = L.scroll; }
    tabs = byId("mlTabs");
    if (tabs) { tabs.scrollLeft = L.tabScroll; }
  }

  /* El rectángulo del reproductor: el video (o ExoPlayer) se coloca exactamente ahí, detrás de la interfaz */
  function livePlace() {
    var st = byId("mlStage");
    var r;
    if (!st || S.view !== "live") { return; }
    r = st.getBoundingClientRect();
    HFLive.place({ x: r.left, y: r.top, w: r.width, h: r.height });
  }

  function liveMedia() {
    var el = byId("lvMedia");
    if (!el) {
      el = document.createElement("div");
      el.id = "lvMedia";
      el.className = "m-livemedia";
      document.body.insertBefore(el, root);
    }
    el.style.display = HFLive.native() ? "none" : ""; // con ExoPlayer el video va nativo: este cuadro negro tapa
    HFLive.attach(el);
    return el;
  }

  function liveShowUi() {
    var L = S.live;
    var ctl = byId("mlCtl");
    L.ui = true;
    if (ctl) { ctl.classList.remove("hide"); }
    clearTimeout(liveCtlTimer);
    liveCtlTimer = setTimeout(function () {
      if (S.live.st === "reproduciendo" && !S.sheet) { S.live.ui = false; var c = byId("mlCtl"); if (c) { c.classList.add("hide"); } }
    }, 3500);
  }

  function livePlay(c) {
    var L = S.live;
    L.ch = c;
    L.st = "cargando";
    L.detail = "";
    HFLibrary.setIptvLast(c.key);
    L.ui = true;
    paintLive();
    liveMedia();
    HFLive.play(c, liveMedia(), function (st, detail) {
      if (!S.live.ch || S.live.ch.key !== c.key) { return; }
      S.live.st = st;
      S.live.detail = detail;
      paintLive();
      if (st === "reproduciendo") { liveShowUi(); }
    });
    livePlace();
  }

  function liveStop() {
    HFLive.stop();
    clearTimeout(liveCtlTimer);
    if (S.live.full) { liveFull(false); }
    S.live.ch = null;
    S.live.st = "";
    document.documentElement.classList.remove("m-live-on");
  }

  function liveFull(on) {
    var L = S.live;
    L.full = on;
    L.ui = true;
    try { if (android) { android.setPlayerMode(on); } } catch (e) { /* nada */ }
    if (S.view === "live") {
      root.classList.toggle("nav-hidden", on);
      paintLive();
      setTimeout(livePlace, 60);
      setTimeout(livePlace, 350);
      liveShowUi();
    }
  }

  AFTER.live = function () {
    var L = S.live;
    document.documentElement.classList.add("m-live-on");
    liveMedia();
    var list = byId("mlList");
    if (list) { list.scrollTop = L.scroll; }
    livePlace();
    if (HFIptv.config() && !L.data && !L.loading) { liveLoad(false); }
    else if (L.data && !L.epg) { HFIptv.loadEpg(L.data).then(function (ok) { if (ok && S.view === "live") { L.epg = true; paintLive(); } }); }
  };

  ACT["live-play"] = function (el) {
    var k = el.getAttribute("data-k");
    var c = S.live.data && S.live.data.channels.filter(function (x) { return x.key === k; })[0];
    if (c) { livePlay(c); }
  };
  ACT["live-group"] = function (el) {
    S.live.group = el.getAttribute("data-g");
    S.live.scroll = 0;
    paintLive();
  };
  ACT["live-reload"] = function () { liveLoad(true); };
  ACT["live-restart"] = function () {
    var c = liveChannel();
    if (c) { HFLive.stop(); livePlay(c); }
  };
  ACT["live-fav"] = function () {
    var c = liveChannel();
    if (!c) { return; }
    HFLibrary.toggleIptvFav(c.key);
    toast(HFLibrary.iptvFavs()[c.key] ? "Agregado a favoritos" : "Quitado de favoritos");
    paintLive();
  };
  ACT["live-full"] = function () { liveFull(!S.live.full); };
  ACT["live-pip"] = function () {
    var v = HFLive.video();
    try {
      if (android && typeof android.livePip === "function") { android.livePip(); return; }
      if (v && document.pictureInPictureEnabled && v.requestPictureInPicture) { v.requestPictureInPicture(); return; }
    } catch (e) { /* abajo el aviso */ }
    toast("La imagen en imagen llega con la próxima actualización de la app");
  };
  ACT["live-gear"] = function () { S.sheet = "live-gear"; render(true); };
  ACT["live-info"] = function (el) {
    S.liveInfo = el.getAttribute("data-k");
    S.sheet = "live-info";
    render(true);
  };
  ACT["live-cast"] = function () {
    if (!liveChannel()) { return; }
    S.castLive = liveChannel().key;
    ACT.cast();
  };

  SHEETS["live-gear"] = function () {
    return sheetHtml("Ajustes del canal",
      '<div class="m-group"><button class="m-opt" data-act="live-gear-reload"><div><b>Actualizar la lista</b><small>Volver a descargar canales y guía del proveedor</small></div>' + I.refresh + "</button>" +
      '<button class="m-opt" data-go="iptv"><div><b>Cambiar el enlace de la lista</b><small>' + esc(HFIptv.config() ? iptvShort(HFIptv.config().url) : "") + "</small></div>" + I.chev + "</button>" +
      '<button class="m-opt" data-act="live-restart"><div><b>Reiniciar el canal</b><small>Volver a conectar si se quedó trabado</small></div>' + I.replay + "</button></div>",
      I.info + "La calidad la elige sola según tu conexión.");
  };
  SHEETS["live-info"] = function () {
    var c = S.live.data && S.live.data.channels.filter(function (x) { return x.key === S.liveInfo; })[0];
    var n;
    if (!c) { return sheetHtml("Canal", "<p class=\"m-sub\">No se encontró el canal.</p>"); }
    n = HFIptv.now(c);
    return sheetHtml(c.name,
      '<div class="m-liveinfo"><h3>' + esc(n && n.title ? n.title : "En vivo") + "</h3>" +
      "<small>" + esc(c.group) + " · canal " + c.num + (n ? " · " + hm(n.start) + " – " + hm(n.end) : "") + "</small>" +
      (n && n.desc ? "<p>" + esc(n.desc) + "</p>" : '<p class="dim">Este canal no trae guía de programación.</p>') +
      (n && n.next ? "<small>Sigue · " + hm(n.next.start) + " " + esc(n.next.title) + "</small>" : "") + "</div>" +
      '<button class="m-btn primary block" data-act="live-play" data-k="' + esc(c.key) + '">' + I.play + "Ver ahora</button>");
  };
  ACT["live-gear-reload"] = function () { S.sheet = null; render(true); liveLoad(true); };

  /* Mandar el canal a la TV (reusa la hoja «Ver en la TV»): la TV abre el canal con su propia lista */
  function liveCastTo(dev) {
    var msg = { t: "live", key: S.castLive };
    S.castSending = dev;
    render(true);
    var reply = new Promise(function (resolve) {
      var noAnswer = function () { resolve({ t: "error", m: "La TV no respondió. ¿Sigue abierta HomeFlix en la TV?" }); };
      castWaiter = {
        id: dev.id, done: resolve, timer: setTimeout(noAnswer, 15000),
        wait: function (m) { clearTimeout(castWaiter.timer); castWaiter.timer = setTimeout(noAnswer, 60000); S.castSending = { nombre: dev.nombre, msg: m }; if (S.sheet === "cast") { render(true); } }
      };
    });
    HFRemote.send(dev.id, msg).then(function () { return reply; }).then(function (r) {
      castWaiter = null;
      if (!r || r.t !== "ok") { throw new Error((r && r.m) || "La TV no pudo abrir el canal"); }
      S.castSending = null;
      S.castLive = null;
      S.sheet = null;
      liveStop();
      render();
      toast("El canal se está viendo en " + dev.nombre);
    }).catch(function (e) {
      castWaiter = null;
      S.castSending = null;
      S.castErr = (e && e.message) || String(e);
      if (S.sheet === "cast") { render(true); }
    });
  }

  window.addEventListener("resize", function () { if (S.view === "live") { setTimeout(livePlace, 80); } });
  document.addEventListener("visibilitychange", function () { if (document.hidden && S.view === "live" && HFLive.current()) { /* se deja sonando: el usuario puede salir un momento */ } }, false);
  root.addEventListener("click", function (e) {
    /* tocar el video muestra u oculta los controles */
    if (S.view === "live" && S.live.ch && e.target.closest && e.target.closest("#mlCtl") && !e.target.closest("button")) {
      if (S.live.ui) { S.live.ui = false; byId("mlCtl").classList.add("hide"); } else { liveShowUi(); }
    }
  });

  /* ===================== Eventos ===================== */
  root.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act],[data-go],[data-tab],[data-open],[data-play],[data-back]");
    /* bloqueada: solo el botón de desbloquear responde */
    if (S.view === "player" && S.player && S.player.locked && !(el && el.getAttribute("data-act") === "unlock")) { showUnlock(); return; }
    /* tocar el brillo o la barra de tiempo no es tocar el video: los controles se quedan a la vista */
    if (S.view === "player" && !el && e.target.closest && e.target.closest("#plBright, .seek")) { showChrome(); return; }
    if (S.view === "player" && (!el || el.id === "pl")) {
      /* tocar el video muestra u oculta los controles */
      var pl = byId("pl");
      if (pl && !el) { if (pl.classList.contains("idle")) { showChrome(); } else { pl.classList.add("idle"); } }
      if (!el) { return; }
    }
    if (!el) { return; }
    if (el.hasAttribute("data-back")) { back(); return; }
    if (el.hasAttribute("data-tab")) {
      if (el.closest(".m-nav")) { navPop = true; tick(); }
      go(el.getAttribute("data-tab"));
      return;
    }
    if (el.hasAttribute("data-go")) { go(el.getAttribute("data-go")); return; }
    if (el.hasAttribute("data-open")) { S.season = 0; go("detail", el.getAttribute("data-open")); return; }
    if (el.hasAttribute("data-play")) { play(titleOf(el.getAttribute("data-play"))); return; }
    var a = el.getAttribute("data-act");
    if (ACT[a]) { ACT[a](el, e); }
  });

  root.addEventListener("input", function (e) {
    var m = e.target.getAttribute && e.target.getAttribute("data-model");
    if (!m) { return; }
    var path = m.split(".");
    var obj = path.length > 1 ? S[path[0]] : S;
    var key = path[path.length - 1];
    var v = e.target.value;
    if (m === "login.code") {
      v = v.replace(/\D/g, "").slice(0, S.login.length);
      e.target.value = v;
      obj[key] = v;
      var box = e.target.parentNode;
      Array.prototype.forEach.call(box.querySelectorAll("i"), function (i, n) { i.textContent = v.charAt(n); i.className = n === v.length ? "cur" : ""; });
      if (v.length === S.login.length) { ACT["verify-code"](); }
      return;
    }
    obj[key] = v;
    if (m === "search") { byId("results").innerHTML = searchResults(); hydrate(); }
    if (m === "chatQ") { byId("chatList").innerHTML = chatList(); }
    if (S.login.error && path[0] === "login") { S.login.error = ""; var er = root.querySelector(".m-error"); if (er) { er.remove(); } }
  });

  root.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") { return; }
    var id = e.target.id;
    if (id === "phone" || id === "cc") { e.preventDefault(); ACT["send-code"](); }
    if (id === "pw") { e.preventDefault(); ACT["send-password"](); }
    if (id === "q") { e.target.blur(); }
  });

  root.addEventListener("touchstart", function (e) { if (e.target.closest && e.target.closest("#plTrack")) { seekFromTouch(e); } }, { passive: true });
  root.addEventListener("touchmove", function (e) { if (e.target.closest && e.target.closest("#plTrack")) { seekFromTouch(e); } }, { passive: true });

  /* ===================== Biblioteca ===================== */
  function rebuild() {
    var src = HFLibrary.enabledSources() || {};
    var full = HFLibrary.build(items.filter(function (it) { return !!src[itemChat(it)]; }), HFLibrary.tags());
    library = profile && profile.kids ? HFLibrary.filterKids(full) : full;
  }

  var CATALOG = { home: 1, movies: 1, series: 1, search: 1, mylist: 1, category: 1, detail: 1 };
  function sync(manual) {
    var ids = Object.keys(HFLibrary.enabledSources() || {});
    var acc = HFLibrary.accountId();
    var all = [];
    var done = {};
    var failed = 0;
    if (S.syncing || !ids.length) { return; }
    S.syncing = true;
    S.syncError = "";
    if (CATALOG[S.view] || S.view === "account") { render(true); }
    (function next(i) {
      if (HFLibrary.accountId() !== acc) { S.syncing = false; return; }
      if (i >= ids.length) {
        var keep = HFLibrary.allEnabledSources();
        items = items.filter(function (it) { var c = itemChat(it); return !done[c] && !!keep[c]; }).concat(all.map(function (it) {
          if (it.caption && it.caption.length > 800) { it.caption = it.caption.slice(0, 800); }
          return it;
        }));
        HFLibrary.setCachedItems(items);
        rebuild();
        S.syncing = false;
        S.syncError = failed ? plural(failed, "chat no se pudo leer", "chats no se pudieron leer") : "";
        if (CATALOG[S.view] || S.view === "account") { render(true); }
        if (manual) { toast(S.syncError || "Biblioteca actualizada"); }
        return;
      }
      HFTelegram.scan(ids[i]).then(function (list) {
        all = all.concat(list);
        done[String(ids[i])] = true;
      }, function () { failed += 1; }).then(function () { next(i + 1); });
    })(0);
  }

  /* ===================== Imágenes ===================== */
  var imageSource = function (key) { return HFTelegram.image(key, 640); };
  function hydrate() {
    Array.prototype.forEach.call(root.querySelectorAll("[data-img]"), function (el) {
      var key = el.getAttribute("data-img");
      el.removeAttribute("data-img");
      Promise.resolve(imageSource(key)).then(function (url) {
        if (url) {
          el.style.backgroundImage = "url(" + url + ")";
          var fb = el.querySelector(".fallback");
          if (fb) { fb.remove(); }
        }
      }, function () { /* sin imagen: queda el respaldo */ });
    });
  }

  /* ===================== Arranque ===================== */
  function boot() {
    S.view = "boot";
    S.bootError = "";
    S.bootNote = "Conectando con Telegram…";
    render();
    if (!HFTelegram.available()) {
      S.bootError = "No se cargó el motor de Telegram.";
      render();
      return;
    }
    if (!HFTelegram.credentials()) {
      S.bootError = "Esta versión no trae la clave de Telegram. Hay que armarla con node tools/build-apk.mjs.";
      render();
      return;
    }
    /* la intro de marca (js/intro.js) corre mientras se revisa la sesión: no agrega espera */
    var intro = introShown ? Promise.resolve() : HFIntro.play({ base: "../" });
    introShown = true;
    HFTelegram.me().then(function (u) {
      return intro.then(function () {
        if (u) {
          loggedIn(u);
        } else {
          go("login", null, { root: true });
        }
      });
    }, function (e) {
      return intro.then(function () {
        S.bootError = HFTelegram.loginError(e);
        render();
      });
    });
  }
  var introShown = false;

  /* ----- Modo tablero (design/) ----- */
  function design(view) {
    var s = document.createElement("script");
    s.src = "../design/demo-data.js";
    s.onload = function () {
      HFDemo.load().then(function (list) {
        var prog = HFDemo.progressFor(list);
        var known = {};
        HFLibrary.setAccount("demo-ui");
        HFLibrary.progress = function (k) { return prog[k] || null; };
        HFLibrary.allProgress = function () { return prog; };
        HFLibrary.inMyList = function (k) { return /hoppers|spider|super mario/.test(k); };
        HFLibrary.myList = function () { return Object.keys(library.titles).filter(HFLibrary.inMyList); };
        HFTelegram.dialogs = function () { return Promise.resolve([{ id: "self", title: "Mensajes guardados", kind: "saved" }, { id: "-5479575394", title: "NETSUCKS", kind: "group" }, { id: "b", title: "Series HD", kind: "channel" }, { id: "c", title: "Grupo de la familia", kind: "group" }, { id: "d", title: "Dibujos animados", kind: "channel" }, { id: "e", title: "Documentales", kind: "group" }]); };
        HFTelegram.available = function () { return false; };
        imageSource = function (key) {
          var url = HFDemo.mediaUrl(key);
          if (known[url] === undefined) {
            known[url] = fetch(url, { method: "HEAD" }).then(function (r) { return r.ok ? url : null; }, function () { return null; });
          }
          return known[url];
        };
        var AV = { Familia: "01-Spider-Man", Santiago: "02-Captain_Carter", Kids: "04-Spider-Man_comic", Invitado: "03-Iron_Man" };
        HFLibrary.profiles().forEach(function (p) {
          if (AV[p.name] && p.avatar !== AV[p.name]) { HFLibrary.saveProfile({ id: p.id, name: p.name, avatar: AV[p.name], kids: p.kids }); }
        });
        HFLibrary.setEnabledSources({ "-5479575394": "NETSUCKS" });
        account = { name: "David Vasquez", username: "AndresVz14" };
        profile = HFLibrary.profiles()[1];
        if (/^live/.test(view)) { profile = HFLibrary.profiles().filter(function (p) { return !p.kids; })[0] || profile; }
        items = list;
        library = HFLibrary.build(list, {});
        var hop = titles().filter(function (t) { return /Hoppers/.test(t.name); })[0] || movies()[0];
        var ser = series()[0];
        var L = S.login;
        L.phone = "300 123 4567";
        L.code = "284";
        L.until = Date.now() + 42000;
        L.hint = "la de siempre";
        L.password = "contraseña";
        try { L.qr = HFTelegram.qrSvg("tg://login?token=AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8w", 6); } catch (e) { L.qr = ""; }
        L.qrAbort = { abort: function () {} };
        S.chats = null;
        S.search = "spi";
        var map = {
          "detail-movie": ["detail", hop && hop.titleKey], "detail-series": ["detail", ser && ser.titleKey],
          "sheet-quality": ["detail", hop && hop.titleKey, "quality"], "sheet-tracks": ["detail", hop && hop.titleKey, "info"]
        };
        var m = map[view] || [view];
        if (view === "pin") { S.pin = { profile: profile, entered: "12", error: "" }; }
        if (view === "profile-edit") { S.edit = { id: profile.id, name: profile.name, avatar: profile.avatar, kids: false, hasPin: true }; }
        if (view === "categories") { m = ["home"]; S.overlay = "categories"; }
        if (view === "player-clip") {
          S.view = "player-design";
          root.innerHTML = designClip();
          setTimeout(function () { paintClip(); clipScrollTo(S.player.clip, 1515, true); clipTiles(); }, 0);
        } else if (view === "player" || view === "player-next") {
          S.view = "player-design";
          root.innerHTML = designPlayer(view === "player-next");
          hydrate();
        } else {
          S.view = m[0];
          S.arg = m[1] || null;
          S.sheet = m[2] || null;
          AFTER.player = function () {};
          render();
        }
        document.documentElement.setAttribute("data-design-ready", view);
      });
    };
    document.head.appendChild(s);
  }

  /* El reproductor del tablero: una foto fija con los controles (sin video). */
  function designPlayer(next) {
    var t = titles().filter(function (x) { return /Hoppers/.test(x.name); })[0] || movies()[0];
    var s = series()[0];
    if (next && s) {
      var ep = s.seasons[0].episodes[1];
      var nx = s.seasons[0].episodes[2];
      S.player = { name: s.name, sub: "T1:E2 · " + ep.title, poster: null, nextEp: nx, series: s, entry: ep };
      var h = V.player().replace('class="frame"', 'class="frame dark"');
      setTimeout(function () { setPlayerShot(ep.video.duration - 9, ep.video.duration); showNextDemo(nx); }, 0);
      return h;
    }
    S.player = { name: t.name, sub: [t.year, qualityOf(t)].filter(Boolean).join(" · "), poster: t.bannerKey || t.imageKey, qualities: true };
    setTimeout(function () { setPlayerShot(2380, lengthOf(t)); if (byId("plQ")) { byId("plQ").textContent = "AUTO · 1080p"; } }, 0);
    return V.player();
  }
  /* «Recortar» en el tablero: hojas de prueba dibujadas aquí (cada cuadro dice su segundo) para revisar que cada
   * cuadro de la tira caiga en su tiempo y no se deforme. */
  function designClip() {
    var t = titles().filter(function (x) { return /Hoppers/.test(x.name); })[0] || movies()[0];
    var dur = 5400;
    var th = { every: 10, w: 160, h: 90, cols: 10, rows: 10, sheets: [] };
    var P = { name: t.name, title: { thumbs: th }, sheetUrls: {}, clip: { from: 1500, to: 1530, dur: dur, back: 1520, seekAt: 0 } };
    var cv = document.createElement("canvas");
    cv.width = 1600;
    cv.height = 900;
    var cx = cv.getContext("2d");
    for (var s = 0; s < Math.ceil(dur / 10 / 100); s++) {
      th.sheets.push("prueba" + s);
      for (var k = 0; k < 100; k++) {
        var x = (k % 10) * 160;
        var y = Math.floor(k / 10) * 90;
        var sec = (s * 100 + k) * 10;
        cx.fillStyle = "hsl(" + ((s * 100 + k) * 7 % 360) + ",45%,32%)";
        cx.fillRect(x, y, 160, 90);
        cx.strokeStyle = "#fff";
        cx.strokeRect(x + 2, y + 2, 156, 86); // si se deforma o se corre, el borde no queda parejo
        cx.beginPath(); cx.arc(x + 80, y + 45, 30, 0, 7); cx.stroke(); // si se estira, el círculo sale ovalado
        cx.fillStyle = "#fff";
        cx.font = "bold 22px sans-serif";
        cx.textAlign = "center";
        cx.fillText(clock(sec), x + 80, y + 53);
      }
      (function (s, url) { setTimeout(function () { P.sheetUrls[s] = url; paintSheetTiles(P); }, 400); })(s, cv.toDataURL("image/jpeg", 0.8)); // llegan después, como del celular
    }
    S.player = P;
    return clipHtml(P);
  }
  function setPlayerShot(t, d) {
    var pct = (t / d) * 100;
    byId("plD").textContent = clock(d - t);
    byId("plNow").style.width = pct + "%";
    byId("plKnob").style.left = pct + "%";
    byId("plBuf").style.width = Math.min(100, pct + 6) + "%";
  }
  function showNextDemo(nx) {
    var el = byId("plNext");
    el.hidden = false;
    el.innerHTML = '<div class="img"' + img(nx.key) + '><span class="cd">8</span></div><div class="tx"><small>Siguiente capítulo</small><b>T1:E3 · ' + esc(nx.title) + "</b>" +
      '<div class="bt"><button class="m-btn primary">' + I.play + 'Ver ahora</button><button class="m-btn ghost">Ver créditos</button></div></div>';
  }

  /* La barra inferior se esconde al bajar y vuelve al subir (y arriba del todo siempre se ve). */
  (function () {
    var last = window.scrollY;
    window.addEventListener("scroll", function () {
      var y = window.scrollY;
      var d = y - last;
      if (y <= 40) { root.classList.remove("nav-hidden"); last = y; return; }
      if (Math.abs(d) < 10) { return; }
      last = y;
      root.classList.toggle("nav-hidden", d > 0 && y > 120);
    }, { passive: true });
  })();

  var dm = /[?&]design=([^&]*)/.exec(window.location.search);
  if (dm) {
    design(decodeURIComponent(dm[1]));
  } else {
    boot();
  }

  return { back: back, go: go };
})();
