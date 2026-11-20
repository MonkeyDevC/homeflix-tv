/* HomeFlix · Preparador · biblioteca.
 *
 * Antes de las pestañas: entrar con Telegram (QR o número), elegir el chat y ver en Inicio todas las películas y
 * series del chat, como en la TV, pero para saber qué le falta a cada una:
 *   - calidades: cuáles de 4K, 1080p, 720p y 360p ya están en el grupo,
 *   - idioma: si tiene audio o subtítulos en español (se lee el encabezado del archivo, unos pocos MB, y ffprobe en
 *     el PC dice las pistas; se guarda en este navegador para no volver a leerlo),
 *   - imágenes: portada y banner que no son horizontales o son muy pequeñas.
 * La ficha de cada una muestra el detalle y «Preparar lo que falta» llena la pestaña 1 y marca solo esas calidades.
 *
 * Usa lo que expone ui.html en window.PREP (el cliente de Telegram del preparador, el chat donde se publica y las
 * pestañas) y HFLibrary (js/library.js) para juntar las versiones de cada título igual que la app. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function gb(b) { return b >= 1073741824 ? (b / 1073741824).toFixed(1).replace(".", ",") + " GB" : Math.round(b / 1048576) + " MB"; }
  function fmtDur(s) { s = Math.round((s || 0) / 60); return s >= 60 ? Math.floor(s / 60) + " h " + (s % 60) + " min" : s + " min"; }
  function fecha(ms) { return ms ? new Date(ms).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) : ""; }
  function store(k, v) {
    try {
      if (v === undefined) { return localStorage.getItem(k); }
      if (v === null) { localStorage.removeItem(k); } else { localStorage.setItem(k, v); }
    } catch (e) { /* sin almacenamiento */ }
    return null;
  }

  var LS_CHAT = "hf.preparador.chat";
  var LS_ME = "hf.preparador.me";
  var LS_CHATNAME = "hf.preparador.chatNombre";
  var LS_LANG = "hf.preparador.idiomas";
  var LS_CARDS = "hf.preparador.tarjetas"; // forma de las tarjetas de Inicio: "h" horizontal, "v" vertical
  var VIDEO = { _: "inputMessagesFilterVideo" };
  var DOCS = { _: "inputMessagesFilterDocument" };
  var PHOTOS = { _: "inputMessagesFilterPhotos" };
  var VIDEO_EXT = /\.(mkv|webm|mp4|m4v|mov)$/i;
  var QS = [["4K", "2160"], ["1080p", "1080"], ["720p", "720"], ["360p", "360"]];
  var HOME_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7"></path><path d="M5 10v10h14V10"></path></svg>';

  var B = {
    view: "", client: null, me: null,
    chats: null, counts: {}, oldOf: {},
    peer: null, oldPeer: null,
    items: [], msgs: {}, byKey: {}, lib: null, titles: [], reading: false, readError: "",
    filter: "todas", q: "", cat: "", pop: "", sort: { k: "name", dir: 1 }, sel: null,
    login: { step: "qr", phone: "", hash: "", hint: "", busy: false, error: "", qrAbort: null, pwdWait: null },
    langs: {}, langQueue: [], langBusy: false, langDone: 0, langTotal: 0,
    thumbs: {}, thumbQueue: [], thumbBusy: 0,
    syncing: false, msgsReady: false, readGen: 0, lastSync: 0, fromCache: false, cacheAt: 0, painted: ""
  };
  try { B.langs = JSON.parse(store(LS_LANG) || "{}") || {}; } catch (e) { B.langs = {}; }

  /* ===================== pantallas ===================== */
  function show(view) {
    B.view = view;
    B.pop = "";
    var lib = view !== "tabs";
    document.body.classList.toggle("lib-on", lib);
    document.body.classList.toggle("img-on", view === "imagenes"); // «Portadas y banners»: una sola pantalla, sin scroll general
    document.body.classList.toggle("home-on", view === "inicio"); // Inicio: igual, solo se desplaza la cuadrícula
    document.body.classList.toggle("tm-on", view === "temas" || view === "importar"); // «importar» comparte el diseño de Migrar / Respaldo
    document.body.classList.toggle("fi-on", view === "ficha"); // ficha: sin scroll general (solo por dentro si no cabe)
    $("lib").classList.toggle("hidden", !lib);
    $("acct").classList.toggle("hidden", !B.me);
    $("goHome").classList.toggle("on", lib);
    if (lib) { render(); window.scrollTo(0, 0); }
  }

  function render() {
    var html = B.view === "conectando" ? viewConnecting() : B.view === "acceso" ? viewLogin() : B.view === "chats" ? viewChats() :
      B.view === "ficha" ? viewFicha() : B.view === "imagenes" ? viewImagenes() : B.view === "temas" ? viewTemas() : B.view === "importar" ? viewImportar() : viewInicio();
    /* «Portadas y banners» se desplaza por dentro (la lista y el panel): al redibujar se conserva dónde se estaba, salvo que cambie de
     * sección o filtro (lista) o de imagen elegida (panel). */
    var lst0 = $("lib").querySelector(".ilist");
    var pan0 = $("lib").querySelector(".s6 > section:last-child");
    var tmL0 = $("lib").querySelector(".tmlist");
    var tmC0 = $("lib").querySelector(".tmleft");
    var keepTm = (B.view === "temas" || B.view === "importar") && tmL0 ? { l: tmL0.scrollTop, c: tmC0 ? tmC0.scrollTop : 0 } : null;
    var grid0 = $("lib").querySelector(".pgrid");
    var keepG = grid0 && B.view === "inicio" ? { s: grid0.scrollTop, k: grid0.getAttribute("data-k") } : null;
    var keep = lst0 && B.view === "imagenes" ? { l: lst0.scrollTop, lk: lst0.getAttribute("data-k"), p: pan0 ? pan0.scrollTop : 0, pk: pan0 ? pan0.getAttribute("data-sel") : "" } : null;
    $("lib").innerHTML = html;
    document.body.classList.toggle("img-on", B.view === "imagenes");
    document.body.classList.toggle("home-on", B.view === "inicio");
    document.body.classList.toggle("tm-on", B.view === "temas" || B.view === "importar");
    document.body.classList.toggle("fi-on", B.view === "ficha");
    if (B.view === "imagenes") { restoreImgScroll(keep); }
    fitPops();
    if (B.view === "importar" && IM.view === "vista") { imLoadThumbs(); }
    if (keepTm) { var tmL1 = $("lib").querySelector(".tmlist"); var tmC1 = $("lib").querySelector(".tmleft"); if (tmL1) { tmL1.scrollTop = keepTm.l; } if (tmC1) { tmC1.scrollTop = keepTm.c; } }
    if (keepG) { var g1 = $("lib").querySelector(".pgrid"); if (g1 && g1.getAttribute("data-k") === keepG.k) { g1.scrollTop = keepG.s; } }
    if (B.view === "acceso" && B.login.step === "qr") { startQr(); }
    if (B.view === "inicio") { watchThumbs(); }
    if (B.view === "ficha" || B.view === "imagenes") { watchThumbs(); }
    paintAcct();
  }

  function restoreImgScroll(keep) {
    var lst = $("lib").querySelector(".ilist");
    var pan = $("lib").querySelector(".s6 > section:last-child");
    var on = lst && lst.querySelector(".irow.on");
    var a;
    var b;
    if (lst && keep && keep.lk === lst.getAttribute("data-k")) { lst.scrollTop = keep.l; }
    if (pan && keep && keep.pk === pan.getAttribute("data-sel")) { pan.scrollTop = keep.p; }
    /* la imagen elegida siempre a la vista (al pasar a la siguiente después de reemplazar una, por ejemplo) */
    if (lst && on) {
      a = on.offsetTop - lst.offsetTop;
      b = a + on.offsetHeight;
      if (a < lst.scrollTop) { lst.scrollTop = Math.max(0, a - 8); }
      else if (b > lst.scrollTop + lst.clientHeight) { lst.scrollTop = b - lst.clientHeight + 8; }
    }
  }


  /* Los menús desplegables (Herramientas, Categoría, Más) se acomodan para no salirse de la pantalla */
  function fitPops() {
    Array.prototype.forEach.call(document.querySelectorAll(".hpop"), function (p) {
      var r;
      p.style.maxHeight = "";
      r = p.getBoundingClientRect();
      if (r.right > window.innerWidth - 8) { p.classList.add("right"); r = p.getBoundingClientRect(); }
      if (r.left < 8) { p.classList.remove("right"); }
      r = p.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 8) { p.style.maxHeight = Math.max(160, window.innerHeight - r.top - 12) + "px"; }
    });
  }

  function paintAcct() {
    var p = B.peer;
    var name = p ? (p.isSelf ? "Mensajes guardados" : (p.title || p.displayName)) : (B.me ? (B.me.displayName || "") : "");
    $("acctChat").textContent = name;
    $("acctAv").textContent = String((B.me && (B.me.firstName || B.me.displayName)) || "?").charAt(0).toUpperCase();
  }

  function viewConnecting() {
    return '<div class="lib-center"><div class="lib-spin"></div><b>Conectando con Telegram…</b></div>';
  }

  /* ===================== entrar con Telegram ===================== */
  var FEATS = '<ul class="feats">' +
    '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M7 15l3-3 2 2 3-4 2 3"></path></svg><span><b>Qué calidades faltan</b>Las que solo tienen 1080p y les falta 4K, 720p o 360p.</span></li>' +
    '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h9"></path><path d="M8.5 3v2"></path><path d="M6 5c1 4 4 7 7 8"></path><path d="M11 5c-1 4-4 7-7 8"></path><path d="M13 21l4-9 4 9"></path><path d="M14.5 18h5"></path></svg><span><b>Cuáles no están en español</b>Sin audio ni subtítulos en español, para darles una solución.</span></li>' +
    '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="7" rx="1"></rect><rect x="14" y="4" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg><span><b>Portadas y banners por revisar</b>Los que no son horizontales o son muy pequeños.</span></li>' +
    "</ul>";

  function viewLogin() {
    var L = B.login;
    var qr = L.step === "qr";
    var body;
    if (qr) {
      body = '<div class="qrbox2"><div class="qr" id="qr"><div class="lib-spin"></div></div><ol><li>Abre Telegram en el teléfono.</li><li>Ajustes → Dispositivos → <b>Vincular un dispositivo</b>.</li><li>Apunta la cámara a este código.</li></ol></div>' +
        '<div class="lmsg" id="qrMsg">' + esc(L.error) + "</div>";
    } else if (L.step === "telefono") {
      body = '<div class="ph"><div><label for="lCc">País</label><input type="text" id="lCc" value="' + esc(L.cc || "+57") + '"></div>' +
        '<div><label for="lPhone">Número</label><input type="text" id="lPhone" inputmode="tel" placeholder="300 123 4567" value="' + esc(L.num || "") + '"></div></div>' +
        '<div class="lmsg bad">' + esc(L.error) + "</div>" +
        '<button class="primary block" data-act="send-code"' + (L.busy ? " disabled" : "") + ">" + (L.busy ? "Enviando…" : "Enviar código") + "</button>";
    } else if (L.step === "codigo") {
      body = '<label for="lCode">Código que te llegó a Telegram · ' + esc(L.phone) + '</label><input type="text" id="lCode" class="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="•••••">' +
        '<div class="lmsg bad">' + esc(L.error) + "</div>" +
        '<div class="row"><button class="ghost" data-act="login-phone">← Cambiar número</button><button class="primary grow" data-act="check-code"' + (L.busy ? " disabled" : "") + ">" + (L.busy ? "Revisando…" : "Entrar") + "</button></div>";
    } else {
      body = '<label for="lPwd">Tu cuenta tiene verificación en dos pasos · escribe tu clave</label><input type="password" id="lPwd" placeholder="Clave de Telegram">' +
        (L.hint ? '<div class="hint" style="margin-top:6px">Pista: ' + esc(L.hint) + "</div>" : "") +
        '<div class="lmsg bad">' + esc(L.error) + "</div>" +
        '<button class="primary block" data-act="check-pwd"' + (L.busy ? " disabled" : "") + ">" + (L.busy ? "Revisando…" : "Entrar") + "</button>";
    }
    return '<div class="login"><div class="pitch"><img class="bigmark" src="/logo.png" alt=""><h1>Prepara y revisa<br>las películas de <span>HomeFlix</span></h1>' +
      "<p>Entra con la cuenta de Telegram que publica en el grupo. Verás todas las películas del chat, igual que en la TV, y qué le falta a cada una.</p>" + FEATS + "</div>" +
      '<section class="logincard"><h2>Entra con tu Telegram</h2><div class="hint">Solo la primera vez; la sesión queda guardada en este equipo.</div>' +
      '<div class="seg" style="margin:16px 0 4px"><button data-act="login-qr" class="' + (qr ? "on" : "") + '">Código QR</button><button data-act="login-phone" class="' + (qr ? "" : "on") + '">Número de teléfono</button></div>' +
      body + '<div class="loginfoot">Al entrar sigues al chat que quieres revisar. La clave de Telegram nunca se guarda.</div></section></div>';
  }

  function startQr() {
    var L = B.login;
    var c = B.client;
    if (L.qrAbort || !c) { return; }
    L.qrAbort = new AbortController();
    var mine = L.qrAbort;
    c.signInQr({
      onUrlUpdated: function (url) { if ($("qr")) { $("qr").innerHTML = TGLib.qrSvg(url, 6); } },
      onQrScanned: function () { if ($("qrMsg")) { $("qrMsg").textContent = "Código escaneado, entrando…"; } },
      password: function () {
        L.qrAbort = null;
        L.step = "clave";
        L.error = "";
        hint().then(function (h) { L.hint = h; if (B.view === "acceso") { render(); } });
        render();
        return new Promise(function (ok) { L.pwdWait = ok; });
      },
      invalidPasswordCallback: function () {
        L.busy = false;
        L.error = "Esa clave no es correcta. Inténtalo otra vez.";
        render();
      },
      abortSignal: mine.signal
    }).then(function (u) {
      L.qrAbort = null;
      L.pwdWait = null;
      loggedIn(u);
    }, function (e) {
      if (mine.signal.aborted) { return; }
      L.qrAbort = null;
      if (dupRecover(e)) { return; } // el QR es el paso por defecto: también aquí hay que limpiar la sesión dañada
      L.error = "No se pudo entrar: " + HFTelegram.loginError(e);
      if (B.view === "acceso" && L.step === "qr") { setTimeout(function () { if (B.view === "acceso" && L.step === "qr") { render(); } }, 3000); }
      if ($("qrMsg")) { $("qrMsg").textContent = L.error; }
    });
  }
  function stopQr() {
    if (B.login.qrAbort) { B.login.qrAbort.abort(); B.login.qrAbort = null; }
  }
  function hint() {
    return B.client.call({ _: "account.getPassword" }).then(function (p) { return (p && p.hint) || ""; }, function () { return ""; });
  }

  function loggedIn(u) {
    var L = B.login;
    try { window.sessionStorage.removeItem("hf.dup2"); } catch (x) { /* nada */ }
    L.step = "qr"; L.busy = false; L.error = ""; L.hash = ""; L.hint = "";
    B.me = u;
    PREP.setMe(u);
    store(LS_ME, String(u.id));
    loadChats();
    var saved = store(LS_CHAT);
    show(saved ? "conectando" : "chats");
  }

  /* AUTH_KEY_DUPLICATED: Telegram cierra para siempre la llave de la sesión que se usó a la vez en dos sitios. Lo único que sirve es
   * borrar la sesión de este equipo y entrar de nuevo: se hace solo, una vez (el aviso queda en sessionStorage para no repetir). */
  function dupRecover(e, after) {
    if (!/AUTH_KEY_DUPLICATED/.test(String((e && (e.text || e.message)) || e))) { return false; }
    try { if (window.sessionStorage.getItem("hf.dup2")) { return false; } window.sessionStorage.setItem("hf.dup2", "1"); } catch (x) { return false; }
    var go = after || function () { window.location.reload(); }; // after: solo para pruebas
    wipeSession().then(go, go);
    return true;
  }
  /* Borra la sesión de ESTE programa. El preparador guarda la suya en IndexedDB «hf-preparador» (ui.html, tgClient), no en «hf-session»
   * (la de la TV/celular): antes se llamaba a HFTelegram.logout(), que borraba la otra, y la llave dañada seguía ahí tras recargar. */
  function wipeSession() {
    var c = B.client;
    var closed = c && typeof c.destroy === "function" ? Promise.resolve().then(function () { return c.destroy(); }).then(null, function () { /* nada */ }) : Promise.resolve();
    var gone = closed.then(function () {
      return new Promise(function (ok) {
        var r;
        try { r = window.indexedDB.deleteDatabase("hf-preparador"); } catch (x) { ok(); return; }
        r.onsuccess = r.onerror = r.onblocked = function () { ok(); };
      });
    });
    return Promise.race([gone, new Promise(function (ok) { setTimeout(ok, 3000); })]);
  }
  if ((function () { try { return !!window.sessionStorage.getItem("hf.dup2"); } catch (x) { return false; } })()) { B.login.error = "Telegram había cerrado la sesión de este equipo por usarla a la vez en dos sitios. Ya se reinició: vuelve a entrar."; }

  var ACT = {};
  ACT["login-qr"] = function () { B.login.step = "qr"; B.login.error = ""; render(); };
  ACT["login-phone"] = function () { stopQr(); B.login.step = "telefono"; B.login.error = ""; render(); };
  ACT["send-code"] = function () {
    var L = B.login;
    L.cc = $("lCc").value.trim();
    L.num = $("lPhone").value.trim();
    var phone = ("+" + (L.cc + L.num).replace(/\D/g, ""));
    if (phone.length < 8) { L.error = "Escribe el número completo."; render(); return; }
    L.busy = true; L.error = ""; render();
    B.client.sendCode({ phone: phone }).then(function (r) {
      L.busy = false; L.phone = phone; L.hash = r.phoneCodeHash; L.step = "codigo"; render();
      if ($("lCode")) { $("lCode").focus(); }
    }, function (e) { if (dupRecover(e)) { return; } L.busy = false; L.error = HFTelegram.loginError(e); render(); });
  };
  ACT["check-code"] = function () {
    var L = B.login;
    var code = $("lCode").value.replace(/\D/g, "");
    if (!code) { return; }
    L.busy = true; L.error = ""; render();
    B.client.signIn({ phone: L.phone, phoneCodeHash: L.hash, phoneCode: code }).then(loggedIn, function (e) {
      L.busy = false;
      if (/SESSION_PASSWORD_NEEDED/.test(String(e && (e.text || e.message)))) {
        L.step = "clave";
        hint().then(function (h) { L.hint = h; render(); });
      } else {
        if (dupRecover(e)) { return; }
        L.error = HFTelegram.loginError(e);
      }
      render();
    });
  };
  ACT["check-pwd"] = function () {
    var L = B.login;
    var pwd = $("lPwd").value;
    if (!pwd) { return; }
    L.busy = true; L.error = ""; render();
    if (L.pwdWait) { // entrando por QR: el código espera la clave
      var f = L.pwdWait;
      L.pwdWait = null;
      L.step = "qr";
      f(pwd);
      return;
    }
    B.client.checkPassword(pwd).then(loggedIn, function (e) { L.busy = false; L.error = HFTelegram.loginError(e); render(); });
  };

  /* ===================== elegir el chat ===================== */
  /* Mensajes de Telegram que el usuario necesita entender (y qué hacer) */
  function copyErr(e) {
    var t = String((e && (e.text || e.message)) || e);
    if (/CHAT_WRITE_FORBIDDEN|CHAT_ADMIN_REQUIRED|USER_BANNED_IN_CHANNEL|CHAT_SEND_(MEDIA|PHOTOS|VIDEOS)_FORBIDDEN/i.test(t)) { return "Tu cuenta no puede escribir en el grupo de destino (" + t + "): hace falta ser administrador o que el grupo permita enviar fotos y videos. Cambia el destino o pide el permiso, y pulsa «Continuar»."; }
    if (/TOPIC_CLOSED|TOPIC_DELETED/i.test(t)) { return "El tema de destino está cerrado o se borró (" + t + "). Ábrelo de nuevo en Telegram o pulsa «Empezar de cero». Después pulsa «Continuar»."; }
    if (/CHAT_FORWARDS_RESTRICTED|CHAT_RESTRICTED|noforwards/i.test(t)) { return "El canal de origen tiene el contenido protegido: Telegram no deja copiarlo (" + t + ")."; }
    return "No pude seguir: " + t + " · Pulsa «Continuar» para reintentar.";
  }
  function chatName(p) { return p.isSelf ? "Mensajes guardados" : (p.title || p.displayName || String(p.id)); }

  function loadChats() {
    var c = B.client;
    var list = [];
    B.chats = null;
    (async function () {
      for await (var d of c.iterDialogs({ limit: 3000, archived: "keep" })) {
        var p = d.peer;
        if (p.isSelf || p.type === "chat") { list.push(p); }
      }
    })().then(function () {
      /* un grupo que pasó a supergrupo: se muestra solo el supergrupo y se recuerda el de antes para leer los dos */
      var byId = {};
      list.forEach(function (p) { byId[String(p.id)] = p; });
      B.oldOf = {};
      list = list.filter(function (p) {
        var to = p.raw && p.raw.migratedTo;
        if (to && to.channelId) {
          var nu = String(-(1000000000000 + Number(to.channelId)));
          if (byId[nu]) { B.oldOf[nu] = p; return false; }
        }
        return true;
      });
      list.sort(function (a, b) { return (b.isSelf ? 1 : 0) - (a.isSelf ? 1 : 0); });
      B.chats = list;
      if (window.PrepTopics) { list.forEach(function (p) { PrepTopics.noteForum(p); }); }
      var saved = store(LS_CHAT);
      var pick = saved && byId[saved];
      /* B.peer puede ser el chat «provisional» que se pintó de la caché (_cache): hay que fijar el real igual, o el preparador no sabe en qué
       * chat publicar y la cola se queda esperando para siempre */
      if (pick && (!B.peer || B.peer._cache)) {
        if (pick.raw && pick.raw.migratedTo) { pick = list.filter(function (p) { return B.oldOf[String(p.id)] === byId[saved]; })[0] || pick; }
        choose(pick);
      } else if (B.view === "conectando") {
        show("chats");
      } else if (B.view === "chats") {
        render();
      }
      countVideos();
    }, function (e) {
      B.chats = [];
      B.readError = "No pude leer tus chats: " + e.message;
      if (B.view === "chats" || B.view === "conectando") { show("chats"); }
    });
  }

  /* Cuántos videos tiene cada chat (uno por uno, sin apuro: Telegram limita las ráfagas). */
  async function countVideos() {
    for (var i = 0; i < (B.chats || []).length; i += 1) {
      var p = B.chats[i];
      var id = String(p.id);
      if (B.counts[id] !== undefined) { continue; }
      try {
        var a = await B.client.searchMessages({ chatId: p, filter: VIDEO, limit: 1 });
        var n = a.total || a.length || 0;
        var old = B.oldOf[id];
        if (old) {
          try { var b = await B.client.searchMessages({ chatId: old, filter: VIDEO, limit: 1 }); n += b.total || b.length || 0; } catch (e) { /* sin acceso al de antes */ }
        }
        B.counts[id] = n;
      } catch (e) {
        B.counts[id] = -1;
      }
      if (B.view === "chats") { paintCount(id); }
    }
  }
  function countText(id) {
    var n = B.counts[id];
    return n === undefined ? "<b>…</b>contando" : n < 0 ? "<b>—</b>sin acceso" : "<b>" + n + "</b>" + (n === 1 ? "video" : "videos");
  }
  function paintCount(id) {
    var el = document.querySelector('[data-cnt="' + id + '"]');
    if (el) { el.innerHTML = countText(id); }
  }

  function viewChats() {
    var list = B.chats;
    var cur = B.peer ? String(B.peer.id) : store(LS_CHAT);
    var rows = !list ? '<div class="lib-center"><div class="lib-spin"></div>Leyendo tus chats…</div>' :
      !list.length ? '<div class="note bad">' + esc(B.readError || "No encontré grupos, canales ni Mensajes guardados en esta cuenta.") + "</div>" :
      list.map(function (p) {
        var id = String(p.id);
        var on = id === cur;
        var desc = p.isSelf ? "Para pruebas: nadie más lo ve" : (p.isForum ? "Grupo con temas" : p.chatType === "channel" ? "Canal" : p.chatType === "supergroup" ? "Supergrupo" : "Grupo") +
          (B.oldOf[id] ? " · también se leen los videos de antes del cambio de grupo" : "");
        return '<button class="chat' + (on ? " on" : "") + '" data-act="chat" data-id="' + esc(id) + '" role="radio" aria-checked="' + on + '">' +
          '<span class="radio" aria-hidden="true"></span><span class="av" aria-hidden="true">' + esc(chatName(p).charAt(0).toUpperCase()) + "</span>" +
          '<span class="tx"><b>' + esc(chatName(p)) + "</b><small>" + esc(desc) + '</small></span><span class="cnt" data-cnt="' + esc(id) + '">' + countText(id) + "</span></button>";
      }).join("");
    return '<div class="pick"><h1>¿Qué chat revisamos?</h1><div class="hint" style="font-size:14px">Es el chat de donde salen las películas, como en la TV. Desde aquí también se publica lo que prepares.</div>' +
      '<div class="chatlist" role="radiogroup" aria-label="Chats con videos">' + rows + "</div></div>" +
      '<div class="libfoot"><div class="status"><span class="dot ready"></span><span class="sum">Conectado como ' + esc(B.me ? (B.me.displayName || B.me.username || "") : "") + "</span></div>" +
      '<div class="btns"><button class="ghost" data-act="logout">Cerrar sesión</button>' + (B.peer ? '<button class="primary" data-act="inicio">Ver la biblioteca →</button>' : "") + "</div></div>";
  }

  ACT.chat = function (el) {
    var id = el.getAttribute("data-id");
    var p = (B.chats || []).filter(function (x) { return String(x.id) === id; })[0];
    if (p) { choose(p); }
  };
  ACT.inicio = function () { show("inicio"); };
  ACT.logout = function () {
    if (PREP.busy() || !confirm("¿Cerrar la sesión de Telegram en este preparador? La TV y el celular no se ven afectados.")) { return; }
    B.client.logOut().then(null, function () {}).then(function () { store(LS_CHAT, null); location.reload(); });
  };

  function choose(p) {
    if (PREP.busy()) { alert("Espera a que termine lo que está en marcha para cambiar de chat."); return; }
    var same = B.peer && String(B.peer.id) === String(p.id);
    B.peer = p;
    B.oldPeer = B.oldOf[String(p.id)] || null;
    store(LS_CHAT, String(p.id));
    store(LS_CHATNAME, chatName(p));
    PREP.setChat(p, B.oldPeer);
    /* con la biblioteca ya a la vista (de la caché) y revisada hace poco no se vuelve a pedir nada */
    if (!same || !B.lib) { readChat(); }
    else if (!B.syncing && Date.now() - (B.lastSync || 0) > 30000) { readChat(); }
    show("inicio");
  }

  /* ===================== leer el chat ===================== */
  function isVideoMsg(m) { var d = m.media; return !!d && d.type === "video" && !d.isRound && !d.isAnimation; }
  function isVideoDoc(m) { var d = m.media; return !!d && d.type === "document" && (VIDEO_EXT.test(d.fileName || "") || /^video\//i.test(d.mimeType || "")); }
  function isThumbDoc(m) { var d = m.media; return !!d && d.type === "document" && /miniaturas[\s_]+\d+s[\s_]+\d+x\d+[\s_]+\d+x\d+[\s_]+hoja[\s_]+\d+[\s_]+de[\s_]+\d+\.jpe?g$/i.test(d.fileName || ""); }
  function isSubDoc(m) { var d = m.media; return !!d && d.type === "document" && /\.(srt|vtt|ass|ssa)$/i.test(d.fileName || "") && !!(m.text && m.text.indexOf("#") >= 0); }
  function isPhoto(m) { return !!m.media && m.media.type === "photo" && !!(m.text && m.text.indexOf("#") >= 0); }

  function describe(m, kind) {
    var d = m.media;
    var key = String(m.chat.id) + ":" + m.id;
    B.msgs[key] = m;
    return { key: key, chatId: String(m.chat.id), chatTitle: "", msgId: m.id, kind: kind, caption: m.text || "", fileName: (d && d.fileName) || "",
      duration: (d && d.duration) || 0, size: (d && d.fileSize) || 0, width: (d && d.width) || 0, height: (d && d.height) || 0, date: m.date ? m.date.getTime() : 0 };
  }

  async function collect(peer, filter, keep, kind, out) {
    var offset;
    var res;
    var n = 0;
    do {
      res = await B.client.searchMessages({ chatId: peer, filter: filter, limit: 100, offset: offset });
      res.forEach(function (m) { if (keep(m)) { out.push(describe(m, typeof kind === "function" ? kind(m) : kind)); } });
      n += res.length;
      offset = res.next;
      if (B.view === "inicio") { paintReading(out.length); }
    } while (res.length && offset !== undefined && n < 3000);
  }

  /* Huella de lo que muestra Inicio (títulos, comentarios, tamaños): si no cambió al terminar de revisar, no se repinta */
  function itemsSig(items) {
    var h = 5381;
    var s;
    var i;
    var j;
    for (i = 0; i < items.length; i += 1) {
      s = items[i].key + "|" + items[i].kind + "|" + items[i].caption + "|" + items[i].size + "|" + items[i].width + "x" + items[i].height;
      for (j = 0; j < s.length; j += 1) { h = ((h * 33) ^ s.charCodeAt(j)) | 0; }
    }
    return items.length + ":" + (h >>> 0).toString(36);
  }

  /* arma la biblioteca con estos items (lo que antes hacía el final de readChat) */
  function applyItems(items) {
    B.items = items;
    B.byKey = {};
    items.forEach(function (it) { B.byKey[it.key] = it; });
    B.lib = HFLibrary.build(items, {});
    seriesVideo(B.lib);
    B.titles = B.lib.movies.concat(B.lib.series).sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
    /* la ficha abierta sigue con los datos nuevos */
    if (B.sel) { B.sel = B.titles.filter(function (x) { return x.titleKey === B.sel.titleKey; })[0] || B.sel; }
  }

  function meId() { return B.me ? String(B.me.id) : (store(LS_ME) || ""); }

  /* Lo que se ve al abrir: lo último que se guardó de este chat, AL INSTANTE, antes de que Telegram conteste. */
  function paintFromCache() {
    var me = store(LS_ME);
    var chat = store(LS_CHAT);
    if (!me || !chat || !window.PrepCatalog) { return Promise.resolve(false); }
    return PrepCatalog.peek(me, chat).then(function (c) {
      if (!c || B.lib || B.view === "acceso" || B.view === "tabs") { return false; }
      B.peer = B.peer || { id: Number(chat), title: store(LS_CHATNAME) || "", _cache: true };
      B.fromCache = true;
      B.cacheAt = c.at || 0;
      B.at = c.at || Date.now();
      B.reading = false;
      B.syncing = true;
      applyItems(c.items.slice());
      B.painted = itemsSig(c.items);
      show("inicio");
      return true;
    });
  }

  /* readChat({full}): se enseña lo guardado, se piden los mensajes nuevos y se revisa lo ya conocido (comentarios editados,
   * imágenes cambiadas, videos borrados) en segundo plano. full (↻): se vuelve a leer todo el chat. */
  function readChat(opts) {
    var peer = B.peer;
    var old = B.oldPeer;
    var gen = (B.readGen += 1);
    B.forceMsg = false;
    var msgs = {};
    var hadLib = !!B.lib;
    opts = opts || {};
    B.readError = "";
    B.syncing = true;
    B.msgsReady = false;
    if (!window.PrepCatalog) { return legacyRead(opts); }
    /* sin nada guardado de este chat: pantalla de «Leyendo…» (la primera vez); con algo guardado se ve al momento */
    PrepCatalog.peek(meId(), String(peer.id)).then(function (c) {
      if (gen !== B.readGen) { return null; }
      if (c && !hadLib) { applyItems(c.items.slice()); B.fromCache = true; B.at = c.at || Date.now(); B.painted = itemsSig(c.items); B.reading = false; if (B.view === "inicio" || B.view === "ficha") { render(); } }
      else if (!c && !hadLib) { B.reading = true; B.lib = null; B.titles = []; if (B.view === "inicio") { render(); } }
      B.msgs = msgs;
      return PrepCatalog.refresh({ client: B.client, peer: peer._cache ? Number(peer.id) : peer, old: old, chatId: String(peer.id), meId: meId(), full: !!opts.full, msgs: msgs, onlyIncremental: !!opts.early,
        onProgress: function (n) { if (B.view === "inicio") { paintReading(n); } } });
    }).then(function (r) {
      if (!r) {
        /* la revisión temprana (sin conocer aún el grupo de antes) no puede ser completa: se espera a elegir el chat */
        if (gen === B.readGen) { B.syncing = false; B.lastSync = 0; if (B.view === 'inicio') { paintTop(); } }
        return;
      }
      if (gen !== B.readGen || (peer !== B.peer && !(peer._cache && String(B.peer.id) === String(peer.id)))) { return; }
      var sig = itemsSig(r.items);
      B.msgs = Object.assign(B.msgs || {}, msgs);
      B.reading = false;
      B.syncing = false;
      B.fromCache = false;
      B.lastSync = Date.now();
      B.at = Date.now();
      B.msgsReady = r.hydrated !== false;
      if (sig !== B.painted || !B.lib) {
        applyItems(r.items);
        B.painted = sig;
        if (B.view === "inicio" || B.view === "ficha") { render(); }
      } else {
        applyItems(r.items); // mismos datos: se actualizan las referencias sin repintar
        if (B.view === "inicio") { var cnt = $("libCount"); if (cnt) { cnt.textContent = topCount(); } paintTop(); }
      }
      if (B.msgsReady) { queueLangs(); queueSrt(); } // las pistas y los .srt se leen con los mensajes de Telegram
      releaseThumbs();
      watchThumbs();
    }, function (e) {
      if (gen !== B.readGen) { return; }
      B.reading = false;
      B.syncing = false;
      B.lastSync = 0; // se vuelve a intentar al elegir el chat
      if (B.lib) {
        if (B.view === "inicio") { paintTop(); } // hay algo guardado: se sigue viendo, sin error a pantalla completa
        return;
      }
      B.readError = "No pude leer el chat: " + (e.message || e);
      if (B.view === "inicio") { render(); }
    });
  }

  /* Respaldo si cache.js no cargó: lectura completa de siempre */
  function legacyRead(opts) {
    var peer = B.peer;
    var old = B.oldPeer;
    var out = [];
    B.reading = true;
    B.lib = null;
    B.titles = [];
    B.msgs = {};
    if (B.view === "inicio") { render(); }
    (async function () {
      for (var pp of [peer].concat(old ? [old] : [])) {
        try {
          await collect(pp, VIDEO, isVideoMsg, "video", out);
          await collect(pp, DOCS, function (m) { return isVideoDoc(m) || isThumbDoc(m) || isSubDoc(m); }, function (m) { return isThumbDoc(m) ? "thumbs" : isSubDoc(m) ? "sub" : "video"; }, out);
          await collect(pp, PHOTOS, isPhoto, "photo", out);
        } catch (e) {
          if (pp === peer) { throw e; }
        }
      }
    })().then(function () {
      if (peer !== B.peer) { return; }
      applyItems(out);
      B.reading = false;
      B.syncing = false;
      B.msgsReady = true;
      B.at = Date.now();
      queueLangs();
      queueSrt();
      if (B.view === "inicio" || B.view === "ficha") { render(); }
    }, function (e) {
      if (peer !== B.peer) { return; }
      B.reading = false;
      B.syncing = false;
      B.readError = "No pude leer el chat: " + (e.message || e);
      if (B.view === "inicio") { render(); }
    });
  }
  function paintReading(n) {
    var el = $("readN");
    if (el) { el.textContent = n + " videos y fotos leídos"; }
  }

  /* ===================== qué le falta a cada título ===================== */
  /* Una serie no trae un video propio: se le da el del primer capítulo, para leer sus pistas de idioma y mostrar su comentario en el grupo
   * (sin esto la ficha se quedaba en «Leyendo el encabezado del archivo…» y con el comentario vacío). */
  function seriesVideo(lib) {
    (lib.series || []).forEach(function (t) {
      var e = episodesOf(t)[0];
      if (!t.video && e && e.video) { t.video = e.video; }
    });
  }
  function episodesOf(t) {
    var out = [];
    (t.seasons || []).forEach(function (s) { (s.episodes || []).forEach(function (e) { out.push(e); }); });
    return out;
  }
  /* calidades que hay: en una serie, las que tienen todos los capítulos */
  function haveOf(t) {
    if (t.type !== "series") { return (t.versions || []).map(function (v) { return v.q; }); }
    var eps = episodesOf(t);
    return QS.map(function (q) { return q[0]; }).filter(function (q) {
      return eps.length && eps.every(function (e) { return (e.versions || []).some(function (v) { return v.q === q; }); });
    });
  }
  function missingOf(t) {
    var have = haveOf(t);
    return QS.filter(function (q) { return have.indexOf(q[0]) < 0; }).map(function (q) { return q[0]; });
  }

  function photoInfo(key) { return key ? B.byKey[key] || null : null; }
  /* portada y banner: deben ser horizontales 16:9; la portada desde 1280×720 y el banner desde 1920×1080 */
  /* t (opcional): el título de la foto, para avisar si es la misma imagen que la de otra película */
  function imgIssue(it, kind, t) {
    if (!it || !it.width || !it.height) { return ""; }
    var r = it.width / it.height;
    if (kind === "vertical") {
      if (r > 0.8) { return "No vertical"; }
      if (it.width < 600) { return "Muy pequeña"; }
      if (t && dupOf(it, t).length) { return "Repetida"; }
      return "";
    }
    var need = kind === "banner" ? 1920 : 1280;
    if (r < 0.9) { return "Vertical"; }
    if (r < 1.3) { return "Cuadrada"; }
    if (it.width < need * 0.75) { return kind === "banner" ? "Pequeña para banner" : "Muy pequeña"; }
    if (t && dupOf(it, t).length) { return "Repetida"; }
    return "";
  }
  /* La misma foto publicada como portada o banner de películas distintas (pasaba cuando la pestaña 1 arrastraba la
   * portada y el banner de la película anterior al elegir otro video). Mismas medidas y mismo peso = misma imagen:
   * Telegram deja idéntica una foto que se sube dos veces. */
  var dupMemo = {};
  function photoSig(it) { return it && it.size && it.width ? it.width + "x" + it.height + ":" + it.size : ""; }
  function dupMap() {
    if (dupMemo.titles === B.titles && dupMemo.byKey === B.byKey && dupMemo.n === (B.titles || []).length) { return dupMemo.map; }
    var map = {};
    (B.titles || []).forEach(function (t) {
      [t.posterIsPhoto ? t.imageKey : "", t.bannerKey && t.bannerKey !== t.imageKey ? t.bannerKey : "", t.verticalKey || ""].forEach(function (k) {
        var s = photoSig(photoInfo(k));
        if (!s) { return; }
        map[s] = map[s] || [];
        if (map[s].indexOf(t) < 0) { map[s].push(t); }
      });
    });
    dupMemo = { titles: B.titles, byKey: B.byKey, n: (B.titles || []).length, map: map };
    return map;
  }
  /* las otras películas que usan esta misma foto */
  function dupOf(it, t) {
    var l = dupMap()[photoSig(it)];
    return l && l.length > 1 ? l.filter(function (x) { return x !== t; }) : [];
  }
  function dupNames(it, t) {
    var l = dupOf(it, t);
    return l.slice(0, 3).map(function (x) { return x.name; }).join(", ") + (l.length > 3 ? " y " + (l.length - 3) + " más" : "");
  }
  function imgIssues(t) {
    var out = [];
    var p = t.posterIsPhoto ? photoInfo(t.imageKey) : null; // sin foto, imageKey es el video: no es una portada que cambiar
    var b = t.bannerKey !== t.imageKey ? photoInfo(t.bannerKey) : null; // sin banner propio la app usa la portada
    if (imgIssue(p, "portada", t)) { out.push({ kind: "Portada", it: p, issue: imgIssue(p, "portada", t) }); }
    if (imgIssue(b, "banner", t)) { out.push({ kind: "Banner", it: b, issue: imgIssue(b, "banner", t) }); }
    var v = t.verticalKey ? photoInfo(t.verticalKey) : null;
    if (imgIssue(v, "vertical", t)) { out.push({ kind: "Vertical", it: v, issue: imgIssue(v, "vertical", t) }); }
    return out;
  }

  /* ----- idioma: se lee el encabezado del archivo (en el grupo) y ffprobe dice las pistas ----- */
  var ES = /^(es|spa|esp|es-\w+|spanish|español|espanol|castellano|latino|lat|la)$/i;
  var ES_TITLE = /latino|español|espanol|castellano|spanish|\blat\b|\besp\b/i;
  function isEs(t) { return ES.test(String(t.lang || "").trim()) || ES_TITLE.test(String(t.title || "")); }

  function langOf(t) {
    var r = t.video && B.langs[t.video.key];
    if (!r) {
      var hintTxt = (t.video && (t.video.caption + " " + t.video.fileName)) || "";
      return { state: "pending", audio: [], subs: [], hintEs: /latino|español|castellano|\bdual\b/i.test(hintTxt) };
    }
    if (r.error) { return { state: "unknown", audio: [], subs: [], error: r.error }; }
    var aEs = r.audio.some(isEs);
    var sEs = r.subs.some(isEs);
    var known = r.audio.length && r.audio.every(function (a) { return a.lang && !/^(und|unk|mis|zxx)$/i.test(a.lang); });
    var hintEs = /latino|español|castellano|\bdual\b/i.test((t.video.caption || "") + " " + (t.video.fileName || ""));
    return { state: aEs || (hintEs && !known) ? "es" : sEs ? "subs" : known ? "no" : "unknown", audio: r.audio, subs: r.subs };
  }
  var LANG_TXT = { es: "Español", subs: "Subt. español", no: "Sin español", unknown: "Sin marcar", pending: "Revisando idioma" };
  var LANG_CLS = { es: "good", subs: "good", no: "bad", unknown: "wait", pending: "wait" };

  /* ----- nombre de cada pista en la TV y el celular, y su corrección -----
   * La app muestra el idioma que trae la pista (no el nombre del archivo). Si la pista no lo trae, o trae uno que no
   * cuadra con su nombre («…_track2_eng.aac» marcada como español), se corrige aquí: la corrección va al final del
   * comentario de cada archivo del título (#audio-spa-eng #subs-spa) y la app la aplica. No se vuelve a subir nada. */
  var LANG_OPTS = [["spa", "Español"], ["lat", "Español latino"], ["eng", "Inglés"], ["por", "Portugués"], ["fre", "Francés"], ["ita", "Italiano"],
    ["ger", "Alemán"], ["jpn", "Japonés"], ["kor", "Coreano"], ["chi", "Chino"], ["rus", "Ruso"], ["und", "Sin idioma"]];
  var LANG_ISO = { es: "spa", esp: "spa", en: "eng", pt: "por", fr: "fre", fra: "fre", it: "ita", de: "ger", deu: "ger", ja: "jpn", ko: "kor", zh: "chi", zho: "chi", ru: "rus" };
  function normCode(c) { c = String(c || "").toLowerCase().trim(); return LANG_ISO[c] || c; }
  function knownCode(c) { return !!c && !/^(und|unk|mis|zxx|)$/.test(c); }
  function codeName(c) { var o = LANG_OPTS.filter(function (x) { return x[0] === c; })[0]; return o ? o[1] : String(c || "").toUpperCase(); }
  function sameLang(a, b) { var es = function (c) { return c === "spa" || c === "lat"; }; return a === b || (es(a) && es(b)); }
  /* idioma que dice el nombre de la pista (casi siempre el nombre del archivo con que se armó el video) */
  function guessLang(title) {
    /* gana el último que nombra: «…dual-lat…_track2_eng.aac» es la pista en inglés de un archivo dual */
    /* «dual-lat» es del archivo entero (audio dual, doblaje latino), no de esta pista */
    var n = String(title || "").toLowerCase().replace(/\.[a-z0-9]{2,4}$/, "").replace(/dual[\s._-]*(latino|lat|spa|esp|castellano|eng|english)/g, "dual");
    var best = { at: -1, c: "" };
    [["lat", /latin|mexic|(^|[^a-z])lat(?=[^a-z]|$)/g], ["spa", /espa[ñn]ol|spanish|castellan|(^|[^a-z])(spa|esp)(?=[^a-z]|$)/g],
      ["eng", /english|ingl[eé]s|(^|[^a-z])eng(?=[^a-z]|$)/g], ["por", /portugu|(^|[^a-z])por(?=[^a-z]|$)/g], ["jpn", /japan|japon|(^|[^a-z])jpn(?=[^a-z]|$)/g]
    ].forEach(function (x) {
      var m;
      while ((m = x[1].exec(n))) { if (m.index > best.at) { best = { at: m.index, c: x[0] }; } }
    });
    return best.c;
  }
  /* Cada calidad es otro archivo y puede traer otras pistas (la 360p con subtítulos en inglés que la 1080p no tiene):
   * se lee cada una y se juntan las que tienen las mismas pistas y la misma corrección. */
  function fileKey(v) { return v && v.parts && v.parts[0] ? v.parts[0].key : ""; }
  function trackSig(r) {
    var f = function (a) { return [a.lang, a.title, a.codec, a.channels, a.forced ? 1 : 0].join("~"); };
    return (r.audio || []).map(f).join("|") + "#" + (r.subs || []).map(f).join("|");
  }
  function fileGroups(t) {
    if (t.type === "series") { return []; }
    var groups = [];
    (t.versions || []).slice().sort(function (a, b) { return (b.h || 0) - (a.h || 0); }).forEach(function (v) {
      var k = fileKey(v);
      var r = k && B.langs["f:" + k];
      if (r && !r.error && r.v !== 2) { r = null; }
      var it = B.byKey[k];
      var fix = (it && it.langs) || null;
      var sig = !r ? "pend:" + k : r.error ? "err:" + k : trackSig(r) + "@" + HFLibrary.langsTag(fix || {});
      var g = groups.filter(function (x) { return x.sig === sig; })[0];
      if (!g) { g = { sig: sig, id: k, r: r || null, fix: fix, versions: [] }; groups.push(g); }
      g.versions.push(v);
    });
    return groups;
  }
  function groupName(g) {
    return g.versions.map(function (v) { return v.q + ((v.parts || []).length > 1 ? " (" + v.parts.length + " partes)" : ""); }).join(" · ");
  }
  /* las pistas de un tipo de un archivo con lo que muestra la app, si está mal y qué se sugiere */
  function trackRows(g, kind) {
    var r = g && g.r;
    if (!r || r.error) { return null; }
    var list = (kind === "audio" ? r.audio : r.subs) || [];
    var fix = (g.fix && g.fix[kind]) || [];
    var eff = list.map(function (a, i) {
      var f = fix[i] && fix[i] !== "x" ? fix[i] : "";
      return { lang: f || a.lang, name: a.title, channels: a.channels, isForced: a.forced };
    });
    var labels = HFLibrary.trackLabels(eff, kind);
    return list.map(function (a, i) {
      var own = normCode(a.lang);
      var guess = guessLang(a.title);
      var fixed = fix[i] && fix[i] !== "x" ? fix[i] : "";
      var issue = "";
      if (!knownCode(own) && !guess) { issue = "No dice su idioma: la app la muestra como «" + labels[i] + "»"; }
      else if (knownCode(own) && guess && !sameLang(guess, own)) { issue = "Dice " + codeName(own).toLowerCase() + ", pero su nombre dice " + codeName(guess).toLowerCase(); }
      return { i: i, a: a, own: own, label: labels[i], fixed: fixed, guess: guess, issue: fixed ? "" : issue };
    });
  }
  /* pistas con el idioma mal y sin corregir, en cualquiera de sus archivos (solo películas: en las series cada
   * capítulo es un archivo distinto) */
  function subLangsOf(g) {
    var fix = (g.fix && g.fix.subs) || [];
    var out = {};
    ((g.r && g.r.subs) || []).forEach(function (a, i) {
      var c = normCode(fix[i] && fix[i] !== "x" ? fix[i] : a.lang);
      if (c === "lat") { c = "spa"; }
      if (!a.forced && knownCode(c)) { out[c] = true; }
    });
    return out;
  }
  function subGaps(t) {
    var groups = fileGroups(t).filter(function (g) { return g.r && !g.r.error; });
    if (groups.length < 2) { return []; }
    var ext = {};
    (t.subFiles || []).forEach(function (x) { ext[x.lang === "lat" ? "spa" : x.lang] = true; });
    var all = {};
    groups.forEach(function (g) { Object.keys(subLangsOf(g)).forEach(function (c) { all[c] = true; }); });
    var out = [];
    groups.forEach(function (g) {
      var have = subLangsOf(g);
      Object.keys(all).forEach(function (c) {
        if (!have[c] && !ext[c]) { out.push({ g: g, lang: c, from: groups.filter(function (o) { return subLangsOf(o)[c]; }).map(groupName).join(" · ") }); }
      });
    });
    return out;
  }
  /* subtítulos de texto que vienen DENTRO de algún video y no están aparte: hay que pasarlos (estándar: un .srt por
   * idioma para todas las calidades) */
  function embeddedPending(t) {
    if (t.type === "series") { return []; }
    var ext = {};
    (t.subFiles || []).forEach(function (x) { ext[(x.lang === "lat" ? "spa" : x.lang) + (x.forced ? ":f" : "")] = true; });
    var out = {};
    fileGroups(t).forEach(function (g) {
      var fix = (g.fix && g.fix.subs) || [];
      ((g.r && !g.r.error && g.r.subs) || []).forEach(function (a, i) {
        if (!/^(mov_text|subrip|srt|ass|ssa|webvtt|text)$/i.test(a.codec || "")) { return; }
        var c = normCode(fix[i] && fix[i] !== "x" ? fix[i] : a.lang);
        if (c === "lat") { c = "spa"; }
        var k = c + (a.forced ? ":f" : "");
        if (!ext[k]) { out[k] = { lang: c, forced: !!a.forced }; }
      });
    });
    return Object.keys(out).map(function (k) { return out[k]; });
  }
  function langIssues(t) {
    return fileGroups(t).reduce(function (out, g) {
      return ["audio", "subs"].reduce(function (o, k) {
        return o.concat((trackRows(g, k) || []).filter(function (x) { return x.issue; }).map(function (x) { return { g: g, kind: k, row: x }; }));
      }, out);
    }, []);
  }

  var langTimer = null;
  function saveLangs() {
    if (langTimer) { return; }
    langTimer = setTimeout(function () { langTimer = null; store(LS_LANG, JSON.stringify(B.langs)); }, 1500);
  }
  function queueLangs() {
    B.langQueue = B.titles.filter(function (t) { return t.video && (!B.langs[t.video.key] || (t.type !== "series" && (t.versions || []).some(function (v) { var x = fileKey(v) && B.langs["f:" + fileKey(v)]; return fileKey(v) && (!x || (!x.error && x.v !== 2)); }))); });
    B.langTotal = B.langQueue.length;
    B.langDone = 0;
    runLangs();
  }
  /* Telegram a veces deja una lectura colgada y toda la fila de revisión se quedaba «leyendo el encabezado». Con tiempo límite pasa a «No pude
   * leer las pistas» (con Reintentar y las opciones para marcar el idioma a mano). */
  function withTimeout(p, ms, msg) {
    var timer;
    return Promise.race([p, new Promise(function (_, rej) { timer = setTimeout(function () { rej(new Error(msg || "Telegram no respondió a tiempo")); }, ms); })]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }
  async function runLangs() {
    if (B.langBusy) { return; }
    B.langBusy = true;
    while (B.langQueue.length) {
      var t = B.langQueue.shift();
      var peer = B.peer;
      try {
        B.langs[t.video.key] = await withTimeout(probeTitle(t), 45000);
      } catch (e) {
        B.langs[t.video.key] = { error: String((e && e.message) || e), at: Date.now() };
      }
      /* y cada calidad por separado (sus pistas pueden ser otras) */
      if (t.type !== "series") {
        for (var vi = 0; vi < (t.versions || []).length && peer === B.peer; vi += 1) {
          var fk = fileKey(t.versions[vi]);
          if (!fk || (B.langs["f:" + fk] && (B.langs["f:" + fk].v === 2 || B.langs["f:" + fk].error)) || !B.msgs[fk]) { continue; }
          try {
            B.langs["f:" + fk] = await withTimeout(probeMsg(B.msgs[fk]), 45000);
          } catch (e) {
            B.langs["f:" + fk] = { error: String((e && e.message) || e), at: Date.now() };
          }
        }
      }
      if (peer !== B.peer) { break; }
      B.langDone += 1;
      saveLangs();
      paintLang(t);
    }
    B.langBusy = false;
    if (B.view === "inicio") { paintTop(); }
  }

  /* El archivo más chico del título (360p si hay): sus pistas de audio y subtítulos son las mismas en todas. */
  function smallestPart(t) {
    var vs = t.type === "series" ? [] : (t.versions || []).slice();
    if (t.type === "series") { var e = episodesOf(t)[0]; vs = e ? (e.versions || []).slice() : []; }
    vs.sort(function (a, b) { return (a.h || 0) - (b.h || 0); });
    var v = vs[0];
    return v && v.parts && v.parts[0] ? B.msgs[v.parts[0].key] : (t.video ? B.msgs[t.video.key] : null);
  }

  var CH = 512 * 1024;
  /* Bytes [offset, offset+len) del archivo de un mensaje, sin bajar el resto. */
  async function readRange(media, offset, len) {
    var start = Math.floor(offset / CH) * CH;
    var end = Math.min(media.fileSize || offset + len, offset + len);
    var chunks = [];
    var got = 0;
    for await (var c of B.client.downloadAsIterable(media, { offset: start, fileSize: media.fileSize, partSize: 512 })) {
      chunks.push(c);
      got += c.length;
      if (start + got >= end) { break; }
    }
    var all = new Uint8Array(got);
    var p = 0;
    chunks.forEach(function (c) { all.set(c, p); p += c.length; });
    return all.subarray(offset - start, Math.min(got, end - start));
  }
  function u32(b, i) { return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]; }
  function box(b, i) {
    if (i + 8 > b.length) { return null; }
    var size = u32(b, i);
    var type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (size === 1 && i + 16 <= b.length) { size = u32(b, i + 8) * 4294967296 + u32(b, i + 12); }
    return { size: size, type: type };
  }

  async function probeTitle(t) { return probeMsg(smallestPart(t)); }
  async function probeMsg(m) {
    if (!m || !m.media) { throw new Error("sin archivo"); }
    var d = m.media;
    var name = d.fileName || "";
    var mkv = /\.(mkv|webm)$/i.test(name) || /matroska|webm/i.test(d.mimeType || "");
    var head = await readRange(d, 0, Math.min(d.fileSize || 0, 2 * 1048576));
    var data = head;
    if (!mkv) {
      /* MP4: las pistas están en «moov»; puede ir al principio (lo normal en lo que sube el preparador) o al final */
      var i = 0;
      var ftyp = null;
      var moov = null;
      for (var n = 0; n < 60 && i < (d.fileSize || 0); n += 1) {
        var b = i + 16 <= head.length ? box(head, i) : box(await readRange(d, i, 16), 0);
        if (!b || b.size < 8) { break; } // tamaño 0 = «hasta el final»: no hay más cajas
        if (b.type === "ftyp" && i + b.size <= head.length) { ftyp = head.subarray(i, i + b.size); }
        if (b.type === "moov") {
          if (b.size > 64 * 1048576) { break; }
          moov = i + b.size <= head.length ? head.subarray(i, i + b.size) : await readRange(d, i, b.size);
          break;
        }
        i += b.size;
      }
      if (moov) {
        data = new Uint8Array((ftyp ? ftyp.length : 0) + moov.length);
        if (ftyp) { data.set(ftyp, 0); }
        data.set(moov, ftyp ? ftyp.length : 0);
      }
    }
    var r = await fetch("/api/probe-bytes?ext=" + (mkv ? "mkv" : "mp4"), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: data });
    var j = await r.json();
    if (!r.ok) { throw new Error(j.error || "ffprobe"); }
    return { audio: j.audio, subs: j.subs, at: Date.now(), v: 2 }; // v2: con el nombre de la pista (handler_name del MP4)
  }

  /* ===================== Inicio ===================== */
  function statusOf(t) {
    var miss = missingOf(t);
    var lang = langOf(t);
    var imgs = imgIssues(t);
    var langOk = lang.state === "es" || lang.state === "subs";
    var bad = langIssues(t).concat(subGaps(t));
    var emb = embeddedPending(t);
    var lp = t.type === "series" ? { audio: null, subs: null, gaps: [], srtBad: [] } : langPanel(t);
    return { miss: miss, lang: lang, imgs: imgs, bad: bad, emb: emb, lp: lp, full: !miss.length && langOk && !imgs.length && !bad.length && !emb.length && !lp.gaps.length && !lp.srtBad.length, noEs: lang.state === "no" };
  }
  var FILTERS = {
    todas: function () { return true; },
    completas: function (s) { return s.full; },
    faltan: function (s) { return s.miss.length > 0; },
    sin_espanol: function (s) { return s.noEs; },
    es_en: function (s) { return s.noEs || s.lp.gaps.length > 0; },
    srt: function (s) { return s.lp.srtBad.length > 0; },
    imagenes: function (s) { return s.imgs.length > 0; },
    idiomas: function (s) { return s.bad.length > 0; },
    separar: function (s) { return s.emb.length > 0; }
  };

  /* Los filtros de estado (las antiguas fichas de resumen): en una sola fila; los que están en 0 no ocupan sitio (van en «Más») */
  var TILES = [
    ["todas", "Todas", "Todo lo que hay en el chat", ""], ["faltan", "Falta renderizar", "Les falta alguna calidad", "warn"], ["es_en", "Español e inglés", "Les falta audio o subtítulos en alguno", "warn"],
    ["srt", "Subtítulos con fallas", "Incompletos, desfasados o dañados", "bad"], ["imagenes", "Imágenes por revisar", "Portada o banner no horizontal o repetida", "warn"],
    ["idiomas", "Idiomas por revisar", "Audio o subtítulos con el idioma mal", "warn"], ["separar", "Subtítulos por separar", "Aún van dentro de cada video", "warn"],
    ["completas", "Completas", "4 calidades, español, inglés e imágenes", "good"]
  ];
  function sortRank(t, s) { var g = tagOf(t, s); return g.cls === "bad" ? 0 : g.cls === "inc" ? 1 : 2; }
  var SORTERS = {
    name: function (x) { return String(x.t.name || "").toLowerCase(); },
    year: function (x) { return Number(x.t.year) || 0; },
    cat: function (x) { return catOf(x.t).toLowerCase() || "zzz"; },
    q: function (x) { return haveOf(x.t).length; },
    state: function (x) { return sortRank(x.t, x.s); }
  };

  function viewInicio() {
    var p = B.peer;
    if (!p) { return viewChats(); }
    var name = chatName(p);
    var pop = B.pop || "";
    var nImgs = B.lib ? B.titles.reduce(function (n, t) { return n + imgIssues(t).length; }, 0) : 0;
    var tools = B.lib ? '<div class="pop-wrap"><button class="ghost" data-act="pop" data-v="tools" aria-haspopup="true" aria-expanded="' + (pop === "tools") + '">Herramientas ▾</button>' +
      (pop === "tools" ? '<div class="hpop right" role="menu"><button role="menuitem" data-act="img-go" title="Revisar y cambiar las portadas y banners del grupo">Preparador de portadas<span class="pill ' + (nImgs ? "warn" : "dim") + '">' + nImgs + "</span></button>" +
        '<button role="menuitem" data-act="tm-go" title="Copiar el contenido a un grupo con temas, un tema por película">Migrar a grupo con temas</button>' +
        '<button role="menuitem" data-act="rb-go" title="Copiar todo, organizado por película, a un grupo de respaldo nuevo">Respaldar en grupo nuevo</button>' +
        '<button role="menuitem" data-act="im-go" title="Leer un canal o grupo con el formato antiguo y ver qué series y temporadas tiene (solo lectura)">Importar grupo antiguo</button>' +
        '<div class="hsep"></div><button role="menuitem" data-act="go-chats">Elegir otro chat</button></div>' : "") + "</div>" : "";
    var top = '<div class="htop"><div class="hl"><h1 class="libtitle">' + esc(name) + '</h1><span class="hint" id="libCount">' + topCount() + '</span><div class="scan" id="scan">' + scanHtml() + "</div>" +
      '<button class="ghost icon" data-act="reread" title="Volver a leer el chat" aria-label="Volver a leer el chat">↻</button></div>' +
      '<div class="hr">' + tools + '<button class="primary" data-act="new">＋ Preparar película</button></div></div>';
    if (B.reading) {
      return '<div class="s0 dash">' + top + '<div class="lib-center"><div class="lib-spin"></div><b>Leyendo ' + esc(name) + '…</b><span id="readN"></span></div></div>' + footInicio("Leyendo el chat…");
    }
    if (B.readError) {
      return '<div class="s0 dash">' + top + '<div class="note bad">' + esc(B.readError) + ' <button data-act="reread">Reintentar</button></div></div>' + footInicio("");
    }
    var st = B.titles.map(function (t) { return { t: t, s: statusOf(t) }; });
    var n = function (k) { return st.filter(function (x) { return FILTERS[k](x.s); }).length; };
    var counts = {};
    TILES.forEach(function (x) { counts[x[0]] = n(x[0]); });
    var shownTiles = TILES.filter(function (x) { return counts[x[0]] > 0 || x[0] === "todas" || B.filter === x[0]; });
    var hiddenTiles = TILES.filter(function (x) { return shownTiles.indexOf(x) < 0; });
    var pills = shownTiles.map(function (x) {
      var on = B.filter === x[0];
      return '<button class="fpill ' + x[3] + (on ? " on" : "") + '" data-act="filter" data-f="' + x[0] + '" aria-pressed="' + on + '" title="' + esc(x[2]) + '">' + x[1] + " <b>" + counts[x[0]] + "</b></button>";
    }).join("") + (hiddenTiles.length ? '<span class="pop-wrap"><button class="fpill more" data-act="pop" data-v="more" aria-haspopup="true" aria-expanded="' + (pop === "more") + '" title="Filtros sin resultados ahora: ' + hiddenTiles.map(function (x) { return x[1]; }).join(", ") + '">Más ▾</button>' +
      (pop === "more" ? '<div class="hpop" role="menu">' + hiddenTiles.map(function (x) { return '<button role="menuitem" data-act="filter" data-f="' + x[0] + '">' + x[1] + '<span class="pill dim">0</span></button>'; }).join("") + "</div>" : "") + "</span>" : "");
    var q = B.q.toLowerCase();
    /* categorías que hay en el chat (la que le toca a cada título: Marvel, Infantil, géneros…), contadas sobre lo que deja pasar el filtro de estado */
    var catCount = {};
    var catList;
    var inTile = st.filter(function (x) { return FILTERS[B.filter](x.s); });
    inTile.forEach(function (x) { var c = catOf(x.t); catCount[c] = (catCount[c] || 0) + 1; });
    catList = Object.keys(catCount).filter(function (c) { return c; }).sort(function (a, b) { return catRank(a) - catRank(b) || a.localeCompare(b, "es"); });
    if (catCount[""]) { catList.push(""); }
    if (B.cat && !catCount.hasOwnProperty(B.cat === NO_CAT ? "" : B.cat)) { B.cat = ""; } // la categoría elegida ya no tiene nada con este filtro
    var shown = inTile.filter(function (x) { return (!B.cat || catOf(x.t) === (B.cat === NO_CAT ? "" : B.cat)) && (!q || x.t.name.toLowerCase().indexOf(q) >= 0); });
    var catLabel = B.cat ? (B.cat === NO_CAT ? "Sin categoría" : B.cat) : "Todas";
    var catBtn = '<span class="pop-wrap"><button class="ctl" data-act="pop" data-v="cat" aria-haspopup="true" aria-expanded="' + (pop === "cat") + '"><span class="cl">Categoría</span> <b>' + esc(catLabel) + '</b> ▾</button>' +
      (pop === "cat" ? '<div class="hpop right catpop" role="menu"><button role="menuitem" data-act="cat" data-c="" class="' + (B.cat ? "" : "on") + '">Todas<span class="pill dim">' + inTile.length + "</span></button>" +
        catList.map(function (c) { var key = c || NO_CAT; return '<button role="menuitem" data-act="cat" data-c="' + esc(key) + '" class="' + (B.cat === key ? "on" : "") + '">' + esc(c || "Sin categoría") + '<span class="pill dim">' + catCount[c] + "</span></button>"; }).join("") + "</div>" : "") + "</span>";
    var mode = homeCards();
    var vert = mode === "v";
    var seg = '<div class="seg sm" role="group" aria-label="Forma de la lista">' +
      '<button data-act="home-cards" data-v="h" class="' + (mode === "h" ? "on" : "") + '" aria-pressed="' + (mode === "h") + '" title="Tarjetas horizontales (16:9)">▭</button>' +
      '<button data-act="home-cards" data-v="v" class="' + (mode === "v" ? "on" : "") + '" aria-pressed="' + (mode === "v") + '" title="Tarjetas verticales (póster 2:3)">▯</button>' +
      '<button data-act="home-cards" data-v="t" class="' + (mode === "t" ? "on" : "") + '" aria-pressed="' + (mode === "t") + '" title="Lista: se ordena por columna y se ve de un vistazo qué falta">☰</button></div>';
    var bar = '<div class="hbar"><div class="fpills" role="group" aria-label="Filtrar por estado">' + pills + '</div><div class="hctl">' + catBtn +
      '<input type="search" id="libQ" class="search" placeholder="Buscar…  ( / )" value="' + esc(B.q) + '" aria-label="Buscar una película o serie">' + seg + "</div></div>";
    var body;
    if (!shown.length) {
      body = '<div class="empty" style="grid-column:1/-1">' + (B.titles.length ? "Ninguna película con este filtro." : "Este chat no tiene películas ni series con el formato de HomeFlix.") + "</div>";
    } else if (mode === "t") {
      body = tableHtml(shown);
    } else {
      body = shown.map(function (x) { return card(x.t, x.s); }).join("");
    }
    var foot = {
      todas: "Toca una película para ver qué tiene en el grupo y qué le falta",
      completas: "Listas: todas las calidades, audio y subtítulos en español e inglés sin fallas, y portada y banner horizontales",
      faltan: "Con calidades por crear · en la ficha ves cuáles y las preparas",
      es_en: "Les falta audio o subtítulos aparte en español o en inglés",
      srt: "Subtítulos aparte que se cortan antes, no van al compás del español o tienen letras dañadas · en la ficha ves el detalle",
      imagenes: "Portada o banner vertical, cuadrado o muy pequeño",
      idiomas: "Pistas que la TV y el celular muestran con el idioma mal · se corrigen en la ficha sin volver a subir",
      separar: "Sus subtítulos van dentro de cada video · al pasarlos aparte, todas las calidades usan los mismos"
    }[B.filter] || "";
    var bulk = B.filter === "separar" && n("separar") ? '<div class="note warn" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span class="grow">' +
      (MIG.busy ? esc(MIG.busy) : "«Pasar con lo de este PC» usa los videos que ya tienes (originales o carpetas «- HomeFlix»): no baja nada. «Bajar y pasar» baja la versión más liviana de cada una. En los dos casos se sacan sus subtítulos como .srt y se publican aparte; los videos del grupo no se tocan.") + "</span>" +
      (MIG.busy ? '<button class="ghost sm" data-act="mig-stop">Detener</button>' : '<button class="primary sm" data-act="mig-local" title="Sin bajar nada: usa los originales o las carpetas «- HomeFlix» que haya en este PC">Pasar con lo de este PC</button>' +
        '<button class="ghost sm" data-act="mig-folder" title="Agregar una carpeta donde buscar los videos">＋ Carpeta…</button>' +
        '<button class="ghost sm" data-act="mig-all" title="Baja de cada una la versión más liviana">Bajar y pasar todas (' + n("separar") + ")</button>") + "</div>" : "";
    bulk += (MIG.msg && B.filter === "separar" ? '<div class="note ' + (/^No pude/.test(MIG.msg) ? "bad" : "ok") + '">' + esc(MIG.msg) + "</div>" : "");
    return '<div class="s0 dash">' + top + bar + bulk +
      '<div class="pane"><div class="pgrid ' + (mode === "t" ? "gt" : vert ? "gv" : "gh") + '" data-k="' + [B.filter, B.cat, B.q, mode, B.sort.k, B.sort.dir].join("|") + '">' + body + "</div></div></div>" + footInicio(shown.length + " de " + B.titles.length + (foot ? " · " + foot : ""));
  }
  function footInicio(text) {
    return '<div class="libfoot"><div class="status"><span class="dot ready"></span><span class="sum">' + esc(text) + "</span></div></div>";
  }
  /* La categoría en la que sale un título en la app (una sola: Marvel > Infantil > género), la misma que ven la TV y el celular. */
  var NO_CAT = "__sin";
  function catOf(t) { return window.HFLibrary && HFLibrary.primaryCategory ? HFLibrary.primaryCategory(t, true) || "" : ""; }
  function catRank(c) {
    var order = ["Marvel", "Infantil"].concat((window.HFLibrary && HFLibrary.CATEGORIES) || []);
    var i = order.indexOf(c);
    return i >= 0 ? i : 100;
  }
  ACT.cat = function (el) { B.cat = el.getAttribute("data-c") || ""; B.pop = ""; render(); };
  function homeCards() { var v = store(LS_CARDS); return v === "v" ? "v" : v === "t" ? "t" : "h"; }
  function topCount() {
    if (!B.lib) { return ""; }
    return "· " + B.lib.movies.length + (B.lib.movies.length === 1 ? " película" : " películas") + " · " + B.lib.series.length + " series · leído " +
      new Date(B.at).toLocaleTimeString("es", { hour: "numeric", minute: "2-digit" });
  }
  function scanHtml() {
    if (B.syncing && B.lib) { return '<span class="dot busy"></span><span>' + (B.me ? "Sincronizando con Telegram…" : "Conectando con Telegram…") + (B.fromCache ? " · lo de la última vez" : "") + "</span>"; }
    if (!B.langBusy && !B.langQueue.length) { return ""; }
    var pct = B.langTotal ? Math.round(B.langDone / B.langTotal * 100) : 0;
    return '<span class="dot busy"></span><span>Revisando idiomas · ' + B.langDone + " de " + B.langTotal + '</span><span class="bar"><i style="width:' + pct + '%"></i></span>';
  }
  function paintTop() {
    if ($("scan")) { $("scan").innerHTML = scanHtml(); }
  }
  /* cuando se sabe el idioma de una, se repinta solo su tarjeta (y los números de arriba al final) */
  function paintLang(t) {
    paintTop();
    if (B.view === "ficha" && B.sel === t) { render(); return; }
    var el = homeCards() === "t" ? null : document.querySelector('.pcard[data-card="' + CSS.escape(t.titleKey) + '"]'); // en la lista (tabla) se repinta todo al terminar
    if (el) { el.outerHTML = card(t, statusOf(t)); watchThumbs(); }
    if (!B.langQueue.length && B.view === "inicio") { render(); }
  }

  /* La etiqueta de arriba de cada película: color según lo que significa. Ámbar = hay una falla real; gris = está incompleta; ✓ = lista. */
  function tagOf(t, s) {
    var have = haveOf(t);
    if (s.full) { return { cls: "ok", text: "✓" }; }
    if (s.lp.srtBad.length) { return { cls: "bad", text: "Subtítulo con fallas" }; }
    if (s.bad.length) { return { cls: "bad", text: "Idioma por revisar" }; }
    if (s.imgs.length) { return { cls: "bad", text: s.imgs[0].kind + " " + s.imgs[0].issue.toLowerCase() }; }
    if (s.noEs) { return { cls: "bad", text: "Sin español" }; }
    if (s.miss.length === 3 && have.length === 1) { return { cls: "inc", text: "Solo " + have[0] }; }
    if (s.miss.length) { return { cls: "inc", text: "Faltan " + s.miss.length }; }
    if (s.emb.length) { return { cls: "inc", text: "Subtítulos por separar" }; }
    if (s.lp.gaps.length) { return { cls: "inc", text: s.lp.gaps.length > 1 ? "Faltan " + s.lp.gaps.length + " idiomas" : "Falta " + s.lp.gaps[0] }; }
    return { cls: "inc", text: LANG_TXT[s.lang.state] };
  }
  /* calidades: las que hay en verde, las que faltan apagadas */
  function qualRow(t) {
    var have = haveOf(t);
    return '<span class="qrow">' + QS.map(function (q) { return '<i class="' + (have.indexOf(q[0]) >= 0 ? "have" : "miss") + '">' + (q[0] === "4K" ? "4K" : q[1]) + "</i>"; }).join("") + "</span>";
  }
  /* idiomas en una sola línea: 🔊 ES EN  💬 ES EN. Ámbar solo lo que falla (falta, falta pasarlo aparte o con fallas). */
  function langMini(t, s) {
    var lp = s.lp;
    var au = function (c, lab) { return '<i class="' + (!lp.audio ? "w" : lp.audio[c] ? "h" : "m") + '" title="Audio en ' + (c === "spa" ? "español" : "inglés") + (!lp.audio ? ": revisando" : lp.audio[c] ? "" : ": falta") + '">' + lab + "</i>"; };
    var sb = function (c, lab) {
      var x = lp.subs[c];
      var cl = x.bad ? "b" : x.state === "falta" ? "m" : x.state === "dentro" ? "d" : "h";
      return '<i class="' + cl + '" title="Subtítulos en ' + (c === "spa" ? "español" : "inglés") + ": " + ({ pelicula: "venía con la película", agregado: "agregado aparte", dentro: "solo dentro de los videos: falta pasarlo aparte", falta: "falta" }[x.state]) + (x.bad ? " · con fallas" : "") + '">' + lab + (x.bad ? "!" : "") + "</i>";
    };
    if (t.type === "series") { return '<span class="lmini"><span class="lang ' + LANG_CLS[s.lang.state] + '">' + esc(LANG_TXT[s.lang.state]) + "</span></span>"; }
    return '<span class="lmini"><span class="lg" aria-hidden="true">🔊</span>' + au("spa", "ES") + au("eng", "EN") + '<span class="lg" aria-hidden="true">💬</span>' + sb("spa", "ES") + sb("eng", "EN") + "</span>";
  }
  function card(t, s) {
    var tg = tagOf(t, s);
    var imgKey = homeCards() === "v" ? (t.verticalKey || t.imageKey || (t.video && t.video.key)) : (t.imageKey || (t.video && t.video.key));
    return '<button class="pcard" data-act="ficha" data-card="' + esc(t.titleKey) + '" aria-label="' + esc(t.name + (t.year ? " (" + t.year + ")" : "")) + '" title="' + esc(t.name + (t.year ? " (" + t.year + ")" : "")) + '">' +
      '<span class="art" data-thumb="' + esc(imgKey || "") + '"' + thumbStyle(imgKey) + '><span class="ph">' + esc(t.name) + '</span><span class="sttag ' + tg.cls + '">' + esc(tg.text) + "</span></span>" +
      '<span class="pname"><b>' + esc(t.name) + "</b><small>" + esc(t.type === "series" ? "Serie" : t.year || "") + "</small></span>" +
      '<span class="pmeta">' + qualRow(t) + langMini(t, s) + "</span></button>";
  }
  /* La misma lista en forma de tabla: se ordena por columna y se ve de un vistazo qué falta */
  function tableHtml(shown) {
    var k = SORTERS[B.sort.k] ? B.sort.k : "name";
    var dir = B.sort.dir === -1 ? -1 : 1;
    var rows = shown.slice().sort(function (a, b) {
      var x = SORTERS[k](a);
      var y = SORTERS[k](b);
      var r = typeof x === "string" ? x.localeCompare(y, "es") : x - y;
      return (r || String(a.t.name).localeCompare(String(b.t.name), "es")) * dir;
    });
    var th = function (key, label, cls) {
      var on = key === k;
      return '<th class="' + (cls || "") + (on ? " on" : "") + '"><button data-act="th-sort" data-k="' + key + '" aria-label="Ordenar por ' + label + '">' + label + (on ? (dir === 1 ? " ▲" : " ▼") : "") + "</button></th>";
    };
    return '<table class="ptable"><thead><tr>' + th("name", "Título", "c-t") + th("year", "Año") + th("cat", "Categoría") + th("q", "Calidades") + '<th>Idiomas</th>' + th("state", "Estado") + "</tr></thead><tbody>" +
      rows.map(function (x) {
        var t = x.t;
        var tg = tagOf(t, x.s);
        var imgKey = t.imageKey || (t.video && t.video.key);
        return '<tr class="trow" data-act="ficha" data-card="' + esc(t.titleKey) + '" title="' + esc(t.name + (t.year ? " (" + t.year + ")" : "")) + '" tabindex="0"><td class="c-t"><div class="cell"><span class="tth" data-thumb="' + esc(imgKey || "") + '"' + thumbStyle(imgKey) + '></span><b>' + esc(t.name) + "</b></div></td><td>" + esc(t.type === "series" ? "Serie" : t.year || "") + "</td><td>" + esc(catOf(t) || "—") + "</td><td>" + qualRow(t) + "</td><td>" + langMini(t, x.s) +
          '</td><td><span class="sttag in ' + tg.cls + '">' + esc(tg.cls === "ok" ? "✓ Completa" : tg.text) + "</span></td></tr>";
      }).join("") + "</tbody></table>";
  }

  ACT["home-cards"] = function (el) { var v = el.getAttribute("data-v"); store(LS_CARDS, v === "v" ? "v" : v === "t" ? "t" : "h"); render(); };
  ACT.filter = function (el) { B.filter = el.getAttribute("data-f"); B.pop = ""; render(); };
  ACT.pop = function (el) { var v = el.getAttribute("data-v"); B.pop = B.pop === v ? "" : v; render(); };
  ACT["th-sort"] = function (el) { var k = el.getAttribute("data-k"); B.sort = { k: k, dir: B.sort.k === k ? -B.sort.dir : 1 }; render(); };
  ACT.reread = function () { if (!PREP.busy()) { readChat({ full: true }); } };
  ACT["go-chats"] = function () { show("chats"); };
  /* Siempre empieza en blanco: sin lo de la película de la cola que se estaba viendo ni lo que quedó de la anterior (pestañas 1 a 4). */
  ACT.new = function () {
    show("tabs");
    if (!PREP.newMovie()) {
      PREP.showTab(1);
      alert("Hay una publicación manual (o un video de esta pantalla) en curso en las pestañas: cuando termine, pulsa «Preparar una película nueva» otra vez para dejarlas en blanco. Lo que sube o renderiza la cola no estorba.");
    }
  };
  ACT.ficha = function (el) {
    var k = el.getAttribute("data-card");
    B.sel = B.titles.filter(function (t) { return t.titleKey === k; })[0] || null;
    B.fTab = "idioma";
    if (B.sel) {
      /* su idioma primero */
      var t = B.sel;
      if (t.video && (!B.langs[t.video.key] || fileGroups(t).some(function (g) { return !g.r; }))) { B.langQueue = [t].concat(B.langQueue.filter(function (x) { return x !== t; })); runLangs(); }
      show("ficha");
    }
  };

  /* ----- imágenes de las tarjetas: se piden a Telegram al aparecer en pantalla ----- */
  function thumbStyle(key) {
    var u = key && B.thumbs[key];
    return u && u !== "pending" && u !== "none" ? ' style="background-image:url(\'' + u + '\')"' : "";
  }
  var observer = null;
  function watchThumbs() {
    if (!observer) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) { return; }
          observer.unobserve(e.target);
          var k = e.target.getAttribute("data-thumb");
          if (k && !B.thumbs[k]) {
            B.thumbs[k] = "pending";
            thumbFromCache(k).then(function (ok) { if (!ok) { B.thumbQueue.push(k); pumpThumbs(); } });
          }
        });
      }, { rootMargin: "300px" });
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-thumb]"), function (el) {
      var k = el.getAttribute("data-thumb");
      if (k && !B.thumbs[k]) { observer.observe(el); }
    });
  }
  /* Llave de la portada guardada: incluye el peso y las medidas de la foto, así que si se reemplaza la imagen deja de valer sola */
  function thumbCacheKey(key) {
    var it = B.byKey[key];
    return "t:" + meId() + ":" + key + ":" + (it ? it.size + ":" + it.width + "x" + it.height : "");
  }
  function paintThumb(key) {
    var u = B.thumbs[key];
    if (!u || u === "pending") { return; }
    Array.prototype.forEach.call(document.querySelectorAll('[data-thumb="' + CSS.escape(key) + '"]'), function (el) {
      if (u === "none") { el.setAttribute("data-none", "1"); return; } // sin imagen: deja de «cargar» (el brillo de espera se apaga)
      el.style.backgroundImage = "url('" + u + "')";
    });
  }
  function thumbFromCache(key) {
    if (!window.PrepCache) { return Promise.resolve(false); }
    return PrepCache.thumbGet(thumbCacheKey(key)).then(function (buf) {
      if (!buf) { return false; }
      B.thumbs[key] = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
      paintThumb(key);
      return true;
    }, function () { return false; });
  }
  /* las que esperaban a que llegaran los mensajes de Telegram (sin ellos no se puede pedir la imagen) */
  function releaseThumbs() {
    var wait = B.thumbWait || [];
    B.thumbWait = [];
    wait.forEach(function (k) { B.thumbQueue.push(k); });
    pumpThumbs();
  }
  function pickThumb(list, want) {
    var best = null;
    (list || []).forEach(function (t) {
      if (!t.width || t.isVideo || t.type === "i" || t.type === "j") { return; }
      if (!best || Math.abs(t.width - want) < Math.abs(best.width - want)) { best = t; }
    });
    return best;
  }
  /* El mensaje de Telegram de un elemento por su clave «chat:mensaje» (si no estaba en memoria); null si ya no existe.
   * Las peticiones que llegan juntas se agrupan: UNA llamada por hasta 100 mensajes del mismo chat (antes era una por imagen, y con
   * decenas de portadas Telegram contestaba FLOOD_WAIT y quedaban en blanco). Reintenta ante FLOOD_WAIT. */
  var msgBatch = { chats: {}, timer: null };
  function msgByKey(key) {
    if (B.msgs[key]) { return Promise.resolve(B.msgs[key]); }
    var parts = String(key).split(":");
    var chat = Number(parts[0]);
    var id = Number(parts[1]);
    if (!chat || !id) { return Promise.resolve(null); }
    return new Promise(function (resolve, reject) {
      var bk = msgBatch.chats[chat] = msgBatch.chats[chat] || { ids: [], w: {} };
      (bk.w[id] = bk.w[id] || []).push({ ok: resolve, no: reject });
      if (bk.ids.indexOf(id) < 0) { bk.ids.push(id); }
      if (!msgBatch.timer) { msgBatch.timer = setTimeout(flushMsgs, 60); }
    });
  }
  function flushMsgs() {
    var all = msgBatch.chats;
    msgBatch.timer = null;
    msgBatch.chats = {};
    Object.keys(all).forEach(function (chat) {
      var bk = all[chat];
      var i;
      var run = function (ids) {
        var go = function (n) {
          return B.client.getMessages(Number(chat), ids).then(null, function (e) {
            var t = String((e && (e.text || e.message)) || e);
            if (/FLOOD/i.test(t) && n < 3) { return new Promise(function (ok) { setTimeout(ok, 8000 * (n + 1)); }).then(function () { return go(n + 1); }); }
            throw e;
          });
        };
        go(0).then(function (list) {
          var byId = {};
          (list || []).forEach(function (m) { if (m && m.id) { byId[m.id] = m; B.msgs[chat + ":" + m.id] = m; } });
          ids.forEach(function (id) { (bk.w[id] || []).forEach(function (w) { w.ok(byId[id] || null); }); });
        }, function (e) {
          ids.forEach(function (id) { (bk.w[id] || []).forEach(function (w) { w.no(e); }); });
        });
      };
      for (i = 0; i < bk.ids.length; i += 100) { run(bk.ids.slice(i, i + 100)); }
    });
  }
  /* ¿está esta imagen a la vista ahora mismo (dentro de la lista o de la pantalla)? */
  function onScreen(key) {
    var el = document.querySelector('[data-thumb="' + CSS.escape(key) + '"]');
    var r;
    var c;
    var box;
    if (!el) { return false; }
    r = el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > window.innerHeight) { return false; }
    c = el.closest(".pgrid, .ilist");
    if (c) { box = c.getBoundingClientRect(); if (r.bottom < box.top || r.top > box.bottom) { return false; } }
    return true;
  }
  /* Las imágenes que se ven van PRIMERO (si se baja de prisa por la lista, las que ya se pasaron no hacen esperar a las de la pantalla) y,
   * de esas, se piden juntos los mensajes (una sola llamada). */
  function prioritizeThumbs() {
    var vis = [];
    var rest = [];
    var q = B.thumbQueue;
    q.forEach(function (k, i) { if (i < 400 && onScreen(k)) { vis.push(k); } else { rest.push(k); } });
    B.thumbQueue = vis.concat(rest);
    if (!(B.syncing && !B.msgsReady && !B.forceMsg)) {
      B.msgPre = B.msgPre || {};
      B.thumbQueue.slice(0, 60).forEach(function (k) {
        if (!B.msgs[k] && !B.msgPre[k]) {
          B.msgPre[k] = msgByKey(k);
          B.msgPre[k].then(null, function () { /* se atiende al pedir la imagen */ });
        }
      });
    }
  }
  function pumpThumbs() {
    if (B.thumbQueue.length > 1) { prioritizeThumbs(); }
    while (B.thumbBusy < 3 && B.thumbQueue.length) {
      var k = B.thumbQueue.shift();
      B.thumbBusy += 1;
      (function (key) {
        var m = B.msgs[key];
        var d = m && m.media;
        if (!m && B.syncing && !B.msgsReady && !B.forceMsg) {
          /* todavía no llegaron los mensajes: se pide al terminar de sincronizar (lo guardado ya se pintó) */
          (B.thumbWait = B.thumbWait || []).push(key);
          if (!B.waitTimer) {
            B.waitTimer = setTimeout(function () { B.waitTimer = null; if ((B.thumbWait || []).length) { B.forceMsg = true; releaseThumbs(); } }, 15000);
          }
          B.thumbBusy -= 1;
          return;
        }
        /* Sin el mensaje (la lectura de fondo falló, por ejemplo por FLOOD_WAIT de Telegram) se pide ESTE mensaje por su número: antes la imagen
         * se daba por inexistente y quedaba en blanco para siempre («Así está hoy» vacío, portadas verticales sin detectar). Si Telegram falla
         * (no que el mensaje no exista), no se marca como sin imagen: se vuelve a intentar más tarde. */
        var tries = ((B.thumbTry = B.thumbTry || {})[key] = (B.thumbTry[key] || 0) + 1);
        (m ? Promise.resolve(m) : (B.msgPre && B.msgPre[key]) || msgByKey(key)).then(function (mm) {
          var dd = mm && mm.media;
          var th = dd ? (dd.type === "photo" ? pickThumb(dd.thumbnails, 480) : (dd.videoCover && pickThumb(dd.videoCover.thumbnails, 480)) || pickThumb(dd.thumbnails, 480)) : null;
          return th ? B.client.downloadAsBuffer(th) : null;
        }).then(function (buf) {
          B.thumbs[key] = buf ? URL.createObjectURL(new Blob([buf], { type: "image/jpeg" })) : "none";
          if (buf && window.PrepCache) { PrepCache.thumbPut(thumbCacheKey(key), buf.slice ? buf.slice(0) : buf); }
        }, function () {
          if (tries < 5) { setTimeout(function () { B.thumbQueue.push(key); pumpThumbs(); }, 12000 * tries); } else { B.thumbs[key] = "none"; }
        }).then(function () {
          if (B.msgPre) { delete B.msgPre[key]; }
          B.thumbBusy -= 1;
          paintThumb(key);
          pumpThumbs();
        });
      })(k);
    }
  }

  /* ===================== Migrar a un grupo con temas / Respaldo en un grupo nuevo =====================
   * Las dos pantallas son la misma máquina (PrepTopics.plan + PrepTopics.migrate): copiar sin volver a subir, un tema por película.
   *   · migrar: a un grupo con temas que ya existe (para pasar a trabajar en él);
   *   · respaldo: a un grupo con temas NUEVO que se crea aquí mismo (o a un respaldo anterior, que se pone al día con lo nuevo).
   * El avance se guarda por origen y destino: si se corta o se vuelve a pulsar, solo se copia lo que falta. */
  var TM = { mode: "migrar", dest: "", plan: null, st: null, running: false, creating: false, abort: null, prog: null, err: "", verify: "", paintAt: 0, off: {}, extra: [], name: "", tab: "nuevo", q: "", f: "todos", menu: false, pickOpen: false };
  function gb(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : Math.round((n || 0) / 1048576) + " MB"; }
  function tmPrefix() { return TM.mode === "respaldo" ? "hf.preparador.respaldo." : "hf.preparador.migracion."; }
  function tmKey(dest) { return tmPrefix() + (B.peer ? B.peer.id : "") + "." + (dest || TM.dest); }
  function tmEmpty() { return { topics: {}, sent: {}, done: {} }; }
  function tmLoad(dest) { try { return JSON.parse(store(tmKey(dest)) || "null") || tmEmpty(); } catch (e) { return tmEmpty(); } }
  function tmSave(st) { store(tmKey(), JSON.stringify(st)); }
  function tmPlan() {
    if (!TM.plan && window.PrepTopics && B.items) { TM.plan = PrepTopics.plan(B.items.filter(function (it) { return it.kind === "video" || it.kind === "photo" || it.kind === "sub" || it.kind === "thumbs"; })); }
    return TM.plan;
  }
  /* lo elegido: los temas que no están desmarcados */
  function tmSel() {
    var plan = tmPlan();
    var groups = plan ? plan.groups.filter(function (g) { return !TM.off[g.gid]; }) : [];
    return { groups: groups, total: groups.reduce(function (n, g) { return n + g.items.length; }, 0), bytes: groups.reduce(function (n, g) { return n + g.bytes; }, 0), skipped: plan ? plan.skipped : [] };
  }
  /* los grupos con temas a los que se puede copiar (menos el de origen); los recién creados aquí entran aunque Telegram aún no los liste */
  function tmDests() {
    var seen = {};
    return (B.chats || []).concat(TM.extra).filter(function (p) {
      var id = String(p.id);
      if (seen[id] || !B.peer || id === String(B.peer.id) || !window.PrepTopics || !PrepTopics.isForum(p)) { return false; }
      seen[id] = true;
      return true;
    });
  }
  function tmDest() { return tmDests().filter(function (p) { return String(p.id) === TM.dest; })[0]; }
  function tmSentIn(st, g) { return g.items.filter(function (it) { return st && st.sent && st.sent[it.key]; }).length; }
  function lastBackup() { try { return JSON.parse(store("hf.preparador.respaldos") || "{}") || {}; } catch (e) { return {}; } }

  /* ---- las filas de la derecha (se repintan solas al buscar o filtrar, sin tocar el resto) ---- */
  function tmRowState(g, st) {
    var done = !!st && tmSentIn(st, g) >= g.items.length;
    return { done: done, now: TM.running && TM.prog && TM.prog.title === g.topic && !done, on: !TM.off[g.gid] };
  }
  function tmRows() {
    var plan = tmPlan();
    var st = TM.dest ? (TM.st || (TM.st = tmLoad())) : null;
    var q = norm2(TM.q);
    var back = TM.mode === "respaldo";
    var busy = TM.running || TM.creating;
    var list;
    if (!plan) { return '<div class="empty">Leyendo el chat…</div>'; }
    list = plan.groups.filter(function (g) {
      var on = !TM.off[g.gid];
      return (TM.f === "todos" || (TM.f === "marcados" ? on : !on)) && (!q || norm2(g.topic).indexOf(q) >= 0);
    });
    return list.map(function (g) {
      var r = tmRowState(g, st);
      var parts = [g.counts.video ? g.counts.video + (g.counts.video === 1 ? " video" : " videos") : "", g.counts.photo ? g.counts.photo + (g.counts.photo === 1 ? " imagen" : " imágenes") : "",
        g.counts.sub ? g.counts.sub + " sub." : "", g.counts.thumbs ? g.counts.thumbs + " miniat." : ""].filter(Boolean).join(" · ");
      var badge = r.done ? [back ? "Respaldado" : "Ya migrado", "good"] : r.now ? ["Copiando…", "gold"] : r.on ? ["Se copiará", "gold"] : ["Omitido", "dim"];
      return '<label class="tmrow' + (r.done ? " done" : "") + (r.now ? " now" : "") + (r.on ? " on" : " off") + '"><input type="checkbox" data-act="tm-pick" data-gid="' + esc(g.gid) + '"' + (r.on ? " checked" : "") + (busy ? " disabled" : "") + ' aria-label="' + esc(g.topic) + '">' +
        '<span class="tmn"><b>' + esc(g.topic) + "</b><small>" + esc(parts) + " · " + gb(g.bytes) + '</small></span><span class="pill ' + badge[1] + '">' + badge[0] + "</span></label>";
    }).join("") || '<div class="empty">' + (TM.q ? "Ningún título con «" + esc(TM.q) + "»." : "No hay temas en este filtro.") + "</div>";
  }
  function norm2(x) { return String(x || "").toLowerCase().normalize ? String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim() : String(x || "").toLowerCase().trim(); }

  function viewTemas() {
    var back = TM.mode === "respaldo";
    var plan = tmPlan();
    var sel = tmSel();
    var dests = tmDests();
    var st = TM.dest ? (TM.st || (TM.st = tmLoad())) : null;
    var sent = st ? sel.groups.reduce(function (n, g) { return n + tmSentIn(st, g); }, 0) : 0;
    var total = sel.total;
    var pct = total ? Math.min(100, Math.round(sent / total * 100)) : 0;
    var finished = !!st && total > 0 && sent >= total;
    var busy = TM.running || TM.creating;
    var last = lastBackup()[B.peer ? String(B.peer.id) : ""] || "";
    var dest = tmDest();
    var nOn = sel.groups.length;
    var nAll = plan ? plan.groups.length : 0;
    var word = back ? "respaldo" : "migración";
    /* ---- paso 1: grupo de destino ---- */
    var prevOf = function (id) { try { var o = JSON.parse(store(tmPrefix() + (B.peer ? B.peer.id : "") + "." + id) || "null"); return o && o.sent ? Object.keys(o.sent).length : 0; } catch (e) { return 0; } };
    var tabs = '<div class="seg sm tmtabs" role="tablist" aria-label="Grupo de destino"><button role="tab" data-act="tm-tab" data-v="nuevo" class="' + (TM.tab === "nuevo" ? "on" : "") + '" aria-selected="' + (TM.tab === "nuevo") + '"' + (busy ? " disabled" : "") + '>Crear grupo nuevo</button>' +
      '<button role="tab" data-act="tm-tab" data-v="existente" class="' + (TM.tab === "existente" ? "on" : "") + '" aria-selected="' + (TM.tab === "existente") + '"' + (busy ? " disabled" : "") + ">Usar grupo existente</button></div>";
    var pane;
    if (TM.tab === "nuevo") {
      pane = '<div class="tmname"><input type="text" id="tmName" class="search" maxlength="120" value="' + esc(TM.name || chatName(B.peer) + (back ? " · Respaldo" : " · Temas")) + '" aria-label="Nombre del grupo nuevo"' + (busy ? " disabled" : "") + '>' +
        '<button class="primary" data-act="tm-crear"' + (busy ? " disabled" : "") + ' title="Crea un grupo privado, con temas y a tu nombre. Después eliges qué copiar y lo inicias tú.">' + (TM.creating ? "Creando…" : "Crear grupo") + "</button></div>";
    } else if (dest) {
      var prev = prevOf(String(dest.id));
      pane = '<div class="tmdestcard"><span class="av" aria-hidden="true">' + esc(chatName(dest).charAt(0).toUpperCase()) + '</span><span class="tx"><b>' + esc(chatName(dest)) + "</b><small>Grupo con temas" + (back && last === String(dest.id) ? " · tu último respaldo" : "") + '</small></span>' +
        '<span class="pill ' + (prev ? "gold" : "dim") + '">' + (prev ? prev + (back ? " respaldados" : " ya migrados") : "Vacío") + '</span><button class="ghost sm" data-act="tm-cambiar"' + (busy ? " disabled" : "") + ">Cambiar grupo</button></div>";
    } else {
      pane = '<div class="tmdestcard empty"><span class="tx"><b>Aún no eliges un grupo</b><small>Elige uno que ya tengas o crea uno nuevo.</small></span><button class="ghost sm" data-act="tm-cambiar"' + (busy ? " disabled" : "") + ">Elegir grupo</button></div>";
    }
    if (TM.tab === "existente" && TM.pickOpen) {
      pane += '<div class="tmpick"><div class="tmpickh"><b>Tus grupos con temas</b><button class="ghost sm" data-act="tm-find"' + (busy ? " disabled" : "") + '>Buscar mis grupos</button></div>' +
        (dests.map(function (p) {
          var id = String(p.id);
          var n = prevOf(id);
          return '<button class="chat' + (id === TM.dest ? " on" : "") + '" data-act="tm-dest" data-id="' + esc(id) + '" role="radio" aria-checked="' + (id === TM.dest) + '"><span class="radio" aria-hidden="true"></span><span class="av" aria-hidden="true">' + esc(chatName(p).charAt(0).toUpperCase()) +
            '</span><span class="tx"><b>' + esc(chatName(p)) + "</b><small>" + (n ? n + (back ? " mensajes de respaldo" : " mensajes migrados") : "Grupo con temas") + "</small></span></button>";
        }).join("") || '<div class="hint" style="padding:6px 2px">No hay grupos con temas todavía: crea uno en la otra pestaña, o actívalos en Telegram (Ajustes del grupo → Temas) y pulsa «Buscar mis grupos».</div>') + "</div>";
    }
    var step1 = '<div class="tmstep"><div class="tmsh"><span class="tmnum">1</span><b>Grupo de destino</b></div>' + tabs + pane + "</div>";
    /* ---- paso 2: resumen ---- */
    var tiles = '<div class="tmtiles"><div><b>' + nOn + '</b><span>temas' + (nOn < nAll ? " de " + nAll : "") + "</span></div><div><b>" + sel.total + "</b><span>mensajes</span></div><div><b>" + gb(sel.bytes) + "</b><span>de videos</span></div><div title=\"Versiones viejas o ya reemplazadas: no se copian\"><b>" + (plan ? plan.skipped.length : 0) + "</b><span>omitidos</span></div></div>";
    var step2 = '<div class="tmstep"><div class="tmsh"><span class="tmnum">2</span><b>Resumen</b><span class="tmtip" title="Solo se copia lo vigente: la versión actual de cada calidad, sus imágenes y subtítulos. Lo que no tiene comentario de HomeFlix va al tema «Sin clasificar».">?</span></div>' + tiles + "</div>";
    /* ---- paso 3: ejecución ---- */
    var state = TM.creating ? ["busy", "Creando el grupo en Telegram…"] : TM.running ? ["busy", TM.prog && TM.prog.step === "espera" ? "Telegram pidió esperar " + TM.prog.wait + " s…" : "Copiando" + (TM.prog && TM.prog.title ? " «" + TM.prog.title + "»" : "…")] :
      TM.err ? ["bad", TM.err] : finished ? ["good", back ? "Respaldo al día" : "Migración completada"] : sent ? ["warn", "Se detuvo: sigue donde iba"] : dest ? ["ready", "Listo para iniciar"] : ["ready", "Elige o crea el grupo de destino"];
    var icon = { busy: "◔", bad: "!", good: "✓", warn: "⏸", ready: "●" }[state[0]];
    var sub = TM.err ? "" : finished ? (back ? "Todos los temas marcados están copiados." : "Todos los temas marcados se copiaron al grupo nuevo.") : "";
    var progress = '<div class="tmprog"><div class="tmpt"><span class="tmico ' + state[0] + '">' + icon + "</span><div><b>" + esc(state[1]) + "</b>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + '</div></div>' +
      '<div class="tmbar2"><div class="tmtrack"><i style="width:' + pct + '%"></i></div><span class="tmpct">' + pct + " %</span></div>" +
      '<div class="tmcount">' + sent + " / " + total + " mensajes (" + gb(sel.bytes) + ")</div>" + (TM.verify ? '<div class="tmnote ok"><span>✓</span><div>' + esc(TM.verify) + "</div></div>" : "") + "</div>";
    var primary = TM.running ? '<button class="danger" data-act="tm-stop">Pausar</button>' :
      (!back && finished) ? '<button class="primary" data-act="tm-use">Activar y usar este grupo →</button>' :
      '<button class="primary" data-act="tm-start"' + (!dest || !nOn ? " disabled" : "") + ">" + (finished ? "Volver a revisar" : sent ? "Continuar " + word : "Iniciar " + word) + (nOn ? " (" + nOn + (nOn === 1 ? " tema)" : " temas)") : "") + "</button>";
    var menu = '<div class="tmmenu"><button class="ghost" data-act="tm-menu" aria-haspopup="true" aria-expanded="' + !!TM.menu + '"' + (busy ? " disabled" : "") + '>Más opciones ▾</button>' +
      (TM.menu ? '<div class="tmpop" role="menu"><button role="menuitem" data-act="tm-map"' + (sent ? "" : " disabled") + '>Descargar el mapa de mensajes (.json)</button><button role="menuitem" class="redtx" data-act="tm-reset"' + (sent ? "" : " disabled") + ">Empezar de cero…</button></div>" : "") + "</div>";
    var verify = finished ? '<button class="ghost" data-act="tm-verify" title="Cuenta los videos del grupo nuevo y los compara con lo esperado">Verificar en Telegram</button>' : "";
    var step3 = '<div class="tmstep"><div class="tmsh"><span class="tmnum">3</span><b>Ejecución</b></div>' + progress + '<div class="tmactions">' + menu + '<span class="tmsp"></span>' + verify + primary + "</div></div>";
    /* ---- derecha: qué temas ---- */
    var counts = { todos: nAll, marcados: nOn, omitidos: nAll - nOn };
    var pills = [["todos", "Todos"], ["marcados", "Marcados"], ["omitidos", "Sin marcar"]].map(function (f) {
      return '<button data-act="tm-f" data-v="' + f[0] + '" class="' + (TM.f === f[0] ? "on" : "") + '" aria-pressed="' + (TM.f === f[0]) + '">' + f[1] + " · " + counts[f[0]] + "</button>";
    }).join("");
    var right = '<div class="tmrh"><h2>' + (back ? "Temas a respaldar" : "Temas a migrar") + ' <span class="hint">' + nOn + " de " + nAll + ' marcados</span></h2>' +
      '<div class="tmtools"><input type="search" id="tmQ" class="search" placeholder="Buscar película o serie…" value="' + esc(TM.q) + '" aria-label="Buscar película o serie"><div class="seg sm" role="group" aria-label="Filtrar temas">' + pills + "</div>" +
      (plan && !busy ? '<span class="tmq"><button class="ghost sm" data-act="tm-all" title="Marca todos los que se ven">Marcar</button><button class="ghost sm" data-act="tm-none" title="Quita la marca a todos los que se ven">Quitar</button></span>' : "") + "</div></div>" +
      '<div class="tmlist">' + tmRows() + "</div>";
    return '<div class="s7"><section class="tmleft"><div class="crumb"><a href="#" data-act="inicio">Inicio</a><span aria-hidden="true">›</span><span>' + (back ? "Respaldo en un grupo nuevo" : "Migrar a un grupo con temas") + "</span></div>" +
      '<div class="tmhead"><h2 class="tmh">' + (back ? "Respaldar en un grupo nuevo" : "Migrar a un grupo con temas") + '</h2><p class="hint" title="Telegram reenvía los mensajes sin volver a subirlos: es rápido y no gasta tu internet. El grupo de ahora no se toca.">' +
      (back ? "Una copia de seguridad, un tema por película, sin volver a subir nada." : "Cada película en su propio tema, sin volver a subir nada.") + "</p></div>" +
      step1 + step2 + step3 + '</section><section class="tmright">' + right + "</section></div>" +
      '<div class="libfoot"><div class="status"><span class="dot ' + (busy ? "busy" : "ready") + '"></span><span class="sum">' + esc(busy ? (back ? "Respaldando… no cierres esta pestaña" : "Migrando… no cierres esta pestaña") : "Copia sin autor: los videos no se vuelven a subir") + '</span></div>' +
      '<div class="btns"><button class="ghost" data-act="inicio">← Inicio</button></div></div>';
  }
  function tmPaint() { if (B.view === "temas" && Date.now() - TM.paintAt > 250) { TM.paintAt = Date.now(); render(); } }

  function tmOpen(mode) {
    var l;
    TM.mode = mode; TM.plan = null; TM.err = ""; TM.verify = ""; TM.st = null; TM.dest = ""; TM.off = {}; TM.q = ""; TM.f = "todos"; TM.menu = false; TM.pickOpen = false; TM.tab = "nuevo";
    if (mode === "respaldo") {
      l = lastBackup()[B.peer ? String(B.peer.id) : ""];
      if (l && tmDests().some(function (p) { return String(p.id) === String(l); })) { TM.dest = String(l); TM.tab = "existente"; }
    }
    show("temas");
  }
  ACT["tm-go"] = function () { tmOpen("migrar"); };
  ACT["rb-go"] = function () { tmOpen("respaldo"); };
  ACT["tm-find"] = function () { loadChats(); setTimeout(function () { TM.plan = null; render(); }, 2500); };
  ACT["tm-tab"] = function (el) { if (TM.running || TM.creating) { return; } TM.tab = el.getAttribute("data-v") === "existente" ? "existente" : "nuevo"; TM.pickOpen = TM.tab === "existente" && !TM.dest; TM.menu = false; render(); };
  ACT["tm-cambiar"] = function () { TM.pickOpen = !TM.pickOpen; TM.menu = false; render(); };
  ACT["tm-dest"] = function (el) { if (TM.running || TM.creating) { return; } TM.dest = el.getAttribute("data-id"); TM.st = null; TM.err = ""; TM.verify = ""; TM.pickOpen = false; render(); };
  ACT["tm-menu"] = function () { TM.menu = !TM.menu; render(); };
  ACT["tm-f"] = function (el) { TM.f = el.getAttribute("data-v") || "todos"; render(); };
  ACT["tm-pick"] = function (el) { var g = el.getAttribute("data-gid"); if (el.checked) { delete TM.off[g]; } else { TM.off[g] = true; } render(); };
  /* marcar / quitar: solo los que se ven con el buscador y el filtro actuales */
  function tmVisible() {
    var plan = tmPlan();
    var q = norm2(TM.q);
    return plan ? plan.groups.filter(function (g) {
      var on = !TM.off[g.gid];
      return (TM.f === "todos" || (TM.f === "marcados" ? on : !on)) && (!q || norm2(g.topic).indexOf(q) >= 0);
    }) : [];
  }
  ACT["tm-all"] = function () { tmVisible().forEach(function (g) { delete TM.off[g.gid]; }); render(); };
  ACT["tm-none"] = function () { tmVisible().forEach(function (g) { TM.off[g.gid] = true; }); render(); };
  ACT["tm-reset"] = function () {
    TM.menu = false;
    if (TM.running || !confirm("¿Empezar de cero? Se olvida lo que ya se copió (en el grupo de destino se queda; si vuelves a copiar, quedaría repetido).")) { render(); return; }
    TM.st = tmEmpty();
    tmSave(TM.st);
    TM.err = ""; TM.verify = "";
    render();
  };
  ACT["tm-stop"] = function () { if (TM.abort) { TM.abort.abort(); } };

  /* copia lo que falta (todo, o solo lo nuevo si ya había un respaldo) */
  function tmRun() {
    var dest = tmDest();
    var plan = tmSel();
    if (TM.running || !dest || !plan.groups.length) { return; }
    TM.st = TM.st || tmLoad();
    TM.st.done = {}; // lo ya copiado se salta por sí solo; esto vuelve a mirar cada tema por si hay algo nuevo
    TM.running = true; TM.err = ""; TM.verify = ""; TM.prog = null;
    TM.abort = new AbortController();
    render();
    PrepTopics.migrate({
      client: B.client, to: dest, plan: plan, state: TM.st, signal: TM.abort.signal,
      save: tmSave,
      onProgress: function (p) { TM.prog = p; tmPaint(); }
    }).then(function () {
      TM.running = false;
      if (TM.mode === "respaldo") { var r = lastBackup(); r[String(B.peer.id)] = String(TM.dest); store("hf.preparador.respaldos", JSON.stringify(r)); }
      render();
    }, function (e) {
      TM.running = false;
      TM.err = /Detenido/.test(String(e && e.message)) ? "Detenido. Pulsa «Continuar» cuando quieras: sigue donde iba." : "No pude seguir: " + ((e && (e.text || e.message)) || e) + " · Pulsa «Continuar» para reintentar.";
      render();
    });
  }
  ACT["tm-start"] = function () { tmRun(); };

  /* Crea el grupo con temas (privado, de esta cuenta) y lo deja elegido: la copia la empieza el botón del paso 3 */
  ACT["tm-crear"] = function () {
    var input = $("tmName");
    var name = String((input && input.value) || "").trim() || chatName(B.peer) + (TM.mode === "respaldo" ? " · Respaldo" : " · Temas");
    if (TM.running || TM.creating) { return; }
    if (!confirm("Se va a crear en tu Telegram un grupo nuevo, con temas y privado, llamado:\n\n«" + name + "»\n\nTodavía no se copia nada: después eliges qué temas y pulsas «Iniciar». El grupo de ahora no se toca. ¿Crearlo?")) { return; }
    TM.name = name; TM.creating = true; TM.err = ""; TM.verify = "";
    render();
    B.client.createSupergroup({ title: name, description: (TM.mode === "respaldo" ? "Respaldo de HomeFlix" : "HomeFlix") + ": un tema por película o serie.", forum: true }).then(function (chat) {
      TM.extra.push(chat);
      if (window.PrepTopics) { PrepTopics.noteForum({ id: chat.id, isForum: true }); }
      TM.dest = String(chat.id);
      TM.st = tmEmpty();
      TM.creating = false;
      TM.tab = "existente";
      TM.pickOpen = false;
      TM.verify = "Grupo «" + name + "» creado. Revisa los temas marcados y pulsa «Iniciar».";
      render();
    }, function (e) {
      TM.creating = false;
      TM.err = "No pude crear el grupo: " + ((e && (e.text || e.message)) || e);
      render();
    });
  };

  ACT["tm-map"] = function () {
    var st = TM.st || tmLoad();
    var blob = new Blob([JSON.stringify({ origen: B.peer ? String(B.peer.id) : "", destino: TM.dest, fecha: new Date().toISOString(), mensajes: st.sent, temas: st.topics }, null, 1)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (TM.mode === "respaldo" ? "respaldo-" : "migracion-") + (B.peer ? B.peer.id : "chat") + "-a-" + TM.dest + ".json";
    a.click();
  };
  ACT["tm-verify"] = function () {
    var dest = tmDest();
    var plan = tmSel();
    if (!dest || !plan.groups.length) { return; }
    TM.verify = "Comprobando…";
    render();
    B.client.searchMessages({ chatId: dest, filter: VIDEO, limit: 1 }).then(function (r) {
      var want = plan.groups.reduce(function (n, g) { return n + g.counts.video; }, 0);
      var have = r.total || r.length || 0;
      TM.verify = "En el grupo nuevo hay " + have + " videos; se esperaban " + want + (have >= want ? ". Todo está." : ". Faltan " + (want - have) + ": revisa en Telegram o pulsa «Continuar».");
      render();
    }, function (e) { TM.verify = "No pude comprobarlo: " + ((e && e.message) || e); render(); });
  };
  ACT["tm-use"] = function () {
    var dest = tmDest();
    if (dest) { choose(dest); }
  };


  /* ===================== Importar desde un grupo antiguo — FASE 1: solo lectura (PrepImport, importar.js; diseño en docs/diseno-importar-grupo-antiguo.md) ===================== */
  var IM = { src: "", cq: "", q: "", f: "todos", view: "lista", pv: "", pvAll: {}, th: {}, stream: {}, open: {}, step: {}, okd: {}, movOpen: false, an: null, running: false, abort: null, count: 0, err: "", at: 0, paintAt: 0, pick: true,
    tm: null, tmBusy: false, tmAbort: null, tmProg: null, tmErr: "",
    dest: "", tab: "nuevo", gname: "", sure: false, creating: false, extra: [], destPick: false, trial: true, st: null, copying: false, cabort: null, cprog: null, cerr: "", verify: "", cat: "Anime" };

  function imChats() {
    var q = norm2(IM.cq);
    return (B.chats || []).filter(function (p) { return !p.isSelf && (!q || norm2(chatName(p)).indexOf(q) >= 0); });
  }
  function imSrc() { return (B.chats || []).filter(function (p) { return String(p.id) === IM.src; })[0]; }
  function imRanges(nums) {
    var a = nums.slice().sort(function (x, y) { return x - y; });
    var out = [];
    var i = 0;
    while (i < a.length) {
      var j = i;
      while (j + 1 < a.length && a[j + 1] === a[j] + 1) { j += 1; }
      out.push(j > i ? a[i] + "–" + a[j] : String(a[i]));
      i = j + 1;
    }
    return out.join(", ");
  }
  /* Panel «Temporadas» de una serie: cuando el canal no marca dónde empieza cada una (numeración continua), se parte según TMDB, en N partes iguales o a mano. */
  function imSplitPanel(s) {
    var f = s.match && s.match.ficha;
    var ts = f && f.seasons && f.seasons.length > 1 ? f.seasons : null;
    var copied = IM.st && IM.st.sent ? Object.keys(IM.st.sent).filter(function (k) { return k.indexOf(s.id + ":e:") === 0; }).length : 0;
    var opts = [2, 3, 4, 5, 6, 7, 8].map(function (n) { return '<option value="' + n + '"' + (n === ((IM.parts && IM.parts[s.id]) || (s.split && /partes iguales/.test(s.split.how) ? s.split.starts.length : 0) || (ts ? ts.length : 4)) ? " selected" : "") + ">" + n + "</option>"; }).join("");
    if (s.type === "pelicula" || s.chapters < 4) { return ""; }
    return '<div class="imsplit"><div class="imsh"><b>Temporadas</b><span class="pill ' + (s.split ? "gold" : "dim") + '">' + (s.split ? esc(s.split.how) : "Detectadas por el análisis") + '</span><span class="pill dim">' + s.seasons.length + (s.seasons.length === 1 ? " temporada" : " temporadas") + "</span>" +
      (ts ? '<span class="pill dim" title="Lo que dice TMDB de esta serie">TMDB: ' + ts.length + " (" + ts.map(function (x) { return x.episodes; }).join(", ") + ")</span>" : "") + "</div>" +
      '<small class="hint">Si el canal numera todo seguido (1 a ' + PrepImport.maxNum(s) + ") y no marca las temporadas, aquí eliges cómo partirlas. Cada temporada vuelve a contar desde el capítulo 1.</small>" +
      '<div class="imsplitrow">' + (ts ? '<button class="ghost sm" data-act="im-split" data-sid="' + esc(s.id) + '" data-mode="tmdb">Según TMDB (' + ts.length + ")</button>" : "") +
      '<span class="imgrp"><small class="hint">Partir en</small><select class="imparts" data-sid="' + esc(s.id) + '" aria-label="Cantidad de partes">' + opts + '</select><small class="hint">partes iguales</small><button class="ghost sm" data-act="im-split" data-sid="' + esc(s.id) + '" data-mode="iguales">Aplicar</button></span>' +
      '<span class="imgrp"><small class="hint">o a mano</small><input type="text" class="search imstarts" data-sid="' + esc(s.id) + '" placeholder="capítulo donde empieza cada una (1, 33, 65, 97)" value="' + esc(s.split ? s.split.starts.join(", ") : "") + '"><button class="ghost sm" data-act="im-split" data-sid="' + esc(s.id) + '" data-mode="manual">Aplicar</button></span>' +
      (s.split ? '<button class="ghost sm" data-act="im-split" data-sid="' + esc(s.id) + '" data-mode="auto">Volver a la detección</button>' : "") + "</div>" +
      (IM.splitMsg && IM.splitMsg[s.id] ? '<div class="imwarn">' + esc(IM.splitMsg[s.id]) + "</div>" : "") +
      (copied ? '<div class="imwarn">Ya se copiaron ' + copied + " capítulos de esta serie con las temporadas de antes; los que falten saldrán con las nuevas. Si cambiaste el reparto, borra lo copiado y empieza de nuevo.</div>" : "") + "</div>";
  }
  function imPickRows() {
    var list = imChats();
    return list.slice(0, 60).map(function (p) {
      var id = String(p.id);
      return '<button class="chat' + (id === IM.src ? " on" : "") + '" data-act="im-src" data-id="' + esc(id) + '" role="radio" aria-checked="' + (id === IM.src) + '"><span class="radio" aria-hidden="true"></span><span class="av" aria-hidden="true">' + esc(chatName(p).charAt(0).toUpperCase()) +
        '</span><span class="tx"><b>' + esc(chatName(p)) + "</b><small>" + (p.type === "chat" && p.chatType ? esc(p.chatType) : "Chat") + "</small></span></button>";
    }).join("") + (list.length > 60 ? '<div class="hint" style="padding:6px 2px">Hay ' + (list.length - 60) + " más: escribe parte del nombre para encontrarlo.</div>" : "") ||
      '<div class="hint" style="padding:6px 2px">No encuentro ese chat. Entra primero al canal con tu cuenta de Telegram y pulsa «Buscar mis chats».</div>';
  }
  function imStat(s) { return s.status === "revisar" && IM.okd[s.id] ? "seguro" : s.status; }
  /* por qué una serie está en «Revisar»: cortes por confirmar y avisos del canal */
  function imReasons(s) {
    var cuts = s.seasons.filter(function (se) { return se.cut && se.cut.certainty !== "seguro"; }).length;
    var warns = s.seasons.reduce(function (n, se) { return n + se.warnings.length; }, 0) + (s.notes ? s.notes.length : 0);
    return [cuts ? cuts + (cuts === 1 ? " corte por confirmar" : " cortes por confirmar") : "", warns ? warns + (warns === 1 ? " aviso" : " avisos") : ""].filter(Boolean).join(" · ");
  }
  /* ----- reproducir un video del canal dentro del preparador (service worker + lectura por trozos de Telegram, sin bajarlo entero) ----- */
  function imSwOn() {
    if (IM.swOn || !("serviceWorker" in navigator)) { return IM.swOn; }
    IM.swOn = true;
    navigator.serviceWorker.addEventListener("message", function (e) {
      var d = e.data;
      var port = e.ports && e.ports[0];
      var s = d && d.k && IM.stream[d.k];
      if (!port) { return; }
      if (!s) { port.postMessage({ ok: false, error: "El video ya no está abierto" }); return; }
      readRange(s.media, d.start, d.len).then(function (u8) {
        var b = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        port.postMessage({ ok: true, buf: b }, [b]);
      }, function (err) { port.postMessage({ ok: false, error: String((err && (err.text || err.message)) || err) }); });
    });
    return true;
  }
  function imPlayClose() {
    var o = document.getElementById("imPlay");
    var v;
    if (!o) { return; }
    v = o.querySelector("video");
    if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
    o.remove();
    document.removeEventListener("keydown", imPlayKey);
  }
  function imPlayKey(e) { if (e.key === "Escape") { imPlayClose(); } }
  async function imPlay(id) {
    var chatKey = String(IM.src);
    var m = B.msgs[chatKey + ":" + id];
    var media;
    var o;
    var v;
    var label = "";
    var k;
    var link = imTgLink(id);
    imPlayClose();
    o = document.createElement("div");
    o.id = "imPlay"; o.className = "implay";
    o.innerHTML = '<div class="implayb"><div class="implayh"><b></b>' + (link ? '<a class="ghost sm" href="' + link + '" target="_blank" rel="noopener">Abrir en Telegram ↗</a>' : "") + '<button class="ghost sm" data-imx="1">Cerrar ✕</button></div><div class="implayv"><span class="implaym">Preparando el video…</span></div></div>';
    document.body.appendChild(o);
    o.addEventListener("click", function (e) { if (e.target === o || (e.target.getAttribute && e.target.getAttribute("data-imx"))) { imPlayClose(); } });
    document.addEventListener("keydown", imPlayKey);
    try {
      if (!m) { var l = await B.client.getMessages(Number(chatKey), [Number(id)]); m = l && l[0]; }
      media = m && m.media;
      if (!media || !media.fileSize) { throw new Error("No encuentro ese video en el canal (¿se borró?)."); }
      if (!imSwOn()) { throw new Error("Este navegador no permite reproducir aquí. Usa «Abrir en Telegram»."); }
      await navigator.serviceWorker.register("/sw-stream.js");
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) { await new Promise(function (ok) { navigator.serviceWorker.addEventListener("controllerchange", ok, { once: true }); setTimeout(ok, 4000); }); }
      k = chatKey + "_" + id;
      IM.stream[k] = { media: media };
      label = (media.fileName || "") + " · " + Math.round(media.fileSize / 1048576) + " MB";
      o.querySelector(".implayh b").textContent = label;
      v = document.createElement("video");
      v.controls = true; v.autoplay = true; v.playsInline = true;
      v.addEventListener("error", function () {
        var box = o.querySelector(".implayv");
        if (box && !box.querySelector(".implaye")) { var p = document.createElement("p"); p.className = "implaye"; p.textContent = "El navegador no pudo reproducir este video (formato o audio que Chrome no abre, o Telegram tardó). Usa «Abrir en Telegram» para verlo ahí."; box.appendChild(p); }
      });
      v.src = "/hf-stream/" + encodeURIComponent(k) + "?k=" + encodeURIComponent(k) + "&size=" + media.fileSize + "&type=" + encodeURIComponent(media.mimeType || "video/mp4");
      o.querySelector(".implayv").innerHTML = "";
      o.querySelector(".implayv").appendChild(v);
    } catch (e) {
      var msg = o.querySelector(".implaym");
      if (msg) { msg.textContent = String((e && (e.message || e.text)) || e); }
    }
  }

  /* Miniatura (la portada del video que guarda Telegram) de cada video que se ve en la vista previa: se piden los mensajes del canal por su número y se baja la imagen chica. */
  function imThumbPaint(id) {
    var u = IM.th[id];
    if (!u || u === "pending" || u === "none") { return; }
    Array.prototype.forEach.call(document.querySelectorAll('[data-imth="' + id + '"]'), function (el) { el.style.backgroundImage = "url('" + u + "')"; el.classList.add("has"); });
  }
  function imLoadThumbs() {
    var ids = [];
    var chat = Number(IM.src);
    if (!B.client || !chat) { return; }
    Array.prototype.forEach.call(document.querySelectorAll("[data-imth]"), function (el) {
      var id = el.getAttribute("data-imth");
      if (IM.th[id]) { imThumbPaint(id); } else if (ids.indexOf(id) < 0) { ids.push(id); }
    });
    if (!ids.length) { return; }
    ids.forEach(function (id) { IM.th[id] = "pending"; });
    (async function () {
      var i;
      var list;
      var byId;
      var tries;
      for (i = 0; i < ids.length; i += 40) {
        var chunk = ids.slice(i, i + 40);
        list = null;
        for (tries = 0; tries < 3 && !list; tries += 1) {
          try { list = await B.client.getMessages(chat, chunk.map(Number)); } catch (e) { await new Promise(function (ok) { setTimeout(ok, 6000 * (tries + 1)); }); }
        }
        byId = {};
        (list || []).forEach(function (m) { if (m && m.id) { byId[m.id] = m; } });
        await Promise.all(chunk.map(async function (id) {
          var m = byId[id];
          var dd = m && m.media;
          var th = dd ? ((dd.videoCover && pickThumb(dd.videoCover.thumbnails, 480)) || pickThumb(dd.thumbnails, 480)) : null;
          try {
            var buf = th ? await B.client.downloadAsBuffer(th) : null;
            IM.th[id] = buf ? URL.createObjectURL(new Blob([buf], { type: "image/jpeg" })) : "none";
          } catch (e) { IM.th[id] = "none"; }
          imThumbPaint(id);
        }));
      }
    })();
  }

  /* ----- vista previa: cada detección como tarjeta; al abrirla se ven sus videos tal como están en el canal (con enlace a Telegram) ----- */
  function imMatchF(s, q) {
    return (IM.f === "todos" || (IM.f === "revisar" ? imStat(s) !== "seguro" : imStat(s) === "seguro")) && (!q || norm2(s.title + " " + s.original).indexOf(q) >= 0);
  }
  function imTgLink(id) {
    var m = /^-100(\d+)$/.exec(String(IM.src || ""));
    return m ? "https://t.me/c/" + m[1] + "/" + id : "";
  }
  function imEpLabel(e) {
    var t = e.title || "";
    var raw = String(e.text || "").split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean)[0] || "";
    return { main: t || raw || e.fileName || ("Mensaje " + e.id), sub: e.fileName && (t || raw) ? e.fileName : (t && raw && raw !== t ? raw : "") };
  }
  function imPreview() {
    var an = IM.an;
    var q = norm2(IM.q);
    var list;
    if (!an) { return '<div class="tmrow"><div class="tmn"><b>Todavía no hay análisis</b><small>Elige el canal antiguo y pulsa «Analizar».</small></div></div>'; }
    list = an.series.filter(function (s) { return imMatchF(s, q); });
    if (!list.length) { return '<div class="tmrow"><div class="tmn"><b>Nada con ese filtro</b></div></div>'; }
    return '<div class="impv">' + list.map(function (s) {
      var isMov = s.type === "pelicula";
      var open = IM.pv === s.id;
      var st = imStat(s) === "seguro" ? "good" : s.status === "revisar" ? "warn" : "bad";
      var f = s.match && s.match.ficha;
      var poster = f && f.poster ? '<img alt="" loading="lazy" src="' + esc(f.poster.url.replace("/original/", "/w342/")) + '">' : '<span class="impph">' + esc((s.name || s.title || "?").charAt(0).toUpperCase()) + "</span>";
      var eps = s.seasons.reduce(function (n, se) { return n + se.count; }, 0);
      var card = '<div class="impc' + (open ? " open" : "") + '"><div class="impcm"><button class="impcb" data-act="im-pv" data-sid="' + esc(s.id) + '" aria-expanded="' + open + '"><span class="imppo"' + (f && f.poster ? "" : ' data-imth="' + (s.seasons[0] && s.seasons[0].episodes[0] ? s.seasons[0].episodes[0].id : "") + '"') + ">" + poster + '<i class="imdot ' + st + '"></i></span>' +
        '<span class="impct"><b>' + esc(s.name || s.title || "(sin título)") + "</b><small>" + esc([s.year || "", isMov ? "película" : s.seasons.length + (s.seasons.length === 1 ? " temporada" : " temporadas")].filter(Boolean).join(" · ")) + " · " + eps + (eps === 1 ? " video" : " videos") + "</small></span></button>" +
        '<div class="imptype" role="group" aria-label="Tipo"><button class="' + (isMov ? "on" : "") + '" data-act="im-type" data-sid="' + esc(s.id) + '" data-v="pelicula"' + (IM.copying ? " disabled" : "") + '>Película</button><button class="' + (!isMov ? "on" : "") + '" data-act="im-type" data-sid="' + esc(s.id) + '" data-v="serie"' + (IM.copying ? " disabled" : "") + ">Serie</button></div></div>";
      if (open) {
        card += '<div class="impd">' + s.seasons.map(function (se) {
          var key = s.id + ":" + se.n;
          var all = !!IM.pvAll[key] || se.episodes.length <= 14;
          var rows = (all ? se.episodes : se.episodes.slice(0, 12)).map(function (e) {
            var lb = imEpLabel(e);
            var lk = imTgLink(e.id);
            return "<tr><td class=\"v\">" + '<button class="imvid" data-act="im-play" data-id="' + e.id + '" data-imth="' + e.id + '" title="Reproducir este video aquí" aria-label="Reproducir"></button>' + "</td><td class=\"n\">" + (isMov ? "▶" : "E" + e.newNum) + (!isMov && e.num != null && e.num !== e.newNum ? "<small>era " + e.num + "</small>" : "") + "</td><td><b>" + esc(lb.main.slice(0, 90)) + "</b>" + (lb.sub ? "<small>" + esc(lb.sub.slice(0, 90)) + "</small>" : "") + "</td><td class=\"m\">" + (e.size ? Math.round(e.size / 1048576) + " MB" : "") + (e.duration ? "<small>" + Math.round(e.duration / 60) + " min</small>" : "") + "</td><td>" + (lk ? '<a class="ghost sm" href="' + lk + '" target="_blank" rel="noopener" title="Abre este video en Telegram para verlo">Ver ↗</a>' : "") + "</td></tr>";
          }).join("");
          return '<div class="impse">' + (isMov ? "" : '<div class="impsh"><b>Temporada ' + se.n + "</b><span>" + esc(se.langLabel || se.lang || "idioma sin indicar") + " · " + se.count + " capítulos</span></div>") + '<table class="imtab"><tbody>' + rows + "</tbody></table>" +
            (all ? "" : '<button class="ghost sm" data-act="im-pv-all" data-k="' + esc(key) + '">Ver los ' + (se.episodes.length - 12) + " restantes</button>") + "</div>";
        }).join("") + (IM.src && !/^-100/.test(String(IM.src)) ? '<p class="hint">Este chat no tiene enlaces a Telegram.</p>' : "") + "</div>";
      }
      return card + "</div>";
    }).join("") + "</div>";
  }
  function imRows() {
    var an = IM.an;
    var q = norm2(IM.q);
    var list;
    if (!an) { return '<div class="tmrow"><div class="tmn"><b>Todavía no hay análisis</b><small>Elige el canal antiguo y pulsa «Analizar».</small></div></div>'; }
    list = an.series.filter(function (s) {
      return (IM.f === "todos" || (IM.f === "revisar" ? imStat(s) !== "seguro" : imStat(s) === "seguro")) && (!q || norm2(s.title + " " + s.original).indexOf(q) >= 0);
    });
    if (!list.length) { return '<div class="tmrow"><div class="tmn"><b>Nada con ese filtro</b></div></div>'; }
    var rowOf = function (s) {
      var open = !!IM.open[s.id];
      var st = imStat(s) === "seguro" ? ["good", s.status === "seguro" ? "Seguro" : "Revisada"] : s.status === "revisar" ? ["warn", "Revisar"] : ["bad", "Sin capítulos"];
      var mt = s.match;
      var tmChip = mt ? '<span class="pill ' + ({ alta: "gold", media: "warn", baja: "bad", sin: "bad" }[mt.state] || "dim") + '" title="Coincidencia con TMDB">TMDB · ' + ({ alta: "segura", media: "dudosa", baja: "baja", sin: "sin resultado" }[mt.state] || "") + "</span>" : "";
      var head = '<button class="imh" data-act="im-open" data-sid="' + esc(s.id) + '" aria-expanded="' + open + '"><span class="imdot ' + st[0] + '" aria-hidden="true"></span><span class="tmn"><b>' + esc(s.name || s.title || "(sin título)") + "</b><small>" +
        esc([s.original, s.year || "", s.type === "pelicula" ? "película" : (s.typeRaw || s.type)].filter(Boolean).join(" · ")) + (st[0] === "warn" ? '<em class="imwhy">' + esc(imReasons(s)) + "</em>" : "") + '</small></span><span class="impills"><span class="pill dim">' + s.seasons.length + (s.seasons.length === 1 ? " temporada" : " temporadas") + '</span><span class="pill dim">' + s.chapters + ' caps</span>' + tmChip + '<span class="pill ' + (st[0] === "good" ? "gold" : st[0]) + '">' + st[1] + '</span></span><span class="imchev" aria-hidden="true">' + (open ? "▾" : "▸") + "</span></button>";
      var body = "";
      if (open) {
        var match = "";
        if (mt) {
          var f = mt.ficha;
          match = '<div class="immatch"><label class="imlbl">Nombre en el grupo nuevo<input type="text" class="search imname" data-sid="' + esc(s.id) + '" value="' + esc(s.name || s.title) + '"></label>' +
            '<label class="imlbl">Ficha de TMDB<select class="imsel" data-sid="' + esc(s.id) + '">' + (mt.candidates.length ? mt.candidates.map(function (c) { return '<option value="' + c.id + '"' + (c.id === mt.pick ? " selected" : "") + ">" + esc(c.title + " (" + (c.year || "?") + ") · " + c.score) + "</option>"; }).join("") : '<option value="">Sin resultados</option>') + "</select></label>" +
            (mt.error ? '<div class="imwarn">' + esc(mt.error) + "</div>" : f ? '<div class="imfi">' + (f.poster ? '<img alt="" src="' + esc(f.poster.url.replace("/original/", "/w185/")) + '">' : "") + "<div><b>" + esc(f.title) + "</b><small>" + esc((f.genres || []).join(", ")) + "</small><p>" + esc((f.overview || "Sin descripción en TMDB").slice(0, 220)) + "</p></div></div>" : "") + "</div>";
        }
        var how = "";
        if (s.status === "revisar") {
          var pend = s.seasons.filter(function (se) { return se.cut && se.cut.certainty !== "seguro"; });
          var anyW = s.seasons.some(function (se) { return se.warnings.length; });
          how = IM.okd[s.id] ? '<div class="imhow ok"><b>Revisada por ti</b><button class="ghost sm" data-act="im-ok" data-sid="' + esc(s.id) + '">Deshacer</button></div>' :
            '<div class="imhow"><b>Qué hacer</b><ul>' +
            (pend.length ? "<li>Mira los <b>cortes propuestos</b> de abajo (dónde empieza cada temporada). Si están bien, déjalos; si no, usa «Partir…» para cambiarlos.</li>" : "") +
            (anyW ? "<li>Los <b>avisos</b> (capítulos que faltan o están repetidos) vienen del canal, no son un error de HomeFlix: se copia lo que hay.</li>" : "") +
            (s.notes.length ? "<li>Mira las notas en amarillo.</li>" : "") +
            '</ul><button class="primary sm" data-act="im-ok" data-sid="' + esc(s.id) + '">Todo bien · marcar como revisada</button></div>';
        }
        body = '<div class="imbody"><div class="imgo"><button class="ghost sm" data-act="im-pv-go" data-sid="' + esc(s.id) + '">Ver sus videos en la vista previa</button></div>' + how + match + imSplitPanel(s) + (s.notes.length ? '<div class="imwarn">' + s.notes.map(esc).join("<br>") + "</div>" : "") +
          '<div class="imhdrs">' + (s.source === "comentario" ? "<b>Sin foto de encabezado:</b> los datos salen del comentario de cada video" + (s.headers[0] && s.headers[0].hasPhoto ? " · póster asociado" : " · sin póster (se usa el de TMDB)") : "<b>Encabezados encontrados:</b> " + s.headers.map(function (h) { return esc((h.title || "(sin título)") + " · " + (h.lang || "sin idioma") + " · " + h.chapters + " caps"); }).join(" &nbsp;|&nbsp; ")) + "</div>" +
          s.seasons.map(function (se) {
            var cut = se.cut ? '<div class="imcut ' + se.cut.certainty + '"><b>' + (se.cut.certainty === "seguro" ? "Corte seguro" : "Corte propuesto: confírmalo") + " · " + se.cut.score + (se.cut.score === 1 ? " punto" : " puntos") + "</b><ul>" +
              se.cut.evidence.map(function (e) { return "<li><span>" + (e.pts > 0 ? "+" : "") + e.pts + "</span> " + esc(e.text) + "</li>"; }).join("") + "</ul></div>" : "";
            return '<div class="imseason"><div class="imsh"><b>Temporada ' + se.n + '</b><span class="pill gold">' + esc(se.langLabel || se.lang || "idioma sin indicar") + "</span>" + (se.quality ? '<span class="pill dim">' + esc(se.quality) + "</span>" : "") +
              '<span class="pill dim">' + se.count + " capítulos" + (se.avgMB ? " · ~" + se.avgMB + " MB c/u" : "") + "</span></div>" + cut +
              '<div class="imnums">Capítulos: ' + esc(imRanges(se.episodes.map(function (e) { return e.newNum; })) || "—") + "</div>" +
              (se.warnings.length ? '<details class="imincid"><summary>' + se.warnings.length + (se.warnings.length === 1 ? " aviso del canal" : " avisos del canal") + ' <span>· se copia igual</span></summary>' + se.warnings.map(function (w) { return '<div class="imwarn">' + esc(w) + "</div>"; }).join("") + "</details>" : "") + "</div>";
          }).join("") + "</div>";
      }
      return '<div class="imser ' + st[0] + (open ? " open" : "") + '">' + head + body + "</div>";
    };
    var movies = list.filter(function (s) { return s.type === "pelicula"; });
    if (movies.length >= 3 && !q) { // muchas películas sueltas: van en un grupo plegable para no tapar las series
      var rest = list.filter(function (s) { return s.type !== "pelicula"; });
      var mrev = movies.filter(function (s) { return imStat(s) !== "seguro"; }).length;
      return rest.map(rowOf).join("") + '<div class="immov"><button class="imh" data-act="im-mov" aria-expanded="' + IM.movOpen + '"><span class="imdot ' + (mrev ? "warn" : "good") + '" aria-hidden="true"></span><span class="tmn"><b>Películas sueltas</b><small>' + movies.length + " películas" + (mrev ? " · " + mrev + " por revisar" : " · todas seguras") + '</small></span><span class="imchev" aria-hidden="true">' + (IM.movOpen ? "▾" : "▸") + "</span></button>" + (IM.movOpen ? '<div class="immovbody">' + movies.map(rowOf).join("") + "</div>" : "") + "</div>";
    }
    return list.map(rowOf).join("");
  }

  /* ----- destino y copia (fase 3) ----- */
  function imDests() {
    var seen = {};
    return (B.chats || []).concat(IM.extra).filter(function (p) {
      var id = String(p.id);
      if (seen[id] || p.isSelf || id === IM.src || !window.PrepTopics || !PrepTopics.isForum(p)) { return false; }
      seen[id] = true;
      return true;
    });
  }
  function imDest() { return imDests().filter(function (p) { return String(p.id) === IM.dest; })[0]; }
  function imStKey() { return "hf.preparador.importar." + IM.src + "." + IM.dest; }
  function imStLoad() { try { return JSON.parse(store(imStKey()) || "null") || { sent: {} }; } catch (e) { return { sent: {} }; } }
  function imStSave(st) { store(imStKey(), JSON.stringify(st)); }
  function imPlan() { return IM.an && window.PrepImport ? PrepImport.planCopy(IM.an, { maxEpisodes: IM.trial ? 2 : 0, category: IM.cat }) : { groups: [], total: 0 }; }
  /* ¿Qué hay ya en el grupo de destino? Se lee lo que se copió (videos, archivos y fotos) y se compara por el comentario («serie(T/C)#Nombre», «pelicula#Nombre», «serie#Nombre #portada»…).
   * Sirve cuando el avance guardado en este navegador no coincide (otro navegador, otro análisis, se borró) y evita copiar dos veces. */
  function imSig(caption) {
    var c = String(caption || "").trim();
    var nm = function (x) { return String(x || "").toLowerCase().replace(/\s*\(\d{4}\)\s*$/, "").replace(/[^a-z0-9À-ɏ]+/g, ""); };
    var m;
    var tag = /#(portada|banner|vertical|capitulo)\s*$/.exec(c);
    if ((m = /^serie\((\d+)\/(\d+)\)#([^#]*)/.exec(c))) { return (tag ? "still|" : "e|") + nm(m[3]) + "|" + m[1] + "|" + m[2]; }
    if ((m = /^(serie|pelicula)#([^#]*)/.exec(c))) { return tag ? "i|" + tag[1] + "|" + nm(m[2]) : "v|" + nm(m[2]); }
    return "";
  }
  async function imRecon(dest) {
    var seen = {};
    var scanned = 0;
    var found = 0;
    var total = 0;
    var st = IM.st || (IM.st = imStLoad());
    var plan = imPlan();
    var filters = [VIDEO, DOCS, PHOTOS];
    var fi;
    var res;
    var offset;
    var n;
    st.sent = st.sent || {};
    for (fi = 0; fi < filters.length; fi += 1) {
      offset = undefined; n = 0;
      do {
        res = await B.client.searchMessages({ chatId: dest.id, filter: filters[fi], limit: 100, offset: offset });
        res.forEach(function (m) { var s = imSig(m.text); if (s) { seen[s] = true; } });
        scanned += res.length; n += res.length; offset = res.next;
        IM.verify = "Mirando lo que ya hay en el grupo… " + scanned; imPaint();
      } while (res.length && offset !== undefined && n < 6000);
    }
    plan.groups.forEach(function (g) {
      g.items.forEach(function (x) {
        var s = imSig(x.caption);
        total += 1;
        if (s && seen[s] && !(st.sent[x.key] && st.sent[x.key] !== "omitida")) { st.sent[x.key] = true; found += 1; }
      });
    });
    imStSave(st);
    return { found: found, scanned: scanned, total: total };
  }
  function imApi() {
    var post = function (url, body) { return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function (r) { return r.json().then(function (j) { if (!r.ok) { throw new Error(j.error || "Error"); } return j; }); }); };
    return {
      buscar: function (b) { return post("/api/tmdb/buscar", b); },
      ficha: function (b) { return post("/api/tmdb/ficha", b); },
      temporada: function (b) { return post("/api/tmdb/temporada", b); },
      imagen: function (b) { return post("/api/imagen-url", b); },
      bytes: function (id) { return fetch("/api/media/" + id).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); }); }
    };
  }

  function viewImportar() {
    var an = IM.an;
    var src = imSrc();
    var s = an ? an.stats : null;
    var nSeasons = an ? an.series.reduce(function (n, x) { return n + x.seasons.length; }, 0) : 0;
    var nRev = an ? an.series.filter(function (x) { return imStat(x) !== "seguro"; }).length : 0;
    var nSafe = an ? an.series.length - nRev : 0;
    var lock = IM.running || IM.tmBusy || IM.copying || IM.creating;
    /* paso 1: canal de origen */
    var pane;
    if (src && !IM.pick) {
      pane = '<div class="tmdestcard"><span class="av" aria-hidden="true">' + esc(chatName(src).charAt(0).toUpperCase()) + '</span><span class="tx"><b>' + esc(chatName(src)) + "</b><small>Canal o grupo antiguo · solo se lee</small></span>" +
        '<button class="ghost sm" data-act="im-cambiar"' + (lock ? " disabled" : "") + ">Cambiar</button></div>";
    } else {
      pane = '<div class="tmpick"><div class="tmpickh"><b>Tus chats</b><button class="ghost sm" data-act="im-find"' + (lock ? " disabled" : "") + '>Buscar mis chats</button></div>' +
        '<input type="search" id="imCq" class="search" placeholder="Buscar el canal por nombre…" value="' + esc(IM.cq) + '" aria-label="Buscar el canal antiguo"><div class="impick">' + imPickRows() + "</div></div>";
    }
    var step1h = '<div class="tmstep"><div class="tmsh"><span class="tmnum">1</span><b>Canal o grupo antiguo</b><span class="tmtip" title="Tienes que ser miembro con tu cuenta de Telegram: aparece aquí con tus demás chats. El preparador solo lee fotos y videos; no cambia nada en el canal.">?</span></div>' + pane + "</div>";
    /* paso 2: análisis */
    var state = IM.running ? ["busy", "Leyendo el canal… " + IM.count + " mensajes"] : IM.err ? ["bad", IM.err] : an ? ["good", "Análisis listo: " + s.series + (s.series === 1 ? " serie" : " series") + ", " + s.chapters + " capítulos"] : src ? ["ready", "Listo para analizar"] : ["ready", "Elige el canal antiguo"];
    var icon = { busy: "◔", bad: "!", good: "✓", ready: "●" }[state[0]];
    var tiles = '<div class="tmtiles"><div><b>' + (an ? s.series : "—") + "</b><span>series</span></div><div><b>" + (an ? nSeasons : "—") + "</b><span>temporadas</span></div><div><b>" + (an ? s.chapters : "—") + "</b><span>capítulos</span></div><div title=\"Series con un corte propuesto, capítulos faltantes o repetidos, o datos por confirmar\"><b>" + (an ? nRev : "—") + "</b><span>por revisar</span></div></div>";
    var extra = an && (s.videosSinEncabezado || s.fotosSinDatos) ? '<div class="tmnote"><span>i</span><div>' + (s.videosSinEncabezado ? s.videosSinEncabezado + " video" + (s.videosSinEncabezado === 1 ? "" : "s") + " aparece" + (s.videosSinEncabezado === 1 ? "" : "n") + " antes de cualquier encabezado y no se asigna" + (s.videosSinEncabezado === 1 ? "" : "n") + " a ninguna serie. " : "") + (s.fotosSinDatos ? s.fotosSinDatos + " foto" + (s.fotosSinDatos === 1 ? "" : "s") + " sin los datos de un encabezado (se ignoran)." : "") + "</div></div>" : "";
    var prog = '<div class="tmprog"><div class="tmpt"><span class="tmico ' + state[0] + '">' + icon + "</span><div><b>" + esc(state[1]) + "</b>" + (an && !IM.running ? "<small>Leído " + new Date(IM.at).toLocaleTimeString() + " · " + s.messages + " fotos y videos</small>" : "") + "</div></div>" + extra + "</div>";
    var primary = IM.running ? '<button class="danger" data-act="im-stop">Detener</button>' : '<button class="primary" data-act="im-run"' + (src && !lock ? "" : " disabled") + ">" + (an ? "Volver a analizar" : "Analizar canal") + "</button>";
    var step2h = '<div class="tmstep"><div class="tmsh"><span class="tmnum">2</span><b>Análisis</b><span class="tmtip" title="Lee el canal, reconoce los encabezados (foto con título, año, géneros, idioma…) y los capítulos, une las temporadas de cada serie y marca dónde está el corte entre una y otra. No copia ni cambia nada.">?</span></div>' + tiles + prog +
      '<div class="tmactions">' + (an ? '<button class="ghost" data-act="im-report" title="Un archivo de texto con lo que se encontró (sin claves ni videos): sirve para afinar el detector">Descargar informe (.json)</button>' : "") + '<span class="tmsp"></span>' + primary + "</div></div>";
    /* paso 3: fichas de TMDB */
    var ms = an ? an.series.filter(function (x) { return x.match; }) : [];
    var cnt = { alta: 0, media: 0, baja: 0, sin: 0 };
    ms.forEach(function (x) { cnt[x.match.state] += 1; });
    var tmState = IM.tmBusy ? ["busy", "Buscando en TMDB… " + (IM.tmProg ? IM.tmProg.done + " de " + IM.tmProg.total + (IM.tmProg.title ? " · " + IM.tmProg.title : "") : "")] : IM.tmErr ? ["bad", IM.tmErr] : ms.length ? ["good", ms.length + " de " + an.series.length + " emparejadas"] : an ? ["ready", "Falta buscar las fichas"] : ["ready", "Primero el análisis"];
    var step3h = '<div class="tmstep"><div class="tmsh"><span class="tmnum">3</span><b>Fichas de TMDB</b><span class="tmtip" title="Busca cada serie en TMDB (por su nombre original y en español, y el año) para traer la descripción, la portada y el banner. Puedes cambiar la elegida desde la serie, a la derecha.">?</span></div>' +
      '<div class="tmprog"><div class="tmpt"><span class="tmico ' + tmState[0] + '">' + ({ busy: "◔", bad: "!", good: "✓", ready: "●" }[tmState[0]]) + "</span><div><b>" + esc(tmState[1]) + "</b>" + (ms.length ? "<small>" + cnt.alta + " seguras · " + cnt.media + " dudosas · " + (cnt.baja + cnt.sin) + " sin coincidencia clara</small>" : "") + "</div></div></div>" +
      '<div class="tmactions"><span class="tmsp"></span>' + (IM.tmBusy ? '<button class="danger" data-act="im-tm-stop">Detener</button>' : '<button class="primary" data-act="im-tm"' + (an && !lock ? "" : " disabled") + ">" + (ms.length ? "Buscar de nuevo" : "Buscar fichas en TMDB") + "</button>") + "</div></div>";
    /* paso 4: grupo de destino */
    var dests = imDests();
    var dest = imDest();
    var tabs = '<div class="seg sm tmtabs" role="tablist" aria-label="Grupo de destino"><button role="tab" data-act="im-tab" data-v="nuevo" class="' + (IM.tab === "nuevo" ? "on" : "") + '"' + (lock ? " disabled" : "") + '>Crear grupo nuevo</button><button role="tab" data-act="im-tab" data-v="existente" class="' + (IM.tab === "existente" ? "on" : "") + '"' + (lock ? " disabled" : "") + ">Usar grupo existente</button></div>";
    var dpane;
    if (IM.tab === "nuevo") {
      dpane = '<div class="tmname"><input type="text" id="imGname" class="search" maxlength="120" value="' + esc(IM.gname || (src ? chatName(src) + " · Temas" : "Importación · Temas")) + '" aria-label="Nombre del grupo nuevo"' + (lock ? " disabled" : "") + ">" +
        (IM.sure ? '<button class="danger" data-act="im-crear"' + (lock ? " disabled" : "") + '>Sí, crear este grupo</button><button class="ghost" data-act="im-crear-no">No</button>' : '<button class="primary" data-act="im-crear"' + (lock ? " disabled" : "") + ">" + (IM.creating ? "Creando…" : "Crear grupo") + "</button>") + "</div>" +
        '<p class="hint" style="margin:0">' + (IM.sure ? "Se creará en tu Telegram un grupo privado, con temas, a tu nombre. Todavía no se copia nada: eso lo inicias en el paso 5. El canal antiguo no se toca." : "Crea un grupo privado con temas, a tu nombre. Después lo puedes borrar desde Telegram.") + "</p>";
    } else if (dest && !IM.destPick) {
      dpane = '<div class="tmdestcard"><span class="av" aria-hidden="true">' + esc(chatName(dest).charAt(0).toUpperCase()) + '</span><span class="tx"><b>' + esc(chatName(dest)) + "</b><small>Grupo con temas</small></span><button class=\"ghost sm\" data-act=\"im-dcambiar\"" + (lock ? " disabled" : "") + ">Cambiar</button></div>";
    } else {
      dpane = '<div class="tmpick"><div class="tmpickh"><b>Tus grupos con temas</b><button class="ghost sm" data-act="im-find"' + (lock ? " disabled" : "") + '>Buscar mis grupos</button></div>' +
        (dests.map(function (p) { var id = String(p.id); return '<button class="chat' + (id === IM.dest ? " on" : "") + '" data-act="im-dest" data-id="' + esc(id) + '" role="radio" aria-checked="' + (id === IM.dest) + '"><span class="radio" aria-hidden="true"></span><span class="av" aria-hidden="true">' + esc(chatName(p).charAt(0).toUpperCase()) + '</span><span class="tx"><b>' + esc(chatName(p)) + "</b><small>Grupo con temas</small></span></button>"; }).join("") ||
          '<div class="hint" style="padding:6px 2px">No hay grupos con temas todavía: crea uno en la otra pestaña.</div>') + "</div>";
    }
    var step4h = '<div class="tmstep"><div class="tmsh"><span class="tmnum">4</span><b>Grupo de destino</b></div>' + tabs + dpane + "</div>";
    /* paso 5: copia */
    var plan = imPlan();
    var st = IM.dest ? (IM.st || (IM.st = imStLoad())) : null;
    var sent = st ? plan.groups.reduce(function (n, g) { return n + g.items.filter(function (x) { return st.sent && st.sent[x.key] && st.sent[x.key] !== "omitida"; }).length; }, 0) : 0;
    var omit = st ? plan.groups.reduce(function (n, g) { return n + g.items.filter(function (x) { return st.sent && st.sent[x.key] === "omitida"; }).length; }, 0) : 0;
    var total = plan.total;
    var pct = total ? Math.min(100, Math.round(sent / total * 100)) : 0;
    var finished = !!st && total > 0 && sent >= total;
    var cstate = IM.copying ? ["busy", IM.cprog && IM.cprog.step === "espera" ? "Telegram pidió esperar " + IM.cprog.wait + " s…" : "Copiando" + (IM.cprog && IM.cprog.label ? " " + IM.cprog.label : "") + (IM.cprog && IM.cprog.title ? " de «" + IM.cprog.title + "»" : "…")] :
      IM.cerr ? ["bad", IM.cerr] : finished ? ["good", IM.trial ? "Prueba copiada" : "Copia completa"] : omit && sent + omit >= total ? ["warn", omit + (omit === 1 ? " imagen de TMDB no se pudo bajar" : " imágenes de TMDB no se pudieron bajar") + ": pulsa «Reintentar imágenes»"] : sent ? ["warn", "Se detuvo: sigue donde iba"] : dest && ms.length ? ["ready", "Listo para copiar"] : ["ready", !an ? "Primero el análisis" : !ms.length ? "Falta buscar las fichas (paso 3)" : "Elige o crea el grupo de destino"];
    var cprog = '<div class="tmprog"><div class="tmpt"><span class="tmico ' + cstate[0] + '">' + ({ busy: "◔", bad: "!", good: "✓", warn: "⏸", ready: "●" }[cstate[0]]) + "</span><div><b>" + esc(cstate[1]) + "</b></div></div>" +
      '<div class="tmbar2"><div class="tmtrack"><i style="width:' + pct + '%"></i></div><span class="tmpct">' + pct + ' %</span></div><div class="tmcount">' + sent + " / " + total + " mensajes" + (IM.trial ? " (prueba: 2 capítulos por temporada)" : "") + "</div>" +
      (st && st.errors && st.errors.length ? '<div class="imwarn">' + st.errors.map(esc).join("<br>") + "</div>" : "") + (IM.verify ? '<div class="tmnote ok"><span>✓</span><div>' + esc(IM.verify) + "</div></div>" : "") + "</div>";
    var go = IM.copying ? '<button class="danger" data-act="im-cstop">Pausar</button>' : '<button class="primary" data-act="im-copiar"' + (!dest || !ms.length || !total || lock ? " disabled" : "") + ">" + (finished ? "Volver a revisar" : omit && sent + omit >= total ? "Reintentar imágenes (" + omit + ")" : sent ? "Continuar" : IM.trial ? "Copiar la prueba" : "Copiar todo") + "</button>";
    var step5h = '<div class="tmstep"><div class="tmsh"><span class="tmnum">5</span><b>Copia</b><span class="tmtip" title="Copia cada mensaje SIN volver a subirlo (Telegram reutiliza el archivo) con el comentario de hoy, en el tema de su serie: serie(T/C)#Nombre#descripción #Anime #tmdbtv… Además publica la portada vertical (la del encabezado), y la portada y el banner de TMDB.">?</span></div>' +
      '<label class="imchk"><input type="checkbox" id="imTrial"' + (IM.trial ? " checked" : "") + (lock ? " disabled" : "") + '> Prueba: solo 2 capítulos de cada temporada <small>(después puedes copiar el resto: no se repite nada)</small></label>' + cprog +
      '<div class="tmactions">' + (dest && !IM.copying ? '<button class="ghost" data-act="im-recon"' + (lock ? " disabled" : "") + ' title="Mira qué hay ya en el grupo de destino y lo marca como copiado, para no repetirlo">Reconocer lo ya copiado</button>' : "") + (dest && sent ? '<button class="ghost" data-act="im-verify"' + (lock ? " disabled" : "") + ' title="Cuenta los videos y fotos del grupo nuevo">Verificar en Telegram</button>' : "") + (dest && sent && !IM.copying ? '<button class="ghost" data-act="im-reset"' + (lock ? " disabled" : "") + ' title="Olvida lo que ya se copió a este grupo para poder copiar todo otra vez (úsalo después de borrar el tema en Telegram)">Empezar de cero</button>' : "") + '<span class="tmsp"></span>' + go + "</div></div>";
    /* ---- asistente: los pasos hechos se pliegan en una línea; el activo queda abierto; arriba una tarjeta dice qué sigue ---- */
    var dones = [
      !!src && !IM.pick,
      false, // el análisis no se pliega: ahí quedan «Volver a analizar» y el informe
      ms.length > 0 && !IM.tmBusy,
      !!dest && !IM.destPick && !IM.creating
    ];
    var sums = [
      src ? chatName(src) : "",
      an ? s.series + (s.series === 1 ? " serie" : " series") + " · " + nSeasons + (nSeasons === 1 ? " temporada" : " temporadas") + " · " + s.chapters + " capítulos" + (nRev ? " · " + nRev + " por revisar" : "") : "",
      an ? ms.length + " de " + an.series.length + " emparejadas" : "",
      dest ? chatName(dest) : ""
    ];
    var titles = ["Canal o grupo antiguo", "Análisis", "Fichas de TMDB", "Grupo de destino"];
    var busyNow = [false, IM.running, IM.tmBusy, IM.creating];
    var steps = [step1h, step2h, step3h, step4h, step5h].map(function (html, i) {
      var n = i + 1;
      if (n === 5 || !dones[i] || busyNow[i] || IM.copying) { return html; }
      if (IM.step[n]) { return html + '<button class="ghost sm tmhide" data-act="im-step" data-n="' + n + '">Ocultar este paso</button>'; }
      return '<div class="tmstep done"><button class="tmsum" data-act="im-step" data-n="' + n + '" aria-expanded="false"><span class="tmnum ok" aria-hidden="true">✓</span><b>' + titles[i] + '</b><span class="tmsumtxt">' + esc(sums[i]) + '</span><span class="tmsumed">Cambiar</span></button></div>';
    });
    var nxt;
    var mkBtn = function (act, label, dis) { return '<button class="primary" data-act="' + act + '"' + (dis ? " disabled" : "") + ">" + label + "</button>"; };
    if (IM.copying) { nxt = ["busy", "Copiando…", "No cierres esta pestaña. Puedes pausar cuando quieras: sigue donde iba.", '<button class="danger" data-act="im-cstop">Pausar</button>']; }
    else if (IM.running) { nxt = ["busy", "Leyendo el canal…", IM.count + " mensajes leídos hasta ahora.", '<button class="danger" data-act="im-stop">Detener</button>']; }
    else if (IM.tmBusy) { nxt = ["busy", "Buscando en TMDB…", "Un momento.", '<button class="danger" data-act="im-tm-stop">Detener</button>']; }
    else if (!src || IM.pick) { nxt = ["todo", "Paso 1 · Elige el canal antiguo", "Búscalo por nombre en la lista y márcalo. Solo se lee: no se cambia nada en él.", ""]; }
    else if (!an) { nxt = ["todo", "Paso 2 · Analiza el canal", "Lee los mensajes, reconoce series, temporadas y capítulos.", mkBtn("im-run", "Analizar canal", lock)]; }
    else if (!ms.length) { nxt = ["todo", "Paso 3 · Busca las fichas en TMDB", (nRev ? "Antes (o después) revisa a la derecha las " + nRev + " series con punto ámbar: cada una dice qué pasa y qué hacer. " : "") + "TMDB trae descripción, portada y nombre en español.", mkBtn("im-tm", "Buscar fichas en TMDB", lock)]; }
    else if (!dest) { nxt = ["todo", "Paso 4 · Elige el grupo de destino", "Crea un grupo nuevo con temas, o elige uno que ya tengas (por ejemplo HOMEFLIX).", ""]; }
    else if (IM.cerr) { nxt = ["bad", "No se pudo seguir", IM.cerr, mkBtn("im-copiar", "Continuar", lock)]; }
    else if (finished) { nxt = ["done", IM.trial ? "Prueba copiada" : "Copia completa", IM.trial ? "Mira el grupo en Telegram. Si se ve bien, quita la casilla «Prueba» y copia todo (no se repite nada)." : "Todo copiado. Puedes verificarlo con «Verificar en Telegram».", ""]; }
    else { nxt = ["todo", "Paso 5 · " + (sent ? "Continúa la copia" : IM.trial ? "Copia una prueba" : "Copia todo"), (nRev ? nRev + " series siguen con punto ámbar: se copian igual con lo que se detectó. " : "") + (IM.trial ? "Se copian solo 2 capítulos por temporada para ver cómo queda." : "Se copia sin volver a subir los videos."), go]; }
    var next = '<div class="tmnext ' + nxt[0] + '"><div class="tmnt"><b>' + nxt[1] + "</b><span>" + nxt[2] + "</span></div>" + (nxt[3] ? '<div class="tmna">' + nxt[3] + "</div>" : "") + "</div>";
    var counts = { todos: an ? an.series.length : 0, revisar: nRev, seguro: nSafe };
    var pills = [["todos", "Todas"], ["revisar", "Por revisar"], ["seguro", "Seguras"]].map(function (f) {
      return '<button data-act="im-f" data-v="' + f[0] + '" class="' + (IM.f === f[0] ? "on" : "") + '" aria-pressed="' + (IM.f === f[0]) + '">' + f[1] + " · " + counts[f[0]] + "</button>";
    }).join("");
    var right = '<div class="tmrh"><h2>Series encontradas <span class="hint">' + (an ? an.series.length : 0) + '</span></h2><div class="tmtools"><div class="seg sm" role="group" aria-label="Vista"><button data-act="im-view" data-v="lista" class="' + (IM.view === "lista" ? "on" : "") + '" aria-pressed="' + (IM.view === "lista") + '">Lista</button><button data-act="im-view" data-v="vista" class="' + (IM.view === "vista" ? "on" : "") + '" aria-pressed="' + (IM.view === "vista") + '">Vista previa</button></div><input type="search" id="imQ" class="search" placeholder="Buscar serie…" value="' + esc(IM.q) + '" aria-label="Buscar serie"><div class="seg sm" role="group" aria-label="Filtrar series">' + pills + "</div>" + (an ? '<button class="ghost sm" data-act="im-report" title="Un archivo de texto con lo que se encontró (sin claves ni videos): sirve para afinar el detector">Informe .json</button>' : "") + "</div></div>" +
      '<div class="tmlist">' + (IM.view === "vista" ? imPreview() : imRows()) + "</div>";
    return '<div class="s7"><section class="tmleft"><div class="crumb"><a href="#" data-act="inicio">Inicio</a><span aria-hidden="true">›</span><span>Importar grupo antiguo</span></div>' +
      '<div class="tmhead"><h2 class="tmh">Importar desde un grupo antiguo</h2><p class="hint">Lee un canal con el formato de antes (foto de encabezado y capítulos), lo empareja con TMDB y lo copia a un grupo nuevo con temas, con el comentario de hoy.</p></div>' +
      next + steps.join("") + '</section><section class="tmright">' + right + "</section></div>" +
      '<div class="libfoot"><div class="status"><span class="dot ' + (lock ? "busy" : "ready") + '"></span><span class="sum">' + esc(IM.copying ? "Copiando… no cierres esta pestaña" : IM.running ? "Leyendo… no cierres esta pestaña" : IM.tmBusy ? "Buscando en TMDB…" : "El canal antiguo no se toca: solo se lee y se copia sin volver a subir") + '</span></div><div class="btns"><button class="ghost" data-act="inicio">← Inicio</button></div></div>';
  }
  function imPaint() { if (B.view === "importar" && Date.now() - IM.paintAt > 400) { IM.paintAt = Date.now(); render(); } }

  ACT["im-go"] = function () {
    IM.err = ""; IM.q = ""; IM.cq = ""; IM.f = "todos"; IM.pick = !IM.src || !imSrc();
    if (!B.chats) { loadChats(); }
    show("importar");
  };
  ACT["im-src"] = function (el) { if (IM.running) { return; } IM.src = el.getAttribute("data-id"); IM.an = null; IM.err = ""; IM.open = {}; IM.pick = false; render(); };
  ACT["im-cambiar"] = function () { IM.pick = true; render(); };
  ACT["im-step"] = function (el) { var n = el.getAttribute("data-n"); IM.step[n] = !IM.step[n]; render(); };
  ACT["im-ok"] = function (el) { var id = el.getAttribute("data-sid"); IM.okd[id] = !IM.okd[id]; render(); };
  ACT["im-mov"] = function () { IM.movOpen = !IM.movOpen; render(); };
  ACT["im-view"] = function (el) { IM.view = el.getAttribute("data-v") === "vista" ? "vista" : "lista"; render(); };
  ACT["im-pv"] = function (el) { var id = el.getAttribute("data-sid"); IM.pv = IM.pv === id ? "" : id; render(); };
  ACT["im-play"] = function (el) { imPlay(el.getAttribute("data-id")); };
  ACT["im-pv-all"] = function (el) { IM.pvAll[el.getAttribute("data-k")] = true; render(); };
  ACT["im-pv-go"] = function (el) { IM.view = "vista"; IM.pv = el.getAttribute("data-sid"); render(); };
  /* Corregir a mano lo que la detección tomó por serie o por película: hay que volver a buscar su ficha en TMDB (película y serie se buscan distinto) */
  ACT["im-type"] = function (el) {
    var s = IM.an && IM.an.series.filter(function (x) { return x.id === el.getAttribute("data-sid"); })[0];
    var v = el.getAttribute("data-v");
    if (!s || IM.copying || s.type === v) { return; }
    s.type = v; s.match = null; s.nameEdited = false;
    render();
  };
  ACT["im-find"] = function () { loadChats(); setTimeout(function () { render(); }, 2500); };
  ACT["im-f"] = function (el) { IM.f = el.getAttribute("data-v") || "todos"; render(); };
  ACT["im-open"] = function (el) { var id = el.getAttribute("data-sid"); IM.open[id] = !IM.open[id]; render(); };
  ACT["im-stop"] = function () { if (IM.abort) { IM.abort.abort(); } };
  ACT["im-run"] = function () {
    var src = imSrc();
    if (IM.running || !src || !window.PrepImport) { return; }
    IM.running = true; IM.err = ""; IM.count = 0; IM.abort = new AbortController();
    render();
    PrepImport.read(B.client, src, { signal: IM.abort.signal, onProgress: function (n) { IM.count = n; imPaint(); } }).then(function (msgs) {
      IM.an = PrepImport.analyze(msgs, { chatTitle: chatName(src) });
      IM.at = Date.now(); IM.running = false; IM.open = {};
      if (IM.an.series.length === 1) { IM.open[IM.an.series[0].id] = true; }
      if (!msgs.length) { IM.err = "No encontré fotos ni videos en ese chat. ¿Es el canal correcto y eres miembro?"; }
      render();
    }, function (e) {
      IM.running = false;
      IM.err = /Detenido/.test(String(e && e.message)) ? "Detenido. Pulsa «Analizar canal» para empezar de nuevo." : "No pude leer el canal: " + ((e && (e.text || e.message)) || e);
      render();
    });
  };
  ACT["im-report"] = function () {
    var src = imSrc();
    var blob;
    var a;
    if (!IM.an) { return; }
    blob = new Blob([JSON.stringify(PrepImport.report(IM.an), null, 1)], { type: "application/json" });
    a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "analisis-canal-antiguo-" + (src ? String(src.id) : "chat") + ".json";
    a.click();
  };
  ACT["im-tm"] = function () {
    if (IM.tmBusy || !IM.an || !window.PrepImport) { return; }
    IM.tmBusy = true; IM.tmErr = ""; IM.tmAbort = new AbortController(); IM.tmProg = { done: 0, total: IM.an.series.length, title: "" };
    render();
    PrepImport.matchAll(IM.an, imApi(), { signal: IM.tmAbort.signal, force: true, onProgress: function (p) { IM.tmProg = p; imPaint(); } }).then(function () {
      IM.tmBusy = false; render();
    }, function (e) {
      IM.tmBusy = false;
      IM.tmErr = /Detenido/.test(String(e && e.message)) ? "Detenido." : "No pude buscar en TMDB: " + ((e && (e.message || e.text)) || e);
      render();
    });
  };
  ACT["im-tm-stop"] = function () { if (IM.tmAbort) { IM.tmAbort.abort(); } };
  ACT["im-split"] = function (el) {
    var sid = el.getAttribute("data-sid");
    var mode = el.getAttribute("data-mode");
    var sr = IM.an && IM.an.series.filter(function (x) { return x.id === sid; })[0];
    var row = el.closest(".imsplit");
    var f = sr && sr.match && sr.match.ficha;
    var st;
    var n;
    if (!sr || !window.PrepImport || IM.copying) { return; }
    IM.splitMsg = IM.splitMsg || {}; IM.splitMsg[sid] = ""; IM.parts = IM.parts || {};
    if (mode === "auto") { PrepImport.restoreSeasons(sr); }
    else if (mode === "tmdb") { st = PrepImport.tmdbStarts(f); if (st) { PrepImport.resplit(sr, st, "Según TMDB", f.seasons.map(function (x) { return x.episodes; })); } }
    else if (mode === "iguales") { n = Number(row.querySelector(".imparts").value) || 2; IM.parts[sid] = n; PrepImport.resplit(sr, PrepImport.equalStarts(PrepImport.maxNum(sr), n), "En " + n + " partes iguales"); }
    else if (mode === "manual") { st = PrepImport.parseStarts(row.querySelector(".imstarts").value); if (st.length) { PrepImport.resplit(sr, st, "A mano"); } else { IM.splitMsg[sid] = "Escribe en qué capítulo empieza cada temporada (por ejemplo 1, 3). Para partir en partes iguales usa el botón Aplicar de la izquierda."; } }
    IM.open[sid] = true;
    render();
  };
  ACT["im-tab"] = function (el) { if (IM.copying || IM.creating) { return; } IM.tab = el.getAttribute("data-v") === "existente" ? "existente" : "nuevo"; IM.sure = false; IM.destPick = IM.tab === "existente" && !IM.dest; render(); };
  ACT["im-dcambiar"] = function () { IM.destPick = true; render(); };
  ACT["im-dest"] = function (el) { if (IM.copying) { return; } IM.dest = el.getAttribute("data-id"); IM.st = null; IM.cerr = ""; IM.verify = ""; IM.destPick = false; render(); };
  ACT["im-crear-no"] = function () { IM.sure = false; render(); };
  /* Crea el grupo con temas: pide confirmar en la pantalla (sin diálogos del navegador) y solo lo crea y lo deja elegido; la copia la inicia el paso 5. */
  ACT["im-crear"] = function () {
    var input = $("imGname");
    var name = String((input && input.value) || "").trim() || "Importación · Temas";
    if (IM.copying || IM.creating) { return; }
    if (!IM.sure) { IM.gname = name; IM.sure = true; render(); return; }
    IM.gname = name; IM.sure = false; IM.creating = true; IM.cerr = ""; IM.verify = "";
    render();
    B.client.createSupergroup({ title: name, description: "HomeFlix: un tema por serie o película.", forum: true }).then(function (chat) {
      IM.extra.push(chat);
      if (window.PrepTopics) { PrepTopics.noteForum({ id: chat.id, isForum: true }); }
      IM.dest = String(chat.id); IM.st = null; IM.creating = false; IM.tab = "existente"; IM.destPick = false;
      IM.verify = "Grupo «" + name + "» creado. Revisa el paso 5 y pulsa «Copiar la prueba».";
      render();
    }, function (e) { IM.creating = false; IM.cerr = "No pude crear el grupo: " + ((e && (e.text || e.message)) || e); render(); });
  };
  ACT["im-copiar"] = function () {
    var dest = imDest();
    var plan = imPlan();
    if (IM.copying || !dest || !plan.total || !window.PrepImport) { return; }
    IM.st = IM.st || imStLoad();
    IM.copying = true; IM.cerr = ""; IM.verify = ""; IM.cprog = null; IM.cabort = new AbortController();
    render();
    /* sin avance guardado: antes de copiar, mira qué hay ya en el grupo para no repetirlo */
    (Object.keys(IM.st.sent || {}).length ? Promise.resolve(null) : imRecon(dest).catch(function () { return null; })).then(function (r) {
      if (r && r.found) { IM.verify = "En el grupo ya había " + r.found + " de " + r.total + " elementos: se saltan."; }
      return PrepImport.copyAll({ client: B.client, from: Number(IM.src), to: dest, analysis: IM.an, state: IM.st, save: imStSave, signal: IM.cabort.signal, api: imApi(), category: IM.cat, maxEpisodes: IM.trial ? 2 : 0, onProgress: function (p) { IM.cprog = p; imPaint(); } }).then(function () {
      IM.copying = false; render();
    }, function (e) {
      IM.copying = false;
      IM.cerr = /Detenido/.test(String(e && e.message)) ? "Detenido. Pulsa «Continuar»: sigue donde iba." : copyErr(e);
      render();
    });
    });
  };
  ACT["im-recon"] = function () {
    var dest = imDest();
    if (IM.copying || !dest || !window.PrepImport) { return; }
    IM.copying = true; IM.verify = "Mirando lo que ya hay en el grupo…"; render();
    imRecon(dest).then(function (r) {
      IM.copying = false;
      IM.verify = r.found ? "En el grupo ya había " + r.found + " de " + r.total + " elementos: quedan marcados como copiados y no se repiten." : "No encontré en el grupo nada que coincida con este canal (miré " + r.scanned + " mensajes).";
      render();
    }, function (e) { IM.copying = false; IM.cerr = copyErr(e); render(); });
  };
  ACT["im-cstop"] = function () { if (IM.cabort) { IM.cabort.abort(); } };
  /* Olvida el avance guardado de esta copia (canal → grupo): sirve cuando el usuario borró lo copiado en Telegram y quiere repetirlo. No toca Telegram. */
  ACT["im-reset"] = function () {
    if (IM.copying || !IM.dest) { return; }
    if (!window.confirm("Esto solo borra el avance guardado aquí (no toca Telegram). Antes borra en Telegram el tema que quieres rehacer; después se copiará todo otra vez. ¿Seguimos?")) { return; }
    IM.st = { sent: {} }; imStSave(IM.st); IM.cerr = ""; IM.verify = "";
    render();
  };
  ACT["im-verify"] = function () {
    var dest = imDest();
    var st = IM.st || imStLoad();
    var plan = imPlan();
    var expV = 0;
    var expP = 0;
    if (!dest) { return; }
    plan.groups.forEach(function (g) { g.items.forEach(function (x) { if (st.sent && st.sent[x.key] === true) { if (/^s\d+:e:/.test(x.key)) { expV += 1; } else { expP += 1; } } }); });
    IM.verify = "Contando en Telegram…"; render();
    Promise.all([B.client.searchMessages({ chatId: dest, filter: VIDEO, limit: 1 }), B.client.searchMessages({ chatId: dest, filter: PHOTOS, limit: 1 })]).then(function (r) {
      var v = r[0].total != null ? r[0].total : r[0].length;
      var p = r[1].total != null ? r[1].total : r[1].length;
      IM.verify = "En el grupo hay " + v + " videos y " + p + " fotos; se copiaron " + expV + " capítulos y " + expP + " imágenes." + (v >= expV && p >= expP ? " Coincide." : " Falta algo: pulsa «Continuar».");
      render();
    }, function (e) { IM.verify = "No pude verificar: " + ((e && (e.text || e.message)) || e); render(); });
  };

  /* los buscadores repintan solo su lista (sin perder el cursor); el nombre de cada serie y del grupo nuevo se guardan al escribir */
  $("lib").addEventListener("input", function (e) {
    var l;
    var sr;
    if (B.view !== "importar") { return; }
    if (e.target.id === "imQ") { IM.q = e.target.value; l = document.querySelector(".tmlist"); if (l) { l.innerHTML = imRows(); } }
    if (e.target.id === "imCq") { IM.cq = e.target.value; l = document.querySelector(".impick"); if (l) { l.innerHTML = imPickRows(); } }
    if (e.target.id === "imGname") { IM.gname = e.target.value; }
    if (e.target.classList && e.target.classList.contains("imname") && IM.an) {
      sr = IM.an.series.filter(function (x) { return x.id === e.target.getAttribute("data-sid"); })[0];
      if (sr) { sr.name = e.target.value; sr.nameEdited = true; }
    }
  });
  $("lib").addEventListener("change", function (e) {
    var sr;
    if (B.view !== "importar") { return; }
    if (e.target.classList && e.target.classList.contains("imparts")) { IM.parts = IM.parts || {}; IM.parts[e.target.getAttribute("data-sid")] = Number(e.target.value) || 2; return; }
    if (e.target.id === "imTrial") { IM.trial = !!e.target.checked; IM.st = null; render(); return; }
    if (e.target.classList && e.target.classList.contains("imsel") && IM.an && window.PrepImport) {
      sr = IM.an.series.filter(function (x) { return x.id === e.target.getAttribute("data-sid"); })[0];
      if (sr && sr.match) { PrepImport.pick(sr, e.target.value, imApi()).then(function () { render(); }); }
    }
  });

  /* Migrar / Respaldo: el buscador de temas repinta solo la lista (sin perder el cursor); el nombre del grupo se guarda al escribir; el menú «Más opciones» se cierra al tocar fuera */
  $("lib").addEventListener("input", function (e) {
    var list;
    if (B.view !== "temas") { return; }
    if (e.target.id === "tmName") { TM.name = e.target.value; }
    if (e.target.id === "tmQ") {
      TM.q = e.target.value;
      list = document.querySelector(".tmlist");
      if (list) { list.innerHTML = tmRows(); }
    }
  });
  $("lib").addEventListener("click", function (e) {
    if (B.view === "temas" && TM.menu && !e.target.closest(".tmmenu")) { TM.menu = false; render(); }
  });


  /* Inicio: «/» y Ctrl+K llevan al buscador; los menús (Herramientas, Categoría, Más) se cierran al tocar fuera */
  document.addEventListener("keydown", function (e) {
    var tag = e.target && e.target.tagName;
    var q;
    if (B.view !== "inicio" || (document.body.className.indexOf("tabs") >= 0)) { return; }
    if (e.key === "Escape" && B.pop) { B.pop = ""; render(); return; }
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "k" || (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag || ""))) {
      q = $("libQ");
      if (q) { e.preventDefault(); q.focus(); q.select(); }
    }
  });
  document.addEventListener("click", function (e) {
    if (B.view === "inicio" && B.pop && !e.target.closest('[data-act="pop"]') && !e.target.closest(".hpop")) { B.pop = ""; render(); }
  });

  /* ===================== Ficha ===================== */
  function partsText(v) { return v.n > 1 ? v.n + " partes" : "1 archivo"; }

  function viewFicha() {
    var t = B.sel;
    if (!t) { return viewInicio(); }
    var s = statusOf(t);
    var series = t.type === "series";
    var eps = episodesOf(t);
    var imgKey = t.imageKey || (t.video && t.video.key);
    var have = haveOf(t);
    var meta = (series ? "<b>Serie</b><span>" + eps.length + (eps.length === 1 ? " capítulo" : " capítulos") + "</span>" :
      (t.year ? "<b>" + esc(t.year) + "</b>" : "") + (t.video && t.video.duration ? "<span>" + fmtDur(t.video.duration) + "</span>" : "")) +
      (t.categories || []).map(function (c) { return '<span class="pill dim">' + esc(c) + "</span>"; }).join("") + (t.kids ? '<span class="pill dim">Infantil</span>' : "");
    var hero = '<section><div class="crumb"><a href="#" data-act="inicio">Inicio</a><span aria-hidden="true">›</span><span>' + esc(t.name) + "</span></div>" +
      '<div class="fhero"><div class="art" data-thumb="' + esc(imgKey || "") + '"' + thumbStyle(imgKey) + "></div><div><h1>" + esc(t.name) + '</h1><div class="meta">' + meta + "</div>" +
      (t.description ? "<p>" + esc(t.description) + "</p>" : "") + '<div class="hint" style="margin-top:8px">Publicada el ' + esc(fecha(t.date)) + "</div></div></div></section>";

    var vrows = QS.map(function (q) {
      var label = q[0];
      if (series) {
        var withQ = eps.filter(function (e) { return (e.versions || []).some(function (v) { return v.q === label; }); }).length;
        var all = withQ === eps.length && eps.length;
        return '<div class="vrow' + (withQ ? "" : " miss") + '"><span class="q">' + label + '</span><span class="d">' +
          (withQ ? withQ + " de " + eps.length + " capítulos" : "Falta") + "<small>" + (all ? "Todos los capítulos la tienen" : withQ ? "Faltan " + (eps.length - withQ) + " capítulos" : "Ningún capítulo la tiene") + "</small></span>" +
          '<span class="pill ' + (all ? "good" : "gold") + '">' + (all ? "Publicada" : "Se puede crear") + "</span></div>";
      }
      var v = (t.versions || []).filter(function (x) { return x.q === label; })[0];
      if (v) {
        var vid = v.video || {};
        return '<div class="vrow"><span class="q">' + label + '</span><span class="d">En el grupo · ' + gb(v.size) + " · " + partsText(v) +
          "<small>" + esc((vid.width && vid.height ? vid.width + "×" + vid.height + " · " : "") + (v.bps ? (v.bps / 1e6).toFixed(1).replace(".", ",") + " Mbps · " : "") + "subida el " + fecha(v.date)) + "</small></span>" +
          '<span class="pill good">Publicada</span></div>';
      }
      var top = have.length ? have[0] : "";
      var can = label === "4K" ? "Necesita un original en 4K" : top && QS.findIndex(function (x) { return x[0] === top; }) < QS.findIndex(function (x) { return x[0] === label; }) ? "Se crea desde tu original (o desde la de " + top + ")" : "Se crea desde tu original";
      return '<div class="vrow miss"><span class="q">' + label + '</span><span class="d">Falta<small>' + esc(can) + '</small></span><span class="pill gold">Se va a crear</span></div>';
    }).join("");

    var L = s.lang;
    var trackList = function (list) {
      return list.length ? list.map(function (a) {
        return '<div class="check">' + esc((a.lang || "sin marcar").toUpperCase() + (a.codec ? " · " + a.codec.toUpperCase() : "") + (a.channels ? " · " + a.channels + " canales" : "") + (a.title ? " · " + a.title : "") + (a.forced ? " · forzados" : "")) + (isEs(a) ? ' <span class="pill good">español</span>' : "") + "</div>";
      }).join("") : '<div class="check" style="color:var(--dim)">No tiene</div>';
    };
    var langBody = L.state === "pending" ? '<div class="lib-center sm"><div class="lib-spin"></div>Leyendo el encabezado del archivo…</div>' :
      L.error ? '<div class="alerta" role="alert"><span class="ai" aria-hidden="true">⚠</span><div class="at"><b>No pude leer las pistas del archivo</b><code>' + esc(L.error) + '</code><small>Revisa que el archivo esté accesible (la conexión o el equipo donde está) y vuelve a intentar leer las pistas.</small></div><button class="primary sm" data-act="relang">Reintentar lectura</button></div>' :
      (series ? '<div class="tracks"><div><h3>Audio</h3>' + trackList(L.audio) + "</div><div><h3>Subtítulos</h3>" + trackList(L.subs) + "</div></div>" : langFixer(t) + extSubsSection(t) + langSaveRow(t)) +
      (L.state === "no" ? '<div class="note warn"><b>No tiene audio ni subtítulos en español.</b> Elige cómo agregarlo; se hace junto con las calidades.</div>' + esOptions(t) :
        L.state === "unknown" ? '<div class="note warn">Las pistas no dicen su idioma. Si sabes que está en español, no hay que hacer nada; si no, agrégalo:</div>' + esOptions(t) :
        "");
    /* el estado del idioma va en el título de la sección, con «volver a revisar» al lado */
    var langHead = L.state === "pending" ? "" : '<span class="hstat ' + (L.state === "es" || L.state === "subs" ? "ok" : "warn") + '">' +
      (L.state === "es" ? "✓ Audio en español" : L.state === "subs" ? "✓ Subtítulos en español" : L.state === "no" ? "Sin español" : "Idioma sin marcar") + "</span>" +
      '<button class="icobtn" data-act="relang" title="Volver a revisar las pistas" aria-label="Volver a revisar las pistas">↻</button>';

    var imgRow = function (kind, key, need) {
      var it = photoInfo(key);
      var vert = kind === "Vertical";
      var issue = imgIssue(it, kind === "Banner" ? "banner" : vert ? "vertical" : "portada", t);
      if (issue) {
        return '<div class="vrow"><span class="q" style="font-size:14px">' + kind + '</span><span class="d">' + it.width + "×" + it.height + "<small>" +
          (issue === "Repetida" ? "Es la misma imagen que la de " + esc(dupNames(it, t)) : (vert ? "Debe ser vertical (2:3) desde " : "Debe ser horizontal desde ") + need) +
          '</small></span><button class="sm" data-act="img-from-ficha" data-id="' + esc(key) + '">Cambiar…</button></div>';
      }
      return '<div class="vrow' + (it ? "" : " miss") + '"><span class="q" style="font-size:14px">' + kind + '</span><span class="d">' +
        (it ? it.width + "×" + it.height : "No tiene") + "<small>" + (it ? (issue ? (vert ? "Debe ser vertical (2:3) desde " : "Debe ser horizontal desde ") + need : (vert ? "Vertical · bien" : "Horizontal · bien")) : (vert ? "Falta: la vista vertical usa la horizontal" : "La app usa un cuadro del video")) + "</small></span>" +
        '<span class="pill ' + (it ? (issue ? "warn" : "good") : "dim") + '">' + (it ? (issue || "Bien") : "Opcional") + "</span></div>";
    };

    /* galería de escenas del título (de la serie o de la película): cuántas tiene y sus primeras fotos */
    var galRow = function (who) {
      var gal = t.galleryKeys || [];
      if (!gal.length) {
        return '<div class="galempty"><span class="gi" aria-hidden="true">▦</span><div class="gt"><b>Sin escenas</b><small>Agrega capturas de ' + who + ': en el celular aparece el botón «Galería».</small></div>' +
          '<button class="sm" data-act="go-tab" data-tab="4" title="Pestaña 4: elegir y publicar escenas">＋ Agregar escenas</button></div>';
      }
      return '<div class="vrow' + (gal.length ? "" : " miss") + '"><span class="q" style="font-size:13px">Galería</span><span class="d">' +
        (gal.length ? gal.length + (gal.length === 1 ? " escena" : " escenas") + " de " + who : "Sin escenas") +
        "<small>" + (gal.length ? gal.slice(0, 6).map(function (k) { return '<span class="gth" data-thumb="' + esc(k) + '"' + thumbStyle(k) + "></span>"; }).join("") : "En el celular el botón «Galería» aparece cuando hay escenas") + "</small></span>" +
        '<span class="acts"><button class="sm" data-act="go-tab" data-tab="4" title="Pestaña 4: elegir y publicar escenas">' + (gal.length ? "Agregar escenas" : "Agregar") + "</button></span></div>";
    };
    var epRows = function () {
      var eps = episodesOf(t);
      if (!eps.length) { return ""; }
      return '<section><h2>Capítulos y galería <span class="hint">· a cada uno se le puede completar su imagen, galería y miniaturas sin renderizar</span></h2><div class="vlist">' + galRow("la serie") + eps.map(function (e) {
        var have = (e.versions || []).map(function (v) { return v.q; });
        var id = e.season + ":" + e.episode;
        var eg = e.galleryKeys || [];
        return '<div class="vrow"><span class="q" style="font-size:13px">T' + e.season + ":E" + e.episode + '</span><span class="d">' + esc(e.title || "Capítulo " + e.episode) +
          "<small>" + (have.length ? esc(have.join(" · ")) : "sin versiones") + (eg.length ? " · galería: " + eg.length + (eg.length === 1 ? " escena" : " escenas") : "") + "</small></span>" +
          '<span class="acts"><button class="sm" data-act="go-tab" data-tab="4" data-ep="' + id + '" title="Solo la pestaña 4: completar imágenes, galería y miniaturas">Pestaña 4</button>' +
          '<button class="sm ghost" data-act="go-tab" data-tab="3" data-ep="' + id + '" title="Pestañas 3 y 4: calidades y publicación">3 y 4</button></span></div>';
      }).join("") + "</div></section>";
    };
    var todo = s.miss.slice();
    if (s.noEs) { todo.push("español"); }
    if (!series && !t.thumbs) { todo.push("miniaturas"); }
    if (s.imgs.length) { todo.push(s.imgs.map(function (x) { return x.kind.toLowerCase(); }).join(" y ")); }
    var footText = todo.length ? "Le falta: " + todo.join(", ") + ". Al seguir, la pestaña 1 se llena con los datos de " + (series ? "la serie" : "esta película") + "." : "No le falta nada.";
    return '<div class="s5"><div class="stack">' + hero +
      '<section><h2>Calidades en el grupo <span class="hint">· las nuevas se publican con el mismo comentario y la app las junta con las que ya están</span></h2><div class="vlist">' + vrows + "</div></section>" +
      (series ? epRows() : sourceSection(t, s)) +
      '</div><div class="stack">' + fichaTabs(t, s, series, L, langHead, langBody, imgRow, galRow) +
      "</div></div>" +
      '<div class="libfoot"><div class="status"><span class="dot ' + (FI.busy ? "busy" : todo.length ? "ready" : "done") + '"></span><span class="sum">' + esc(FI.busy || footText) + "</span></div>" +
      '<div class="btns"><button class="ghost" data-act="inicio">← Inicio</button>' +
      '<button class="ghost" data-act="go-tab" data-tab="4" title="Completar lo que falta (galería, imágenes, miniaturas) sin renderizar">Solo publicación (4) →</button>' +
      '<button class="ghost" data-act="go-tab" data-tab="3" title="Calidades y publicación, sin necesidad de renderizar">Calidades y publicación (3 y 4) →</button>' +
      ((s.miss.length || fiEs(t)) && !series ? '<button class="primary" data-act="prepare"' + (FI.busy ? " disabled" : "") + ">" + (fiEs(t) && !s.miss.length ? "Volver a crear con el español →" : "Preparar lo que falta →") + "</button>" : "") + "</div></div>";
  }

  /* Íconos de las pestañas: mismo trazo lineal para que armonicen (16 px, trazo 1,75, heredan el color del texto) */
  var TAB_SVG = function (inner) { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>"; };
  var TAB_IC = {
    idioma: TAB_SVG('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"></path><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"></path><path d="M18.5 7a7 7 0 0 1 0 10"></path>'),
    comentario: TAB_SVG('<path d="M8 8l-4 4 4 4"></path><path d="M16 8l4 4-4 4"></path><path d="M13.5 6l-3 12"></path>'),
    imagenes: TAB_SVG('<rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="9" cy="9.5" r="1.7"></circle><path d="M21 16.5l-5-5-9 8.5"></path>'),
    miniaturas: TAB_SVG('<rect x="3" y="4" width="18" height="16" rx="2.5"></rect><path d="M8 4v16"></path><path d="M16 4v16"></path><path d="M3 9h5"></path><path d="M3 15h5"></path><path d="M16 9h5"></path><path d="M16 15h5"></path>')
  };
  /* La columna derecha de la ficha en pestañas: Idiomas y subtítulos · Comentario · Imágenes. Un punto ámbar avisa cuál pide atención. */
  function fichaTabs(t, s, series, L, langHead, langBody, imgRow, galRow) {
    var tab = B.fTab === "comentario" ? "comentario" : ((B.fTab === "imagenes" || B.fTab === "miniaturas") && !series ? B.fTab : "idioma");
    var langAlert = !!L.error || L.state === "no" || L.state === "unknown" || s.lp.srtBad.length > 0 || s.lp.gaps.length > 0 || s.bad.length > 0 || s.emb.length > 0;
    var imgAlert = !series && s.imgs.length > 0;
    var cap = (t.video && t.video.caption) || "";
    var tabs = [["idioma", TAB_IC.idioma, "Idiomas y subtítulos", langAlert], ["comentario", TAB_IC.comentario, "Comentario", !cap]].concat(series ? [] : [["imagenes", TAB_IC.imagenes, "Imágenes", imgAlert], ["miniaturas", TAB_IC.miniaturas, "Miniaturas", !t.thumbs]]);
    var head = '<div class="ftabs" role="tablist" aria-label="Datos de la película">' + tabs.map(function (x) {
      return '<button role="tab" class="ftab' + (tab === x[0] ? " on" : "") + '" data-act="ftab" data-v="' + x[0] + '" aria-selected="' + (tab === x[0]) + '"><span class="fi" aria-hidden="true">' + x[1] + "</span>" + x[2] +
        (x[3] ? '<i class="fdot" title="Pide atención" aria-label="Pide atención"></i>' : "") + "</button>";
    }).join("") + "</div>";
    var body;
    if (tab === "comentario") {
      body = '<div class="fphead"><h2>Comentario en el grupo</h2><button class="ghost sm" data-act="copy-caption" title="Copiar el comentario">Copiar</button></div>' +
        '<div class="caption big">' + esc(cap) + "</div>" +
        '<div class="hint" style="margin-top:8px">Es el texto que lleva cada video en Telegram: tipo, nombre, año, descripción y marcas (#categoría, #tmdb…).</div>';
    } else if (tab === "miniaturas") {
      body = thumbsSection(t, true);
    } else if (tab === "imagenes") {
      body = '<div class="fphead"><h2>Portada, banner, vertical y galería</h2></div><div class="vlist g3">' + imgRow("Portada", t.imageKey, "1280×720") + imgRow("Banner", t.bannerKey !== t.imageKey ? t.bannerKey : null, "1920×1080") +
        imgRow("Vertical", t.verticalKey || null, "800×1200") + galRow("la película") + "</div>";
    } else {
      var gs = series ? [] : fileGroups(t);
      var nq = series ? 0 : (t.versions || []).length;
      var sum = series ? "" : gs.length > 1 ? "Las calidades traen pistas distintas" : nq > 1 ? nq + " calidades · mismas pistas" : nq === 1 ? "1 calidad" : "";
      body = (sum || langHead ? '<div class="lbar"><span class="lsum">' + esc(sum) + '</span><span class="lact">' + langHead + "</span></div>" : "") + langBody; // cabecera de estado: resumen a la izquierda; audio en español y ↻ a la derecha
    }
    return '<section class="fsec' + (tab === "idioma" && L.error ? " alertsec" : "") + '">' + head + '<div class="fpanel">' + body + "</div></section>";
  }
  ACT.ftab = function (el) { B.fTab = el.getAttribute("data-v"); render(); };
  ACT["copy-caption"] = function (el) {
    var t = B.sel;
    var txt = (t && t.video && t.video.caption) || "";
    var done = function () { el.textContent = "✓ Copiado"; setTimeout(function () { if (el.isConnected) { el.textContent = "Copiar"; } }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(done, function () { el.textContent = "No se pudo copiar"; }); }
    else { el.textContent = "No se pudo copiar"; }
  };

  /* ----- corrector de idiomas de la ficha (por archivo: cada calidad lleva su comentario) ----- */
  var LF = { key: "", pick: {}, busy: "", msg: "" };
  function lfFor(t) {
    if (LF.key !== t.titleKey) {
      LF = { key: t.titleKey, pick: {}, busy: "", msg: "" };
    }
    /* lo detectado ya viene elegido (si su nombre lo dice): solo hay que guardar */
    fileGroups(t).forEach(function (g) {
      if (!g.r || LF.pick[g.id]) { return; }
      LF.pick[g.id] = { audio: [], subs: [] };
      ["audio", "subs"].forEach(function (k) {
        (trackRows(g, k) || []).forEach(function (x) { if (x.issue && x.guess) { LF.pick[g.id][k][x.i] = x.guess; } });
      });
    });
    return LF;
  }
  function lfChoice(g, k, x) { var p = LF.pick[g.id]; return (p && p[k][x.i]) || x.fixed || (knownCode(x.own) ? x.own : x.guess) || "und"; }
  function lfSame(c, x) { return x.fixed ? c === x.fixed : c === x.own || (c === "und" && !knownCode(x.own)); }
  /* lo que va al comentario de ese archivo: por pista, el código elegido o x si se deja el suyo */
  function lfLangs(g) {
    var out = {};
    ["audio", "subs"].forEach(function (k) {
      var codes = (trackRows(g, k) || []).map(function (x) {
        var c = lfChoice(g, k, x);
        return !x.fixed && (c === x.own || (c === "und" && !knownCode(x.own))) ? "x" : c;
      });
      while (codes.length && codes[codes.length - 1] === "x") { codes.pop(); }
      if (codes.length) { out[k] = codes; }
    });
    return out;
  }
  function lfDirty(g) { return !!g.r && !g.r.error && HFLibrary.langsTag(lfLangs(g)) !== HFLibrary.langsTag(g.fix || {}); }
  /* El botón de guardar de las pistas: queda al final de la pestaña y se pega abajo de la pantalla mientras haya algo que guardar. */
  function langSaveRow(t) {
    var groups = fileGroups(t);
    var dirty;
    if (!groups.length) { return ""; }
    dirty = groups.some(lfDirty);
    return '<div class="lfsave' + (dirty ? " dirty" : "") + '"><button class="primary sm" data-act="lfix-save"' + (dirty && !LF.busy ? "" : " disabled") + ">" + esc(LF.busy || "Guardar idiomas") + "</button>" +
      '<span class="hint">' + (dirty ? "Hay cambios sin guardar. " : "") + "Solo cambia el comentario de los archivos en el grupo; no se vuelve a subir nada.</span></div>";
  }
  function langFixer(t) {
    lfFor(t);
    var groups = fileGroups(t);
    if (!groups.length) { return '<div class="check" style="color:var(--dim)">No hay archivos de esta película en el grupo.</div>'; }
    var sel = function (g, k, x) {
      var c = lfChoice(g, k, x);
      var opts = LANG_OPTS.slice();
      if (!opts.some(function (o) { return o[0] === c; })) { opts.push([c, c.toUpperCase()]); }
      return '<select data-trk="' + k + '" data-g="' + esc(g.id) + '" data-i="' + x.i + '" aria-label="Idioma de la pista ' + (x.i + 1) + '">' +
        opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === c ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>";
    };
    var block = function (g, k, title) {
      var rows = trackRows(g, k) || [];
      return "<div><h3>" + title + "</h3>" + (rows.length ? rows.map(function (x) {
        var a = x.a;
        var tech = [(a.lang || "sin idioma").toUpperCase(), a.codec ? a.codec.toUpperCase() : "", a.channels ? (a.channels >= 6 ? "5.1" : a.channels === 2 ? "Estéreo" : a.channels + " canales") : "", a.forced ? "forzados" : ""].filter(Boolean).join(" · ");
        var changed = !lfSame(lfChoice(g, k, x), x);
        return '<div class="trk' + (x.issue ? " bad" : "") + '"><span class="n">' + (x.i + 1) + '</span><span class="d"><b>En la app: ' + esc(x.label) + "</b>" +
          "<small>" + esc(tech) + (a.title ? " · «" + esc(a.title) + "»" : "") + "</small>" +
          (x.issue ? '<small class="why">⚠ ' + esc(x.issue) + (x.guess ? " · sugerido: " + esc(codeName(x.guess)) : " · elige su idioma") + "</small>" : x.fixed ? '<small class="ok">✓ Corregido en el comentario</small>' : "") +
          "</span>" + sel(g, k, x) + (changed ? '<span class="pill gold">cambia</span>' : "") + "</div>";
      }).join("") : '<div class="check" style="color:var(--dim)">No tiene</div>') + "</div>";
    };
    var html = groups.map(function (g) {
      var head = groups.length > 1 ? '<div class="lfg">' + esc(g.versions.map(function (v) { return v.q; }).join(" · ")) + "</div>" : "";
      if (!g.r) { return head + '<div class="lib-center sm"><div class="lib-spin"></div>Leyendo las pistas…</div>'; }
      if (g.r.error) { return head + '<div class="note warn">No pude leer las pistas de este archivo: ' + esc(g.r.error) + "</div>"; }
      return head + '<div class="tracks lfix">' + block(g, "audio", "Audio") + block(g, "subs", "Subtítulos") + "</div>";
    }).join("");
    var issues = langIssues(t);
    var guessed = issues.filter(function (x) { return x.row.guess; }).length;
    var dirty = groups.some(lfDirty);
    return (groups.length > 1 ? '<div class="hint" style="margin:6px 0 2px">Las calidades no traen las mismas pistas: cada una se corrige aparte.</div>' : "") + html +
      (issues.length ? '<div class="note warn"><b>' + issues.length + (issues.length === 1 ? " pista muestra" : " pistas muestran") + " el idioma mal en la TV y el celular.</b> " +
        (guessed === issues.length ? "Ya dejé elegido lo que dice su nombre; revísalo y guarda." : guessed ? "Las que dicen su idioma en el nombre ya están elegidas; en las demás elige el idioma y guarda." : "Elige su idioma y guarda.") + "</div>" : "") +
      (LF.msg ? '<div class="note ' + (/^✓/.test(LF.msg) ? "ok" : "bad") + '">' + esc(LF.msg) + "</div>" : "") +
      "";
  }
  /* ----- subtítulos aparte: un .srt publicado en el grupo con el comentario de la película; la TV y el celular lo
   * ofrecen en TODAS sus calidades (el que el archivo ya trae en ese idioma no se repite). No se renderiza nada. ----- */
  var XS = { key: "", file: null, lang: "", busy: "", msg: "", sync: null, useSync: true };
  /* «Iron Man 1 (2008).eng.srt»: el mismo nombre que los subtítulos que saca el preparador de los videos */
  var TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"></path><path d="M10 11v6M14 11v6"></path><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"></path><path d="M9 7V4h6v3"></path></svg>';
  var DLIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"></path><path d="M7 10l5 5 5-5"></path><path d="M5 20h14"></path></svg>';
  var SUBIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M7 13h4M13 13h4M7 16h7"></path></svg>';
  /* ¿la película traía este idioma de subtítulos dentro del video («pelicula») o se subió aparte («agregado»)?
   * Si todavía no se leyeron las pistas de ningún video, no se sabe (""). */
  function subOrigin(t, x) {
    var groups = fileGroups(t).filter(function (g) { return g.r && !g.r.error; });
    if (!groups.length) { return ""; }
    var want = x.lang === "lat" ? "spa" : x.lang;
    var found = groups.some(function (g) {
      var fix = (g.fix && g.fix.subs) || [];
      return (g.r.subs || []).some(function (a, i) {
        var c = normCode(fix[i] && fix[i] !== "x" ? fix[i] : a.lang);
        return (c === "lat" ? "spa" : c) === want && !!a.forced === !!x.forced;
      });
    });
    return found ? "pelicula" : "agregado";
  }
  function xsName(t, lang, fileName) {
    var ext = (/\.(srt|vtt|ass|ssa)$/i.exec(fileName || "") || [".srt"])[0].toLowerCase();
    var base = (t.name.replace(/[#\\/:*?"<>|]/g, "").trim() + (t.year ? " (" + t.year + ")" : "")).slice(0, 40).trim();
    return base + "." + lang + ext;
  }
  /* una espera con tope: si Telegram no responde, se avisa en vez de quedarse en «Publicando…» para siempre */
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (ok, no) { setTimeout(function () { no(new Error("TIMEOUT")); }, ms); })]);
  }
  /* ----- revisión de cada .srt aparte: se baja (pesa poco), se cuentan sus líneas, hasta dónde llega frente a la
   * película, si tiene tiempos rotos o letras dañadas, y si va al compás del español de referencia ----- */
  var LS_SRT = "hf.preparador.srt";
  var SRT = { cache: {}, queue: [], busy: false };
  try { SRT.cache = JSON.parse(store(LS_SRT) || "{}") || {}; } catch (e) { SRT.cache = {}; }
  function titleDur(t) {
    return Math.max.apply(null, [(t.video && t.video.duration) || 0].concat((t.versions || []).map(function (v) { return v.dur || 0; })));
  }
  function srtNeeds(t, x) {
    var c = SRT.cache[x.key];
    if (!c || c.v !== 3) { return true; }
    var ref = syncRef(t);
    var wantRef = !x.forced && ref && ref.key !== x.key ? ref.key : "";
    return (c.refKey || "") !== wantRef;
  }
  function queueSrt() {
    var add = [];
    B.titles.forEach(function (t) {
      if (t.type === "series") { return; }
      var ref = syncRef(t);
      /* el español de referencia primero: los demás se comparan con él */
      (t.subFiles || []).slice().sort(function (a, b) { return (ref && a.key === ref.key ? -1 : 0) - (ref && b.key === ref.key ? -1 : 0); }).forEach(function (x) {
        if (B.msgs[x.key] && srtNeeds(t, x) && !SRT.queue.some(function (q) { return q.x.key === x.key; })) { add.push({ t: t, x: x }); }
      });
    });
    SRT.queue = SRT.queue.concat(add);
    runSrt();
  }
  async function srtText(key) {
    if (refCache[key]) { return refCache[key]; }
    var b = await withTimeout(B.client.downloadAsBuffer(B.msgs[key].media), 45000);
    refCache[key] = HFSubSync.decode(b);
    return refCache[key];
  }
  async function runSrt() {
    if (SRT.busy) { return; }
    SRT.busy = true;
    var peer = B.peer;
    var checked = 0;
    while (SRT.queue.length && peer === B.peer) {
      var job = SRT.queue.shift();
      checked += 1;
      try {
        SRT.cache[job.x.key] = await checkSrt(job.t, job.x);
      } catch (e) {
        SRT.cache[job.x.key] = { v: 0, error: String(e && e.message) === "TIMEOUT" ? "Telegram no respondió" : String((e && e.message) || e) };
      }
      store(LS_SRT, JSON.stringify(SRT.cache));
      await Promise.resolve();
      if (B.view === "ficha" && B.sel === job.t) { render(); }
      else {
        var el = document.querySelector('[data-card="' + CSS.escape(job.t.titleKey) + '"]');
        if (el) { el.outerHTML = card(job.t, statusOf(job.t)); watchThumbs(); }
      }
    }
    SRT.busy = false;
    if (checked && B.view === "inicio") { render(); } // si no hubo nada que revisar, no se repinta
  }
  async function checkSrt(t, x) {
    var text = await srtText(x.key);
    var p = HFSubSync.parse(text);
    var cues = p.cues;
    var dur = titleDur(t);
    var end = cues.reduce(function (m, c) { return Math.max(m, c.e); }, 0);
    var broken = cues.filter(function (c) { return c.e <= c.s; }).length;
    var moji = (text.match(/Ã[ -¿]|â€|�/g) || []).length;
    var issues = [];
    if (!cues.length) { issues.push("no tiene líneas de tiempo: no es un .srt válido"); }
    else if (!x.forced && cues.length < 80) { issues.push("casi vacío: solo " + cues.length + " líneas"); }
    if (!x.forced && cues.length && dur && end < dur * 0.75) { issues.push("se corta en " + fmtDur(end) + " de " + fmtDur(dur)); }
    if (cues.length && dur && end > dur + 120) { issues.push("dura más que la película (" + fmtDur(end) + " de " + fmtDur(dur) + "): es de otra versión"); }
    if (broken > Math.max(2, cues.length * 0.01)) { issues.push(broken + " líneas con tiempos rotos"); }
    if (moji > 5) { issues.push("letras dañadas (tildes y ñ mal)"); }
    var out = { v: 3, cues: cues.length, end: end, dur: dur, issues: issues, refKey: "" };
    var ref = syncRef(t);
    out.refKey = !x.forced && ref && ref.key !== x.key ? ref.key : "";
    if (out.refKey && cues.length >= 20) {
      var refText = await srtText(ref.key);
      var s0 = HFSubSync.score(refText, text);
      if (s0 != null && s0 >= 0.75) { out.match = { state: "igual", score: s0 }; }
      else {

        var r = HFSubSync.sync(refText, text);
        out.match = r.dudoso ? { state: "dudoso", score: r.mejor } : r.igual ? { state: "igual", score: r.before } : { state: "desfasado", score: r.before, after: r.after, offset: r.offset, tramos: !!r.tramos, speed: r.speed };
        if (r.dudoso) { issues.push("no coincide con el español ni corriéndolo: puede ser de otra película o de otro corte"); }
        else if (!r.igual) {
          var how = [];
          if (r.tramos) { how.push("corrido según el tramo"); } else if (Math.abs(r.offset) >= 0.05) { how.push("corrido " + secText(r.offset)); }
          if (speedText(r.speed)) { how.push("a otra velocidad"); }
          issues.push("no va al compás del español: " + (how.join(" y ") || "corrido") + " (coincide " + Math.round(r.before * 100) + " %)");
        }
      }
    }
    return out;
  }
  /* lo que tiene y le falta de español e inglés: audio (de los videos) y subtítulos aparte (con su origen y revisión) */
  function langPanel(t) {
    var groups = fileGroups(t).filter(function (g) { return g.r && !g.r.error; });
    var audio = null;
    if (groups.length) {
      audio = {};
      groups.forEach(function (g) {
        var fix = (g.fix && g.fix.audio) || [];
        (g.r.audio || []).forEach(function (a, i) {
          var c = normCode(fix[i] && fix[i] !== "x" ? fix[i] : a.lang);
          if (!knownCode(c)) { c = guessLang(a.title) || c; }
          if (c === "lat") { c = "spa"; }
          audio[c] = true;
        });
      });
    } else if (t.video && B.langs[t.video.key] && !B.langs[t.video.key].error) {
      audio = {};
      (B.langs[t.video.key].audio || []).forEach(function (a) { var c = isEs(a) ? "spa" : normCode(a.lang); audio[c] = true; });
    }
    var emb = {};
    groups.forEach(function (g) { Object.keys(subLangsOf(g)).forEach(function (c) { emb[c] = true; }); });
    var subs = {};
    ["spa", "eng"].forEach(function (c) {
      var f = (t.subFiles || []).filter(function (x) { return !x.forced && sameLang(x.lang, c); })[0];
      if (f) {
        var chk = SRT.cache[f.key];
        subs[c] = { state: subOrigin(t, f) || "pelicula", file: f, chk: chk && chk.v === 3 ? chk : null, bad: !!(chk && chk.v === 3 && chk.issues.length) };
      } else { subs[c] = { state: emb[c] ? "dentro" : "falta" }; }
    });
    var gaps = [];
    if (audio && !audio.spa) { gaps.push("audio español"); }
    if (audio && !audio.eng) { gaps.push("audio inglés"); }
    if (subs.spa.state === "falta") { gaps.push("subt. español"); }
    if (subs.eng.state === "falta") { gaps.push("subt. inglés"); }
    var srtBad = (t.subFiles || []).filter(function (x) { var c = SRT.cache[x.key]; return c && c.v === 3 && c.issues.length; });
    return { audio: audio, subs: subs, gaps: gaps, srtBad: srtBad };
  }
  function langRow(t, lp) {
    var a = function (c, lab) { return '<i class="' + (!lp.audio ? "wait" : lp.audio[c] ? "have" : "miss") + '" title="Audio en ' + (c === "spa" ? "español" : "inglés") + (!lp.audio ? ": revisando" : lp.audio[c] ? "" : ": falta") + '">' + lab + "</i>"; };
    var s = function (c, lab) {
      var x = lp.subs[c];
      var tip = { pelicula: "venía con la película", agregado: "agregado aparte", dentro: "solo dentro de los videos: falta pasarlo aparte", falta: "falta" }[x.state];
      if (x.bad) { tip += " · con fallas: " + x.chk.issues.join("; "); }
      return '<i class="sb ' + x.state + (x.bad ? " bad" : "") + '" title="Subtítulos en ' + (c === "spa" ? "español" : "inglés") + ": " + esc(tip) + '">' + lab + (x.bad ? "!" : "") + "</i>";
    };
    return '<span class="lrow"><span class="lk">Audio</span>' + a("spa", "ES") + a("eng", "EN") + '<span class="lk">Subt.</span>' + s("spa", "ES") + s("eng", "EN") + "</span>";
  }
  function srtLine(t, x) {
    var c = SRT.cache[x.key];
    if (!c) { return '<small class="chk wait">Revisando el archivo…</small>'; }
    if (c.v !== 3) { return '<small class="chk bad">No pude revisarlo: ' + esc(c.error || "") + "</small>"; }
    var parts = [c.cues.toLocaleString("es") + " líneas"];
    if (c.dur && !x.forced) { parts.push("hasta " + fmtDur(c.end) + " de " + fmtDur(c.dur)); }
    if (c.match && c.match.state === "igual") { parts.push("✓ al compás del español"); }
    if (c.issues.length) { var full = parts.concat(c.issues).join(" · "); return '<small class="chk bad" title="' + esc(full) + '">⚠ ' + esc(full) + "</small>"; }
    return '<small class="chk ok" title="' + esc(parts.join(" · ")) + '">✓ ' + esc(parts.join(" · ")) + "</small>";
  }
  function xsFor(t) { if (XS.key !== t.titleKey) { XS = { key: t.titleKey, file: null, lang: "", busy: "", msg: "", sync: null, useSync: true }; } return XS; }

  /* ----- ajustar los tiempos al español ya publicado (tools/preparador/subsync.js) -----
   * El español aparte de la película es la referencia verificada: un .srt de otro idioma (bien traducido pero hecho
   * para otra copia) se corre, se acelera o se corrige por tramos para que vaya al mismo compás. */
  var refCache = {};
  function syncRef(t) {
    return (t.subFiles || []).filter(function (x) { return (x.lang === "spa" || x.lang === "lat") && !x.forced && B.msgs[x.key]; })
      .sort(function (a, b) { return (b.size || 0) - (a.size || 0); })[0] || null;
  }
  function runSync(t) {
    var ref = syncRef(t);
    var file = XS.file;
    if (!file || !ref || XS.lang === "spa" || XS.lang === "lat") { XS.sync = ref ? null : { state: "sin-ref" }; return; }
    XS.sync = { state: "comparando", ref: ref.name };
    render();
    (refCache[ref.key] ? Promise.resolve(refCache[ref.key]) : withTimeout(B.client.downloadAsBuffer(B.msgs[ref.key].media), 45000).then(function (b) {
      refCache[ref.key] = HFSubSync.decode(b);
      return refCache[ref.key];
    })).then(function (refText) {
      if (XS.file !== file) { return; }
      setTimeout(function () {
        try {
          var r = HFSubSync.sync(refText, HFSubSync.decode(file.bytes));
          XS.sync = { state: r.dudoso ? "dudoso" : r.igual ? "igual" : "ajustado", ref: ref.name, r: r };
          XS.useSync = !r.dudoso && !r.igual;
        } catch (e) {
          XS.sync = { state: "error", ref: ref.name, error: e.message };
        }
        render();
      }, 30);
    }, function (e) {
      if (XS.file !== file) { return; }
      XS.sync = { state: "error", ref: ref.name, error: String(e && e.message) === "TIMEOUT" ? "Telegram no respondió al bajar el español" : String((e && e.message) || e) };
      render();
    });
  }
  function pct(x) { return Math.round(x * 100) + " %"; }
  function speedText(sp) {
    var F = [[23.976, "23,976"], [24, "24"], [25, "25"]];
    for (var i = 0; i < F.length; i += 1) {
      for (var j = 0; j < F.length; j += 1) {
        if (i !== j && Math.abs(F[i][0] / F[j][0] - sp) < 0.0005) { return "de " + F[j][1] + " a " + F[i][1] + " cuadros por segundo"; }
      }
    }
    return "";
  }
  function secText(x) { return (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(1).replace(".", ",") + " s"; }
  function syncBox() {
    var S2 = XS.sync;
    if (!S2) { return ""; }
    if (S2.state === "sin-ref") { return '<div class="syncbox"><span class="ic">⏱</span><span>No hay subtítulos en español aparte para comparar los tiempos: se sube tal cual.</span></div>'; }
    if (S2.state === "comparando") { return '<div class="syncbox"><span class="lib-spin sm"></span><span>Comparando los tiempos con «' + esc(S2.ref) + "»…</span></div>"; }
    if (S2.state === "error") { return '<div class="syncbox bad"><span class="ic">!</span><span>No pude comparar los tiempos: ' + esc(S2.error) + ". Se subiría tal cual.</span></div>"; }
    var r = S2.r;
    if (S2.state === "igual") { return '<div class="syncbox ok"><span class="ic">✓</span><span><b>Ya va al mismo compás que el español</b> · coinciden ' + pct(r.before) + "</span></div>"; }
    if (S2.state === "dudoso") {
      return '<div class="syncbox bad"><span class="ic">!</span><span><b>No coincide con el español ni ajustándolo</b> (' + pct(r.mejor) + "). Puede ser de otra película, de otro corte o estar incompleto: revisa el archivo. Si lo publicas, va tal cual.</span></div>";
    }
    var what = [];
    what.push(r.tramos ? "corrido de " + secText(r.tramos.min) + " a " + secText(r.tramos.max) + " según el tramo" : "corrido " + secText(r.offset));
    if (speedText(r.speed)) { what.push("velocidad " + speedText(r.speed)); }
    return '<div class="syncbox ok"><span class="ic">⏱</span><span class="grow"><b>Tiempos ajustados al español</b> · ' + esc(what.join(" · ")) +
      '<small>Coinciden ' + pct(r.after) + " (antes " + pct(r.before) + ") · referencia «" + esc(S2.ref) + "»</small></span>" +
      '<label class="swt"><input type="checkbox" data-act="xs-usesync"' + (XS.useSync ? " checked" : "") + '><span class="trk" aria-hidden="true"><i></i></span>Usar</label></div>';
  }
  function extSubsSection(t) {
    xsFor(t);
    var gaps = subGaps(t);
    var list = (t.subFiles || []).map(function (x) {
      if (XS.del === x.key) {
        return '<div class="trk sub del"><span class="n">' + TRASH + '</span><span class="d"><b>¿Quitar ' + esc((codeName(x.lang) || "este subtítulo").toLowerCase()) + (x.forced ? " (forzados)" : "") + ' del grupo?</b><small>' + esc(x.name || "") + " · se borra para todos; los videos no se tocan</small></span>" +
          '<span class="acts"><button class="ghost sm" data-act="xs-del-no"' + (XS.busy ? " disabled" : "") + '>Cancelar</button><button class="sm dangerfill" data-act="xs-del-yes" data-k="' + esc(x.key) + '"' + (XS.busy ? " disabled" : "") + ">" + esc(XS.busy || "Quitar") + "</button></span></div>";
      }
      var o = subOrigin(t, x);
      var tag = o === "pelicula" ? '<span class="pill orig" title="Esta película ya traía este idioma de subtítulos dentro del video">De la película</span>' :
        o === "agregado" ? '<span class="pill added" title="La película no traía este idioma: se subió aparte">Agregado</span>' : "";
      if (!SRT.busy && (!SRT.cache[x.key] || (SRT.cache[x.key].v === 3 && srtNeeds(t, x)))) { setTimeout(queueSrt, 0); }
      return '<div class="trk sub ' + (o || "") + '"><span class="n">' + SUBIC + '</span><span class="d"><b>' + esc(codeName(x.lang) || "Sin idioma") + (x.forced ? " (forzados)" : "") + " " + tag + "</b><small>" + esc(x.name || "") + " · subido el " + esc(fecha(x.date)) + "</small></span>" +
        '<span class="acts">' + (SRT.cache[x.key] && SRT.cache[x.key].match && SRT.cache[x.key].match.state === "desfasado" ? '<button class="primary sm" data-act="xs-fix" data-k="' + esc(x.key) + '" title="Corrige sus tiempos con los del español y lo reemplaza en el grupo"' + (XS.busy ? " disabled" : "") + ">" + esc(XS.fix === x.key && XS.busy ? XS.busy : "Ajustar al español") + "</button>" : "") + '<button class="icodl" data-act="xs-dl" data-k="' + esc(x.key) + '" title="Descargar el .srt al equipo" aria-label="Descargar ' + esc((codeName(x.lang) || "").toLowerCase()) + '"' + (XS.dl === x.key ? " disabled" : "") + ">" + (XS.dl === x.key ? '<span class="lib-spin sm"></span>' : DLIC) + "</button>" +
        '<button class="ghost sm' + (x.forced ? " on" : "") + '" data-act="xs-forced" data-k="' + esc(x.key) + '" title="Forzados: solo carteles y diálogos en otro idioma; se activan solos con el audio de su idioma">' + (x.forced ? "✓ Forzados" : "Forzados") + "</button>" +
        '<button class="icodel" data-act="xs-del" data-k="' + esc(x.key) + '" title="Quitar del grupo" aria-label="Quitar ' + esc((codeName(x.lang) || "").toLowerCase()) + ' del grupo">' + TRASH + "</button></span>" + srtLine(t, x) + "</div>";
    }).join("");
    var pick = XS.file ? '<div class="trk"><span class="n">＋</span><span class="d"><b>' + esc(xsName(t, XS.lang || "spa", XS.file.name)) + "</b><small>" + Math.max(1, Math.round(XS.file.bytes.length / 1024)) + " KB · de «" + esc(XS.file.name) + "» · se publica con el comentario de la película</small></span>" +
      '<select id="xsLang" aria-label="Idioma del subtítulo">' + LANG_OPTS.filter(function (o) { return o[0] !== "und"; }).map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === XS.lang ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>" +
      '<span class="row" style="gap:6px"><button class="primary sm" data-act="xs-publish"' + (XS.busy || (XS.sync && XS.sync.state === "comparando") ? " disabled" : "") + ">" + esc(XS.busy || "Publicar") + '</button><button class="ghost sm" data-act="xs-cancel"' + (XS.busy ? " disabled" : "") + ">Cancelar</button></span></div>" + syncBox() : "";
    var pend = embeddedPending(t);
    /* lo que se arregla al pasarlos aparte no se avisa dos veces */
    gaps = gaps.filter(function (x) { return !pend.some(function (y) { return y.lang === x.lang && !y.forced; }); });
    var migNote = pend.length ? '<div class="note warn" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span class="grow"><b>Sus subtítulos en ' +
      esc(listaY(pend.map(function (x) { return codeName(x.lang).toLowerCase() + (x.forced ? " (forzados)" : ""); }))) + " van dentro de cada video.</b> " +
      (MIG.busy && MIG.key === t.titleKey ? esc(MIG.busy) : "Pásalos aparte: se baja " + esc(migPlanText(t)) + ", se sacan como .srt y se publican; los videos no se tocan.") + "</span>" +
      (MIG.busy ? "" : '<button class="primary sm" data-act="mig-one">Pasar aparte</button>') + "</div>" : "";
    return '<div class="lfg lfrow"><span>Subtítulos aparte <span class="hint" title="Un .srt por idioma que la TV y el celular usan en todas las calidades, como en cualquier servicio de streaming">· para todas las calidades</span></span>' +
      (XS.file ? "" : '<button class="ghost sm" data-act="xs-choose">＋ Subir un .srt</button><input type="file" id="xsFile" accept=".srt,.vtt,.ass,.ssa" hidden>') + "</div>" +
      (XS.msg ? '<div class="flash ' + (/^✓/.test(XS.msg) ? "ok" : "bad") + '">' + esc(XS.msg) + "</div>" : "") + migNote +
      (MIG.msg && MIG.key === t.titleKey ? '<div class="note ' + (/^✓/.test(MIG.msg) ? "ok" : "bad") + '">' + esc(MIG.msg) + "</div>" : "") +
      gaps.map(function (x) { return '<div class="note warn"><b>' + esc(groupName(x.g)) + " no trae subtítulos en " + esc(codeName(x.lang).toLowerCase()) + "</b> (" + esc(x.from) + " sí). Sube aquí ese .srt y queda para todas.</div>"; }).join("") +
      list + pick;
  }
  function listaY(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + (/^i|^hi/i.test(a[a.length - 1]) ? " e " : " y ") + a[a.length - 1]; }

  /* ----- pasar los subtítulos de dentro de los videos a .srt aparte ----- */
  var MIG = { busy: "", key: "", msg: "", stop: false };
  /* la versión de la que se sacan: la que trae más idiomas de subtítulos; entre esas, la más liviana */
  function migSource(t) {
    var best = null;
    fileGroups(t).forEach(function (g) {
      var n = ((g.r && !g.r.error && g.r.subs) || []).filter(function (a) { return /^(mov_text|subrip|srt|ass|ssa|webvtt|text)$/i.test(a.codec || ""); }).length;
      g.versions.forEach(function (v) {
        var size = partsSize(v);
        if (n && (!best || n > best.n || (n === best.n && size < best.size))) { best = { v: v, n: n, size: size }; }
      });
    });
    return best;
  }
  function migPlanText(t) { var b = migSource(t); return b ? "la de " + b.v.q + " (" + gb(b.size) + ")" : "una versión"; }
  async function migrateTitle(t, say) {
    var src = migSource(t);
    if (!src) { throw new Error("No encontré una versión con subtítulos de texto."); }
    say("Bajando la de " + src.v.q + " (" + gb(src.size) + ")…");
    var paths = [];
    var before = 0;
    var last = 0;
    for (var i = 0; i < src.v.parts.length; i += 1) {
      var m = B.msgs[src.v.parts[i].key];
      if (!m) { throw new Error("No encuentro una de las partes en el grupo."); }
      paths.push(await downloadToPc(m, function (got) {
        if (Date.now() - last > 800) { last = Date.now(); say("Bajando la de " + src.v.q + " · " + Math.round((before + got) / Math.max(1, src.size) * 100) + " %"); }
      }));
      before += src.v.parts[i].size || 0;
      if (MIG.stop) { throw new Error("Detenido"); }
    }
    var path = paths.length > 1 ? (await postJson("/api/unir", { paths: paths })).path : paths[0];
    return publishSubsFrom(t, path, paths, say, null);
  }
  async function publishSubsFrom(t, path, borrar, say, solo) {
    say("Sacando los subtítulos…");
    var base = t.name.replace(/[#\\/:*?"<>|]/g, "").trim() + (t.year ? " (" + t.year + ")" : "");
    var got = (await postJson("/api/subs-aparte", { path: path, base: base, borrar: borrar })).subs || [];
    if (solo) { got = got.filter(function (x) { return solo.some(function (y) { return y.lang === (x.lang === "lat" ? "spa" : x.lang) && !!y.forced === !!x.forced; }); }); }
    var have = {};
    (t.subFiles || []).forEach(function (x) { have[(x.lang === "lat" ? "spa" : x.lang) + (x.forced ? ":f" : "") + ((x.n || 1) > 1 ? ":" + x.n : "")] = true; });
    var head = "pelicula#" + t.name + (t.year ? " (" + t.year + ")" : "");
    var sent = 0;
    for (var j = 0; j < got.length; j += 1) {
      var x = got[j];
      if (have[x.lang + (x.forced ? ":f" : "") + (x.n > 1 ? ":" + x.n : "")]) { continue; }
      say("Publicando subtítulos en " + codeName(x.lang).toLowerCase() + "…");
      var bytes = new Uint8Array(await (await fetch("/api/media/" + x.id)).arrayBuffer());
      var at = x.name.lastIndexOf("." + x.lang + ".");
      var fileName = base.slice(0, 40).trim() + (at >= 0 ? x.name.slice(at) : "." + x.lang + ".srt");
      await B.client.sendMedia(B.peer, { type: "document", file: bytes, fileName: fileName, fileMime: "text/plain", caption: head + " #subs-" + x.lang + (x.forced ? "-f" : "") });
      sent += 1;
    }
    return sent;
  }
  ACT["mig-one"] = function () {
    var t = B.sel;
    if (!t || MIG.busy) { return; }
    MIG = { busy: "Empezando…", key: t.titleKey, msg: "", stop: false };
    render();
    migrateTitle(t, function (txt) { MIG.busy = txt; if (B.view === "ficha") { render(); } }).then(function (n) {
      MIG = { busy: "", key: t.titleKey, msg: "✓ " + n + (n === 1 ? " subtítulo publicado" : " subtítulos publicados") + " aparte. La TV y el celular los usan en todas las calidades al volver a leer el grupo (botón ↻).", stop: false };
      readChat();
    }, function (e) {
      MIG = { busy: "", key: t.titleKey, msg: "No pude pasarlos: " + String((e && (e.text || e.message)) || e), stop: false };
      render();
    });
  };
  ACT["mig-all"] = function () {
    if (MIG.busy) { return; }
    var list = B.titles.filter(function (t) { return statusOf(t).emb.length > 0; });
    MIG = { busy: "Empezando…", key: "", msg: "", stop: false };
    render();
    (async function () {
      var ok = 0;
      var bad = [];
      for (var i = 0; i < list.length && !MIG.stop; i += 1) {
        var t = list[i];
        try {
          await migrateTitle(t, function (txt) { MIG.busy = (i + 1) + " de " + list.length + " · " + t.name + ": " + txt; if (B.view === "inicio") { render(); } });
          ok += 1;
        } catch (e) {
          if (MIG.stop) { break; }
          bad.push(t.name);
        }
      }
      return { ok: ok, bad: bad };
    })().then(function (r) {
      MIG = { busy: "", key: "", stop: false, msg: "✓ Listas " + r.ok + " de " + list.length + "." + (r.bad.length ? " No se pudo con: " + r.bad.join(", ") + "." : "") + " La TV y el celular los toman al volver a leer el grupo (botón ↻)." };
      readChat();
    });
  };
  /* ----- con los videos de este PC (sin bajar nada): el archivo de la misma película tiene su duración (±3 s) ----- */
  var LS_CARPETAS = "hf.preparador.carpetas-videos";
  function carpetas() { try { return JSON.parse(store(LS_CARPETAS) || "[]") || []; } catch (e) { return []; } }
  function normT(x) { return String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
  function localFor(t, vids, pend) {
    var dur = (t.video && t.video.duration) || 0;
    var words = normT(t.name).split(" ").filter(function (w) { return w.length > 1; });
    var best = null;
    vids.forEach(function (v) {
      if (!dur || !v.duration || Math.abs(v.duration - dur) > 3) { return; }
      var fn = normT(v.name);
      if (t.year && fn.indexOf(String(t.year)) < 0 && !/\[(360|720|1080|2160)p\]/i.test(v.name)) { return; }
      var hit = words.filter(function (w) { return fn.indexOf(w) >= 0; }).length;
      if (words.length && hit / words.length < 0.4) { return; }
      var langs = {};
      v.subs.forEach(function (x) { var c = normCode(x.lang); langs[(c === "lat" ? "spa" : c) + (x.forced ? ":f" : "")] = true; });
      var covers = pend.filter(function (p) { return langs[p.lang + (p.forced ? ":f" : "")]; }).length;
      if (covers && (!best || covers > best.covers || (covers === best.covers && v.size < best.v.size))) { best = { v: v, covers: covers }; }
    });
    return best;
  }
  ACT["mig-local"] = function () {
    if (MIG.busy) { return; }
    MIG = { busy: "Buscando las películas en este PC…", key: "", msg: "", stop: false };
    render();
    (async function () {
      var found = await postJson("/api/videos-locales", { carpetas: carpetas() });
      var list = B.titles.filter(function (t) { return statusOf(t).emb.length > 0; });
      var ok = [];
      var bad = [];
      var none = [];
      for (var i = 0; i < list.length && !MIG.stop; i += 1) {
        var t = list[i];
        var pend = embeddedPending(t);
        var hit = localFor(t, found.videos, pend);
        if (!hit) { none.push(t.name); continue; }
        try {
          await publishSubsFrom(t, hit.v.path, [], function (txt) { MIG.busy = t.name + " (" + hit.v.name + "): " + txt; if (B.view === "inicio") { render(); } }, pend);
          ok.push(t.name);
        } catch (e) {
          bad.push(t.name + " (" + String((e && e.message) || e) + ")");
        }
      }
      return { ok: ok, bad: bad, none: none, dirs: found.carpetas };
    })().then(function (r) {
      MIG = { busy: "", key: "", stop: false, msg: "✓ Con lo de este PC: " + r.ok.length + " lista" + (r.ok.length === 1 ? "" : "s") + (r.ok.length ? " (" + r.ok.join(", ") + ")" : "") + "." +
        (r.bad.length ? " Fallaron: " + r.bad.join("; ") + "." : "") + (r.none.length ? " No están en este PC: " + r.none.length + "." : "") + " Se buscó en: " + r.dirs.join(" · ") + "." };
      readChat();
    }, function (e) {
      MIG = { busy: "", key: "", stop: false, msg: "No pude buscar en este PC: " + String((e && e.message) || e) };
      render();
    });
  };
  ACT["mig-folder"] = function () {
    postJson("/api/pick-folder", {}).then(function (r) {
      if (!r.path) { return; }
      var c = carpetas().filter(function (x) { return x !== r.path; });
      c.push(r.path);
      store(LS_CARPETAS, JSON.stringify(c));
      MIG.msg = "Carpeta agregada: " + r.path + ". Pulsa «Pasar con lo de este PC».";
      render();
    });
  };

  ACT["mig-stop"] = function () { MIG.stop = true; MIG.busy = "Deteniendo al terminar la película actual…"; render(); };

  ACT["xs-forced"] = function (el) {
    var t = B.sel;
    var k = el.getAttribute("data-k");
    var x = t && (t.subFiles || []).filter(function (y) { return y.key === k; })[0];
    var m = B.msgs[k];
    if (!x || !m || XS.busy) { return; }
    var cap = String((B.byKey[k] && B.byKey[k].caption) || m.text || "").replace(/\s+#subs-[a-z-]+\s*$/i, "") + " #subs-" + (x.lang || "und") + (x.forced ? "" : "-f");
    XS.busy = "Guardando…";
    render();
    B.client.editMessage({ chatId: m.chat.id, message: m.id, text: cap }).then(function () {
      if (B.byKey[k]) { B.byKey[k].caption = cap; }
      XS.busy = "";
      XS.msg = "✓ " + codeName(x.lang) + (x.forced ? ": ya no son forzados." : ": marcados como forzados (se activan solos con el audio en ese idioma).");
      B.lib = HFLibrary.build(B.items, {});
      seriesVideo(B.lib);
      B.titles = B.lib.movies.concat(B.lib.series).sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
      B.sel = B.titles.filter(function (y) { return y.titleKey === t.titleKey; })[0] || B.sel;
      render();
    }, function (e) {
      XS.busy = "";
      XS.msg = "No pude cambiarlo: " + String((e && (e.text || e.message)) || e);
      render();
    });
  };
  /* Quitar un .srt aparte: se borra su mensaje del grupo (para subir otro si no correspondía a la película) */
  /* bajar el .srt del grupo al equipo (queda en Descargas, con el nombre de la película) */
  ACT["xs-dl"] = function (el) {
    var t = B.sel;
    var k = el.getAttribute("data-k");
    var x = t && (t.subFiles || []).filter(function (y) { return y.key === k; })[0];
    var m = B.msgs[k];
    if (!x || !m || XS.dl) { return; }
    XS.dl = k;
    XS.msg = "";
    render();
    withTimeout(B.client.downloadAsBuffer(m.media), 45000).then(function (buf) {
      var name = String(x.name || xsName(t, x.lang, ".srt")).replace(/_/g, " ");
      var url = URL.createObjectURL(new Blob([buf], { type: "application/x-subrip" }));
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      XS.dl = "";
      XS.msg = "✓ «" + name + "» quedó en tu carpeta de Descargas.";
      render();
      xsFlashOff();
    }).catch(function (e) {
      XS.dl = "";
      XS.msg = e && e.message === "TIMEOUT" ? "Telegram no respondió al bajar el subtítulo. Prueba de nuevo." : "No pude bajar el subtítulo: " + ((e && e.message) || e);
      render();
    });
  };
  ACT["xs-del"] = function (el) { if (!XS.busy) { XS.del = el.getAttribute("data-k"); XS.msg = ""; render(); } };
  ACT["xs-del-no"] = function () { XS.del = ""; render(); };
  ACT["xs-del-yes"] = function (el) {
    var t = B.sel;
    var k = el.getAttribute("data-k");
    var x = t && (t.subFiles || []).filter(function (y) { return y.key === k; })[0];
    var m = B.msgs[k];
    if (!x || !m || XS.busy) { return; }
    var what = "los subtítulos en " + (codeName(x.lang) || "este idioma").toLowerCase() + (x.forced ? " (forzados)" : "");
    XS.busy = "Quitando…";
    XS.msg = "";
    render();
    withTimeout(B.client.deleteMessagesById(m.chat.id, [m.id]), 45000).then(function () {
      B.items = B.items.filter(function (it) { return it.key !== k; });
      delete B.byKey[k];
      delete B.msgs[k];
      B.lib = HFLibrary.build(B.items, {});
      seriesVideo(B.lib);
      B.titles = B.lib.movies.concat(B.lib.series).sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
      B.sel = B.titles.filter(function (y) { return y.titleKey === t.titleKey; })[0] || B.sel;
      XS.busy = "";
      XS.del = "";
      XS.msg = "✓ Se quitaron " + what + ".";
      xsFlashOff();
      render();
    }, function (e) {
      XS.busy = "";
      XS.del = "";
      var why = String((e && (e.text || e.message)) || e);
      XS.msg = /RIGHT|ADMIN|FORBIDDEN|AUTHOR/i.test(why) ? "No tienes permiso para borrar ese mensaje en el grupo (lo subió otra persona y no eres administrador)." :
        why === "TIMEOUT" ? "Telegram no respondió; vuelve a intentarlo." : "No pude quitarlo: " + why;
      render();
    });
  };
  /* corrige los tiempos de un .srt ya publicado con los del español y lo reemplaza (publica el nuevo y quita el viejo) */
  ACT["xs-fix"] = function (el) {
    var t = B.sel;
    var k = el.getAttribute("data-k");
    var x = t && (t.subFiles || []).filter(function (y) { return y.key === k; })[0];
    var m = B.msgs[k];
    var ref = t && syncRef(t);
    if (!x || !m || !ref || XS.busy) { return; }
    XS.fix = k;
    XS.busy = "Ajustando…";
    XS.msg = "";
    render();
    Promise.all([srtText(ref.key), srtText(k)]).then(function (tx) {
      var r = HFSubSync.sync(tx[0], tx[1]);
      if (r.dudoso || r.igual) { throw new Error(r.igual ? "ya va al compás" : "no coincide con el español"); }
      XS.busy = "Publicando…";
      render();
      var caption = (B.byKey[k] && B.byKey[k].caption) || m.text || ("pelicula#" + t.name + (t.year ? " (" + t.year + ")" : "") + " #subs-" + x.lang + (x.forced ? "-f" : ""));
      var fileName = String(x.name || xsName(t, x.lang, ".srt")).replace(/_/g, " ");
      return withTimeout(B.client.sendMedia(B.peer, { type: "document", file: new TextEncoder().encode(r.text), fileName: fileName, fileMime: "text/plain", caption: caption }), 60000).then(function () {
        XS.busy = "Quitando el anterior…";
        render();
        return withTimeout(B.client.deleteMessagesById(m.chat.id, [m.id]), 45000).then(function () { return ""; }, function () { return " (el anterior no se pudo quitar: bórralo con la papelera)"; });
      }).then(function (warn) {
        delete SRT.cache[k];
        XS.busy = "";
        XS.fix = "";
        XS.msg = "✓ " + codeName(x.lang) + " ajustado al español y reemplazado en el grupo" + warn + ".";
        var msg = XS.msg;
        readChat();
        XS.msg = msg;
        xsFlashOff();
      });
    }).catch(function (e) {
      XS.busy = "";
      XS.fix = "";
      XS.msg = String(e && e.message) === "TIMEOUT" ? "Telegram no respondió. Revisa con ↻ si quedó publicado." : "No pude ajustarlo: " + String((e && (e.text || e.message)) || e);
      render();
    });
  };
  ACT["xs-choose"] = function () { var f = $("xsFile"); if (f) { f.click(); } };
  /* los avisos de «listo» se van solos a los 8 s */
  var flashTimer = null;
  function xsFlashOff() {
    clearTimeout(flashTimer);
    var msg = XS.msg;
    flashTimer = setTimeout(function () { if (XS.msg === msg && /^✓/.test(msg)) { XS.msg = ""; if (B.view === "ficha") { render(); } } }, 8000);
  }
  ACT["xs-cancel"] = function () { XS.file = null; XS.sync = null; XS.msg = ""; render(); };
  ACT["xs-usesync"] = function () { XS.useSync = !XS.useSync; render(); };
  ACT["xs-publish"] = function () {
    var t = B.sel;
    if (!t || !XS.file || XS.busy) { return; }
    var lang = XS.lang || "spa";
    var caption = "pelicula#" + t.name + (t.year ? " (" + t.year + ")" : "") + " #subs-" + lang;
    var fileName = xsName(t, lang, XS.file.name);
    var synced = XS.sync && XS.sync.state === "ajustado" && XS.useSync;
    var file = { type: "document", file: synced ? new TextEncoder().encode(XS.sync.r.text) : XS.file.bytes, fileName: fileName, fileMime: "text/plain", caption: caption };
    XS.busy = "Publicando…";
    XS.msg = "";
    render();
    /* si la conexión con Telegram quedó dormida (la ventana llevaba rato abierta), se reconecta y se intenta otra vez */
    withTimeout(B.client.sendMedia(B.peer, file), 45000).catch(function (e) {
      if (String(e && e.message) !== "TIMEOUT") { throw e; }
      XS.busy = "Reconectando con Telegram…";
      render();
      return Promise.resolve(B.client.connect && B.client.connect()).catch(function () {}).then(function () {
        XS.busy = "Publicando…";
        render();
        return withTimeout(B.client.sendMedia(B.peer, file), 60000);
      });
    }).then(function () {
      XS = { key: t.titleKey, file: null, lang: "", busy: "", sync: null, useSync: true, msg: "✓ " + codeName(lang) + " publicado" + (synced ? " con los tiempos del español" : "") + ". La TV y el celular lo toman al volver a leer el grupo (↻)." };
      xsFlashOff();
      var msg = XS.msg;
      readChat();
      XS.msg = msg;
    }, function (e) {
      XS.busy = "";
      XS.msg = String(e && e.message) === "TIMEOUT" ? "Telegram no respondió. Revisa en el grupo si quedó publicado (botón ↻ de Inicio) y, si no, vuelve a intentarlo." :
        "No pude publicarlo: " + String((e && (e.text || e.message)) || e);
      render();
    });
  };

  /* el comentario con las marcas nuevas de idioma (las viejas se quitan) */
  function withLangs(caption, langs) {
    var base = String(caption || "").replace(/\s+#\s*(audio|subs)-(?:[a-z]{1,3}-)*[a-z]{1,3}(?=\s|$)/gi, "").replace(/\s+$/, "");
    return base + HFLibrary.langsTag(langs);
  }
  ACT["lfix-save"] = function () {
    var t = B.sel;
    if (!t || LF.busy) { return; }
    /* cada archivo (todas las partes de cada calidad del grupo) con lo elegido para su grupo */
    var jobs = [];
    fileGroups(t).filter(lfDirty).forEach(function (g) {
      var langs = lfLangs(g);
      g.versions.forEach(function (v) {
        (v.parts || []).forEach(function (pt) {
          if (B.msgs[pt.key] && B.byKey[pt.key]) { jobs.push({ key: pt.key, langs: langs }); }
        });
      });
    });
    if (!jobs.length) { return; }
    LF.busy = "Guardando… 0 de " + jobs.length;
    LF.msg = "";
    render();
    (async function () {
      var copied = 0;
      var kept = 0;
      for (var i = 0; i < jobs.length; i += 1) {
        var k = jobs[i].key;
        var m = B.msgs[k];
        var cap = withLangs(B.byKey[k].caption, jobs[i].langs);
        if (cap !== B.byKey[k].caption) {
          try {
            await B.client.editMessage({ chatId: m.chat.id, message: m.id, text: cap });
          } catch (e) {
            var why = String((e && (e.text || e.message)) || e);
            if (!/MESSAGE_NOT_MODIFIED/i.test(why)) {
              if (!/AUTHOR_REQUIRED|ADMIN_REQUIRED|EDIT_TIME|FORBIDDEN|RIGHT/i.test(why)) { throw e; }
              /* lo subió otra cuenta: se publica una copia sin remitente con el comentario nuevo y se borra el viejo */
              await B.client.sendCopy({ fromChatId: m.chat.id, toChatId: m.chat.id, message: m.id, caption: cap });
              copied += 1;
              try { await B.client.deleteMessagesById(m.chat.id, [m.id]); } catch (e2) { kept += 1; }
            }
          }
          B.byKey[k].caption = cap;
        }
        LF.busy = "Guardando… " + (i + 1) + " de " + jobs.length;
        render();
      }
      return { copied: copied, kept: kept };
    })().then(function (r) {
      var key = t.titleKey;
      var msg = "✓ Idiomas guardados en " + jobs.length + (jobs.length === 1 ? " archivo" : " archivos") + ". La TV y el celular los muestran al volver a leer el grupo (botón ↻)." +
        (r.copied ? " " + r.copied + " eran de otra cuenta: se publicaron de nuevo con el comentario corregido" + (r.kept ? " (" + r.kept + " viejos siguen en el grupo: no tienes permiso para borrarlos)" : "") + "." : "");
      LF = { key: "", pick: {}, busy: "", msg: "" };
      if (r.copied) {
        readChat();
      } else {
        B.lib = HFLibrary.build(B.items, {});
        seriesVideo(B.lib);
        B.titles = B.lib.movies.concat(B.lib.series).sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
        B.sel = B.titles.filter(function (x) { return x.titleKey === key; })[0] || B.sel;
      }
      if (B.sel) { lfFor(B.sel); }
      LF.msg = msg;
      render();
    }, function (e) {
      LF.busy = "";
      LF.msg = "No pude guardar: " + String((e && (e.text || e.message)) || e);
      render();
    });
  };

  ACT["img-from-ficha"] = function (el) {
    var id = el.getAttribute("data-id");
    IMG.sec = secPhotos("banner").some(function (x) { return x.id === id; }) ? "banner" : secPhotos("vertical").some(function (x) { return x.id === id; }) ? "vertical" : "portada";
    IMG.fmt = IMG.sec === "vertical" ? "v" : IMG.sec === "portada" ? "h" : IMG.fmt;
    IMG.sel = id; IMG.f = "todas"; IMG.msg = ""; show("imagenes");
  };
  ACT.relang = function () {
    var t = B.sel;
    if (!t || !t.video) { return; }
    delete B.langs[t.video.key];
    (t.versions || []).forEach(function (v) { delete B.langs["f:" + fileKey(v)]; });
    B.langQueue = [t].concat(B.langQueue.filter(function (x) { return x !== t; }));
    B.langTotal += 1;
    render();
    runLangs();
  };
  /* ----- lo que se elige en la ficha (se olvida al cambiar de película) ----- */
  var FI = { key: "", src: "local", es: "audio", audio: "", sub: "", busy: "", dl: null, msg: "" };
  function fiFor(t) {
    if (FI.key !== t.titleKey) { FI = { key: t.titleKey, src: "local", es: "audio", audio: "", sub: "", busy: "", dl: null, msg: "" }; }
    return FI;
  }
  function fiEs(t) { fiFor(t); return !!(FI.audio || FI.sub); }
  function bestVersion(t) { return (t.versions || []).slice().sort(function (a, b) { return (b.h || 0) - (a.h || 0); })[0] || null; }
  function smallestVersion(t) { return (t.versions || []).slice().sort(function (a, b) { return (a.h || 0) - (b.h || 0); })[0] || null; }
  function partsSize(v) { return (v.parts || []).reduce(function (n, p) { return n + (p.size || 0); }, 0); }

  function sourceSection(t, s) {
    fiFor(t);
    var bv = bestVersion(t);
    var opts = [["local", "Mi original en este equipo", "La mejor calidad que tengas. Hace falta para el 4K."]];
    if (bv) { opts.push(["group", "La de " + bv.q + " del grupo", "Se baja (" + gb(partsSize(bv)) + ")" + (bv.n > 1 ? " en " + bv.n + " partes y se unen" : "") + ". Sirve para las calidades menores."]); }
    var dl = FI.dl ? '<div class="hint" style="margin-top:8px">Bajando ' + esc(FI.dl.what) + " · " + Math.round(FI.dl.got / Math.max(1, FI.dl.size) * 100) + " % · " + gb(FI.dl.got) + " de " + gb(FI.dl.size) +
      '</div><div class="bar" style="margin-top:6px"><i style="width:' + Math.round(FI.dl.got / Math.max(1, FI.dl.size) * 100) + '%"></i></div>' : "";
    return '<section><h2>De dónde salen las calidades nuevas</h2><div class="rcards" role="radiogroup" style="margin-top:10px">' + opts.map(function (o) {
      return '<button data-act="fi-src" data-v="' + o[0] + '" class="' + (FI.src === o[0] ? "on" : "") + '" role="radio" aria-checked="' + (FI.src === o[0]) + '"><b>' + esc(o[1]) + "</b><small>" + esc(o[2]) + "</small></button>";
    }).join("") + "</div>" + dl + "</section>";
  }

  function esOptions(t) {
    fiFor(t);
    var name = function (p) { return String(p || "").split(/[\\/]/).pop(); };
    var opts = [
      ["audio", "Agregar un audio en español", "De otra copia de la película o de un archivo de audio (.ac3, .mka…). Si va corrido, se ajusta el desfase en la pestaña 1."],
      ["srt", "Agregar subtítulos en español", "Desde un archivo .srt tuyo. Van dentro de cada versión."]
    ];
    var chosen = FI.es === "audio" ? FI.audio : FI.sub;
    return '<div class="rcards" role="radiogroup" style="margin-top:10px;grid-template-columns:minmax(0,1fr)">' + opts.map(function (o) {
      return '<button data-act="fi-es" data-v="' + o[0] + '" class="' + (FI.es === o[0] ? "on" : "") + '" role="radio" aria-checked="' + (FI.es === o[0]) + '"><b>' + o[1] + "</b><small>" + o[2] + "</small></button>";
    }).join("") + "</div>" +
      '<div class="row" style="margin-top:8px"><span class="grow hint">' + (chosen ? "Elegido: <b>" + esc(name(chosen)) + "</b>" : FI.es === "audio" ? "Elige el archivo con el audio en español." : "Elige el archivo .srt.") + "</span>" +
      (chosen ? '<button class="sm ghost" data-act="fi-es-del">Quitar</button>' : "") + '<button class="sm" data-act="fi-es-pick">Elegir…</button></div>' +
      (FI.audio && FI.sub ? '<div class="hint" style="margin-top:4px">Van los dos: audio y subtítulos.</div>' : "");
  }

  function thumbsSection(t, bare) {
    fiFor(t);
    var th = t.thumbs;
    var sv = smallestVersion(t);
    return (bare ? '<div class="fphead"><h2>' : "<section><h2>") + 'Miniaturas para recortes <span class="pill ' + (th ? "good" : "warn") + '">' + (th ? "Listas" : "No tiene") + "</span></h2>" + (bare ? "</div>" : "") +
      '<div class="hint" style="margin-top:4px">' + (th ? th.sheets.length + (th.sheets.length === 1 ? " hoja" : " hojas") + " · 1 cuadro cada " + th.every + " s. «Recortar» del celular muestra toda la película al instante." :
        "Se crean de la versión de " + (sv ? sv.q : "menor calidad") + " del grupo (se baja: " + (sv ? gb(partsSize(sv)) : "—") + ") y se publican solas, sin volver a subir el video.") + "</div>" +
      (FI.msg ? '<div class="note ' + (/^✓/.test(FI.msg) ? "ok" : "bad") + '">' + esc(FI.msg) + "</div>" : "") +
      (sv ? '<div class="row" style="margin-top:10px"><button data-act="fi-thumbs"' + (FI.busy ? " disabled" : "") + ">" + (th ? "Crearlas y publicarlas otra vez" : "Publicar solo las miniaturas") + "</button></div>" : "") + (bare ? "" : "</section>");
  }

  ACT["fi-src"] = function (el) { FI.src = el.getAttribute("data-v"); render(); };
  ACT["fi-es"] = function (el) { FI.es = el.getAttribute("data-v"); render(); };
  ACT["fi-es-del"] = function () { if (FI.es === "audio") { FI.audio = ""; } else { FI.sub = ""; } render(); };
  ACT["fi-es-pick"] = function () {
    var kind = FI.es === "audio" ? "audio" : "sub";
    fetch("/api/pick-extra", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: kind }) }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.path) { return; }
      if (kind === "audio") { FI.audio = j.path; } else { FI.sub = j.path; }
      render();
    });
  };

  /* Baja todas las partes de una versión del grupo y las une; devuelve la ruta en este PC. */
  async function downloadVersion(v, what) {
    var paths = [];
    var total = partsSize(v);
    var before = 0;
    var last = 0;
    FI.dl = { what: what, got: 0, size: total };
    render();
    for (var i = 0; i < v.parts.length; i += 1) {
      var m = B.msgs[v.parts[i].key];
      if (!m) { throw new Error("No encuentro una de las partes en el grupo."); }
      paths.push(await downloadToPc(m, function (got) {
        FI.dl.got = before + got;
        if (Date.now() - last > 600) { last = Date.now(); if (B.view === "ficha") { render(); } }
      }));
      before += v.parts[i].size || 0;
    }
    FI.dl = null;
    return paths;
  }
  function postJson(url, body) {
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { throw new Error(j.error || "Error"); } return j; }); });
  }

  /* Pasar a la pestaña 3 o 4 de este título (o de uno de sus capítulos) sin cargar el video original */
  ACT["go-tab"] = function (el) {
    var t = B.sel;
    if (!t) { return; }
    var tab = Number(el.getAttribute("data-tab")) || 4;
    var epk = el.getAttribute("data-ep");
    var ep = epk ? episodesOf(t).filter(function (e) { return e.season + ":" + e.episode === epk; })[0] : null;
    var src = ep || (t.type === "series" ? episodesOf(t)[0] : t);
    var cap = src && src.video && HFLibrary.parseCaption(src.video.caption || "");
    if (!cap) { alert("No pude leer el comentario de este título."); return; }
    if (PREP.formBusy() || FI.busy) { alert("Esta pantalla está ocupada (una publicación manual o el video de esta misma pantalla): espera a que termine. Lo que sube o renderiza la cola no estorba."); return; }
    var have = t.type === "series" ? (src.versions || []).map(function (v) { return v.q; }) : haveOf(t);
    var quals = QS.filter(function (q) { return have.indexOf(q[0]) < 0; }).map(function (q) { return q[1]; });
    show("tabs");
    PREP.openPub(cap, tab === 3 ? quals : [], tab);
  };

  ACT.prepare = function () {
    var t = B.sel;
    var cap = t && t.video && HFLibrary.parseCaption(t.video.caption || "");
    if (!cap) { alert("No pude leer el comentario de esta película."); return; }
    if (PREP.formBusy() || FI.busy) { alert("Esta pantalla está ocupada (una publicación manual o el video de esta misma pantalla): espera a que termine. Lo que sube o renderiza la cola no estorba."); return; }
    var map = { "4K": "2160", "1080p": "1080", "720p": "720", "360p": "360" };
    /* con español nuevo se vuelven a crear todas (las del grupo no lo tienen); si no, solo las que faltan */
    var quals = fiEs(t) ? ["2160", "1080", "720", "360"] : missingOf(t).map(function (q) { return map[q]; });
    var extras = { audio: FI.audio, sub: FI.sub };
    var go = function (path) {
      PREP.prefill(cap, quals);
      return PREP.setExtras(extras).then(function () {
        show("tabs");
        PREP.showTab(1);
        if (path) { PREP.loadSource(path); }
      });
    };
    if (FI.src === "group") {
      var bv = bestVersion(t);
      FI.busy = "Bajando la de " + bv.q + " del grupo…";
      render();
      downloadVersion(bv, "la de " + bv.q).then(function (paths) {
        FI.busy = paths.length > 1 ? "Uniendo las partes…" : "";
        render();
        return paths.length > 1 ? postJson("/api/unir", { paths: paths }).then(function (r) { return r.path; }) : paths[0];
      }).then(function (path) { FI.busy = ""; return go(path); }, function (e) { FI.busy = ""; FI.dl = null; FI.msg = "No pude bajar el video: " + (e.message || e); render(); });
      return;
    }
    go("").then(function () {
      /* el original de este equipo: se abre el diálogo para elegirlo */
      postJson("/api/pick-file", {}).then(function (r) { if (r.path) { PREP.loadSource(r.path); } });
    });
  };

  /* Miniaturas de una película que ya está en el grupo: se baja la versión más chica, se crean y se publican solas. */
  ACT["fi-thumbs"] = function () {
    var t = B.sel;
    var sv = smallestVersion(t);
    if (!sv || FI.busy || PREP.busy()) { return; }
    FI.msg = "";
    FI.busy = "Bajando la de " + sv.q + " para las miniaturas…";
    render();
    var base = t.name + (t.year ? " (" + t.year + ")" : "");
    downloadVersion(sv, "la de " + sv.q).then(function (paths) {
      FI.busy = "Creando las miniaturas…";
      render();
      return postJson("/api/thumbs-file", { paths: paths, name: base });
    }).then(async function (th) {
      FI.busy = "Publicando las miniaturas…";
      render();
      var caption = "pelicula#" + t.name + (t.year ? " (" + t.year + ")" : "") + " #miniaturas";
      var bytes = [];
      for (var i = 0; i < th.sheets.length; i += 1) { bytes.push(new Uint8Array(await (await fetch("/api/media/" + th.sheets[i].id)).arrayBuffer())); }
      for (var g = 0; g < bytes.length; g += 10) {
        await B.client.sendMediaGroup(B.peer, bytes.slice(g, g + 10).map(function (b, j) {
          return { type: "document", file: b, fileMime: "image/jpeg", caption: caption, fileName: base.replace(/[\\/:*?"<>|]/g, "") + " miniaturas " + th.every + "s " + th.w + "x" + th.h + " " + th.cols + "x" + th.rows + " hoja " + (g + j + 1) + " de " + bytes.length + ".jpg" };
        }));
      }
      t.thumbs = { every: th.every, w: th.w, h: th.h, cols: th.cols, rows: th.rows, sheets: th.sheets.map(function (x) { return x.id; }) };
      FI.busy = "";
      FI.msg = "✓ Miniaturas publicadas (" + th.sheets.length + (th.sheets.length === 1 ? " hoja" : " hojas") + "). El celular las usa al volver a leer el chat.";
      render();
    }).catch(function (e) { FI.busy = ""; FI.dl = null; FI.msg = "No se pudieron publicar: " + (e.message || e); render(); });
  };

  /* ===================== Imágenes por revisar =====================
   * Portadas y banners del chat que no son horizontales o son muy pequeños. Para cada una se elige una imagen nueva
   * (buscándola en internet, de un cuadro del video o una propia), se deja a la medida en el PC y se cambia la foto en el
   * MISMO mensaje del grupo (el comentario no cambia). Si Telegram no deja editarlo (lo subió otra persona), se publica
   * una foto nueva con el mismo comentario y se intenta borrar la vieja: la app usa la más nueva. */
  var IMG = {
    sec: "portada", fmt: "h", onlyBad: true, f: "todas", sel: "", fix: "google", modal: false, adv: { size: 2, text: "none" }, matches: [], picked: null, hideSmall: true, dedupe: true,
    q: "", results: [], next: 0, loading: false, error: "", res: -1, chosen: {}, frames: null, video: null, dl: null, busy: false, msg: "", fixed: {}
  };
  var SHAPE = { Vertical: "v", Cuadrada: "sq", "Muy pequeña": "sm", "Pequeña para banner": "sm", Repetida: "h", "No vertical": "h" };
  var KIND_F = { Vertical: "vert", Cuadrada: "sq", "Muy pequeña": "small", "Pequeña para banner": "small", Repetida: "dup", "No vertical": "vert" };
  /* formato de la imagen que se cambia, como lo entiende el servidor */
  function apiKind(x) { return x.kind === "Banner" ? "banner" : x.kind === "Vertical" ? "vertical" : "portada"; }

  /* Portadas y banners van en secciones aparte (IMG.sec). Con «Solo las que fallan» (IMG.onlyBad) se ven las que hay que
   * cambiar; apagado, todas las de la sección con su estado. Un título sin banner propio (la app usa su portada) o sin
   * portada (usa un cuadro del video) sale VACÍO: al elegirle imagen se publica como foto nueva en el grupo. */
  function secKind(sec) { return sec === "banner" ? "Banner" : sec === "vertical" ? "Vertical" : "Portada"; }
  /* comentario de la foto nueva: el nombre del título y la marca; así la app la junta con su película o serie */
  function newCaption(t, sec) {
    var name = String(t.name || "").replace(/#/g, "").trim();
    var mark = sec === "banner" ? " #banner" : sec === "vertical" ? " #vertical" : " #portada";
    return t.type === "series" ? "serie(1/1)#" + name + mark : "pelicula#" + name + (t.year ? " (" + t.year + ")" : "") + mark;
  }
  function secPhotos(sec) {
    var kind = secKind(sec);
    var out = [];
    B.titles.forEach(function (t) {
      var key = kind === "Banner" ? (t.bannerKey && t.bannerKey !== t.imageKey ? t.bannerKey : "") : kind === "Vertical" ? (t.verticalKey || "") : (t.posterIsPhoto ? t.imageKey : "");
      var it = key ? photoInfo(key) : null;
      if (!it || !it.key) {
        var id = "vacia:" + sec + ":" + (t.titleKey || t.name);
        out.push({ id: id, t: t, kind: kind, it: { key: id, width: 0, height: 0, caption: newCaption(t, sec) }, empty: true,
          issue: kind === "Banner" ? "Sin banner" : kind === "Vertical" ? "Sin vertical" : "Sin portada", f: "empty", shape: "empty" });
        return;
      }
      var issue = imgIssue(it, kind.toLowerCase(), t);
      out.push({ id: it.key, t: t, kind: kind, it: it, issue: issue, f: issue ? KIND_F[issue] || "small" : "ok", shape: issue ? SHAPE[issue] || "sm" : kind === "Vertical" ? "pv" : "h" });
    });
    return out;
  }
  function imgList() {
    var kind = secKind(IMG.sec);
    var out = secPhotos(IMG.sec).filter(function (x) { return !IMG.onlyBad || x.issue || IMG.fixed[x.id]; });
    Object.keys(IMG.fixed).forEach(function (k) { var f = IMG.fixed[k]; if (f.kind === kind && !out.some(function (x) { return x.id === k; })) { out.push(f); } });
    return out;
  }
  function badCount(sec) { return secPhotos(sec).filter(function (x) { return x.issue && !IMG.fixed[x.id]; }).length; }
  function emptyCount(sec) { return secPhotos(sec).filter(function (x) { return x.empty && !IMG.fixed[x.id]; }).length; }
  function imgSel(list) {
    return list.filter(function (x) { return x.id === IMG.sel; })[0] || list.filter(function (x) { return !IMG.fixed[x.id]; })[0] || list[0] || null;
  }
  function need(x) { return x.kind === "Banner" ? [1920, 1080] : x.kind === "Vertical" ? [800, 1200] : [1280, 720]; }
  function emptyNote(x) { return x.kind === "Banner" ? "usa la portada" : x.kind === "Vertical" ? "usa la portada horizontal" : "usa un cuadro del video"; }

  function viewImagenes() {
    var all = imgList();
    var pendP = badCount("portada");
    var pendB = badCount("banner");
    var pendV = badCount("vertical");
    var isV = IMG.fmt === "v"; // en vertical también va el banner: el destacado (hero) siempre lo usa
    var pend = { length: pendP + pendB + pendV };
    var counts = { todas: all.length, vert: 0, sq: 0, small: 0, dup: 0, ok: 0, empty: 0 };
    all.forEach(function (x) { counts[IMG.fixed[x.id] ? "ok" : x.f] += 1; });
    if (IMG.onlyBad && IMG.f === "ok") { IMG.f = "todas"; }
    var list = all.filter(function (x) { return IMG.f === "todas" || (IMG.f === "ok" ? !x.issue || IMG.fixed[x.id] : x.f === IMG.f && !IMG.fixed[x.id]); });
    var sel = imgSel(list.length ? list : all);
    IMG.sel = sel ? sel.id : "";
    var fdefs = [["todas", "Todas"], ["empty", "Vacías"], ["vert", "Verticales"], ["sq", "Cuadradas"], ["small", "Muy pequeñas"], ["dup", "Repetidas"]].concat(IMG.onlyBad ? [] : [["ok", "Bien"]]);
    var filters = fdefs.map(function (f) {
      return '<button data-act="img-f" data-f="' + f[0] + '" class="' + (IMG.f === f[0] ? "on" : "") + '" aria-pressed="' + (IMG.f === f[0]) + '">' + f[1] + " · " + counts[f[0]] + "</button>";
    }).join("");
    var secDefs = isV ? [["vertical", "Portadas verticales", pendV, "800×1200 · póster de la vista vertical"], ["banner", "Banners", pendB, "1920×1080 · fondo del destacado"]] : [["portada", "Portadas", pendP, "1280×720 · tarjetas de las filas"], ["banner", "Banners", pendB, "1920×1080 · fondo del destacado"]];
    var fmtSw = '<div class="seg" role="group" aria-label="Formato de las imágenes" style="margin:8px 0">' +
      '<button data-act="img-fmt" data-v="portada" class="' + (isV ? "" : "on") + '" aria-pressed="' + !isV + '">Horizontal · ' + (pendP + pendB) + ' por revisar</button>' +
      '<button data-act="img-fmt" data-v="vertical" class="' + (isV ? "on" : "") + '" aria-pressed="' + isV + '">Vertical · ' + (pendV + pendB) + ' por revisar</button></div>';
    var secs = secDefs.map(function (s) {
      var on = IMG.sec === s[0];
      var vac = emptyCount(s[0]);
      var bad = s[2] - vac;
      var txt = [bad ? bad + (bad === 1 ? " falla" : " fallan") : "", vac ? vac + (vac === 1 ? " vacía" : " vacías") : ""].filter(Boolean).join(" · ") || "Bien";
      return '<button data-act="img-sec" data-v="' + s[0] + '" class="' + (on ? "on" : "") + '" role="tab" aria-selected="' + on + '"><span><b>' + s[1] + "</b><small>" + s[3] + "</small></span>" +
        '<span class="pill ' + (s[2] ? "warn" : "good") + '">' + txt + "</span></button>";
    }).join("");
    var secName = IMG.sec === "banner" ? "banners" : IMG.sec === "vertical" ? "portadas verticales" : "portadas";
    var emptyMsg = "Ninguna con este filtro.";
    if (IMG.onlyBad && !all.length) { emptyMsg = (IMG.sec === "banner" ? "Todos los banners están bien" : IMG.sec === "vertical" ? "Todas las portadas verticales están bien" : "Todas las portadas están bien") + (IMG.sec === "vertical" ? ": son verticales y del tamaño correcto." : ": son horizontales y del tamaño correcto.") + " Apaga «Solo las que fallan» para verlas."; }
    var rows = list.map(function (x) {
      var on = sel && x.id === sel.id;
      var done = !!IMG.fixed[x.id];
      return '<div class="irow' + (on ? " on" : "") + (done ? " fixed" : "") + (IMG.chosen[x.id] && !done ? " picked" : "") + '"><button class="ipick" data-act="img-sel" data-id="' + esc(x.id) + '" aria-pressed="' + on + '">' +
        '<span class="ibox" aria-hidden="true">' + (x.empty && !done ? '<span class="empty">+</span>' : '<span class="' + (x.empty ? "h" : x.shape) + '" data-thumb="' + esc(x.id) + '"' + thumbStyle(x.id) + "></span>") + "</span>" +
        '<span class="tx"><b>' + esc(x.t.name) + "</b><small>" + x.kind + " · " + (done ? done.size || "" : x.empty ? emptyNote(x) : x.it.width + "×" + x.it.height) + '</small><span class="pill ' + (done || !x.issue ? "good" : x.empty ? "gold" : "warn") + '">' + (done ? (x.empty ? "Agregada" : "Reemplazada") : x.issue || "Bien") + "</span></span></button>" +
        '<button class="gsearch" data-act="img-google" data-id="' + esc(x.id) + '" title="Buscar en internet" aria-label="Buscar ' + esc(x.kind.toLowerCase() + " de " + x.t.name) + ' en internet"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="M15.5 15.5L21 21"></path><path d="M7.5 12l2-2.5 1.5 1.5 1.5-2 1 1.5"></path></svg></button></div>';
    }).join("") || '<div class="empty">' + esc(emptyMsg) + "</div>";

    var left = '<section class="lst"><div class="ititle"><div class="crumb"><a href="#" data-act="inicio">Inicio</a><span aria-hidden="true">›</span><span>Imágenes por revisar</span></div>' +
      '<h2>Portadas y banners <span class="pill ' + (pend.length ? "warn" : "good") + '">' + (pend.length ? pend.length + (pend.length === 1 ? " pendiente" : " pendientes") : "Sin pendientes") + "</span></h2></div>" +
      '<div class="hint">' + (isV ? "Portada vertical (póster 2:3) desde 800×1200 para las tarjetas, y el banner 1920×1080 que sigue usando el destacado de arriba. «Vacías» son los títulos que todavía no la tienen." : "Deben ser horizontales 16:9: la portada desde 1280×720 y el banner desde 1920×1080. «Vacías» son los títulos que todavía no la tienen.") + "</div>" +
      '<div class="ictl">' + fmtSw + '<div class="isec" role="tablist" aria-label="Sección">' + secs + "</div></div>" +
      '<div class="itools"><div class="seg" role="group" aria-label="Filtrar ' + secName + ' por estado">' + filters + "</div>" +
      '<label class="swt"><input type="checkbox" data-act="img-only"' + (IMG.onlyBad ? " checked" : "") + '><span class="trk" aria-hidden="true"><i></i></span>Solo las que fallan</label></div>' +
      '<div class="ilist ' + (IMG.sec === "vertical" ? "gv" : "gh") + '" data-k="' + [IMG.fmt, IMG.sec, IMG.f, IMG.onlyBad ? 1 : 0].join("|") + '">' + rows + "</div></section>";
    return '<div class="s6">' + left + (sel ? imgPanel(sel) : "<section></section>") + "</div>" + imgFoot(pend.length) + (IMG.modal && sel ? imgModal(sel) : "");
  }

  function imgPanel(x) {
    var ch = IMG.chosen[x.id];
    var n = need(x);
    var cur = B.thumbs[x.id];
    var curStyle = cur && cur !== "pending" && cur !== "none" ? ' style="background-image:url(\'' + cur + '\')"' : "";
    var opts = [["google", "Buscar en internet", "Con los filtros ya puestos."], ["video", "Fotograma del video", "Un cuadro de la película."], ["file", "Una imagen mía", "Arrastrarla o pegarla."]].map(function (o) {
      return '<button data-act="img-fix" data-v="' + o[0] + '" class="' + (IMG.fix === o[0] ? "on" : "") + '" role="radio" aria-checked="' + (IMG.fix === o[0]) + '"><b>' + o[1] + "</b><small>" + o[2] + "</small></button>";
    }).join("");
    var body = "";
    if (IMG.fix === "google") {
      body = '<div class="gpick"><span class="th' + (x.kind === "Vertical" ? " v" : "") + (ch && ch.from === "google" ? "" : " none") + '"' + (ch && ch.from === "google" ? ' style="background-image:url(/api/media/' + ch.info.id + ')"' : "") + '></span><span class="tx"><b>' +
        (ch && ch.from === "google" ? ch.label : "Sin elegir todavía") + "</b>" + (ch && ch.from === "google" ? "de " + esc(ch.site) + " · ajustada a " + n.join("×") : "Busca con el nombre y los filtros ya puestos.") +
        '</span><button class="sm" data-act="img-open">' + (ch && ch.from === "google" ? "Cambiar…" : "Buscar…") + "</button></div>";
    } else if (IMG.fix === "video") {
      body = framesHtml(x);
    } else {
      body = '<button class="dropz" data-act="img-pick-file" id="dropz"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"></path><path d="M7 9l5-5 5 5"></path><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"></path></svg>' +
        "<b>" + (ch && ch.from === "file" ? "Elegida: " + esc(ch.label) : "Arrastra aquí la imagen") + "</b><span>o haz clic para elegirla · también sirve pegarla (Ctrl+V) o soltarla desde el navegador</span></button>";
    }
    var nueva = ch ? ' style="background-image:url(/api/media/' + ch.info.id + ')"' : "";
    return '<section class="ipan" data-sel="' + esc(x.id) + '"><h2>' + esc(x.t.name) + ' <span class="hint">· ' + x.kind + "</span></h2>" +
      '<div class="cmp' + (x.kind === "Vertical" ? " vsec" : "") + '"><div><div class="lbl">Así está hoy</div>' + (x.empty && !IMG.fixed[x.id] ?
        '<div class="scr cur vac"><span>' + (x.kind === "Banner" ? "Sin banner propio:<br>la app usa la portada" : x.kind === "Vertical" ? "Sin portada vertical:<br>la vista vertical usa la horizontal" : "Sin portada:<br>la app usa un cuadro del video") + '</span><span class="cap warn">' + x.issue + "</span></div></div>" :
        '<div class="scr cur"><span class="cut' + (x.f === "small" ? " small" : x.f === "ok" || x.f === "dup" || x.empty ? " h" : "") + '" data-thumb="' + esc(x.id) + '"' + curStyle + '></span>' + (x.f === "ok" || x.f === "dup" || x.empty ? "" : '<span class="bars" aria-hidden="true"><i></i><i></i></span>') +
        '<span class="cap ' + (x.issue && !IMG.fixed[x.id] ? "warn" : "good") + '">' + (IMG.fixed[x.id] ? (x.empty ? "Agregada" : "Reemplazada") :
          x.issue === "Repetida" ? "Repetida · es la de " + esc(dupNames(x.it, x.t)) : x.it.width + "×" + x.it.height + " · " + (x.issue || "Bien")) + "</span></div></div>") +
      '<div><div class="lbl">Con la nueva</div><div class="scr good"' + nueva + '><span class="cap good">' + (ch ? ch.info.width + "×" + ch.info.height + " · " + (ch.from === "google" ? "de internet" : ch.from === "video" ? "del video" : "tuya") : "Elige una abajo") + "</span></div></div></div>" +
      '<div class="kicker">Imagen nueva</div><div class="rcards" role="radiogroup" aria-label="De dónde sale la imagen nueva">' + opts + "</div>" + body +
      (x.empty ? '<div class="note gold">Se publica <b>una foto nueva en el grupo</b> con el comentario «' + esc(x.it.caption) + "», que la junta con " + (x.t.type === "series" ? "la serie" : "la película") + ". Si es más grande, se ajusta a " + n.join("×") + ".</div>" :
      '<div class="note gold">Se cambia la foto <b>en el mismo mensaje del grupo</b>; el comentario «' + esc(x.it.caption || "") + "» no cambia. Si es más grande, se ajusta a " + n.join("×") + ".</div>") +
      (IMG.msg ? '<div class="note ' + (/^✓/.test(IMG.msg) ? "ok" : "bad") + '">' + esc(IMG.msg) + "</div>" : "") + "</section>";
  }

  function imgFoot(n) {
    var x = imgSel(imgList());
    var ch = x && IMG.chosen[x.id];
    return '<div class="libfoot"><div class="status"><span class="dot ' + (IMG.busy ? "busy" : n ? "ready" : "done") + '"></span><span class="sum">' +
      esc(IMG.busy ? IMG.busy : n ? n + (n === 1 ? " imagen para cambiar en " : " imágenes para cambiar en ") + chatName(B.peer) + (Object.keys(IMG.fixed).length ? " · " + Object.keys(IMG.fixed).length + " ya arregladas" : "") : "Sin pendientes") +
      (chosenPending().length ? " · " + chosenPending().length + " elegidas sin publicar" : "") +
      '</span></div><div class="btns"><button class="ghost" data-act="inicio">← Inicio</button>' +
      (chosenPending().length >= 2 ? '<button class="primary" data-act="img-replace-all"' + (IMG.busy ? " disabled" : "") + ">Publicar las " + chosenPending().length + " elegidas</button>" : "") +
      '<button class="' + (chosenPending().length >= 2 ? "ghost" : "primary") + '" data-act="img-replace"' + (ch && !IMG.busy && !IMG.fixed[x.id] ? "" : " disabled") + ">" +
      (IMG.busy ? (x && x.empty ? "Publicando…" : "Reemplazando…") : x && x.empty ? "Agregar al grupo" : "Reemplazar en el grupo") + "</button></div></div>";
  }

  /* ----- fotogramas: del video en este PC o bajando una versión del grupo ----- */
  function bestVideoFor(t) {
    var vs = (t.versions || []).slice().sort(function (a, b) { return (b.h || 0) - (a.h || 0); });
    var v = vs.filter(function (v) { return v.h && v.h <= 1100; })[0] || vs[vs.length - 1];
    return v && v.parts && v.parts[0] ? { v: v, m: B.msgs[v.parts[0].key] } : null;
  }
  function framesHtml(x) {
    var F = IMG.frames && IMG.frames.id === x.id ? IMG.frames : null;
    var bv = bestVideoFor(x.t);
    if (IMG.dl && IMG.dl.id === x.id) {
      var pct = IMG.dl.size ? Math.round(IMG.dl.got / IMG.dl.size * 100) : 0;
      return '<div class="frbox"><div class="hint">Bajando la versión de ' + esc(IMG.dl.q) + " del grupo · " + pct + " % · " + gb(IMG.dl.got) + " de " + gb(IMG.dl.size) + '</div><div class="bar" style="margin-top:6px"><i style="width:' + pct + '%"></i></div></div>';
    }
    if (!F || !F.frames) {
      return '<div class="frbox"><div class="hint">' + (F && F.loading ? "Sacando cuadros del video…" : "Los cuadros salen de un video de esta película.") + "</div>" +
        '<div class="row" style="margin-top:8px;flex-wrap:wrap">' + (bv ? '<button class="sm" data-act="img-dl">Bajar la de ' + esc(bv.v.q) + " del grupo (" + gb(bv.v.parts[0].size) + ")</button>" : "") +
        '<button class="sm ghost" data-act="img-local">Elegir el video en este equipo…</button></div>' + (F && F.error ? '<div class="note bad">' + esc(F.error) + "</div>" : "") + "</div>";
    }
    var ch = IMG.chosen[x.id];
    return '<div class="frames' + (x.kind === "Vertical" ? " v" : "") + '" role="radiogroup" aria-label="Fotogramas del video">' + F.frames.map(function (fr, i) {
      var on = ch && ch.from === "video" && ch.frame === fr.id;
      return '<button class="' + (on ? "on" : "") + '" data-act="img-frame" data-i="' + i + '" role="radio" aria-checked="' + !!on + '" aria-label="Cuadro en ' + clockTxt(fr.at) + '" style="background-image:url(/api/media/' + fr.id + ')">' + clockTxt(fr.at) + "</button>";
    }).join("") + '</div><div class="row" style="margin-top:6px;justify-content:space-between"><span class="hint">De ' + esc(F.from) + '</span><button class="sm ghost" data-act="img-more">↻ Otros cuadros</button></div>';
  }
  function clockTxt(s) { s = Math.round(s); var h = Math.floor(s / 3600); var m = Math.floor(s % 3600 / 60); return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s % 60).padStart(2, "0"); }

  /* Baja un archivo del grupo a este PC (por pedazos de 8 MB al servidor del preparador); devuelve su ruta. */
  async function downloadToPc(m, onProgress) {
    var d = m.media;
    var name = d.fileName || (String(m.chat.id) + "-" + m.id + ".mp4");
    var have = await fetch("/api/ya-bajado", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name, size: d.fileSize }) }).then(function (r) { return r.json(); });
    if (have.path) { return have.path; }
    var buf = [];
    var len = 0;
    var sent = 0;
    var path = "";
    async function flush() {
      var all = new Uint8Array(len);
      var p = 0;
      buf.forEach(function (c) { all.set(c, p); p += c.length; });
      var r = await fetch("/api/recibir?name=" + encodeURIComponent(name) + "&offset=" + sent, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: all });
      var j = await r.json();
      if (!r.ok) { throw new Error(j.error || "No pude guardar el video en el PC"); }
      sent += len;
      path = j.path;
      buf = [];
      len = 0;
    }
    for await (var c of B.client.downloadAsIterable(d, { partSize: 512 })) {
      buf.push(c);
      len += c.length;
      if (len >= 8 * 1048576) { await flush(); }
      if (onProgress) { onProgress(sent + len, d.fileSize); }
    }
    if (len) { await flush(); }
    return path;
  }

  function loadFrames(x, path, from, seed) {
    IMG.frames = { id: x.id, loading: true, path: path, from: from, seed: seed || 0 };
    render();
    fetch("/api/fotogramas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: path, n: 6, seed: seed || 0 }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { throw new Error(j.error); } return j; }); })
      .then(function (j) { if (IMG.frames && IMG.frames.id === x.id) { IMG.frames.frames = j.frames; IMG.frames.loading = false; render(); } },
        function (e) { if (IMG.frames && IMG.frames.id === x.id) { IMG.frames.loading = false; IMG.frames.error = e.message; render(); } });
  }

  /* ----- ventana de búsqueda (TMDB dentro; «Abrir en Google» con los mismos filtros) -----
   * TMDB devuelve los fondos (16:9) del título con su medida y el idioma del texto que traen: «» = sin texto (lo mejor
   * para el banner, que lleva el texto de la app encima), «es»/«en» = con el título (lo mejor para la portada). */
  var GROUPS = [
    { title: "Combinaciones rápidas", key: null, opts: [
      { label: "Banner ideal", set: { size: 2, text: "none" } },
      { label: "Portada con título", set: { size: 0, text: "title" } },
      { label: "Lo más grande", set: { size: 8, text: "any" } },
      { label: "Sin filtros", set: { size: 0, text: "any" } }
    ] },
    { title: "Tamaño mínimo", key: "size", opts: [[0, "Cualquiera"], [2, "2 MP"], [4, "4 MP"], [8, "8 MP"]] },
    { title: "Texto en la imagen", key: "text", opts: [["any", "Cualquiera"], ["none", "Sin texto"], ["title", "Con el título"], ["es", "En español"]] }
  ];
  function defaultQuery(x) { return x.t.name + (x.t.year ? " " + x.t.year : ""); }
  function fullQuery() { return IMG.q + " " + (imgSel(imgList()) && imgSel(imgList()).kind === "Banner" ? "banner" : imgSel(imgList()) && imgSel(imgList()).kind === "Vertical" ? "poster" : "wallpaper"); }
  function tbs() {
    var selX = imgSel(imgList());
    var t = [selX && selX.kind === "Vertical" ? "iar:t" : "iar:w"];
    if (IMG.adv.size > 0) { t.push("isz:lt,islt:" + IMG.adv.size + "mp"); }
    return t.join(",");
  }
  function extOf(u) { var m = /\.(png|jpe?g|webp|gif|bmp|avif)(?:[?#]|$)/i.exec(u || ""); return m ? m[1].toLowerCase().replace("jpeg", "jpg") : ""; }
  function langLabel(r) { return r.lang ? r.lang.toUpperCase() : "SIN TEXTO"; }
  function visibleResults(x) {
    var a = IMG.adv;
    var n = need(x);
    var seen = {};
    /* el banner prefiere las limpias; la portada, las que traen el título (primero en español) */
    var rank = function (r) { return x.kind === "Banner" ? (r.lang ? 1 : 0) : (r.lang === "es" ? 0 : r.lang ? 1 : 2); };
    return IMG.results.map(function (r, i) { return Object.assign({ i: i }, r); }).filter(function (r) {
      if (!r.w || !r.h) { return false; }
      if (r.w * r.h / 1e6 < a.size) { return false; }
      if (a.text === "none" && r.lang) { return false; }
      if (a.text === "title" && !r.lang) { return false; }
      if (a.text === "es" && r.lang !== "es") { return false; }
      if (IMG.hideSmall && (r.w < n[0] || r.h < n[1])) { return false; }
      if (IMG.dedupe) { if (seen[r.url]) { return false; } seen[r.url] = 1; }
      return true;
    }).sort(function (p, q) { return rank(p) - rank(q) || p.i - q.i; });
  }
  function matchRow() {
    if (!IMG.matches || IMG.matches.length < 2) { return ""; }
    return '<div class="gmatch" role="radiogroup" aria-label="Título encontrado">' + IMG.matches.map(function (m, i) {
      var on = IMG.picked && IMG.picked.id === m.id && IMG.picked.media === m.media;
      return '<button class="' + (on ? "on" : "") + '" data-act="img-match" data-i="' + i + '" role="radio" aria-checked="' + on + '">' +
        (m.thumb ? '<img src="' + esc(m.thumb) + '" alt="">' : "") + "<span>" + esc(m.title) + (m.year ? " (" + m.year + ")" : "") + " · " + (m.media === "tv" ? "Serie" : "Película") + "</span></button>";
    }).join("") + "</div>";
  }
  function imgModal(x) {
    var vis = visibleResults(x);
    if (!IMG.loading && vis.length && !vis.some(function (r) { return r.i === IMG.res; })) { IMG.res = vis[0].i; } // siempre hay una elegida si se ve alguna
    if (!vis.length) { IMG.res = -1; }
    var a = IMG.adv;
    var groups = GROUPS.map(function (g) {
      return '<div class="ggrp"><h3>' + g.title + '</h3><div class="gopts" role="radiogroup" aria-label="' + g.title + '">' + g.opts.map(function (o, oi) {
        var on = g.key ? a[g.key] === o[0] : Object.keys(o.set).every(function (k) { return a[k] === o.set[k]; });
        return '<button class="gchip' + (on ? " on" : "") + (g.key ? "" : " pre") + '" data-act="img-adv" data-g="' + esc(g.key || "") + '" data-v="' + esc(g.key ? String(o[0]) : String(oi)) + '" role="radio" aria-checked="' + on + '">' + (g.key ? o[1] : o.label) + "</button>";
      }).join("") + "</div></div>";
    }).join("");
    var res = IMG.loading ? '<div class="lib-center sm"><div class="lib-spin"></div>Buscando…</div>' : IMG.error ? '<div class="note bad">' + esc(IMG.error) + "</div>" :
      !vis.length ? '<div class="note gold">Ningún resultado cumple todos los filtros. Prueba con un tamaño mínimo menor u otra proporción.</div>' :
      '<div class="gres' + (x.kind === "Vertical" ? " v" : "") + '" role="radiogroup" aria-label="Resultados">' + vis.slice(0, 24).map(function (r) {
        var on = IMG.res === r.i;
        return '<button class="' + (on ? "on" : "") + '" data-act="img-res" data-i="' + r.i + '" role="radio" aria-checked="' + on + '" aria-label="' + esc(r.w + "×" + r.h + ", " + langLabel(r).toLowerCase()) + '" style="background-image:url(\'' + esc(r.thumb) + '\')"><span>' + r.w + "×" + r.h + "</span><i>" + langLabel(r) + "</i></button>";
      }).join("") + "</div>";
    var R = IMG.res >= 0 ? IMG.results[IMG.res] : null;
    return '<div class="scrim"><div class="gmodal" role="dialog" aria-label="Buscar imágenes">' +
      '<div class="mh"><h2>Buscar imágenes <span class="hint">· ' + x.kind + " de " + esc(x.t.name) + '</span></h2><a class="btn-a" target="_blank" rel="noopener" href="https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(fullQuery()) + "&tbs=" + encodeURIComponent(tbs()) + '">Abrir en Google ↗</a></div>' +
      '<div class="gq"><label for="gq" class="sr">Qué buscar</label><input type="search" id="gq" value="' + esc(IMG.q) + '"><button data-act="img-search">Buscar</button></div>' +
      '<div class="hint" style="margin-top:6px">' + (IMG.loading ? "" : vis.length + " resultados · se ocultaron " + (IMG.results.length - vis.length) + " que no cumplen los filtros") + "</div>" +
      '<div class="gbody"><aside class="gside" aria-label="Filtros avanzados">' + groups +
      '<div class="ggrp"><h3>En la herramienta</h3><label class="check"><input type="checkbox" data-act="img-small"' + (IMG.hideSmall ? " checked" : "") + "> Ocultar más chicas que " + need(x).join("×") + "</label>" +
      '<label class="check"><input type="checkbox" data-act="img-dedupe"' + (IMG.dedupe ? " checked" : "") + "> Quitar las repetidas</label></div></aside>" +
      '<div class="gmain">' + matchRow() + res +
      '<div class="gtbs">Imágenes de TMDB (themoviedb.org) · si no está la que buscas, usa «Abrir en Google»</div></div></div>' +
      '<div class="mf"><span class="sum">' + (R ? "Elegida: <b>" + R.w + "×" + R.h + "</b> · " + langLabel(R).toLowerCase() + " · de TMDB" : "Toca una imagen para elegirla") + "</span>" +
      '<button class="ghost" data-act="img-close">Cancelar</button><button class="primary" data-act="img-use"' + (R && !IMG.using ? "" : " disabled") + ">" + (IMG.using ? "Ajustando…" : "Usar esta imagen") + "</button></div></div></div>";
  }
  /* pick: {id, media} de un título ya encontrado (se conservan los demás de la fila); sin pick se busca IMG.q */
  function search(pick) {
    var x = imgSel(imgList());
    if (!x) { return; }
    IMG.loading = true;
    IMG.error = "";
    IMG.results = [];
    IMG.res = -1;
    if (!pick) { IMG.matches = []; IMG.picked = null; }
    render();
    fetch("/api/buscar-imagenes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign(pick ? { id: pick.id, media: pick.media } : { q: IMG.q }, { kind: apiKind(imgSel(imgList()) || { kind: "Portada" }) })) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { throw new Error(j.error); } return j; }); }).then(function (j) {
        IMG.loading = false;
        IMG.results = j.results || [];
        if (!pick) { IMG.matches = j.matches || []; }
        IMG.picked = j.picked;
        if (!j.picked) { IMG.error = "TMDB no encontró «" + IMG.q + "». Prueba con el nombre original (en inglés) o usa «Abrir en Google»."; }
        var vis = visibleResults(x);
        if (vis.length) { IMG.res = vis[0].i; }
        render();
      }, function (e) { IMG.loading = false; IMG.error = e.message; render(); });
  }
  function useInfo(x, info, from, label, extra) {
    IMG.chosen[x.id] = Object.assign({ info: info, from: from, label: label }, extra || {});
    IMG.msg = "";
  }

  ACT["img-go"] = function () { IMG.msg = ""; show("imagenes"); };
  ACT["img-f"] = function (el) { IMG.f = el.getAttribute("data-f"); render(); };
  ACT["img-fmt"] = function (el) { IMG.fmt = el.getAttribute("data-v") === "vertical" ? "v" : "h"; IMG.sec = el.getAttribute("data-v"); IMG.f = "todas"; IMG.sel = ""; IMG.frames = null; IMG.msg = ""; render(); };
  ACT["img-sec"] = function (el) { var v = el.getAttribute("data-v"); if (v !== IMG.sec) { IMG.sec = v; IMG.f = "todas"; IMG.sel = ""; IMG.frames = null; IMG.msg = ""; } render(); };
  ACT["img-only"] = function () { IMG.onlyBad = !IMG.onlyBad; if (IMG.onlyBad && IMG.f === "ok") { IMG.f = "todas"; } render(); };
  ACT["img-sel"] = function (el) { IMG.sel = el.getAttribute("data-id"); IMG.msg = ""; if (!IMG.frames || IMG.frames.id !== IMG.sel) { IMG.frames = null; } render(); };
  ACT["img-fix"] = function (el) { IMG.fix = el.getAttribute("data-v"); render(); };
  ACT["img-google"] = function (el) { IMG.sel = el.getAttribute("data-id"); IMG.fix = "google"; ACT["img-open"](); };
  ACT["img-open"] = function () {
    var x = imgSel(imgList());
    if (!x) { return; }
    IMG.modal = true;
    if (IMG.qFor !== x.id) {
      IMG.qFor = x.id;
      IMG.q = defaultQuery(x);
      IMG.adv = x.kind === "Banner" ? { size: 2, text: "none" } : { size: 0, text: "title" };
      search(null);
    } else { render(); }
  };
  ACT["img-close"] = function () { IMG.modal = false; render(); };
  ACT["img-search"] = function () { IMG.q = $("gq").value.trim(); search(null); };
  ACT["img-match"] = function (el) { var m = IMG.matches[Number(el.getAttribute("data-i"))]; if (m) { search({ id: m.id, media: m.media }); } };
  ACT["img-res"] = function (el) { IMG.res = Number(el.getAttribute("data-i")); render(); };
  ACT["img-adv"] = function (el) { // todo se filtra aquí: TMDB ya trajo todas las imágenes del título
    var g = el.getAttribute("data-g");
    var v = el.getAttribute("data-v");
    if (g) { IMG.adv[g] = g === "size" ? Number(v) : v; } else { Object.assign(IMG.adv, GROUPS[0].opts[Number(v)].set); }
    IMG.res = -1;
    render();
  };
  ACT["img-small"] = function () { IMG.hideSmall = !IMG.hideSmall; render(); };
  ACT["img-dedupe"] = function () { IMG.dedupe = !IMG.dedupe; render(); };
  ACT["img-use"] = function () {
    var x = imgSel(imgList());
    var R = IMG.results[IMG.res];
    if (!x || !R) { return; }
    IMG.using = true;
    render();
    fetch("/api/imagen-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: R.url, kind: apiKind(x) }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { throw new Error(j.error); } return j; }); })
      .then(function (info) {
        IMG.using = false;
        IMG.modal = false;
        useInfo(x, info, "google", R.w + "×" + R.h + " · TMDB", { site: R.site });
        var order = imgList();
        var at = order.map(function (y) { return y.id; }).indexOf(x.id);
        var nxt = order.slice(at + 1).concat(order.slice(0, Math.max(0, at))).filter(function (y) { return !IMG.fixed[y.id] && !IMG.chosen[y.id]; })[0];
        if (nxt) { IMG.sel = nxt.id; IMG.frames = null; }
        IMG.msg = "✓ Elegida para «" + x.t.name + "» (" + x.kind.toLowerCase() + ")." + (nxt ? " Sigue con «" + nxt.t.name + "»; al final publica todas juntas." : " Cuando termines, publica todas juntas.");
        render();
      }, function (e) { IMG.using = false; IMG.error = e.message + " Elige otra."; render(); });
  };
  ACT["img-dl"] = function () {
    var x = imgSel(imgList());
    var bv = x && bestVideoFor(x.t);
    if (!bv || !bv.m) { return; }
    IMG.dl = { id: x.id, q: bv.v.q, got: 0, size: bv.m.media.fileSize };
    render();
    var last = 0;
    downloadToPc(bv.m, function (got, size) {
      IMG.dl.got = got; IMG.dl.size = size;
      if (Date.now() - last > 500) { last = Date.now(); if (B.view === "imagenes") { render(); } }
    }).then(function (path) { IMG.dl = null; loadFrames(x, path, bv.v.q + " del grupo"); },
      function (e) { IMG.dl = null; IMG.frames = { id: x.id, error: "No pude bajar el video: " + (e.message || e) }; render(); });
  };
  ACT["img-local"] = function () {
    var x = imgSel(imgList());
    fetch("/api/pick-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.path) { loadFrames(x, j.path, j.path.split(/[\\/]/).pop()); }
    });
  };
  ACT["img-more"] = function () { var x = imgSel(imgList()); var F = IMG.frames; if (F && F.path) { loadFrames(x, F.path, F.from, (F.seed || 0) + 1); } };
  ACT["img-frame"] = function (el) {
    var x = imgSel(imgList());
    var fr = IMG.frames.frames[Number(el.getAttribute("data-i"))];
    IMG.busy = "Ajustando el cuadro…";
    render();
    fetch("/api/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: fr.path, kind: apiKind(x), outDir: "" }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { throw new Error(j.error); } return j; }); })
      .then(function (info) { IMG.busy = false; useInfo(x, info, "video", "Cuadro en " + clockTxt(fr.at), { frame: fr.id }); render(); },
        function (e) { IMG.busy = false; IMG.msg = e.message; render(); });
  };
  function useBytes(x, bytes, label) {
    IMG.busy = "Ajustando la imagen…";
    render();
    fetch("/api/imagen-bytes?kind=" + apiKind(x), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { throw new Error(j.error); } return j; }); })
      .then(function (info) { IMG.busy = false; useInfo(x, info, "file", label); render(); }, function (e) { IMG.busy = false; IMG.msg = e.message; render(); });
  }
  function useUrl(x, url) {
    IMG.busy = "Bajando la imagen…";
    render();
    fetch("/api/imagen-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url, kind: apiKind(x) }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { throw new Error(j.error); } return j; }); })
      .then(function (info) { IMG.busy = false; useInfo(x, info, "file", "desde el navegador"); render(); }, function (e) { IMG.busy = false; IMG.msg = e.message; render(); });
  }
  ACT["img-pick-file"] = function () {
    var x = imgSel(imgList());
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = function () { var f = inp.files[0]; if (f) { f.arrayBuffer().then(function (b) { useBytes(x, b, f.name); }); } };
    inp.click();
  };
  /* soltar un archivo, o una imagen arrastrada desde otra pestaña; pegar con Ctrl+V */
  $("lib").addEventListener("dragover", function (e) { if (B.view === "imagenes") { e.preventDefault(); var z = $("dropz"); if (z) { z.classList.add("over"); } } });
  $("lib").addEventListener("dragleave", function () { var z = $("dropz"); if (z) { z.classList.remove("over"); } });
  $("lib").addEventListener("drop", function (e) {
    if (B.view !== "imagenes") { return; }
    e.preventDefault();
    var x = imgSel(imgList());
    if (!x) { return; }
    IMG.fix = "file";
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /^image\//.test(f.type)) { f.arrayBuffer().then(function (b) { useBytes(x, b, f.name); }); return; }
    var html = e.dataTransfer.getData("text/html");
    var m = /<img[^>]+src="([^"]+)"/i.exec(html || "");
    var url = (m && m[1]) || e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (/^https?:\/\//i.test(url || "")) { useUrl(x, url.trim().split(/\s/)[0]); }
  });
  document.addEventListener("paste", function (e) {
    if (B.view !== "imagenes" || IMG.modal) { return; }
    var x = imgSel(imgList());
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i += 1) {
      if (/^image\//.test(items[i].type)) { var f = items[i].getAsFile(); IMG.fix = "file"; f.arrayBuffer().then(function (b) { useBytes(x, b, "pegada"); }); return; }
    }
    var t = e.clipboardData && e.clipboardData.getData("text");
    if (/^https?:\/\/\S+$/i.test((t || "").trim())) { IMG.fix = "file"; useUrl(x, t.trim()); }
  });

  /* ----- reemplazar en el grupo ----- */
  /* Sube la imagen elegida (ch) al grupo: edita el mensaje de la foto (m) o publica una nueva si no había o si Telegram no deja editarla. */
  function publishOne(x, ch, m, t0) {
    /* si no hay respuesta en 2 minutos se mira el mensaje: puede haber quedado editado aunque Telegram no contestó */
    function editado() {
      return B.client.getMessages(m.chat.id, [m.id]).then(function (r) { var q = r && r[0]; return !!(q && q.editDate && new Date(q.editDate).getTime() >= t0 - 5000); }, function () { return false; });
    }
    return (async function () {
      var bytes = new Uint8Array(await (await fetch("/api/media/" + ch.info.id)).arrayBuffer());
      if (x.empty) { // no había foto: se publica una nueva con el nombre y la marca
        await B.client.sendMedia(B.peer, { type: "photo", file: bytes, fileName: x.kind.toLowerCase() + ".jpg", caption: x.it.caption });
        return "agregada al grupo";
      }
      var how = "editada";
      try {
        await withTimeout(B.client.editMessage({ chatId: m.chat.id, message: m.id, media: { type: "photo", file: bytes, fileName: x.kind.toLowerCase() + ".jpg" }, text: m.text }), 120000);
      } catch (e) {
        var why = String((e && (e.text || e.message)) || e);
        if (why === "TIMEOUT") { if (await editado()) { return "editada (Telegram tardó en confirmar)"; } throw new Error("Telegram no respondió en 2 minutos y la foto no se cambió. Revisa tu internet y vuelve a intentar."); }
        if (!/AUTHOR_REQUIRED|ADMIN_REQUIRED|EDIT_TIME|FORBIDDEN|RIGHT/i.test(why)) { throw e; }
        /* la subió otra persona: foto nueva con el mismo comentario y, si se puede, se borra la vieja */
        await B.client.sendMedia(B.peer, { type: "photo", file: bytes, fileName: x.kind.toLowerCase() + ".jpg", caption: m.text });
        how = "publicada de nuevo";
        try { await B.client.deleteMessagesById(m.chat.id, [m.id]); } catch (e2) { how = "publicada de nuevo (la vieja sigue en el grupo: no tienes permiso para borrarla)"; }
      }
      return how;
    })();
  }

  /* El mensaje de una foto del grupo: si todavía no está en memoria (la lista se pintó de la caché y los mensajes no se hidrataron), se pide a Telegram
   * por su número (la clave es «chat:mensaje»). Antes el botón salía sin hacer nada ni avisar. */
  function ensureMsg(x) {
    if (x.empty || B.msgs[x.id]) { return Promise.resolve(B.msgs[x.id]); }
    return msgByKey(x.id);
  }

  ACT["img-replace"] = function () {
    var x = imgSel(imgList());
    var ch = x && IMG.chosen[x.id];
    if (!ch) { return; }
    if (!x.empty && !B.msgs[x.id]) {
      IMG.busy = "Buscando la foto en el grupo…";
      render();
      ensureMsg(x).then(function (m) {
        IMG.busy = false;
        if (!m) { IMG.msg = "No encontré esa foto en el grupo (¿la borraron?). Pulsa «↻ Volver a leer» en Inicio y vuelve a intentar."; render(); return; }
        ACT["img-replace"]();
      }, function (e) {
        IMG.busy = false;
        IMG.msg = "No pude leer la foto del grupo: " + HFTelegram.loginError(e).replace(/^Telegram respondió: /, "");
        render();
      });
      return;
    }
    var m = x && B.msgs[x.id];
    if (!m && !x.empty) { return; }
    var t0 = Date.now();
    var label = (x.empty ? "Publicando la " : "Reemplazando la ") + x.kind.toLowerCase() + " de " + x.t.name;
    IMG.busy = label + "…";
    render();
    /* Telegram a veces tarda varios segundos por cada paso (subir la foto, editar el mensaje): se muestra el tiempo para que no parezca trabado */
    var tick = setInterval(function () {
      var sec = Math.round((Date.now() - t0) / 1000);
      IMG.busy = label + "… " + sec + " s" + (sec >= 15 ? " · Telegram responde lento, sigue en curso" : "");
      var el = document.querySelector("#lib .libfoot .sum");
      if (el) { el.textContent = IMG.busy; }
    }, 1000);
    publishOne(x, ch, m, t0).then(function (how) {
      clearInterval(tick);
      IMG.busy = false;
      IMG.fixed[x.id] = Object.assign({}, x, { size: ch.info.width + "×" + ch.info.height });
      if (!x.empty) { B.byKey[x.id] = Object.assign({}, B.byKey[x.id], { width: ch.info.width, height: ch.info.height, size: -(ch.info.size || 1) }); } // ya no es la repetida
      dupMemo = {};
      B.thumbs[x.id] = "/api/media/" + ch.info.id;
      IMG.msg = "✓ " + x.kind + " " + how + ". La TV y el celular la toman al volver a leer el chat.";
      var next = imgList().filter(function (y) { return !IMG.fixed[y.id]; })[0];
      if (next) { IMG.sel = next.id; IMG.frames = null; }
      render();
    }, function (e) {
      clearInterval(tick);
      IMG.busy = false;
      IMG.msg = "No se pudo reemplazar: " + HFTelegram.loginError(e).replace(/^Telegram respondió: /, "");
      render();
    });
  };

  /* Imágenes elegidas y todavía sin publicar, de las tres secciones (portadas, banners, verticales) */
  function chosenPending() {
    var out = [];
    ["portada", "banner", "vertical"].forEach(function (sec) {
      secPhotos(sec).forEach(function (x) {
        var ch = IMG.chosen[x.id];
        if (ch && !IMG.fixed[x.id]) { out.push({ x: x, ch: ch }); }
      });
    });
    return out;
  }
  ACT["img-replace-all"] = async function () {
    if (IMG.busy) { return; }
    var list = chosenPending();
    if (!list.length) { return; }
    var ok = 0;
    var errs = [];
    var peer = B.peer;
    for (var i = 0; i < list.length && peer === B.peer; i += 1) {
      var x = list[i].x;
      var ch = list[i].ch;
      IMG.busy = "Publicando " + (i + 1) + " de " + list.length + ": " + x.kind.toLowerCase() + " de " + x.t.name + "…";
      render();
      try {
        if (!x.empty) { await ensureMsg(x); if (!B.msgs[x.id]) { throw new Error("no encontré la foto en el grupo"); } }
        await publishOne(x, ch, B.msgs[x.id], Date.now());
        IMG.fixed[x.id] = Object.assign({}, x, { size: ch.info.width + "×" + ch.info.height });
        if (!x.empty) { B.byKey[x.id] = Object.assign({}, B.byKey[x.id], { width: ch.info.width, height: ch.info.height, size: -(ch.info.size || 1) }); }
        dupMemo = {};
        B.thumbs[x.id] = "/api/media/" + ch.info.id;
        ok += 1;
      } catch (e) {
        errs.push(x.t.name + " (" + x.kind.toLowerCase() + "): " + HFTelegram.loginError(e).replace(/^Telegram respondió: /, ""));
      }
    }
    IMG.busy = false;
    IMG.msg = (ok ? "✓ " + ok + (ok === 1 ? " imagen publicada" : " imágenes publicadas") + ". La TV y el celular las toman al volver a leer el chat. " : "") + (errs.length ? "No se pudieron " + errs.length + ": " + errs.join(" · ") : "");
    if (errs.length && !ok) { IMG.msg = IMG.msg.replace(/^/, ""); }
    var next = imgList().filter(function (y) { return !IMG.fixed[y.id]; })[0];
    if (next) { IMG.sel = next.id; IMG.frames = null; }
    render();
  };

  /* ===================== eventos ===================== */
  $("lib").addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el) { return; }
    var fn = ACT[el.getAttribute("data-act")];
    if (fn) { e.preventDefault(); fn(el); }
  });
  $("lib").addEventListener("keydown", function (e) {
    if (e.key !== "Enter") { return; }
    if (e.target.id === "lPhone" || e.target.id === "lCc") { ACT["send-code"](); }
    if (e.target.id === "lCode") { ACT["check-code"](); }
    if (e.target.id === "lPwd") { ACT["check-pwd"](); }
  });
  $("lib").addEventListener("change", function (e) {
    if (e.target.id === "xsFile" && e.target.files && e.target.files[0] && B.sel) {
      var f = e.target.files[0];
      f.arrayBuffer().then(function (b) {
        xsFor(B.sel);
        var gaps = subGaps(B.sel);
        XS.file = { name: f.name, bytes: new Uint8Array(b) };
        XS.lang = HFLibrary.subFileLang(f.name) || (gaps[0] && gaps[0].lang) || "spa";
        XS.msg = "";
        XS.sync = null;
        render();
        runSync(B.sel);
      });
      return;
    }
    if (e.target.id === "xsLang") { XS.lang = e.target.value; render(); if (B.sel) { runSync(B.sel); } return; }
    var k = e.target.getAttribute && e.target.getAttribute("data-trk");
    if (!k || !B.sel) { return; }
    var g = e.target.getAttribute("data-g");
    lfFor(B.sel);
    LF.pick[g] = LF.pick[g] || { audio: [], subs: [] };
    LF.pick[g][k][Number(e.target.getAttribute("data-i"))] = e.target.value;
    LF.msg = "";
    render();
  });
  $("lib").addEventListener("input", function (e) {
    if (e.target.id !== "libQ") { return; }
    B.q = e.target.value;
    clearTimeout(B.qTimer);
    B.qTimer = setTimeout(function () {
      var pos = e.target.selectionStart;
      render();
      var q = $("libQ");
      if (q) { q.focus(); q.setSelectionRange(pos, pos); }
    }, 200);
  });
  $("goHome").addEventListener("click", function () { show(B.peer ? "inicio" : B.me ? "chats" : "acceso"); });
  $("acct").addEventListener("click", function () { show(B.me ? "chats" : "acceso"); });

  /* ===================== arranque ===================== */
  function start() {
    show("conectando");
    paintFromCache();
    PREP.tgClient().then(function (c) {
      B.client = c;
      return c.getMe().then(function (u) { return u; }, function (e) {
        if (dupRecover(e)) { return new Promise(function () {}); } // la sesión guardada está dañada: se limpia y se recarga (no se muestra el login a medias)
        return null;
      });
    }).then(function (u) {
      if (!u) { show("acceso"); return; }
      B.me = u;
      PREP.setMe(u);
      store(LS_ME, String(u.id));
      loadChats(); // con un chat guardado, entra directo a Inicio
      if (!store(LS_CHAT)) { show("chats"); }
      /* con la biblioteca ya a la vista, se revisa el chat sin esperar a que lleguen los 300 chats (~10 s): Telegram acepta su id */
      else if (B.peer && B.peer._cache && B.lib) { readChat({ early: true }); }
    }, function (e) {
      $("lib").innerHTML = '<div class="lib-center"><div class="note bad">No pude conectar con Telegram: ' + esc(e.message) + '</div><button onclick="location.reload()">Reintentar</button></div>';
    });
    /* si hay un trabajo en marcha (creando versiones), se abre en las pestañas */
    setTimeout(function () { if (PREP.busy() && B.view !== "tabs") { show("tabs"); PREP.showTab(3); } }, 1200);
  }

  window.HFB = { show: show, read: function (o) { return readChat(o); }, debug: function () { return B; }, downloadToPc: function (m, cb) { return downloadToPc(m, cb); }, dupRecover: dupRecover };
  start();
})();
