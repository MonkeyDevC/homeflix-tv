/* HomeFlix · acceso: pantalla inicial, login con Telegram, perfiles y editor de perfil. */

var telegramUser = null;
var activeProfile = null;

/* ===================== Pantalla inicial ===================== */

/* Mosaico: portadas reales de la biblioteca si hay suficientes; si no, carátulas ilustradas. */
function wallHtml(opts) {
  var keys = [];
  var COLS = 7;
  var PER = 4;
  opts = opts || {};
  if (telegramUser && library && library.recent) {
    library.recent.concat(library.unclassified || []).forEach(function (t) {
      var k = t.imageKey || t.key;
      if (k && keys.indexOf(k) < 0) {
        keys.push(k);
      }
    });
  }
  /* Prioridad: tus portadas de images/portadas/ → carátulas reales de la biblioteca → pósters de ejemplo. */
  var own = typeof HF_PORTADAS !== "undefined" && HF_PORTADAS && HF_PORTADAS.length ? HF_PORTADAS : null;
  var useReal = !own && keys.length >= 6;
  var cols = [];
  var c;
  var k;
  var tiles;
  var n;
  for (c = 0; c < COLS; c += 1) {
    tiles = "";
    for (k = 0; k < PER; k += 1) {
      /* 7 columnas × 4 = 28 tarjetas. Cada columna toma las 4 siguientes de la lista: con 14 portadas cada una
       * sale 2 veces, nunca dos veces en la misma columna ni en columnas vecinas (la 2.ª vez cae 3 columnas más allá). */
      n = c * PER + k;
      tiles += own
        ? '<div class="hf2-tile" style="background-image:url(\'' + esc(encodeURI(own[n % own.length])) + '\')"></div>'
        : useReal
        ?'<div class="hf2-tile hf2-img" data-img="' + esc(keys[n % keys.length]) + '" data-img-w="480">' + HFArt.poster(n % HFArt.POSTER_COUNT) + "</div>"
        : '<div class="hf2-tile">' + HFArt.poster(n % HFArt.POSTER_COUNT) + "</div>";
    }
    cols.push('<div class="hf2-col ' + (opts.still ? "" : (c % 2 ? "down" : "up")) + '"><div class="hf2-reel' + (opts.still ? " still" : "") + '"' +
      (opts.still ? ' style="transform:translate3d(0,-' + ((c * 137) % 400) + 'px,0)"' : "") + ">" + tiles + (opts.still ? "" : tiles) + "</div></div>");
  }
  return '<div class="hf2-wall' + (opts.dim ? " dim" : "") + '">' + cols.join("") + "</div>";
}

function renderSplash() {
  var root = byId("scrSplash");
  root.innerHTML = wallHtml() + '<div class="hf2-shade"></div>' + brandHtml() +
    '<div class="hf2-top-actions"><div class="hf2-round" data-focusable="true" data-action="setup" data-title="Ajustes" data-description="Configurar la conexión con Telegram" tabindex="0">' + IC.gear + "</div></div>" +
    '<div class="hf2-hero"><h1>Disfruta películas y<br>series sin límites.</h1>' +
    "<p>Contenido familiar, series y películas seleccionadas para ver desde tu televisor.</p>" +
    '<div class="hf2-ctas"><div class="hf2-btn primary" data-focusable="true" data-action="login" data-title="Iniciar sesión" data-description="' +
      (telegramUser ? "Continuar como " + esc(telegramUser.name) : "Pulsa OK para iniciar sesión con Telegram") + '" tabindex="0">' + (telegramUser ? "Continuar" : "Iniciar sesión") + "</div></div></div>";
  setAreas([
    { name: "top", items: root.querySelectorAll(".hf2-top-actions [data-focusable]"), dir: "h" },
    { name: "cta", items: root.querySelectorAll(".hf2-ctas [data-focusable]"), dir: "h" }
  ], "cta", 0);
  observeImages(root);
}

function openSplash(message) {
  showRoute("splash");
  renderSplash();
  if (message) {
    updateStatus(message);
  }
}

function handleSplashSelect(el) {
  var action = el.getAttribute("data-action");
  if (action === "setup") {
    showRoute("login");
    cancelLogin();
    showApiForm("", true);
    return;
  }
  if (telegramUser) {
    onTelegramReady(telegramUser);
    return;
  }
  showRoute("login");
  runTelegramLogin();
}

/* ===================== Login con Telegram ===================== */

var loginState = "loading";
var loginRun = 0;
var loginAbort = null;
var passwordResolver = null;
var pendingPasswordError = "";
var loginMessage = "";
var apiFormFromSetup = false;

var REFRESH_ICON = IC.refresh;

function loginPanel(main, side, sideClass) {
  return wallHtml({ dim: true, still: true }) + '<div class="hf2-shade strong"></div>' + brandHtml() +
    '<div class="hf2-panel">' + '<div class="hf2-panel-main">' + main + "</div>" +
    (side ? '<div class="hf2-panel-side' + (sideClass ? " " + sideClass : "") + '">' + side + "</div>" : "") + "</div>";
}

