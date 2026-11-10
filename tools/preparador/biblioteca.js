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
  var LS_LANG = "hf.preparador.idiomas";
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
    filter: "todas", q: "", sel: null,
    login: { step: "qr", phone: "", hash: "", hint: "", busy: false, error: "", qrAbort: null, pwdWait: null },
    langs: {}, langQueue: [], langBusy: false, langDone: 0, langTotal: 0,
    thumbs: {}, thumbQueue: [], thumbBusy: 0
  };
  try { B.langs = JSON.parse(store(LS_LANG) || "{}") || {}; } catch (e) { B.langs = {}; }

  /* ===================== pantallas ===================== */
  function show(view) {
    B.view = view;
    var lib = view !== "tabs";
    document.body.classList.toggle("lib-on", lib);
    $("lib").classList.toggle("hidden", !lib);
    $("acct").classList.toggle("hidden", !B.me);
    $("goHome").classList.toggle("on", lib);
    if (lib) { render(); window.scrollTo(0, 0); }
  }

  function render() {
    var html = B.view === "conectando" ? viewConnecting() : B.view === "acceso" ? viewLogin() : B.view === "chats" ? viewChats() :
      B.view === "ficha" ? viewFicha() : B.view === "imagenes" ? viewImagenes() : viewInicio();
    $("lib").innerHTML = html;
    if (B.view === "acceso" && B.login.step === "qr") { startQr(); }
    if (B.view === "inicio") { watchThumbs(); }
    if (B.view === "ficha" || B.view === "imagenes") { watchThumbs(); }
    paintAcct();
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
    L.step = "qr"; L.busy = false; L.error = ""; L.hash = ""; L.hint = "";
    B.me = u;
    PREP.setMe(u);
    loadChats();
    var saved = store(LS_CHAT);
    show(saved ? "conectando" : "chats");
  }

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
    }, function (e) { L.busy = false; L.error = HFTelegram.loginError(e); render(); });
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
  function chatName(p) { return p.isSelf ? "Mensajes guardados" : (p.title || p.displayName || String(p.id)); }

  function loadChats() {
    var c = B.client;
    var list = [];
    B.chats = null;
    (async function () {
      for await (var d of c.iterDialogs({ limit: 300, archived: "exclude" })) {
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
      var saved = store(LS_CHAT);
      var pick = saved && byId[saved];
      if (pick && !B.peer) {
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
        var desc = p.isSelf ? "Para pruebas: nadie más lo ve" : (p.chatType === "channel" ? "Canal" : p.chatType === "supergroup" ? "Supergrupo" : "Grupo") +
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
    PREP.setChat(p, B.oldPeer);
    if (!same || !B.lib) { readChat(); }
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

  function readChat() {
    var peer = B.peer;
    var old = B.oldPeer;
    var out = [];
    B.reading = true;
    B.readError = "";
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
          if (pp === peer) { throw e; } // el grupo de antes puede no verse: se sigue con el actual
        }
      }
    })().then(function () {
      if (peer !== B.peer) { return; }
      B.items = out;
      B.byKey = {};
      out.forEach(function (it) { B.byKey[it.key] = it; });
      B.lib = HFLibrary.build(out, {});
      B.titles = B.lib.movies.concat(B.lib.series).sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
      /* la ficha abierta sigue con los datos nuevos */
      if (B.sel) { B.sel = B.titles.filter(function (x) { return x.titleKey === B.sel.titleKey; })[0] || B.sel; }
      B.reading = false;
      B.at = Date.now();
      queueLangs();
      queueSrt();
      if (B.view === "inicio" || B.view === "ficha") { render(); }
    }, function (e) {
      if (peer !== B.peer) { return; }
      B.reading = false;
      B.readError = "No pude leer el chat: " + (e.message || e);
      if (B.view === "inicio") { render(); }
    });
  }
  function paintReading(n) {
    var el = $("readN");
    if (el) { el.textContent = n + " videos y fotos leídos"; }
  }

  /* ===================== qué le falta a cada título ===================== */
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
      [t.posterIsPhoto ? t.imageKey : "", t.bannerKey && t.bannerKey !== t.imageKey ? t.bannerKey : ""].forEach(function (k) {
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

  function queueLangs() {
    B.langQueue = B.titles.filter(function (t) { return t.video && (!B.langs[t.video.key] || (t.type !== "series" && (t.versions || []).some(function (v) { var x = fileKey(v) && B.langs["f:" + fileKey(v)]; return fileKey(v) && (!x || (!x.error && x.v !== 2)); }))); });
    B.langTotal = B.langQueue.length;
    B.langDone = 0;
    runLangs();
  }
  async function runLangs() {
    if (B.langBusy) { return; }
    B.langBusy = true;
    while (B.langQueue.length) {
      var t = B.langQueue.shift();
      var peer = B.peer;
      try {
        B.langs[t.video.key] = await probeTitle(t);
      } catch (e) {
        B.langs[t.video.key] = { error: String((e && e.message) || e), at: Date.now() };
      }
      /* y cada calidad por separado (sus pistas pueden ser otras) */
      if (t.type !== "series") {
        for (var vi = 0; vi < (t.versions || []).length && peer === B.peer; vi += 1) {
          var fk = fileKey(t.versions[vi]);
          if (!fk || (B.langs["f:" + fk] && (B.langs["f:" + fk].v === 2 || B.langs["f:" + fk].error)) || !B.msgs[fk]) { continue; }
          try {
            B.langs["f:" + fk] = await probeMsg(B.msgs[fk]);
          } catch (e) {
            B.langs["f:" + fk] = { error: String((e && e.message) || e), at: Date.now() };
          }
        }
      }
      if (peer !== B.peer) { break; }
      B.langDone += 1;
      store(LS_LANG, JSON.stringify(B.langs));
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

  function viewInicio() {
    var p = B.peer;
    if (!p) { return viewChats(); }
    var name = chatName(p);
    var top = '<div class="libtop"><h1 class="libtitle grow">' + esc(name) + ' <span class="hint" id="libCount">' + topCount() + "</span></h1>" +
      '<div class="scan" id="scan">' + scanHtml() + "</div>" +
      '<input type="search" id="libQ" class="search" placeholder="Buscar una película" value="' + esc(B.q) + '" aria-label="Buscar una película">' +
      (B.lib ? '<button data-act="img-go">Imágenes por revisar <span class="pill warn">' + B.titles.reduce(function (n, t) { return n + imgIssues(t).length; }, 0) + "</span></button>" : "") +
      '<button class="ghost icon" data-act="reread" title="Volver a leer el chat" aria-label="Volver a leer el chat">↻</button></div>';
    if (B.reading) {
      return '<div class="s0">' + top + '<div class="lib-center"><div class="lib-spin"></div><b>Leyendo ' + esc(name) + '…</b><span id="readN"></span></div></div>' + footInicio("Leyendo el chat…");
    }
    if (B.readError) {
      return '<div class="s0">' + top + '<div class="note bad">' + esc(B.readError) + ' <button data-act="reread">Reintentar</button></div></div>' + footInicio("");
    }
    var st = B.titles.map(function (t) { return { t: t, s: statusOf(t) }; });
    var n = function (k) { return st.filter(function (x) { return FILTERS[k](x.s); }).length; };
    var tiles = [
      ["todas", "Todas", "en el chat", "gold"], ["completas", "Completas", "4 calidades, español, inglés e imágenes", "good"],
      ["faltan", "Falta renderizar", "les falta alguna calidad", "warn"], ["es_en", "Español e inglés", "les falta audio o subtítulos en alguno", "warn"],
      ["srt", "Subtítulos con fallas", "incompletos, desfasados o dañados", "warn"],
      ["imagenes", "Imágenes por revisar", "portada o banner no horizontal o repetida", "warn"],
      ["idiomas", "Idiomas por revisar", "audio o subtítulos con el idioma mal", "warn"],
      ["separar", "Subtítulos por separar", "aún van dentro de cada video", "warn"]
    ].map(function (x) {
      var on = B.filter === x[0];
      return '<button class="tile ' + x[3] + (on ? " on" : "") + '" data-act="filter" data-f="' + x[0] + '" aria-pressed="' + on + '"><b>' + n(x[0]) + "</b><span>" + x[1] + "</span><small>" + x[2] + "</small></button>";
    }).join("");
    var q = B.q.toLowerCase();
    var shown = st.filter(function (x) { return FILTERS[B.filter](x.s) && (!q || x.t.name.toLowerCase().indexOf(q) >= 0); });
    var cards = shown.map(function (x) { return card(x.t, x.s); }).join("") ||
      '<div class="empty" style="grid-column:1/-1">' + (B.titles.length ? "Ninguna película con este filtro." : "Este chat no tiene películas ni series con el formato de HomeFlix.") + "</div>";
    var foot = {
      todas: "Toca una película para ver qué tiene en el grupo y qué le falta",
      completas: "Listas: todas las calidades, audio y subtítulos en español e inglés sin fallas, y portada y banner horizontales",
      faltan: "Con calidades por crear · en la ficha ves cuáles y las preparas",
      sin_espanol: "Sin audio ni subtítulos en español",
      es_en: "Les falta audio o subtítulos aparte en español o en inglés · ES/EN en cada tarjeta: dorado vino con la película, azul agregado, punteado falta",
      srt: "Subtítulos aparte que se cortan antes, no van al compás del español o tienen letras dañadas · en la ficha ves el detalle",
      imagenes: "Portada o banner vertical, cuadrado o muy pequeño",
      idiomas: "Pistas que la TV y el celular muestran con el idioma mal · se corrigen en la ficha sin volver a subir",
      separar: "Sus subtítulos van dentro de cada video · al pasarlos aparte, todas las calidades usan los mismos"
    }[B.filter];
    var bulk = B.filter === "separar" && n("separar") ? '<div class="note warn" style="margin-top:10px;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span class="grow">' +
      (MIG.busy ? esc(MIG.busy) : "«Pasar con lo de este PC» usa los videos que ya tienes (originales o carpetas «- HomeFlix»): no baja nada. «Bajar y pasar» baja la versión más liviana de cada una. En los dos casos se sacan sus subtítulos como .srt y se publican aparte; los videos del grupo no se tocan.") + "</span>" +
      (MIG.busy ? '<button class="ghost sm" data-act="mig-stop">Detener</button>' : '<button class="primary sm" data-act="mig-local" title="Sin bajar nada: usa los originales o las carpetas «- HomeFlix» que haya en este PC">Pasar con lo de este PC</button>' +
        '<button class="ghost sm" data-act="mig-folder" title="Agregar una carpeta donde buscar los videos">＋ Carpeta…</button>' +
        '<button class="ghost sm" data-act="mig-all" title="Baja de cada una la versión más liviana">Bajar y pasar todas (' + n("separar") + ")</button>") + "</div>" : "";
    bulk += (MIG.msg && B.filter === "separar" ? '<div class="note ' + (/^No pude/.test(MIG.msg) ? "bad" : "ok") + '" style="margin-top:10px">' + esc(MIG.msg) + "</div>" : "");
    return '<div class="s0">' + top + '<div class="tiles" role="group" aria-label="Filtrar la biblioteca">' + tiles + "</div>" + bulk +
      '<div class="pgrid">' + cards + "</div></div>" + footInicio(shown.length + " de " + B.titles.length + " · " + foot);
  }
  function footInicio(text) {
    return '<div class="libfoot"><div class="status"><span class="dot ready"></span><span class="sum">' + esc(text) + "</span></div>" +
      '<div class="btns"><button class="ghost" data-act="go-chats">Elegir otro chat</button><button class="primary" data-act="new">＋ Preparar una película nueva</button></div></div>';
  }
  function topCount() {
    if (!B.lib) { return ""; }
    return "· " + B.lib.movies.length + (B.lib.movies.length === 1 ? " película" : " películas") + " · " + B.lib.series.length + " series · leído " +
      new Date(B.at).toLocaleTimeString("es", { hour: "numeric", minute: "2-digit" });
  }
  function scanHtml() {
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
    var el = document.querySelector('[data-card="' + CSS.escape(t.titleKey) + '"]');
    if (el) { el.outerHTML = card(t, statusOf(t)); watchThumbs(); }
    if (!B.langQueue.length && B.view === "inicio") { render(); }
  }

  function card(t, s) {
    var tag;
    var tagCls;
    var have = haveOf(t);
    if (s.full) { tag = "Completa"; tagCls = "good"; }
    else if (s.miss.length === 3 && have.length === 1) { tag = "Solo " + have[0]; tagCls = "warn"; }
    else if (s.miss.length) { tag = "Faltan " + s.miss.length; tagCls = "warn"; }
    else if (s.noEs) { tag = "Sin español"; tagCls = "warn"; }
    else if (s.imgs.length) { tag = s.imgs[0].kind + " " + s.imgs[0].issue.toLowerCase(); tagCls = "warn"; }
    else if (s.bad.length) { tag = "Idioma por revisar"; tagCls = "warn"; }
    else if (s.emb.length) { tag = "Subtítulos por separar"; tagCls = "warn"; }
    else if (s.lp.gaps.length) { tag = s.lp.gaps.length > 1 ? "Faltan " + s.lp.gaps.length + " idiomas" : "Falta " + s.lp.gaps[0]; tagCls = "warn"; }
    else if (s.lp.srtBad.length) { tag = "Subtítulo con fallas"; tagCls = "warn"; }
    else { tag = LANG_TXT[s.lang.state]; tagCls = "wait"; }
    var qrow = QS.map(function (q) {
      return '<i class="' + (have.indexOf(q[0]) >= 0 ? "have" : "miss") + '">' + (q[0] === "4K" ? "4K" : q[1]) + "</i>";
    }).join("");
    var imgKey = t.imageKey || (t.video && t.video.key);
    return '<button class="pcard" data-act="ficha" data-card="' + esc(t.titleKey) + '" aria-label="' + esc(t.name + (t.year ? " (" + t.year + ")" : "")) + '">' +
      '<span class="art" data-thumb="' + esc(imgKey || "") + '"' + thumbStyle(imgKey) + '><span class="ph">' + esc(t.name) + '</span><span class="sttag ' + tagCls + '">' + esc(tag) + "</span></span>" +
      '<span class="pname"><b>' + esc(t.name) + "</b><small>" + esc(t.type === "series" ? "Serie" : t.year || "") + "</small></span>" +
      '<span class="qrow">' + qrow + (t.type === "series" ? '<span class="lang ' + LANG_CLS[s.lang.state] + '">' + esc(LANG_TXT[s.lang.state]) + "</span>" : "") + "</span>" +
      (t.type === "series" ? "" : langRow(t, s.lp)) + "</button>";
  }

  ACT.filter = function (el) { B.filter = el.getAttribute("data-f"); render(); };
  ACT.reread = function () { if (!PREP.busy()) { readChat(); } };
  ACT["go-chats"] = function () { show("chats"); };
  ACT.new = function () { show("tabs"); PREP.showTab(1); };
  ACT.ficha = function (el) {
    var k = el.getAttribute("data-card");
    B.sel = B.titles.filter(function (t) { return t.titleKey === k; })[0] || null;
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
          if (k && !B.thumbs[k]) { B.thumbs[k] = "pending"; B.thumbQueue.push(k); pumpThumbs(); }
        });
      }, { rootMargin: "300px" });
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-thumb]"), function (el) {
      var k = el.getAttribute("data-thumb");
      if (k && !B.thumbs[k]) { observer.observe(el); }
    });
  }
  function pickThumb(list, want) {
    var best = null;
    (list || []).forEach(function (t) {
      if (!t.width || t.isVideo || t.type === "i" || t.type === "j") { return; }
      if (!best || Math.abs(t.width - want) < Math.abs(best.width - want)) { best = t; }
    });
    return best;
  }
  function pumpThumbs() {
    while (B.thumbBusy < 3 && B.thumbQueue.length) {
      var k = B.thumbQueue.shift();
      B.thumbBusy += 1;
      (function (key) {
        var m = B.msgs[key];
        var d = m && m.media;
        var th = d ? (d.type === "photo" ? pickThumb(d.thumbnails, 480) : (d.videoCover && pickThumb(d.videoCover.thumbnails, 480)) || pickThumb(d.thumbnails, 480)) : null;
        (th ? B.client.downloadAsBuffer(th) : Promise.resolve(null)).then(function (buf) {
          B.thumbs[key] = buf ? URL.createObjectURL(new Blob([buf], { type: "image/jpeg" })) : "none";
        }, function () { B.thumbs[key] = "none"; }).then(function () {
          B.thumbBusy -= 1;
          var u = B.thumbs[key];
          if (u !== "none") {
            Array.prototype.forEach.call(document.querySelectorAll('[data-thumb="' + CSS.escape(key) + '"]'), function (el) { el.style.backgroundImage = "url('" + u + "')"; });
          }
          pumpThumbs();
        });
      })(k);
    }
  }

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
      L.error ? '<div class="note warn">No pude leer las pistas del archivo: ' + esc(L.error) + ' <button data-act="relang">Reintentar</button></div>' :
      (series ? '<div class="tracks"><div><h3>Audio</h3>' + trackList(L.audio) + "</div><div><h3>Subtítulos</h3>" + trackList(L.subs) + "</div></div>" : langFixer(t) + extSubsSection(t)) +
      (L.state === "no" ? '<div class="note warn"><b>No tiene audio ni subtítulos en español.</b> Elige cómo agregarlo; se hace junto con las calidades.</div>' + esOptions(t) :
        L.state === "unknown" ? '<div class="note warn">Las pistas no dicen su idioma. Si sabes que está en español, no hay que hacer nada; si no, agrégalo:</div>' + esOptions(t) :
        "");
    /* el estado del idioma va en el título de la sección, con «volver a revisar» al lado */
    var langHead = L.state === "pending" ? "" : '<span class="hstat ' + (L.state === "es" || L.state === "subs" ? "ok" : "warn") + '">' +
      (L.state === "es" ? "✓ Audio en español" : L.state === "subs" ? "✓ Subtítulos en español" : L.state === "no" ? "Sin español" : "Idioma sin marcar") + "</span>" +
      '<button class="icobtn" data-act="relang" title="Volver a revisar las pistas" aria-label="Volver a revisar las pistas">↻</button>';

    var imgRow = function (kind, key, need) {
      var it = photoInfo(key);
      var issue = imgIssue(it, kind === "Banner" ? "banner" : "portada", t);
      if (issue) {
        return '<div class="vrow"><span class="q" style="font-size:14px">' + kind + '</span><span class="d">' + it.width + "×" + it.height + "<small>" +
          (issue === "Repetida" ? "Es la misma imagen que la de " + esc(dupNames(it, t)) : "Debe ser horizontal desde " + need) +
          '</small></span><button class="sm" data-act="img-from-ficha" data-id="' + esc(key) + '">Cambiar…</button></div>';
      }
      return '<div class="vrow' + (it ? "" : " miss") + '"><span class="q" style="font-size:14px">' + kind + '</span><span class="d">' +
        (it ? it.width + "×" + it.height : "No tiene") + "<small>" + (it ? (issue ? "Debe ser horizontal desde " + need : "Horizontal · bien") : "La app usa un cuadro del video") + "</small></span>" +
        '<span class="pill ' + (it ? (issue ? "warn" : "good") : "dim") + '">' + (it ? (issue || "Bien") : "Opcional") + "</span></div>";
    };

    var todo = s.miss.slice();
    if (s.noEs) { todo.push("español"); }
    if (!series && !t.thumbs) { todo.push("miniaturas"); }
    if (s.imgs.length) { todo.push(s.imgs.map(function (x) { return x.kind.toLowerCase(); }).join(" y ")); }
    var footText = todo.length ? "Le falta: " + todo.join(", ") + ". Al seguir, la pestaña 1 se llena con los datos de " + (series ? "la serie" : "esta película") + "." : "No le falta nada.";
    return '<div class="s5"><div class="stack">' + hero +
      '<section><h2>Calidades en el grupo <span class="hint">· las nuevas se publican con el mismo comentario y la app las junta con las que ya están</span></h2><div class="vlist">' + vrows + "</div></section>" +
      (series ? "" : sourceSection(t, s)) +
      (series ? "" : '<section><h2>Portada y banner</h2><div class="vlist">' + imgRow("Portada", t.imageKey, "1280×720") + imgRow("Banner", t.bannerKey !== t.imageKey ? t.bannerKey : null, "1920×1080") + "</div></section>") +
      '</div><div class="stack"><section><h2 class="hrow">Idioma' + langHead + "</h2>" + langBody + "</section>" +
      (series ? "" : thumbsSection(t)) +
      '<section><h2>Comentario en el grupo</h2><div class="caption">' + esc((t.video && t.video.caption) || "") + "</div></section></div></div>" +
      '<div class="libfoot"><div class="status"><span class="dot ' + (FI.busy ? "busy" : todo.length ? "ready" : "done") + '"></span><span class="sum">' + esc(FI.busy || footText) + "</span></div>" +
      '<div class="btns"><button class="ghost" data-act="inicio">← Inicio</button>' +
      ((s.miss.length || fiEs(t)) && !series ? '<button class="primary" data-act="prepare"' + (FI.busy ? " disabled" : "") + ">" + (fiEs(t) && !s.miss.length ? "Volver a crear con el español →" : "Preparar lo que falta →") + "</button>" : "") + "</div></div>";
  }

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
      var head = groups.length > 1 || g.versions.length > 1 ? '<div class="lfg">' + esc(groupName(g)) + (g.versions.length > 1 ? '<span class="hint">· mismas pistas</span>' : "") + "</div>" : "";
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
      '<div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap"><button class="primary sm" data-act="lfix-save"' + (dirty && !LF.busy ? "" : " disabled") + ">" + esc(LF.busy || "Guardar idiomas") + "</button>" +
      '<span class="hint">Solo cambia el comentario de los archivos en el grupo; no se vuelve a subir nada.</span></div>';
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
    while (SRT.queue.length && peer === B.peer) {
      var job = SRT.queue.shift();
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
    if (B.view === "inicio") { render(); }
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
    if (c.issues.length) { return '<small class="chk bad">' + esc(parts.concat(c.issues).join(" · ")) + "</small>"; }
    return '<small class="chk ok">✓ ' + esc(parts.join(" · ")) + "</small>";
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
        '<button class="ghost sm" data-act="xs-forced" data-k="' + esc(x.key) + '" title="Forzados: solo carteles y diálogos en otro idioma; se activan solos con el audio de su idioma">' + (x.forced ? "Quitar forzados" : "Marcar forzados") + "</button>" +
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
    IMG.sec = secPhotos("banner").some(function (x) { return x.id === id; }) ? "banner" : "portada";
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

  function thumbsSection(t) {
    fiFor(t);
    var th = t.thumbs;
    var sv = smallestVersion(t);
    return '<section><h2>Miniaturas para recortes <span class="pill ' + (th ? "good" : "warn") + '">' + (th ? "Listas" : "No tiene") + "</span></h2>" +
      '<div class="hint" style="margin-top:4px">' + (th ? th.sheets.length + (th.sheets.length === 1 ? " hoja" : " hojas") + " · 1 cuadro cada " + th.every + " s. «Recortar» del celular muestra toda la película al instante." :
        "Se crean de la versión de " + (sv ? sv.q : "menor calidad") + " del grupo (se baja: " + (sv ? gb(partsSize(sv)) : "—") + ") y se publican solas, sin volver a subir el video.") + "</div>" +
      (FI.msg ? '<div class="note ' + (/^✓/.test(FI.msg) ? "ok" : "bad") + '">' + esc(FI.msg) + "</div>" : "") +
      (sv ? '<div class="row" style="margin-top:10px"><button data-act="fi-thumbs"' + (FI.busy ? " disabled" : "") + ">" + (th ? "Crearlas y publicarlas otra vez" : "Publicar solo las miniaturas") + "</button></div>" : "") + "</section>";
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

  ACT.prepare = function () {
    var t = B.sel;
    var cap = t && t.video && HFLibrary.parseCaption(t.video.caption || "");
    if (!cap) { alert("No pude leer el comentario de esta película."); return; }
    if (PREP.busy() || FI.busy) { alert("Ya hay un trabajo en marcha: espera a que termine."); return; }
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
    sec: "portada", onlyBad: true, f: "todas", sel: "", fix: "google", modal: false, adv: { size: 2, text: "none" }, matches: [], picked: null, hideSmall: true, dedupe: true,
    q: "", results: [], next: 0, loading: false, error: "", res: -1, chosen: {}, frames: null, video: null, dl: null, busy: false, msg: "", fixed: {}
  };
  var SHAPE = { Vertical: "v", Cuadrada: "sq", "Muy pequeña": "sm", "Pequeña para banner": "sm", Repetida: "h" };
  var KIND_F = { Vertical: "vert", Cuadrada: "sq", "Muy pequeña": "small", "Pequeña para banner": "small", Repetida: "dup" };

  /* Portadas y banners van en secciones aparte (IMG.sec). Con «Solo las que fallan» (IMG.onlyBad) se ven las que hay que
   * cambiar; apagado, todas las de la sección con su estado. Un título sin banner propio (la app usa su portada) o sin
   * portada (usa un cuadro del video) sale VACÍO: al elegirle imagen se publica como foto nueva en el grupo. */
  function secKind(sec) { return sec === "banner" ? "Banner" : "Portada"; }
  /* comentario de la foto nueva: el nombre del título y la marca; así la app la junta con su película o serie */
  function newCaption(t, sec) {
    var name = String(t.name || "").replace(/#/g, "").trim();
    var mark = sec === "banner" ? " #banner" : " #portada";
    return t.type === "series" ? "serie(1/1)#" + name + mark : "pelicula#" + name + (t.year ? " (" + t.year + ")" : "") + mark;
  }
  function secPhotos(sec) {
    var kind = secKind(sec);
    var out = [];
    B.titles.forEach(function (t) {
      var key = kind === "Banner" ? (t.bannerKey && t.bannerKey !== t.imageKey ? t.bannerKey : "") : (t.posterIsPhoto ? t.imageKey : "");
      var it = key ? photoInfo(key) : null;
      if (!it || !it.key) {
        var id = "vacia:" + sec + ":" + (t.titleKey || t.name);
        out.push({ id: id, t: t, kind: kind, it: { key: id, width: 0, height: 0, caption: newCaption(t, sec) }, empty: true,
          issue: kind === "Banner" ? "Sin banner" : "Sin portada", f: "empty", shape: "empty" });
        return;
      }
      var issue = imgIssue(it, kind.toLowerCase(), t);
      out.push({ id: it.key, t: t, kind: kind, it: it, issue: issue, f: issue ? KIND_F[issue] || "small" : "ok", shape: issue ? SHAPE[issue] || "sm" : "h" });
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
  function need(x) { return x.kind === "Banner" ? [1920, 1080] : [1280, 720]; }

  function viewImagenes() {
    var all = imgList();
    var pendP = badCount("portada");
    var pendB = badCount("banner");
    var pend = { length: pendP + pendB };
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
    var secs = [["portada", "Portadas", pendP, "1280×720 · tarjetas de las filas"], ["banner", "Banners", pendB, "1920×1080 · fondo del destacado"]].map(function (s) {
      var on = IMG.sec === s[0];
      var vac = emptyCount(s[0]);
      var bad = s[2] - vac;
      var txt = [bad ? bad + (bad === 1 ? " falla" : " fallan") : "", vac ? vac + (vac === 1 ? " vacía" : " vacías") : ""].filter(Boolean).join(" · ") || "Bien";
      return '<button data-act="img-sec" data-v="' + s[0] + '" class="' + (on ? "on" : "") + '" role="tab" aria-selected="' + on + '"><span><b>' + s[1] + "</b><small>" + s[3] + "</small></span>" +
        '<span class="pill ' + (s[2] ? "warn" : "good") + '">' + txt + "</span></button>";
    }).join("");
    var secName = IMG.sec === "banner" ? "banners" : "portadas";
    var emptyMsg = "Ninguna con este filtro.";
    if (IMG.onlyBad && !all.length) { emptyMsg = (IMG.sec === "banner" ? "Todos los banners están bien" : "Todas las portadas están bien") + ": son horizontales y del tamaño correcto. Apaga «Solo las que fallan» para verlas."; }
    var rows = list.map(function (x) {
      var on = sel && x.id === sel.id;
      var done = !!IMG.fixed[x.id];
      return '<div class="irow' + (on ? " on" : "") + (done ? " fixed" : "") + '"><button class="ipick" data-act="img-sel" data-id="' + esc(x.id) + '" aria-pressed="' + on + '">' +
        '<span class="ibox" aria-hidden="true">' + (x.empty && !done ? '<span class="empty">+</span>' : '<span class="' + (x.empty ? "h" : x.shape) + '" data-thumb="' + esc(x.id) + '"' + thumbStyle(x.id) + "></span>") + "</span>" +
        '<span class="tx"><b>' + esc(x.t.name) + "</b><small>" + x.kind + " · " + (done ? done.size || "" : x.empty ? (x.kind === "Banner" ? "usa la portada" : "usa un cuadro del video") : x.it.width + "×" + x.it.height) + '</small><span class="pill ' + (done || !x.issue ? "good" : x.empty ? "gold" : "warn") + '">' + (done ? (x.empty ? "Agregada" : "Reemplazada") : x.issue || "Bien") + "</span></span></button>" +
        '<button class="gsearch" data-act="img-google" data-id="' + esc(x.id) + '" title="Buscar en internet" aria-label="Buscar ' + esc(x.kind.toLowerCase() + " de " + x.t.name) + ' en internet"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="M15.5 15.5L21 21"></path><path d="M7.5 12l2-2.5 1.5 1.5 1.5-2 1 1.5"></path></svg></button></div>';
    }).join("") || '<div class="empty">' + esc(emptyMsg) + "</div>";

    var left = '<section class="lst"><div class="crumb"><a href="#" data-act="inicio">Inicio</a><span aria-hidden="true">›</span><span>Imágenes por revisar</span></div>' +
      '<h2 style="margin-top:6px;font-size:20px">Portadas y banners <span class="pill ' + (pend.length ? "warn" : "good") + '">' + (pend.length ? pend.length + (pend.length === 1 ? " pendiente" : " pendientes") : "Sin pendientes") + "</span></h2>" +
      '<div class="hint">Deben ser horizontales 16:9: la portada desde 1280×720 y el banner desde 1920×1080.</div>' +
      '<div class="isec" role="tablist" aria-label="Sección">' + secs + "</div>" +
      '<div class="itools"><div class="seg" role="group" aria-label="Filtrar ' + secName + ' por estado">' + filters + "</div>" +
      '<label class="swt"><input type="checkbox" data-act="img-only"' + (IMG.onlyBad ? " checked" : "") + '><span class="trk" aria-hidden="true"><i></i></span>Solo las que fallan</label></div>' +
      '<div class="ilist">' + rows + "</div></section>";
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
      body = '<div class="gpick"><span class="th' + (ch && ch.from === "google" ? "" : " none") + '"' + (ch && ch.from === "google" ? ' style="background-image:url(/api/media/' + ch.info.id + ')"' : "") + '></span><span class="tx"><b>' +
        (ch && ch.from === "google" ? ch.label : "Sin elegir todavía") + "</b>" + (ch && ch.from === "google" ? "de " + esc(ch.site) + " · ajustada a " + n.join("×") : "Busca con el nombre y los filtros ya puestos.") +
        '</span><button class="sm" data-act="img-open">' + (ch && ch.from === "google" ? "Cambiar…" : "Buscar…") + "</button></div>";
    } else if (IMG.fix === "video") {
      body = framesHtml(x);
    } else {
      body = '<button class="dropz" data-act="img-pick-file" id="dropz"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"></path><path d="M7 9l5-5 5 5"></path><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"></path></svg>' +
        "<b>" + (ch && ch.from === "file" ? "Elegida: " + esc(ch.label) : "Arrastra aquí la imagen") + "</b><span>o haz clic para elegirla · también sirve pegarla (Ctrl+V) o soltarla desde el navegador</span></button>";
    }
    var nueva = ch ? ' style="background-image:url(/api/media/' + ch.info.id + ')"' : "";
    return '<section><h2>' + esc(x.t.name) + ' <span class="hint">· ' + x.kind + "</span></h2>" +
      '<div class="cmp"><div><div class="lbl">Así está hoy</div>' + (x.empty && !IMG.fixed[x.id] ?
        '<div class="scr cur vac"><span>' + (x.kind === "Banner" ? "Sin banner propio:<br>la app usa la portada" : "Sin portada:<br>la app usa un cuadro del video") + '</span><span class="cap warn">' + x.issue + "</span></div></div>" :
        '<div class="scr cur"><span class="cut' + (x.f === "small" ? " small" : x.f === "ok" || x.f === "dup" || x.empty ? " h" : "") + '"' + curStyle + '></span>' + (x.f === "ok" || x.f === "dup" || x.empty ? "" : '<span class="bars" aria-hidden="true"><i></i><i></i></span>') +
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
      '</span></div><div class="btns"><button class="ghost" data-act="inicio">← Inicio</button><button class="primary" data-act="img-replace"' + (ch && !IMG.busy && !IMG.fixed[x.id] ? "" : " disabled") + ">" +
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
    return '<div class="frames" role="radiogroup" aria-label="Fotogramas del video">' + F.frames.map(function (fr, i) {
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
  function fullQuery() { return IMG.q + " " + (imgSel(imgList()) && imgSel(imgList()).kind === "Banner" ? "banner" : "wallpaper"); }
  function tbs() {
    var t = ["iar:w"];
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
      '<div class="gres" role="radiogroup" aria-label="Resultados">' + vis.slice(0, 24).map(function (r) {
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
    fetch("/api/buscar-imagenes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pick ? { id: pick.id, media: pick.media } : { q: IMG.q }) })
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
    fetch("/api/imagen-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: R.url, kind: x.kind === "Banner" ? "banner" : "portada" }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { throw new Error(j.error); } return j; }); })
      .then(function (info) {
        IMG.using = false;
        IMG.modal = false;
        useInfo(x, info, "google", R.w + "×" + R.h + " · TMDB", { site: R.site });
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
    fetch("/api/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: fr.path, kind: x.kind === "Banner" ? "banner" : "portada", outDir: "" }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { throw new Error(j.error); } return j; }); })
      .then(function (info) { IMG.busy = false; useInfo(x, info, "video", "Cuadro en " + clockTxt(fr.at), { frame: fr.id }); render(); },
        function (e) { IMG.busy = false; IMG.msg = e.message; render(); });
  };
  function useBytes(x, bytes, label) {
    IMG.busy = "Ajustando la imagen…";
    render();
    fetch("/api/imagen-bytes?kind=" + (x.kind === "Banner" ? "banner" : "portada"), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { throw new Error(j.error); } return j; }); })
      .then(function (info) { IMG.busy = false; useInfo(x, info, "file", label); render(); }, function (e) { IMG.busy = false; IMG.msg = e.message; render(); });
  }
  function useUrl(x, url) {
    IMG.busy = "Bajando la imagen…";
    render();
    fetch("/api/imagen-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url, kind: x.kind === "Banner" ? "banner" : "portada" }) })
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
  ACT["img-replace"] = function () {
    var x = imgSel(imgList());
    var ch = x && IMG.chosen[x.id];
    var m = x && B.msgs[x.id];
    if (!ch || (!m && !x.empty)) { return; }
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
    /* si no hay respuesta en 2 minutos se mira el mensaje: puede haber quedado editado aunque Telegram no contestó */
    function editado() {
      return B.client.getMessages(m.chat.id, [m.id]).then(function (r) { var q = r && r[0]; return !!(q && q.editDate && new Date(q.editDate).getTime() >= t0 - 5000); }, function () { return false; });
    }
    (async function () {
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
    })().then(function (how) {
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
    PREP.tgClient().then(function (c) {
      B.client = c;
      return c.getMe().then(function (u) { return u; }, function () { return null; });
    }).then(function (u) {
      if (!u) { show("acceso"); return; }
      B.me = u;
      PREP.setMe(u);
      loadChats(); // con un chat guardado, entra directo a Inicio
      if (!store(LS_CHAT)) { show("chats"); }
    }, function (e) {
      $("lib").innerHTML = '<div class="lib-center"><div class="note bad">No pude conectar con Telegram: ' + esc(e.message) + '</div><button onclick="location.reload()">Reintentar</button></div>';
    });
    /* si hay un trabajo en marcha (creando versiones), se abre en las pestañas */
    setTimeout(function () { if (PREP.busy() && B.view !== "tabs") { show("tabs"); PREP.showTab(3); } }, 1200);
  }

  window.HFB = { show: show, debug: function () { return B; }, downloadToPc: function (m, cb) { return downloadToPc(m, cb); } };
  start();
})();
