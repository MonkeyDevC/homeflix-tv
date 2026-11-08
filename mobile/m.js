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
  /* Avatares: igual que la TV (avatarSrc en js/ui/core.js). Si el id no tiene imagen en images/avatares/
   * (perfiles viejos: «panda», «zorro»…), se le da una imagen fija según ese id, así nunca queda sin foto. */
  var FACE_IDS = ["panda", "zorro", "buho", "dino", "robot", "astro", "gato", "conejo", "oso", "pinguino", "rana", "leon"]; /* orden de js/art.js */
  function avatarIdOf(src) { return String(src).replace(/^.*\//, "").replace(/\.[a-z0-9]+$/i, ""); }
  function hashOf(x) { var h = 0; x = String(x || ""); for (var i = 0; i < x.length; i += 1) { h = (h * 31 + x.charCodeAt(i)) | 0; } return Math.abs(h); }
  function avatarSrc(id) {
    var own = window.HF_AVATARES || [];
    var k;
    id = String(id || "");
    if (!own.length) { return "images/avatares/" + (id || "01-Spider-Man") + ".jpg"; }
    for (k = 0; k < own.length; k += 1) { if (avatarIdOf(own[k]) === id) { return own[k]; } }
    k = FACE_IDS.indexOf(id);
    return own[(k >= 0 ? k : hashOf(id)) % own.length];
  }
  function avatarUrl(id) { return "../" + encodeURI(avatarSrc(id)); }
  function avatarEffectiveId(id) { return avatarIdOf(avatarSrc(id)); }
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

  function nav(on) {
    var tabs = [["home", "Inicio", I.home], ["movies", "Películas", I.film], ["series", "Series", I.tv], ["search", "Buscar", I.search], ["mylist", "Mi lista", I.list]];
    return '<nav class="m-nav">' + tabs.map(function (x) {
      return '<button class="' + (x[0] === on ? "on" : "") + '" data-tab="' + x[0] + '">' + x[2] + "<span>" + x[1] + "</span></button>";
    }).join("") + "</nav>";
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
    return '<div class="m-center m-boot">' + logo(true) + (S.bootError ? "" : '<div class="m-spin"></div><p>' + esc(S.bootNote || "Conectando con Telegram…") + "</p>") +
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
    return '<div class="m-center m-profiles">' + logo() + "<h1>¿Quién está viendo?</h1>" +
      '<div class="m-pgrid">' + list.map(function (p) {
        return '<button data-act="profile" data-id="' + esc(p.id) + '"><span class="av" style="background-image:url(' + avatarUrl(p.avatar) + ')">' +
          (p.kids ? "<em>INFANTIL</em>" : "") + (p.pin ? '<span class="lockb">' + I.lock + "</span>" : "") + "</span>" + esc(p.name) + "</button>";
      }).join("") + (list.length < HFLibrary.MAX_PROFILES ? '<button data-act="new-profile"><span class="av add">' + I.plus + "</span>Agregar</button>" : "") + "</div>" +
      (account ? '<div class="m-foot">Conectado con Telegram como <b>' + esc(account.name) + "</b>" + (account.username ? " · @" + esc(account.username) : "") + "</div>" : "") + "</div>";
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
      '<div class="m-avpick">' + avs.map(function (a) { return '<i data-act="avatar" data-id="' + esc(a) + '" class="' + (a === avatarEffectiveId(E.avatar) ? "on" : "") + '" style="background-image:url(' + avatarUrl(a) + ')"></i>'; }).join("") + "</div>" +
      '<div class="m-field"><label for="pname">Nombre</label><div class="m-input"><input id="pname" data-model="edit.name" maxlength="20" value="' + esc(E.name) + '"/></div></div>' +
      errorBox(E.error) +
      '<div class="m-group">' +
      '<button class="m-opt" data-act="edit-kids"><div><b>Perfil infantil</b><small>Solo muestra lo marcado #infantil</small></div>' + toggle(E.kids) + "</button>" +
      (E.id ? '<button class="m-opt" data-act="edit-pin"><div><b>' + (E.hasPin ? "Cambiar o quitar PIN" : "Ponerle PIN") + "</b><small>" + (E.hasPin ? "Tiene PIN · ••••" : "Pide 4 números para entrar") + "</small></div>" + I.chev + "</button>" : "") +
      "</div>" +
      (E.id && HFLibrary.profiles().length > 1 ? '<button class="m-btn ghost block danger" data-act="delete-profile">' + I.trash + "Eliminar perfil</button>" : "") + "</div>";
  };

  /* ----- Catálogo ----- */
  function heroHtml(t, i, n) {
    var p = progressOf(t);
    var tags = [t.year, t.type === "series" ? plural((t.seasons || []).length, "temporada", "temporadas") : dur(lengthOf(t))].concat(t.categories || []).filter(Boolean).slice(0, 4);
    return '<div class="m-hero"><div class="art"' + img(t.bannerKey || t.imageKey) + "></div>" +
      '<div class="copy"><h1' + (t.name.length > 18 ? ' class="long"' : "") + ">" + esc(t.name) + "</h1>" +
      '<div class="tags">' + tags.map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("") + "</div>" +
      '<div class="btns"><button class="m-btn primary" data-play="' + esc(t.titleKey) + '">' + I.play + (p ? "Continuar" : "Reproducir") + "</button>" +
      '<button class="m-btn ghost" data-open="' + esc(t.titleKey) + '">' + I.info + "Más info</button></div></div></div>" +
      (n > 1 ? '<div class="m-dots">' + Array.apply(null, Array(Math.min(n, 6))).map(function (_, k) { return "<i" + (k === i ? ' class="on"' : "") + "></i>"; }).join("") + "</div>" : "");
  }

  /* Categorías sin repetir aunque una venga con tilde y otra sin ella («Accion» = «Acción»), como en la TV.
   * Se muestra la forma con tilde si alguna la trae. */
  function catsOf(list) {
    var out = [];
    var seen = {};
    list.forEach(function (t) {
      (t.categories || []).concat(t.kids ? ["Infantil"] : []).forEach(function (c) {
        var k = norm(c);
        if (seen[k] === undefined) { seen[k] = out.length; out.push(c); }
        else if (c !== norm(c) && out[seen[k]] === norm(out[seen[k]]).replace(/^./, function (x) { return x.toUpperCase(); }) && /[áéíóúñ]/i.test(c)) { out[seen[k]] = c; }
      });
    });
    return out;
  }
  function inCategory(t, c) {
    var k = norm(c);
    return (t.categories || []).some(function (x) { return norm(x) === k; }) || (k === "infantil" && t.kids);
  }

  function categoryRows(list) {
    return catsOf(list).map(function (c) {
      var g = list.filter(function (t) { return inCategory(t, c); });
      return row(c, g, { note: plural(g.length, "título", "títulos") });
    }).join("");
  }

  function emptyLibrary() {
    if (S.syncing) {
      /* Pantalla de carga centrada en la pantalla (no en la columna), como la de arranque */
      return '<div class="m-loading" role="status"><div class="m-spin"></div><b>Cargando tu biblioteca…</b><p>Leyendo los videos de ' + esc(chatTitles().join(", ") || "tus chats") + ".</p></div>";
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
    var hi = featured.length ? heroPick % featured.length : 0;
    return topbar() + '<div class="m-scroll">' +
      '<div class="m-chips"><button class="m-chip" data-tab="movies">Películas</button><button class="m-chip" data-tab="series">Series</button>' +
      '<button class="m-chip" data-act="categories">Categorías ' + I.down + "</button></div>" +
      (!all.length ? emptyLibrary() :
        (featured.length ? heroHtml(featured[hi], hi, featured.length) : "") +
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
      (feat ? heroHtml(feat, 0, 1) : "") +
      (list.length ? categoryRows(list) + row(kind === "series" ? "Todas las series" : "Todas las películas", list)
        : !titles().length ? emptyLibrary()
        : '<div class="m-empty">' + I.tv + "<b>Todavía no hay " + (kind === "series" ? "series" : "películas") + "</b>Publica un capítulo con <code>serie(1/1)#Nombre#…</code> en tu grupo y aparecerá aquí.</div>") +
      "</div>" + nav(kind);
  }
  V.movies = function () { return section("movies"); };
  V.series = function () { return section("series"); };

  V.category = function () {
    var c = S.category;
    var list = titles().filter(function (t) { return inCategory(t, c); }).sort(byDate);
    return topTitle(c) + '<div class="m-scroll"><div class="m-sub">' + plural(list.length, "título", "títulos") + '</div><div class="m-grid">' +
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
  function actions(t) {
    var inList = HFLibrary.inMyList(t.titleKey);
    return '<div class="m-acts"><button data-act="mylist" data-key="' + esc(t.titleKey) + '">' + (inList ? I.check : I.plus) + "Mi lista</button>" +
      (t.versions && t.versions.length > 1 ? '<button data-act="sheet" data-sheet="quality">' + I.quality + "Calidad</button>" : "") +
      '<button data-act="sheet" data-sheet="info">' + I.info + "Detalles</button></div>";
  }

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
      body = '<button class="m-btn primary block" data-play="' + esc(t.titleKey) + '">' + I.play + (ep ? (next.started ? "Continuar" : "Ver") + " T" + ep.season + ":E" + ep.episode : "Reproducir") + "</button>" +
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
      body = '<button class="m-btn primary block" data-play="' + esc(t.titleKey) + '">' + I.play + (p ? "Continuar" : "Reproducir") + "</button>" +
        (p ? '<div class="m-resume"><div class="bar"><i style="width:' + Math.round((p.t / Math.max(1, p.d)) * 100) + '%"></i></div><small>Quedan ' + dur(p.d - p.t) + " · Lo dejaste en " + clock(p.t) + '</small><button class="m-inlink" data-act="play-start" data-key="' + esc(t.titleKey) + '">Ver desde el principio</button></div>' : "") +
        (t.description ? '<p class="m-desc">' + esc(t.description) + "</p>" : "") +
        (t.categories && t.categories.length ? '<div class="m-cats">' + t.categories.map(function (c) { return '<button data-act="category" data-c="' + esc(c) + '">' + esc(c) + "</button>"; }).join("") + "</div>" : "") +
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
      var tr = HFPlayback.tracks();
      var audio = (tr.audio || []);
      var subs = (tr.subs || []);
      var anySub = subs.some(function (s) { return s.current; });
      return sheetHtml("Audio y subtítulos",
        '<div class="sh-sec">Audio</div>' + (audio.length ? audio.map(function (a) { return radio(esc(a.label), a.ok === false ? "No se puede reproducir aquí" : "", a.current, 'data-act="audio" data-k="' + esc(a.key) + '"'); }).join("") : '<div class="m-sub">Una sola pista</div>') +
        '<div class="sh-sec">Subtítulos</div>' + radio("Desactivados", "", !anySub, 'data-act="sub" data-k=""') +
        subs.map(function (s) { return radio(esc(s.label), "", s.current, 'data-act="sub" data-k="' + esc(s.key) + '"'); }).join(""),
        I.info + "Se recuerda para este video.");
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
      '<div class="m-gtitle">Sincronización</div><div class="m-group"><div class="m-opt"><div><b>Mi lista, progreso y perfiles</b><small>' + esc(syncText()) + "</small></div></div></div>" +
      '<div class="m-gtitle">Cuenta</div><div class="m-group">' +
      '<button class="m-opt danger" data-act="sheet" data-sheet="logout"><div><b>Cerrar sesión</b><small>Se borra la sesión de este celular</small></div></button></div>' +
      '<div class="m-foot">HomeFlix' + (ver ? " v" + esc(ver) : "") + " · celular</div></div>" + nav("");
  };

  function syncText() {
    var st = HFSync.status();
    if (st.state === "off") { return "Se guardan en tus Mensajes guardados de Telegram"; }
    if (st.state === "busy") { return "Sincronizando…"; }
    if (st.state === "error") { return "No se pudo sincronizar: " + st.error; }
    if (!st.at) { return "Iguales en la TV y el celular"; }
    var min = Math.round((Date.now() - st.at) / 60000);
    return "Iguales en la TV y el celular · " + (min < 1 ? "hace un momento" : "hace " + plural(min, "minuto", "minutos"));
  }

  /* ----- Reproductor ----- */
  V.player = function () {
    var P = S.player || {};
    return '<div class="m-player" id="pl"><div class="frame" id="plPoster"' + img(P.poster) + '></div><div class="scrim"></div>' +
      '<div class="ptop"><button class="m-iconbtn" data-act="close-player">' + I.back + '</button><div class="ttl"><b>' + esc(P.name || "") + "</b><small>" + esc(P.sub || "") + "</small></div></div>" +
      '<div class="mid"><button class="skip" data-act="seek-rel" data-s="-10">' + I.rew + "<em>10</em></button>" +
      '<button class="pp" data-act="toggle-play" id="plPP">' + I.pause + '</button><button class="skip" data-act="seek-rel" data-s="10">' + I.fwd + "<em>10</em></button></div>" +
      '<div class="m-plmsg" id="plMsg"></div>' +
      '<div class="pbot"><div class="seek"><span id="plT">0:00</span><div class="track" id="plTrack"><div class="buf" id="plBuf"></div><div class="now" id="plNow"></div><div class="knob" id="plKnob"></div></div><span id="plD">-0:00</span></div>' +
      '<div class="tools"><button data-act="sheet" data-sheet="tracks">' + I.subs + "Audio y subtítulos</button>" +
      (P.qualities ? '<button data-act="sheet" data-sheet="quality">' + I.quality + 'Calidad <span class="q" id="plQ">AUTO</span></button>' : "") +
      (P.nextEp ? '<button data-act="next-ep">' + I.next + "Siguiente</button>" : "") + "</div></div>" +
      '<div class="m-next" id="plNext" hidden></div></div>';
  };

  /* ===================== Navegación ===================== */
  var TABS = { home: 1, movies: 1, series: 1, search: 1, mylist: 1 };

  function render(keepScroll) {
    var y = window.scrollY;
    root.setAttribute("data-view", S.view);
    root.innerHTML = (V[S.view] || V.home)() + (S.sheet && SHEETS[S.sheet] ? SHEETS[S.sheet]() : "") + overlayHtml() + (S.toast ? '<div class="m-toast">' + esc(S.toast) + "</div>" : "");
    hydrate();
    window.scrollTo(0, keepScroll ? y : 0);
    if (AFTER[S.view]) { AFTER[S.view](); }
  }

  function go(view, arg, opts) {
    opts = opts || {};
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
    if (S.sheet) { S.sheet = null; render(true); return true; }
    if (S.overlay) { S.overlay = null; render(true); return true; }
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
    player: function () { startPlayback(); }
  };

  /* ===================== Acciones ===================== */
  var ACT = {};

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
  ACT["close-sheet"] = function () { S.sheet = null; render(true); };
  ACT.logout = function () {
    S.sheet = null;
    toast("Cerrando sesión…");
    HFSync.stop().then(function () { return HFTelegram.logout(); }).then(function () {
      account = null;
      profile = null;
      items = [];
      library = HFLibrary.build([]);
      go("login", null, { root: true });
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

  /* Reproductor a pantalla completa y en horizontal. En el APK lo hace la parte nativa (HFAndroid); en el navegador
   * (la web) se pide al navegador: pantalla completa siempre que se pueda y giro donde lo permite (Android Chrome).
   * En iPhone el navegador no deja poner la página entera a pantalla completa: se ve igual, dentro de Safari. */
  function playerMode(on) {
    var d = document;
    var el = d.documentElement;
    try {
      if (android) { android.setPlayerMode(on); return; }
      if (on) {
        var req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req && !(d.fullscreenElement || d.webkitFullscreenElement)) {
          Promise.resolve(req.call(el)).then(function () {
            if (screen.orientation && screen.orientation.lock) { screen.orientation.lock("landscape").catch(function () { /* no se puede girar aquí */ }); }
          }, function () { /* sin pantalla completa */ });
        }
      } else {
        if (screen.orientation && screen.orientation.unlock) { try { screen.orientation.unlock(); } catch (e) { /* nada */ } }
        if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); }
      }
    } catch (e) { /* nada */ }
  }

  var hideTimer = null;
  function showChrome() {
    var pl = byId("pl");
    if (!pl) { return; }
    pl.classList.remove("idle");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { if (HFPlayback.playing() && byId("pl") && !S.sheet) { byId("pl").classList.add("idle"); } }, 3500);
  }

  function startPlayback() {
    var P = S.player;
    if (!P) { return; }
    playerMode(true);
    var host = byId("mplayer");
    host.hidden = false;
    var pref = qualityPref();
    HFPlayback.open(P.entry, P.start || 0, {
      onTime: function (t, d, buffered) {
        var pct = d ? (t / d) * 100 : 0;
        if (!byId("plT")) { return; }
        byId("plT").textContent = clock(t);
        byId("plD").textContent = "-" + clock(Math.max(0, d - t));
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
        var pp = byId("plPP");
        var msg = byId("plMsg");
        if (pp) { pp.innerHTML = s === "playing" || s === "buffering" ? I.pause : I.play; }
        if (msg) { msg.innerHTML = s === "loading" ? '<div class="m-spin"></div>Abriendo…' : s === "buffering" ? '<div class="m-spin"></div>Cargando…' : ""; }
        if (s === "playing") { var po = byId("plPoster"); if (po) { po.style.opacity = HFPlayback.simulated ? "1" : "0"; } showChrome(); }
        if (s === "paused") { showChrome(); }
      },
      onEnded: function () {
        HFLibrary.setProgress(entryKey(P.entry), HFPlayback.duration(), HFPlayback.duration());
        if (P.nextEp) { play(P.series, { episode: P.nextEp, fromStart: true }); return; }
        closePlayer();
      },
      onError: function (m) {
        var msg = byId("plMsg");
        if (msg) { msg.innerHTML = '<div class="m-error">' + esc(m) + '</div><button class="m-btn primary" data-act="close-player">Volver</button>'; }
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

  function showNext(sec) {
    var P = S.player;
    var el = byId("plNext");
    if (!el || !P.nextEp) { return; }
    el.hidden = false;
    el.innerHTML = '<div class="img"' + img(entryKey(P.nextEp)) + '><span class="cd">' + sec + '</span></div><div class="tx"><small>Siguiente capítulo</small><b>T' + P.nextEp.season + ":E" + P.nextEp.episode + (P.nextEp.title ? " · " + esc(P.nextEp.title) : "") + "</b>" +
      '<div class="bt"><button class="m-btn primary" data-act="next-ep">' + I.play + 'Ver ahora</button><button class="m-btn ghost" data-act="hide-next">Ver créditos</button></div></div>';
    hydrate();
  }

  function closePlayer() {
    var P = S.player;
    if (P && HFPlayback.time() > 5) { HFLibrary.setProgress(entryKey(P.entry), HFPlayback.time(), HFPlayback.duration()); }
    HFPlayback.close();
    byId("mplayer").hidden = true;
    playerMode(false);
    S.player = null;
    S.sheet = null;
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
    if (!tr || !HFPlayback.duration()) { return; }
    var r = tr.getBoundingClientRect();
    var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    HFPlayback.seek(Math.max(0, Math.min(1, x / r.width)) * HFPlayback.duration());
    showChrome();
  }

  /* ===================== Eventos ===================== */
  root.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act],[data-go],[data-tab],[data-open],[data-play],[data-back]");
    if (S.view === "player" && (!el || el.id === "pl")) {
      /* tocar el video muestra u oculta los controles */
      var pl = byId("pl");
      if (pl && !el) { if (pl.classList.contains("idle")) { showChrome(); } else { pl.classList.add("idle"); } }
      if (!el) { return; }
    }
    if (!el) { return; }
    if (el.hasAttribute("data-back")) { back(); return; }
    if (el.hasAttribute("data-tab")) { go(el.getAttribute("data-tab")); return; }
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

  /* ===================== Deslizar hacia abajo para actualizar =====================
   * En Inicio, Películas, Series y Mi lista: arriba del todo, deslizar hacia abajo vuelve a leer los chats
   * (trae lo último publicado). El indicador aparece arriba al centro y gira mientras actualiza. */
  var PULL_VIEWS = { home: 1, movies: 1, series: 1, mylist: 1 };
  var PULL_MAX = 120;
  var PULL_GO = 72;
  var ptr = document.createElement("div");
  ptr.className = "m-ptr";
  ptr.setAttribute("aria-hidden", "true");
  ptr.innerHTML = '<span class="ring"></span>';
  document.body.appendChild(ptr);
  var pull = null;

  /* El contenido baja con el dedo (como en una app nativa) y el indicador aparece en el hueco, bajo la barra. */
  var html = document.documentElement;
  function ptrShow(d) {
    html.style.setProperty("--pull", d + "px");
    ptr.style.transform = "translate(-50%, " + Math.round(d / 2 - 20) + "px)";
    ptr.style.opacity = String(Math.max(0, Math.min(1, (d - 16) / 36)));
    ptr.style.setProperty("--p", String(Math.min(1, d / PULL_GO)));
    ptr.classList.toggle("ready", d >= PULL_GO);
  }
  function ptrHide() {
    html.classList.remove("m-dragging", "m-pulling");
    html.style.removeProperty("--pull");
    ptr.classList.remove("busy", "ready");
    ptr.style.transform = "";
    ptr.style.opacity = "";
  }
  function ptrRefresh() {
    var t0 = Date.now();
    html.classList.remove("m-dragging");
    html.classList.add("m-pulling");
    ptr.classList.remove("ready");
    ptr.classList.add("busy");
    ptr.style.transform = "";
    ptr.style.opacity = "";
    try { HFSync.now(); } catch (e) { /* sin sincronización: igual se leen los chats */ }
    sync(true);
    (function wait() {
      /* Se queda al menos un momento para que se note que actualizó. Si tarda mucho (red lenta), el contenido
       * vuelve a su lugar y sigue el ícono pequeño de la barra superior mientras termina. */
      var t = Date.now() - t0;
      if ((S.syncing && t < 12000) || t < 700) { setTimeout(wait, 250); return; }
      ptrHide();
    })();
  }
  document.addEventListener("touchstart", function (e) {
    if (!PULL_VIEWS[S.view] || S.sheet || S.overlay || S.syncing || ptr.classList.contains("busy")) { return; }
    if (window.scrollY > 0 || e.touches.length !== 1) { return; }
    pull = { x: e.touches[0].clientX, y: e.touches[0].clientY, d: 0, on: false, off: false };
  }, { passive: true });
  document.addEventListener("touchmove", function (e) {
    if (!pull || pull.off) { return; }
    var dx = e.touches[0].clientX - pull.x;
    var dy = e.touches[0].clientY - pull.y;
    if (!pull.on) {
      /* Solo si el gesto es hacia abajo y vertical (las filas se deslizan de lado) */
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { pull.off = true; return; }
      if (dy < 8 || window.scrollY > 0) { if (dy < -4) { pull.off = true; } return; }
      pull.on = true;
      html.classList.add("m-dragging");
    }
    if (e.cancelable) { e.preventDefault(); }
    pull.d = Math.min(PULL_MAX, Math.max(0, dy - 8) * 0.55);
    ptrShow(pull.d);
  }, { passive: false });
  function pullEnd() {
    if (!pull) { return; }
    var go = pull.on && pull.d >= PULL_GO;
    var was = pull.on;
    pull = null;
    if (go) { ptrRefresh(); } else if (was) { ptrHide(); }
  }
  document.addEventListener("touchend", pullEnd);
  document.addEventListener("touchcancel", pullEnd);

  /* ===================== Deslizar desde el borde izquierdo para volver (iPhone) =====================
   * La app instalada desde Safari no tiene botón ni gesto de atrás. Esto hace lo mismo que el atrás de Android
   * (back(): cierra la hoja, el menú o el reproductor, o vuelve a la pantalla anterior).
   * Solo en la app instalada: en Safari normal el navegador ya tiene su propio gesto. En el APK lo hace Android.
   * Para probar en el navegador: ?swipe=1 */
  function installed() {
    return window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  }
  var SWIPE_ON = !android && (installed() || /[?&]swipe=1/.test(window.location.search));
  var EDGE = 24;
  var swipe = null;
  function canBack() {
    if (S.sheet || S.overlay || S.view === "player") { return true; }
    if (S.view === "settings" && S.firstTime) { return false; }
    return S.stack.length > 0 || (!!TABS[S.view] && S.view !== "home");
  }
  /* Lo que se mueve con el dedo: la hoja o el menú abiertos, o la pantalla (el menú de abajo se queda, como en iOS). */
  function swipeTargets() {
    var top = root.querySelector(".m-sheet, .m-overlay");
    if (top) { return [top]; }
    return Array.prototype.filter.call(root.children, function (el) { return !el.matches(".m-nav, .m-toast, .m-backdrop"); });
  }
  function swipeMove(els, x, animate) {
    els.forEach(function (el) {
      el.style.transition = animate ? "transform 0.26s cubic-bezier(0.2, 0.8, 0.2, 1)" : "none";
      el.style.transform = x ? "translateX(" + x + "px)" : "";
    });
  }
  function swipeClear(els) {
    els.forEach(function (el) { el.style.transition = ""; el.style.transform = ""; });
    html.classList.remove("m-swiping");
  }
  document.addEventListener("touchstart", function (e) {
    if (!SWIPE_ON || e.touches.length !== 1 || e.touches[0].clientX > EDGE || !canBack()) { return; }
    swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), dx: 0, on: false, els: null };
  }, { passive: true });
  document.addEventListener("touchmove", function (e) {
    if (!swipe) { return; }
    var dx = e.touches[0].clientX - swipe.x;
    var dy = e.touches[0].clientY - swipe.y;
    if (!swipe.on) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > dx) { swipe = null; return; }
      if (dx < 10) { return; }
      swipe.on = true;
      swipe.els = swipeTargets();
      html.classList.add("m-swiping");
      pull = null; /* no confundir con deslizar para actualizar */
    }
    if (e.cancelable) { e.preventDefault(); }
    swipe.dx = Math.max(0, dx);
    swipeMove(swipe.els, swipe.dx, false);
  }, { passive: false });
  function swipeEnd() {
    var sw = swipe;
    var w = window.innerWidth;
    swipe = null;
    if (!sw || !sw.on) { return; }
    var fast = sw.dx / Math.max(1, Date.now() - sw.t) > 0.5;
    if (sw.dx > w * 0.33 || (fast && sw.dx > 40)) {
      swipeMove(sw.els, w, true);
      setTimeout(function () {
        swipeClear(sw.els);
        back();
        /* La pantalla anterior entra suave desde la izquierda */
        var now = swipeTargets();
        swipeMove(now, -Math.round(w * 0.25), false);
        now.forEach(function (el) { el.style.opacity = "0.6"; });
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            swipeMove(now, 0, true);
            now.forEach(function (el) { el.style.opacity = ""; });
            setTimeout(function () { swipeClear(now); }, 280);
          });
        });
      }, 240);
    } else {
      swipeMove(sw.els, 0, true);
      setTimeout(function () { swipeClear(sw.els); }, 280);
    }
  }
  document.addEventListener("touchend", swipeEnd);
  document.addEventListener("touchcancel", swipeEnd);

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
    HFTelegram.me().then(function (u) {
      if (u) {
        loggedIn(u);
      } else {
        go("login", null, { root: true });
      }
    }, function (e) {
      S.bootError = HFTelegram.loginError(e);
      render();
    });
  }

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
        if (view === "player" || view === "player-next") {
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
      S.player = { name: s.name, sub: "T1:E2 · " + ep.title, poster: null, nextEp: nx };
      var h = V.player().replace('class="frame"', 'class="frame dark"');
      setTimeout(function () { setPlayerShot(ep.video.duration - 9, ep.video.duration); showNextDemo(nx); }, 0);
      return h;
    }
    S.player = { name: t.name, sub: [t.year, qualityOf(t)].filter(Boolean).join(" · "), poster: t.bannerKey || t.imageKey, qualities: true };
    setTimeout(function () { setPlayerShot(2380, lengthOf(t)); if (byId("plQ")) { byId("plQ").textContent = "AUTO · 1080p"; } }, 0);
    return V.player();
  }
  function setPlayerShot(t, d) {
    var pct = (t / d) * 100;
    byId("plT").textContent = clock(t);
    byId("plD").textContent = "-" + clock(d - t);
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

  var dm = /[?&]design=([^&]*)/.exec(window.location.search);
  if (dm) {
    design(decodeURIComponent(dm[1]));
  } else {
    boot();
  }

  return { back: back, go: go };
})();