function renderLogin() {
  var root = byId("scrLogin");
  var main;
  var side = "";
  var sideClass = "";
  var api = HFTelegram.credentials();
  if (loginState === "qr") {
    main = (loginMode && loginMode.type === "add" ? '<div class="hf2-kicker">Conectar otra cuenta</div><h1 class="hf2-title">Escanea con el teléfono<br>de la otra cuenta</h1>'
      : loginMode && loginMode.type === "reconnect" ? '<div class="hf2-kicker">Volver a conectar · ' + esc(loginMode.acc.name) + '</div><h1 class="hf2-title">Escanea el código<br>con Telegram</h1>'
      : '<div class="hf2-kicker">Iniciar sesión</div><h1 class="hf2-title">Escanea el código<br>con Telegram</h1>') +
      '<ol class="hf2-steps"><li><span>1</span><div>Abre <b>Telegram</b> en tu teléfono.</div></li>' +
      "<li><span>2</span><div>Ve a <b>Ajustes → Dispositivos</b>.</div></li>" +
      "<li><span>3</span><div>Toca <b>Vincular un dispositivo</b> y apunta la cámara al código.</div></li></ol>" +
      '<div class="hf2-note" id="loginQrNote">' + REFRESH_ICON + "El código se renueva solo cada 30 segundos.</div>" +
      '<div class="hf2-actions"><div class="hf2-btn ghost small" data-focusable="true" data-action="back" data-title="Volver" data-description="Volver a la pantalla inicial" tabindex="0">Volver</div></div>';
    side = '<div class="hf2-qr" id="loginQrBox"><div id="loginQr" style="width:100%;height:100%"></div></div>' +
      '<div class="hf2-qr-caption">Tu cuenta de Telegram es tu biblioteca:<br>nada que crear ni contraseñas que recordar.</div>';
  } else if (loginState === "api") {
    main = '<div class="hf2-kicker">Configurar Telegram</div><h1 class="hf2-title small">' + (apiFormFromSetup ? "Clave de la app<br>de Telegram" : "Telegram pidió una<br>clave nueva") + "</h1>" +
      '<p class="hf2-text">' + (apiFormFromSetup ? "Solo hace falta si Telegram rechazó la clave incluida en HomeFlix." : "Pasa muy pocas veces. Escribe los dos valores de tu app de Telegram y seguimos.") + "</p>" +
      '<div class="hf2-field" data-focusable="true" data-input="apiIdInput" data-title="api_id" data-description="Número de la app de Telegram" tabindex="0"><label>api_id</label><div class="hf2-input"><input id="apiIdInput" type="text" inputmode="numeric" autocomplete="off" placeholder="1234567" value="' + esc(api && api.from !== "build" ? api.id : "") + '"/></div></div>' +
      '<div class="hf2-field" data-focusable="true" data-input="apiHashInput" data-title="api_hash" data-description="Clave de 32 caracteres de la app de Telegram" tabindex="0"><label>api_hash</label><div class="hf2-input"><input id="apiHashInput" type="text" autocomplete="off" spellcheck="false" placeholder="32 caracteres"/></div></div>' +
      '<div class="hf2-error" id="apiError">' + esc(loginMessage) + "</div>" +
      '<div class="hf2-actions"><div class="hf2-btn primary small" data-focusable="true" data-action="save-api" data-title="Guardar y continuar" tabindex="0">Guardar y continuar</div>' +
      '<div class="hf2-btn ghost small" data-focusable="true" data-action="back" data-title="Volver" tabindex="0">Volver</div></div>';
    side = '<div class="hf2-help-title">¿Dónde los consigo?</div><ol class="hf2-steps compact">' +
      "<li><span>1</span><div>Desde el teléfono entra a <b>my.telegram.org</b>.</div></li>" +
      "<li><span>2</span><div>Abre <b>API development tools</b>.</div></li>" +
      "<li><span>3</span><div>Crea una app y copia <b>api_id</b> y <b>api_hash</b>.</div></li></ol>" +
      '<div class="hf2-help-tip">Tip: con Apps2Samsung puedes escribir desde el teclado del teléfono.</div>';
    sideClass = "help";
  } else if (loginState === "password") {
    main = '<div class="hf2-kicker">Verificación en dos pasos</div><h1 class="hf2-title small">Escribe tu contraseña<br>de Telegram</h1>' +
      '<p class="hf2-text">Tu cuenta tiene una contraseña adicional. Escríbela para terminar de entrar.</p>' +
      '<div class="hf2-field" data-focusable="true" data-input="loginPasswordInput" data-title="Contraseña" data-description="Escribe la contraseña de verificación en dos pasos" tabindex="0"><label>Contraseña</label><div class="hf2-input"><input id="loginPasswordInput" type="password" autocomplete="current-password"/></div></div>' +
      '<div class="hf2-error" id="passwordError">' + esc(pendingPasswordError) + "</div>" +
      '<div class="hf2-actions"><div class="hf2-btn primary small" data-focusable="true" data-action="send-password" data-title="Continuar" tabindex="0">Continuar</div>' +
      '<div class="hf2-btn ghost small" data-focusable="true" data-action="toggle-password" data-title="Mostrar contraseña" tabindex="0">Mostrar</div>' +
      '<div class="hf2-btn ghost small" data-focusable="true" data-action="back" data-title="Cancelar" tabindex="0">Cancelar</div></div>';
    pendingPasswordError = "";
  } else if (loginState === "error") {
    main = '<div class="hf2-kicker">Telegram</div><h1 class="hf2-title small">No se pudo conectar</h1>' +
      '<p class="hf2-text">' + esc(loginMessage) + "</p>" +
      '<div class="hf2-actions"><div class="hf2-btn primary small" data-focusable="true" data-action="retry" data-title="Reintentar" tabindex="0">Reintentar</div>' +
      '<div class="hf2-btn ghost small" data-focusable="true" data-action="change-api" data-title="Clave de API" tabindex="0">Clave de API</div>' +
      '<div class="hf2-btn ghost small" data-focusable="true" data-action="back" data-title="Volver" tabindex="0">Volver</div></div>';
  } else {
    main = '<div class="hf2-kicker">Telegram</div><h1 class="hf2-title small">Conectando…</h1><p class="hf2-text">Un momento. HomeFlix usa tu cuenta de Telegram como biblioteca de películas y series.</p>';
  }
  root.innerHTML = loginPanel(main, side, sideClass);
  setAreas([
    { name: "fields", items: root.querySelectorAll(".hf2-field[data-focusable]"), dir: "v" },
    { name: "actions", items: root.querySelectorAll(".hf2-actions [data-focusable]"), dir: "h" }
  ], 0, 0);
}

function setLoginState(nextState) {
  loginState = nextState;
  if (currentRoute === "login") {
    renderLogin();
  }
}

function cancelLogin() {
  loginRun += 1;
  if (loginAbort) {
    loginAbort.abort();
    loginAbort = null;
  }
  passwordResolver = null;
}

function showApiForm(message, fromSetup) {
  loginMessage = message || "";
  apiFormFromSetup = !!fromSetup;
  setLoginState("api");
  updateStatus(message || "Escribe el api_id y el api_hash de tu app de Telegram");
}

function showLoginError(message) {
  loginMessage = message;
  setLoginState("error");
  updateStatus("No se pudo conectar con Telegram");
}

function errorText(e) {
  var message = String((e && e.message) || e || "Error desconocido");
  /* el navegador solo da WebCrypto (lo necesita Telegram) con https o en localhost: pasa al abrir la web por la IP */
  if (/WebCrypto|crypto\.subtle/i.test(message)) {
    return "Telegram necesita una conexión segura. Abre HomeFlix en este mismo equipo con http://localhost (no con la IP ni el nombre del equipo); desde otro dispositivo, ábrelo por https.";
  }
  if (/network|fetch|websocket|sin respuesta/i.test(message)) {
    return "No hay conexión con Telegram. Revisa el internet de la TV y vuelve a intentarlo. (" + message + ")";
  }
  return message;
}

function handleLoginFailure(e) {
  var api;
  if (HFTelegram.rejectedApi(e)) {
    api = HFTelegram.credentials();
    HFTelegram.forgetCredentials();
    showApiForm(api && api.from === "build"
      ? "Telegram ya no acepta la clave incluida en esta versión de HomeFlix. Escribe una propia o instala una versión más nueva."
      : "Telegram no aceptó ese api_id / api_hash. Revísalos en my.telegram.org.");
    return;
  }
  showLoginError(errorText(e));
}

function rememberUser(user) {
  telegramUser = user;
  HFLibrary.setAccount(user.id);
  HFLibrary.rememberAccount({ slot: HFTelegram.slot(), id: user.id, name: user.name, username: user.username }, HFTelegram.MAIN_SLOT);
  loadLibraryFromCache();
  HFSync.start(); // Mi lista, progreso y perfiles iguales en la TV y el celular (js/sync.js)
}

function onTelegramReady(user) {
  var m = loginMode;
  loginMode = null;
  if (m && m.type === "add") {
    finishAddAccount(user, m);
    return;
  }
  if (m && m.type === "reconnect") {
    finishReconnect(user, m);
    return;
  }
  rememberUser(user);
  if (!HFLibrary.enabledSources()) {
    openSettings({ firstTime: true });
    return;
  }
  openProfiles("Hola, " + user.name + ". ¿Quién está viendo?");
}

function startQrLogin(run) {
  loginAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
  HFTelegram.loginQr({
    onUrl: function (url) {
      if (run !== loginRun) {
        return;
      }
      if (loginState !== "qr") {
        setLoginState("qr");
        updateStatus("Esperando que escanees el código…");
      }
      var box = byId("loginQrBox");
      byId("loginQr").innerHTML = HFTelegram.qrSvg(url, 8);
      if (box) {
        box.removeAttribute("data-scanned");
      }
    },
    onScanned: function () {
      if (run !== loginRun) {
        return;
      }
      updateStatus("Código escaneado, entrando…");
      if (byId("loginQrNote")) {
        byId("loginQrNote").innerHTML = IC.check + "Código escaneado, entrando…";
      }
    },
    askPassword: function () {
      return new Promise(function (resolve) {
        if (run !== loginRun) {
          return;
        }
        passwordResolver = resolve;
        setLoginState("password");
      });
    },
    onBadPassword: function () {
      pendingPasswordError = "Contraseña incorrecta. Inténtalo de nuevo.";
    },
    signal: loginAbort ? loginAbort.signal : undefined
  }).then(function (user) {
    if (run === loginRun) {
      onTelegramReady(user);
    }
  }, function (e) {
    if (run === loginRun) {
      handleLoginFailure(e);
    }
  });
}

function runTelegramLogin() {
  var run;
  cancelLogin();
  run = loginRun;
  if (!HFTelegram.available()) {
    showLoginError("No se cargó el motor de Telegram (js/tg.bundle.js).");
    return;
  }
  if (!HFTelegram.credentials()) {
    showApiForm("");
    return;
  }
  setLoginState("loading");
  updateStatus("Conectando con Telegram…");
  HFTelegram.me().then(function (user) {
    if (run !== loginRun) {
      return;
    }
    if (user) {
      onTelegramReady(user);
      return;
    }
    startQrLogin(run);
  }, function (e) {
    if (run === loginRun) {
      handleLoginFailure(e);
    }
  });
}

function saveApiFromForm() {
  var idEl = byId("apiIdInput");
  var hashEl = byId("apiHashInput");
  var problem = HFTelegram.validateCredentials(idEl.value, hashEl.value);
  if (problem) {
    byId("apiError").textContent = problem;
    updateStatus(problem);
    return;
  }
  HFTelegram.saveCredentials(idEl.value, hashEl.value);
  runTelegramLogin();
}

function sendPasswordFromForm() {
  var input = byId("loginPasswordInput");
  var value = input ? input.value : "";
  var resolve = passwordResolver;
  if (!value) {
    byId("passwordError").textContent = "Escribe la contraseña.";
    return;
  }
  if (!resolve) {
    runTelegramLogin();
    return;
  }
  passwordResolver = null;
  setLoginState("loading");
  updateStatus("Verificando contraseña…");
  resolve(value);
}

function handleLoginSelect(el) {
  var action = el.getAttribute("data-action");
  var inputId = el.getAttribute("data-input");
  var input;
  if (inputId) {
    focusInput(byId(inputId));
    updateStatus("Escribe con el teclado de la TV y pulsa Listo");
    return;
  }
  if (action === "save-api") {
    saveApiFromForm();
  } else if (action === "send-password") {
    sendPasswordFromForm();
  } else if (action === "toggle-password") {
    input = byId("loginPasswordInput");
    input.setAttribute("type", input.getAttribute("type") === "password" ? "text" : "password");
    el.textContent = input.getAttribute("type") === "password" ? "Mostrar" : "Ocultar";
  } else if (action === "change-api") {
    cancelLogin();
    showApiForm("", true);
  } else if (action === "retry") {
    runTelegramLogin();
  } else if (action === "back") {
    leaveLogin();
  }
}

/* Volver desde el login: si se estaba conectando otra cuenta, se cancela y se vuelve a los perfiles. */
function leaveLogin() {
  var m = loginMode;
  cancelLogin();
  if (!m) {
    openSplash("Pantalla inicial");
    return;
  }
  loginMode = null;
  if (m.type === "add") {
    HFTelegram.forgetSlot(m.slot);
    switchAccount(m.prev, true);
    openProfiles("No se conectó ninguna cuenta nueva");
  } else {
    switchAccount(accountList()[0], true);
    openProfiles("La cuenta " + m.acc.name + " sigue sin conectar");
  }
}

/* Cierra la sesión de todas las cuentas de Telegram conectadas en esta TV. */
function logoutTelegram() {
  var jobs;
  updateStatus("Cerrando sesión de Telegram…");
  /* primero se guarda en Telegram lo que estaba pendiente de sincronizar */
  HFSync.stop().then(function () {
    jobs = accountList().map(function (a) {
      HFTelegram.useSlot(a.slot);
      return HFTelegram.logout().then(function () { HFTelegram.forgetSlot(a.slot); });
    });
    HFTelegram.useSlot(HFTelegram.MAIN_SLOT);
    return Promise.all(jobs);
  }).then(function () {
    HFLibrary.forgetAllAccounts();
    telegramUser = null;
    activeProfile = null;
    setLibraryItems([]);
    openSplash("Sesión de Telegram cerrada");
  });
}

/* Al abrir la app: si ya hay sesión, el botón principal dice «Continuar». */
function warmUpTelegram() {
  if (!HFTelegram.available() || !HFTelegram.credentials()) {
    return;
  }
  HFTelegram.cleanupSlots(HFLibrary.accounts().map(function (a) { return a.slot; }));
  HFTelegram.me().then(function (user) {
    if (user && !telegramUser) {
      rememberUser(user);
      if (currentRoute === "splash") {
        renderSplash();
      }
    }
  }, function () {
    /* se mostrará el error al entrar al login */
  });
}

/* ===================== Perfiles ===================== */

var profilesEditMode = false;
var logoutArmed = false;

function profileAvatarHtml(p, cls) {
  return '<div class="hf2-avatar pic' + (cls ? " " + cls : "") + '">' + avatarSvg(p.avatar) +
    (p.kids ? '<em class="hf2-kids">' + IC.star + "Infantil</em>" : "") + "</div>";
}

function openProfiles(message, editMode) {
  pruneEmptyAccounts();
  showRoute("profiles");
  renderProfiles(!!editMode);
  if (message) {
    updateStatus(message);
  }
}

/* Estado de la sincronización con el celular (js/sync.js), para la línea de abajo de los perfiles. */
function syncLine() {
  var st = HFSync.status();
  var min;
  if (st.state === "busy") {
    return "Sincronizando con el celular…";
  }
  if (st.state === "error") {
    return "No se pudo sincronizar: " + esc(st.error);
  }
  if (!st.at) {
    return "Sincronización pendiente";
  }
  min = Math.round((Date.now() - st.at) / 60000);
  return "Sincronizado " + (min < 1 ? "hace un momento" : "hace " + min + " min");
}

function renderProfiles(editMode, focusName, focusIndex) {
  var root = byId("scrProfiles");
  var accs = accountList();
  var multi = accs.length > 1;
  var cards;
  var accountLine;
  profilesEditMode = !!editMode;
  logoutArmed = false;
  /* los perfiles de todas las cuentas, cuenta por cuenta (la principal primero) */
  profileEntries = [];
  accs.forEach(function (a) {
    HFLibrary.profilesOf(a.id).forEach(function (p) { profileEntries.push({ p: p, a: a }); });
  });
  cards = profileEntries.map(function (e) {
    var p = e.p;
    var desc = profilesEditMode ? "Editar " + p.name : (p.kids ? p.name + " · perfil infantil" : "Entrar como " + p.name);
    if (multi) {
      desc += " · cuenta " + e.a.name;
    }
    return '<div class="hf2-profile" data-focusable="true" data-profile="' + esc(p.id) + '" data-account="' + esc(e.a.id) + '" data-title="' + esc(p.name) + '" data-description="' + esc(desc) + '" tabindex="0">' +
      profileAvatarHtml(p, profilesEditMode ? "editing" : "") + '<div class="hf2-pname">' + (p.pin ? '<span class="hf2-pname-lock">' + IC.lock + "</span>" : "") + esc(p.name) + "</div>" +
      (multi ? '<div class="hf2-pacc">' + IC.plane + esc(e.a.name) + "</div>" : "") + "</div>";
  });
  accountLine = multi
    ? IC.plane + accs.length + " cuentas de Telegram conectadas: <b>" + accs.map(function (a) { return esc(a.name); }).join("</b>, <b>") + "</b>"
    : IC.plane + "Conectado con Telegram como <b>" + esc(telegramUser ? telegramUser.name : "") + "</b>" + (telegramUser && telegramUser.username ? " · @" + esc(telegramUser.username) : "");
  accountLine += " · " + syncLine();
  if (profileEntries.length < HFLibrary.MAX_TOTAL_PROFILES) {
    cards.push('<div class="hf2-profile" data-focusable="true" data-action="add-profile" data-title="Agregar perfil" data-description="Crear un perfil nuevo" tabindex="0"><div class="hf2-avatar add">+</div><div class="hf2-pname">Agregar</div></div>');
  }
  root.innerHTML = '<div class="hf2-glow"></div>' + brandHtml() +
    '<div class="hf2-top-actions">' +
      '<div class="hf2-round" data-focusable="true" data-action="logout" data-title="Cerrar sesión" data-description="Cerrar la sesión de ' + (multi ? "todas las cuentas" : "Telegram") + ' en esta TV" tabindex="0">' + IC.logout + "</div>" +
    "</div>" +
    '<h1 class="hf2-who">' + (profilesEditMode ? "Elige el perfil que quieres editar" : "¿Quién está viendo?") + "</h1>" +
    '<div class="hf2-profiles">' + cards.join("") + "</div>" +
    '<div class="hf2-center-actions"><div class="hf2-btn ghost small icon" data-focusable="true" data-action="edit-profiles" data-title="Editar perfiles" tabindex="0">' +
      (profilesEditMode ? IC.check + "Listo" : IC.pencil + "Editar perfiles") + "</div></div>" +
    '<div class="hf2-account">' + accountLine + "</div>" +
    '<div class="hf2-version">' + esc(appVersion() ? "HomeFlix v" + appVersion() : "HomeFlix") + "</div>" +
    '<div id="updateBanner" style="position:absolute;left:0;right:0;top:920px;z-index:6"></div>';
  renderUpdateBanner();
  setAreas([
    { name: "top", items: root.querySelectorAll(".hf2-top-actions [data-focusable]"), dir: "h" },
    { name: "profiles", items: root.querySelectorAll(".hf2-profiles [data-focusable]"), dir: "h" },
    { name: "actions", items: root.querySelectorAll(".hf2-center-actions [data-focusable]"), dir: "h" },
    { name: "update", items: root.querySelectorAll("#updateBanner [data-focusable]"), dir: "h" }
  ], focusName || "profiles", focusIndex || 0);
}

function handleProfileSelect(el) {
  var action = el.getAttribute("data-action");
  var id = el.getAttribute("data-profile");
  if (action === "logout") {
    if (!logoutArmed) {
      logoutArmed = true;
      updateStatus(accountList().length > 1 ? "Pulsa OK otra vez para cerrar la sesión de todas las cuentas de Telegram en esta TV" : "Pulsa OK otra vez para cerrar la sesión de Telegram en esta TV");
      return;
    }
    logoutTelegram();
    return;
  }
  logoutArmed = false;
  if (action === "settings") { openSettings({ returnTo: "profiles" }); return; }
  if (action === "edit-profiles") { renderProfiles(!profilesEditMode, "actions", 0); return; }
  if (action === "add-profile") { openAccountPicker(); return; }
  if (action === "hide-update") { dismissUpdate(); renderProfiles(profilesEditMode); return; }
  if (!id) { return; }
  /* cada perfil vive en su cuenta: primero se pasa a esa cuenta de Telegram */
  switchAccount(accountById(el.getAttribute("data-account")));
  if (profilesEditMode) { openProfileEditor(id); return; }
  selectProfile(id);
}

function selectProfile(id) {
  var p = profileById(id);
  if (p && p.pin) {
    askPin({
      mode: "verify",
      profile: p,
      title: "Escribe el PIN de " + p.name,
      onOk: function () { enterProfile(id); },
      onCancel: function () { openProfiles("¿Quién está viendo?"); focusProfileCard(HFLibrary.accountId(), id); }
    });
    return;
  }
  enterProfile(id);
}

function profileById(id) {
  return HFLibrary.profiles().filter(function (p) { return p.id === id; })[0] || null;
}

function focusProfileCard(accId, id) {
  var i = profileEntries.map(function (e) { return String(e.a.id) + "|" + e.p.id; }).indexOf(String(accId) + "|" + id);
  if (i >= 0) {
    focusAreaByName("profiles", i);
  }
}

function enterProfile(id) {
  HFLibrary.profiles().forEach(function (p) {
    if (p.id === id) {
      activeProfile = p;
    }
  });
  HFLibrary.setProfile(activeProfile.id);
  rebuildLibrary();
  openBrowse("home", "Perfil: " + activeProfile.name + (activeProfile.kids ? " (infantil)" : ""));
}

/* ----- Editor de perfil ----- */

var profileEdit = { id: null, name: "", avatar: "panda", kids: false, pin: "" };

/* Editar un perfil con PIN pide primero ese PIN. Perfiles sin PIN (o nuevos) entran directo. */
function openProfileEditor(id) {
  var p = id ? profileById(id) : null;
  if (p && p.pin) {
    askPin({
      mode: "verify",
      profile: p,
      title: "Escribe el PIN actual de " + p.name,
      note: "Hace falta para editar este perfil",
      onOk: function () { showProfileEditor(id); },
      onCancel: function () { openProfiles("", true); focusProfileCard(HFLibrary.accountId(), id); }
    });
    return;
  }
  showProfileEditor(id);
}

function showProfileEditor(id) {
  var list = HFLibrary.profiles();
  var p = null;
  var used = {};
  list.forEach(function (x) {
    used[x.avatar] = true;
    if (x.id === id) {
      p = x;
    }
  });
  profileEdit = p ? { id: p.id, name: p.name, avatar: p.avatar, kids: !!p.kids, pin: p.pin || "" }
    : { id: null, name: "", avatar: (avatarList().filter(function (a) { return !used[a.id]; })[0] || avatarList()[0]).id, kids: false, pin: "" };
  showRoute("profile-edit");
  renderProfileEditor("name", 0);
  updateStatus(p ? "Editando " + p.name : "Escribe el nombre del perfil nuevo");
}

function renderProfileEditor(focusName, focusIndex, error) {
  var root = byId("scrProfileEdit");
  var canDelete = profileEdit.id && (HFLibrary.profiles().length > 1 || !HFLibrary.isMainAccount());
  var acc = accountById(HFLibrary.accountId());
  /* Avatares en 2 filas que se desplazan juntas con ◀ ▶ (una sola pista de columnas): caben todos los que haya.
   * Van por columnas (1-2 arriba/abajo, 3-4, …), así al avanzar aparecen en orden. */
  var list = avatarList();
  var chosen = avatarEffectiveId(profileEdit.avatar);
  var colsHtml = "";
  var r;
  var opt = function (a, row) {
    return '<span class="hf2-avatar-opt' + (a.id === chosen ? " on" : "") + '" data-row="' + row + '" data-focusable="true" data-avatar="' + esc(a.id) + '" data-title="' + esc(a.name) + '" data-description="Imagen: ' + esc(a.name) + ' · OK para elegirla" tabindex="0">' + avatarHtml(a.id) + "</span>";
  };
  for (r = 0; r < list.length; r += 2) {
    colsHtml += '<div class="av-col">' + opt(list[r], 0) + (list[r + 1] ? opt(list[r + 1], 1) : "") + "</div>";
  }
  root.innerHTML = '<div class="hf2-glow"></div>' + brandHtml() +
    '<div class="hf2-panel edit">' +
      '<div class="hf2-edit-preview">' + profileAvatarHtml({ avatar: profileEdit.avatar, kids: profileEdit.kids }, "big") +
        '<div class="hf2-pname">' + esc(profileEdit.name || "Nuevo perfil") + "</div>" +
        '<div class="hf2-preview-note">Así se verá en «¿Quién está viendo?»</div>' +
        (acc ? '<div class="hf2-preview-acc">' + IC.plane + "Cuenta de Telegram<b>" + esc(acc.name) + "</b>" + (acc.username ? "<small>@" + esc(acc.username) + "</small>" : "") + "</div>" : "") + "</div>" +
      '<div class="hf2-panel-main">' +
        '<div class="hf2-kicker">Perfil</div><h1 class="hf2-title small">' + (profileEdit.id ? "Editar perfil" : "Nuevo perfil") + "</h1>" +
        '<div class="hf2-field" data-focusable="true" data-input="profileNameInput" data-title="Nombre" data-description="OK para escribir el nombre" tabindex="0"><label>Nombre</label><div class="hf2-input"><input id="profileNameInput" type="text" maxlength="20" autocomplete="off" value="' + esc(profileEdit.name) + '" placeholder="Nombre del perfil"/></div></div>' +
        '<div class="hf2-field"><label>Imagen de perfil <span class="hf2-label-hint">' + esc(avatarName(chosen)) + "</span>" + (list.length > 12 ? '<span class="hf2-label-more">' + list.length + " imágenes · ◀ ▶ para ver más</span>" : "") + "</label>" +
          '<div class="hf2-avatar-grid scroll"><div class="av-track">' + colsHtml + "</div></div></div>" +
        '<div class="hf2-field-pair">' +
        '<div class="hf2-field" data-focusable="true" data-adjust="kids" data-title="Perfil infantil" data-description="OK: un perfil infantil solo ve lo marcado como infantil" tabindex="0"><label>Perfil infantil</label>' +
          '<div class="hf2-toggle-row"><span class="hf2-toggle' + (profileEdit.kids ? " on" : "") + '"><i></i></span><span>' + (profileEdit.kids ? "Solo lo <b>infantil</b>" : "Ve toda la biblioteca") + "</span></div></div>" +
        '<div class="hf2-field" data-focusable="true" data-action="pin" data-title="PIN de acceso" data-description="' + (profileEdit.pin ? "OK para cambiar o quitar el PIN" : "OK para ponerle un PIN de 4 dígitos") + '" tabindex="0"><label>PIN de acceso</label>' +
          '<div class="hf2-toggle-row"><span class="hf2-pin-chip' + (profileEdit.pin ? " on" : "") + '">' + IC.lock + "</span><span>" + (profileEdit.pin ? "Con PIN <b>●●●●</b>" : "Sin PIN") + "</span></div></div>" +
        "</div>" +
        '<div class="hf2-error">' + esc(error || "") + "</div>" +
        '<div class="hf2-actions">' +
          '<div class="hf2-btn primary small" data-focusable="true" data-action="save" data-title="Guardar" tabindex="0">Guardar</div>' +
          (profileEdit.id ? '<div class="hf2-btn ghost small icon" data-focusable="true" data-action="chats" data-title="Chats del perfil" data-description="Elegir de qué chats salen los videos de este perfil" tabindex="0">' + IC.chat + "Chats</div>" : "") +
          (canDelete ? '<div class="hf2-btn ghost small danger" data-focusable="true" data-action="delete" data-title="Borrar perfil" data-description="Borra el perfil, su progreso y Mi lista" tabindex="0">Borrar</div>' : "") +
          '<div class="hf2-btn ghost small" data-focusable="true" data-action="cancel" data-title="Cancelar" tabindex="0">Cancelar</div>' +
        "</div>" +
      "</div>" +
    "</div>";
  byId("profileNameInput").addEventListener("input", function () {
    profileEdit.name = byId("profileNameInput").value;
  });
  var defs = [{ name: "name", items: root.querySelectorAll('[data-input="profileNameInput"]'), dir: "h" }];
  [0, 1].forEach(function (row) {
    var items = root.querySelectorAll('.av-track [data-row="' + row + '"]');
    if (items.length) {
      defs.push({ name: "av-" + row, items: items, dir: "h", keepColumn: true, track: root.querySelector(".av-track") });
    }
  });
  defs.push({ name: "kids", items: root.querySelectorAll(".hf2-field-pair > [data-focusable]"), dir: "h" });
  /* El avatar elegido manda: al entrar a las filas desde arriba o abajo el foco cae en su columna, y si el foco
   * está fuera de los avatares la pista arranca mostrándolo. */
  setTimeout(function () {
    var onEl = root.querySelector(".av-track .hf2-avatar-opt.on");
    var col = onEl ? toArray(onEl.parentNode.parentNode.children).indexOf(onEl.parentNode) : -1;
    if (col < 0) {
      return;
    }
    areas.forEach(function (a) {
      if (a.name.indexOf("av-") !== 0) {
        return;
      }
      areaMemory["profile-edit:" + a.name] = Math.min(col, a.count - 1);
      if (currentArea() && currentArea().track !== a.track) {
        setTrackOffset(a, Math.max(0, Math.min(a.total + 40 - a.viewSize, a.pos[Math.min(col, a.count - 1)][0] - 88)));
      }
    });
  }, 0);
  defs.push({ name: "actions", items: root.querySelectorAll(".hf2-actions [data-focusable]"), dir: "h" });
  setAreas(defs, focusName || "name", focusIndex || 0);
}

function profileEditRefocus() {
  var a = currentArea();
  return { name: a ? a.name : "name", index: state.itemIndex };
}

/* Vuelve al editor tal como estaba (por ejemplo, después de elegir los chats del perfil). */
function returnToProfileEditor(message, focusName, focusIndex) {
  showRoute("profile-edit");
  renderProfileEditor(focusName || "actions", focusName ? focusIndex || 0 : 1);
  if (message) {
    updateStatus(message);
  }
}

function handleProfileEditSelect(el) {
  var action = el.getAttribute("data-action");
  var avatarId = el.getAttribute("data-avatar");
  var res;
  var f;
  if (el.getAttribute("data-input")) { focusInput(byId(el.getAttribute("data-input"))); return; }
  if (avatarId) {
    profileEdit.avatar = avatarId;
    f = profileEditRefocus();
    renderProfileEditor(f.name, f.index);
    updateStatus("Imagen: " + avatarName(avatarId));
    return;
  }
  if (el.getAttribute("data-adjust") === "kids") {
    profileEdit.kids = !profileEdit.kids;
    renderProfileEditor("kids", 0);
    return;
  }
  if (action === "pin") {
    profileEdit.name = byId("profileNameInput").value;
    askPin({
      mode: "set",
      profile: { name: String(profileEdit.name || "").trim() || "Nuevo perfil", avatar: profileEdit.avatar, kids: profileEdit.kids },
      title: profileEdit.pin ? "Escribe el PIN nuevo" : "Elige un PIN de 4 dígitos",
      canRemove: !!profileEdit.pin,
      onOk: function (pin) {
        profileEdit.pin = pin;
        returnToProfileEditor(pin ? "PIN listo. Pulsa Guardar para aplicarlo." : "PIN quitado. Pulsa Guardar para aplicarlo.", "kids", 1);
      },
      onCancel: function () { returnToProfileEditor("", "kids", 1); }
    });
    return;
  }
  if (action === "chats") {
    profileEdit.name = byId("profileNameInput").value;
    openSettings({ returnTo: "profile-edit", profile: { id: profileEdit.id, name: String(profileEdit.name || "").trim() || "este perfil" } });
    return;
  }
  if (action === "save") {
    profileEdit.name = byId("profileNameInput").value;
    res = HFLibrary.saveProfile({ id: profileEdit.id, name: profileEdit.name, avatar: profileEdit.avatar, kids: profileEdit.kids, pin: profileEdit.pin || "" });
    if (res.error) {
      renderProfileEditor("name", 0, res.error);
      updateStatus(res.error);
      return;
    }
    if (activeProfile && activeProfile.id === profileEdit.id) {
      activeProfile = profileById(profileEdit.id) || activeProfile;
      applyProfileView();
    }
    openProfiles("Perfil guardado", true);
  } else if (action === "delete") {
    if (el.getAttribute("data-confirm") !== "true") {
      el.setAttribute("data-confirm", "true");
      el.textContent = "¿Seguro? OK otra vez";
      updateStatus("Pulsa OK otra vez para borrar el perfil con su progreso y Mi lista");
      return;
    }
    HFLibrary.deleteProfile(profileEdit.id);
    if (activeProfile && activeProfile.id === profileEdit.id) {
      activeProfile = null;
    }
    openProfiles("Perfil borrado", true);
  } else if (action === "cancel") {
    openProfiles("", true);
  }
}

/* ===================== PIN de acceso =====================
 * askPin({mode: "verify"|"set", profile, title, note, canRemove, onOk(pin), onCancel})
 *  - verify: pide el PIN guardado del perfil (profile.pin) y llama onOk() si coincide.
 *  - set: pide uno nuevo dos veces (escribir y repetir) y llama onOk(pin); con canRemove ofrece «Quitar PIN» → onOk("").
 * Se escribe con los números del control o con el teclado en pantalla. */

var pinFlow = null;

function askPin(opts) {
  pinFlow = {
    mode: opts.mode, step: opts.mode === "set" ? "new" : "verify", profile: opts.profile, title: opts.title, note: opts.note || "",
    canRemove: !!opts.canRemove, onOk: opts.onOk, onCancel: opts.onCancel, entered: "", first: "", error: ""
  };
  showRoute("pin");
  renderPin("pad", 4);
}

function renderPin(focusName, focusIndex) {
  var root = byId("scrPin");
  var f = pinFlow;
  var dots = "";
  var keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "cancel"];
  var i;
  var pad;
  var defs;
  var title = f.step === "repeat" ? "Repite el PIN" : f.title;
  var note = f.error || (f.step === "repeat" ? "Para confirmar que lo escribiste bien" : f.note || "Usa los números del control o el teclado de abajo");
  for (i = 0; i < 4; i += 1) {
    dots += '<i class="' + (i < f.entered.length ? "on" : "") + '"></i>';
  }
  root.innerHTML = '<div class="hf2-glow"></div>' + brandHtml() +
    '<div class="hf2-pin">' +
      profileAvatarHtml({ avatar: f.profile.avatar, kids: f.profile.kids }, "") +
      '<div class="hf2-pin-name">' + esc(f.profile.name || "") + "</div>" +
      '<h1 class="hf2-pin-title">' + esc(title) + "</h1>" +
      '<div class="hf2-pin-note' + (f.error ? " error" : "") + '">' + esc(note) + "</div>" +
      '<div class="hf2-pin-dots">' + dots + "</div>" +
      '<div class="hf2-pin-pad">' + keys.map(function (k) {
        var label = k === "del" ? "Borrar" : k === "cancel" ? "Cancelar" : k;
        var desc = k === "del" ? "Borrar el último número" : k === "cancel" ? "Volver sin cambiar nada" : "Número " + k;
        return '<span class="hf2-pin-key' + (k.length > 1 ? " small" : "") + '" data-focusable="true" data-pin-key="' + k + '" data-title="' + esc(label) + '" data-description="' + esc(desc) + '" tabindex="0">' + esc(label) + "</span>";
      }).join("") + "</div>" +
      (f.mode === "set" && f.canRemove ? '<div class="hf2-actions center"><span class="hf2-btn ghost small danger" data-focusable="true" data-pin-key="remove" data-title="Quitar PIN" data-description="El perfil quedará sin PIN" tabindex="0">Quitar PIN</span></div>' : "") +
    "</div>";
  pad = toArray(root.querySelectorAll(".hf2-pin-pad [data-focusable]"));
  defs = [0, 1, 2, 3].map(function (r) {
    return { name: "pad-" + r, items: pad.slice(r * 3, r * 3 + 3), dir: "h", keepColumn: true };
  });
  defs.push({ name: "extra", items: root.querySelectorAll(".hf2-actions [data-focusable]"), dir: "h" });
  /* "pad" + índice 0–11 sobre el teclado entero */
  if (focusName === "pad") {
    setAreas(defs, "pad-" + Math.floor((focusIndex || 0) / 3), (focusIndex || 0) % 3);
  } else {
    setAreas(defs, focusName || "pad-1", focusIndex || 0);
  }
}

function pinRefocus() {
  var a = currentArea();
  if (a && a.name.indexOf("pad-") === 0) {
    return { name: "pad", index: Number(a.name.slice(4)) * 3 + state.itemIndex };
  }
  return { name: a ? a.name : "pad", index: a ? state.itemIndex : 4 };
}

function pinDigit(d) {
  var f = pinFlow;
  var r;
  if (!f || f.entered.length >= 4) {
    return;
  }
  f.entered += d;
  f.error = "";
  r = pinRefocus();
  renderPin(r.name, r.index);
  if (f.entered.length === 4) {
    setTimeout(pinComplete, 150);
  }
}

function pinComplete() {
  var f = pinFlow;
  var r;
  if (!f || currentRoute !== "pin" || f.entered.length < 4) {
    return;
  }
  r = pinRefocus();
  if (f.step === "verify") {
    if (f.entered === String(f.profile.pin)) {
      pinFlow = null;
      f.onOk();
      return;
    }
    f.error = "PIN incorrecto. Inténtalo otra vez.";
  } else if (f.step === "new") {
    f.first = f.entered;
    f.step = "repeat";
  } else if (f.entered === f.first) {
    pinFlow = null;
    f.onOk(f.first);
    return;
  } else {
    f.step = "new";
    f.first = "";
    f.error = "Los PIN no coinciden. Escríbelo de nuevo.";
  }
  f.entered = "";
  renderPin(r.name, r.index);
  updateStatus(f.error || "Repite el PIN");
}

function pinBackspace() {
  var r;
  if (!pinFlow || !pinFlow.entered) {
    return;
  }
  pinFlow.entered = pinFlow.entered.slice(0, -1);
  r = pinRefocus();
  renderPin(r.name, r.index);
}

function cancelPin() {
  var f = pinFlow;
  pinFlow = null;
  if (f && f.onCancel) {
    f.onCancel();
  }
}

function handlePinSelect(el) {
  var k = el.getAttribute("data-pin-key");
  var f = pinFlow;
  if (!f || !k) {
    return;
  }
  if (k === "del") { pinBackspace(); return; }
  if (k === "cancel") { cancelPin(); return; }
  if (k === "remove") { pinFlow = null; f.onOk(""); return; }
  pinDigit(k);
}

/* Números del control (0–9), teclado numérico y la tecla de borrar del teclado: true si la tecla se usó. */
function handlePinKey(code) {
  if (code >= 48 && code <= 57) { pinDigit(String(code - 48)); return true; }
  if (code >= 96 && code <= 105) { pinDigit(String(code - 96)); return true; }
  if (code === 8) { pinBackspace(); return true; }
  return false;
}

/* ===================== Varias cuentas de Telegram =====================
 * En la TV puede haber más de una cuenta de Telegram conectada. Cada perfil pertenece a una cuenta y solo ve
 * los chats y videos de esa cuenta. «¿Quién está viendo?» muestra los perfiles de todas, y al elegir uno
 * la app pasa a su cuenta (sesión de Telegram, biblioteca en caché, chats y etiquetas).
 * Al crear un perfil se elige la cuenta: una ya conectada o una nueva (código QR con el teléfono de esa cuenta). */

var loginMode = null;        // null | {type: "add", slot, prev} | {type: "reconnect", acc}
var profileEntries = [];     // [{p: perfil, a: cuenta}] en el orden de la pantalla de perfiles

function accountList() {
  var list = HFLibrary.accounts();
  if (!list.length && telegramUser) {
    list = [{ slot: HFTelegram.MAIN_SLOT, id: String(telegramUser.id), name: telegramUser.name, username: telegramUser.username || "" }];
  }
  return list;
}

function accountById(id) {
  return accountList().filter(function (a) { return String(a.id) === String(id); })[0] || null;
}

/* Pasa a otra cuenta. force: aunque parezca la misma (por ejemplo, después de quitar una). */
function switchAccount(acc, force) {
  var slotName;
  if (!acc) {
    return;
  }
  if (!force && String(acc.id) === HFLibrary.accountId() && HFTelegram.slot() === acc.slot) {
    return;
  }
  HFTelegram.useSlot(acc.slot);
  telegramUser = { id: acc.id, name: acc.name, username: acc.username };
  HFLibrary.setAccount(acc.id);
  activeProfile = null;
  settings.dialogs = null;
  settings.counts = {};
  loadLibraryFromCache();
  HFSync.start();
  /* en segundo plano: ¿sigue abierta la sesión de esa cuenta? (la pueden cerrar desde el teléfono) */
  slotName = acc.slot;
  HFTelegram.me().then(function (u) {
    if (HFTelegram.slot() !== slotName) {
      return;
    }
    if (u) {
      HFLibrary.rememberAccount({ slot: slotName, id: u.id, name: u.name, username: u.username }, HFTelegram.MAIN_SLOT);
    } else {
      reconnectAccount(acc);
    }
  }, function () {
    /* sin conexión: los errores se verán al sincronizar */
  });
}

/* La sesión de una cuenta se cerró (desde el teléfono, por ejemplo): pedir el QR otra vez para esa cuenta. */
function reconnectAccount(acc) {
  loginMode = { type: "reconnect", acc: acc };
  showRoute("login");
  runTelegramLogin();
  updateStatus("La cuenta " + acc.name + " cerró sesión en esta TV. Escanea el código con esa cuenta para volver a conectarla.");
}

function finishReconnect(user, m) {
  if (String(user.id) !== String(m.acc.id)) {
    HFTelegram.logout().then(function () {
      loginMode = m;
      showLoginError("Escaneaste el código con otra cuenta (" + user.name + "). Escanéalo con la cuenta " + m.acc.name + ".");
    });
    return;
  }
  rememberUser(user);
  openProfiles("Cuenta " + user.name + " conectada de nuevo");
}

/* ----- Elegir la cuenta del perfil nuevo ----- */

function openAccountPicker() {
  showRoute("accounts");
  renderAccountPicker();
  updateStatus("¿En qué cuenta de Telegram va el perfil nuevo?");
}

function renderAccountPicker() {
  var root = byId("scrAccounts");
  var accs = accountList();
  var rows = accs.map(function (a, i) {
    var n = HFLibrary.profilesOf(a.id).length;
    var full = n >= HFLibrary.MAX_PROFILES;
    return '<div class="hf2-acc-row' + (full ? " full" : "") + '" data-focusable="true" data-account="' + esc(a.id) + '" data-title="' + esc(a.name) + '" data-description="' +
        esc(full ? "La cuenta " + a.name + " ya tiene " + n + " perfiles (el máximo)" : "Crear el perfil nuevo en la cuenta " + a.name) + '" tabindex="0">' +
      '<span class="hf2-acc-badge">' + esc(String(a.name || "?").charAt(0).toUpperCase()) + "</span>" +
      '<span class="hf2-acc-name"><b>' + esc(a.name) + "</b><small>" + (a.username ? "@" + esc(a.username) + " · " : "") + n + (n === 1 ? " perfil" : " perfiles") + "</small></span>" +
      (i === 0 ? '<span class="hf2-acc-tag">Principal</span>' : "") + "</div>";
  });
  rows.push('<div class="hf2-acc-row add" data-focusable="true" data-action="connect" data-title="Conectar otra cuenta" data-description="Escanea un código QR con el teléfono de la otra cuenta" tabindex="0">' +
    '<span class="hf2-acc-badge">+</span><span class="hf2-acc-name"><b>Conectar otra cuenta de Telegram</b><small>Sus perfiles verán solo los chats y videos de esa cuenta</small></span></div>');
  root.innerHTML = '<div class="hf2-glow"></div>' + brandHtml() +
    '<div class="hf2-accpick">' +
      '<div class="hf2-kicker">Perfil nuevo</div><h1 class="hf2-title small">¿En qué cuenta de Telegram va el perfil?</h1>' +
      '<p class="hf2-text wide">Cada cuenta tiene sus propios chats y videos. Un perfil solo ve lo de su cuenta.</p>' +
      '<div class="hf2-acc-list">' + rows.join("") + "</div>" +
      '<div class="hf2-actions"><div class="hf2-btn ghost small" data-focusable="true" data-action="cancel" data-title="Cancelar" tabindex="0">Cancelar</div></div>' +
    "</div>";
  setAreas([
    { name: "list", items: root.querySelectorAll(".hf2-acc-list [data-focusable]"), dir: "v" },
    { name: "actions", items: root.querySelectorAll(".hf2-actions [data-focusable]"), dir: "h" }
  ], "list", 0);
}

function handleAccountsSelect(el) {
  var action = el.getAttribute("data-action");
  var acc;
  if (action === "cancel") { openProfiles("¿Quién está viendo?"); return; }
  if (action === "connect") { startAddAccount(); return; }
  acc = accountById(el.getAttribute("data-account"));
  if (!acc) {
    return;
  }
  if (HFLibrary.profilesOf(acc.id).length >= HFLibrary.MAX_PROFILES) {
    updateStatus("La cuenta " + acc.name + " ya tiene el máximo de " + HFLibrary.MAX_PROFILES + " perfiles");
    return;
  }
  switchAccount(acc);
  showProfileEditor(null);
}

/* ----- Conectar una cuenta nueva ----- */

function startAddAccount() {
  var prev = accountById(HFLibrary.accountId()) || accountList()[0];
  var slotName = HFTelegram.newSlotName();
  loginMode = { type: "add", slot: slotName, prev: prev };
  HFTelegram.useSlot(slotName);
  showRoute("login");
  runTelegramLogin();
}

function finishAddAccount(user, m) {
  var existing = accountById(user.id);
  if (existing) {
    /* esa cuenta ya estaba: se cierra la sesión repetida y el perfil nuevo va en la que ya estaba */
    HFTelegram.logout().then(function () {
      HFTelegram.forgetSlot(m.slot);
      switchAccount(existing, true);
      showProfileEditor(null);
      updateStatus("Esa cuenta ya estaba conectada: el perfil nuevo queda en la cuenta " + existing.name);
    });
    return;
  }
  rememberUser(user);
  activeProfile = null;
  settings.dialogs = null;
  settings.counts = {};
  if (HFLibrary.profiles().length) {
    openProfiles("Cuenta " + user.name + " conectada");
    return;
  }
  showProfileEditor(null);
  updateStatus("Cuenta " + user.name + " conectada. Crea su primer perfil.");
}

/* ----- Quitar cuentas que se quedaron sin perfiles ----- */

function removeAccount(a) {
  var cur = HFTelegram.slot();
  var p;
  HFLibrary.forgetAccount(a.slot);
  HFTelegram.useSlot(a.slot);
  p = HFTelegram.logout();
  HFTelegram.useSlot(cur === a.slot ? HFTelegram.MAIN_SLOT : cur);
  p.then(function () { HFTelegram.forgetSlot(a.slot); });
}

/* Una cuenta agregada sin perfiles (se borró el último, o se canceló el primero) se desconecta de la TV. */
function pruneEmptyAccounts() {
  var accs = HFLibrary.accounts();
  accs.slice(1).forEach(function (a) {
    if (!HFLibrary.profilesOf(a.id).length) {
      removeAccount(a);
    }
  });
  accs = HFLibrary.accounts();
  if (accs.length && !accountById(HFLibrary.accountId())) {
    switchAccount(accs[0], true);
  }
}
