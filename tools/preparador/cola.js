/* HomeFlix · preparador · cola de películas.
 *
 * Se encolan varias películas («＋ Agregar a la cola» o «Crear versiones»: la misma acción); el servidor las renderiza una tras otra
 * (server.mjs · colaSeguir) y, con «Publicar en el grupo al terminar» encendido, ESTA página sube cada una apenas termina,
 * sin que nadie pulse nada: sus versiones, portada, banner y miniaturas, con el comentario que quedó en su carpeta
 * (COMO-SUBIR.txt). Lo que ya está en el grupo (mismo archivo y tamaño, o la misma foto) no se vuelve a subir.
 * La subida la hace la página (el motor de Telegram vive en el navegador): el preparador tiene que quedar abierto.
 * Usa lo que expone ui.html en window.P (cliente de Telegram, ayudas de subida). */
(function () {
  "use strict";
  var P = window.P;
  if (!P) { return; }
  var VIDEO_F = { _: "inputMessagesFilterVideo" };
  var DOCS_F = { _: "inputMessagesFilterDocument" };
  var PHOTO_F = { _: "inputMessagesFilterPhotos" };
  var C = { items: [], pausa: false, auto: true, actual: "", render: {}, pub: {}, busy: false, abort: null, flash: "" };

  function $(id) { return document.getElementById(id); }
  var esc = P.esc;

  /* ----- estilos (van aquí para que la cola sea un solo archivo) ----- */
  var css = document.createElement("style");
  css.textContent = [
    "button.badge.cola { cursor: pointer; color: var(--text); border-color: var(--line2); }",
    ".hdr .right button.badge.cola:not(.hidden) { display: inline-flex; } /* en ventanas angostas se esconden las demás insignias, la de la cola no */",
    "button.badge.cola.run { color: var(--gold-1); border-color: var(--acc-line); background: var(--acc-soft); }",
    "button.badge.cola .d { width: 8px; height: 8px; border-radius: 50%; background: var(--dim); }",
    "button.badge.cola.run .d { background: var(--gold-1); animation: cqp 1.2s ease-in-out infinite; }",
    "@keyframes cqp { 50% { opacity: .3; } }",
    ".cq { position: fixed; inset: 0; z-index: 94; background: rgba(5,6,7,.7); display: flex; justify-content: flex-end; }",
    ".cq-panel { width: min(560px, 100vw); height: 100%; overflow-y: auto; background: var(--bg2, #16181b); border-left: 1px solid var(--line2); padding: 20px 22px 28px; }",
    ".cq-head { display: flex; align-items: center; gap: 10px; }",
    ".cq-head h2 { flex: 1; margin: 0; font-size: 19px; }",
    ".cq-opts { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 14px 0 6px; padding: 12px 14px; border-radius: 12px; background: var(--acc-soft); border: 1px solid var(--acc-line); font-size: 13.5px; }",
    ".cq-opts label { display: flex; align-items: center; gap: 8px; cursor: pointer; }",
    ".cq-note { margin: 8px 0 14px; color: var(--dim); font-size: 12.5px; line-height: 1.5; }",
    ".cq-row { display: flex; gap: 12px; align-items: flex-start; padding: 12px 0; border-top: 1px solid var(--line); }",
    ".cq-row.flash { animation: cqf 1.6s ease-out; }",
    ".cq-row { cursor: pointer; border-radius: 10px; padding-left: 6px; padding-right: 6px; }",
    ".cq-row:hover { background: rgba(255,255,255,.03); }",
    ".cq-row.sel { background: var(--acc-soft); box-shadow: inset 3px 0 0 var(--gold-1); }",
    "@keyframes cqf { from { background: var(--acc-soft); } to { background: transparent; } }",
    ".cq-n { flex: none; width: 24px; height: 24px; border-radius: 12px; display: grid; place-items: center; background: var(--panel); color: var(--muted); font-size: 12px; font-weight: 700; }",
    ".cq-row.publicado .cq-n { background: rgba(110,231,160,.18); color: var(--ok); }",
    ".cq-row.error .cq-n, .cq-row.cancelado .cq-n { background: rgba(255,120,110,.16); color: var(--bad); }",
    ".cq-main { flex: 1; min-width: 0; }",
    ".cq-main b { display: block; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".cq-main small { display: block; margin-top: 3px; color: var(--muted); font-size: 12.5px; line-height: 1.4; }",
    ".cq-row.error .cq-main small { color: var(--bad); }",
    ".cq-row.publicado .cq-main small { color: var(--ok); }",
    ".cq-bar { height: 6px; margin-top: 8px; border-radius: 3px; background: rgba(255,255,255,.1); overflow: hidden; }",
    ".cq-bar i { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--gold-1), var(--acc2)); transition: width .4s; }",
    ".cq-bar.up i { background: var(--ok); }",
    ".cq-act { display: flex; gap: 4px; flex: none; }",
    ".cq-act button { height: 30px; min-width: 30px; padding: 0 9px; font-size: 12.5px; }",
    ".cq-empty { padding: 30px 0; color: var(--dim); text-align: center; font-size: 13.5px; }",
    ".cq-foot { display: flex; justify-content: space-between; gap: 10px; margin-top: 16px; }"
  ].join("\n");
  document.head.appendChild(css);

  /* ----- estado ----- */
  function set(v) {
    if (!v) { return; }
    C.items = v.items || [];
    C.pausa = !!v.pausa;
    C.auto = v.auto !== false;
    C.actual = v.actual || "";
    paint();
    kick();
    if (P.queueChanged) { P.queueChanged(); } // los botones de la pestaña 3 dependen de si hay cola
  }
  function load() { P.api("/api/cola").then(set, function () { /* sin servidor */ }); }

  /* eventos del render (los manda el servidor con el id de la película en «cola») */
  function onEvent(ev) {
    if (ev.type === "cola") { set(ev.cola); return; }
    if (ev.type === "cola-pub") { // el avance de una publicación que hace otra pestaña (o esta misma antes de recargar)
      var it = C.items.filter(function (i) { return i.id === ev.id; })[0];
      if (it) { it.pub = ev.pub; paint(); if (P.queuePub) { P.queuePub(ev.id); } }
      return;
    }
    if (!ev.cola) { return; }
    var r = C.render[ev.cola] || (C.render[ev.cola] = { n: 1, i: 0, pct: 0, left: 0 });
    if (ev.type === "start") { r.n = (ev.steps || []).length || 1; r.i = 0; r.pct = 0; }
    if (ev.type === "rung-start") { r.i = ev.index; r.pct = 0; }
    if (ev.type === "progress") { r.i = ev.index; r.pct = ev.pct; r.left = ev.left; }
    if (ev.type === "rung-done") { r.i = ev.index; r.pct = 100; }
    paint();
  }

  /* ----- vista: el botón de arriba y el panel ----- */
  var ESTADO = {
    espera: "En espera", renderizando: "Renderizando", renderizado: "Renderizada", publicando: "Publicando",
    publicado: "✓ Publicada en el grupo", error: "✖ Error", cancelado: "Cancelada"
  };
  function pendientes() { return C.items.filter(function (x) { return x.estado !== "publicado" && x.estado !== "cancelado"; }); }
  function rowText(x, pos) {
    var r = C.render[x.id];
    var p = C.pub[x.id] || x.pub; // el avance local (si esta página sube) o el que manda el servidor (si sube otra pestaña)
    if (x.estado === "espera") { return C.pausa ? "En espera · la cola está en pausa" : "En espera · #" + pos + " en la cola"; }
    if (x.estado === "renderizando") {
      if (!r) { return "Renderizando…"; }
      return "Renderizando " + Math.round(((r.i + r.pct / 100) / r.n) * 100) + " %" + (r.n > 1 ? " · versión " + (r.i + 1) + " de " + r.n : "") + (r.left ? " · faltan ~" + P.clock(r.left) : "");
    }
    if (x.estado === "renderizado") { return C.auto ? (P.T().peer ? "Lista · se publica en un momento" : "Lista · se publicará al entrar a Telegram y elegir el chat") : "Lista para publicar"; }
    if (x.estado === "publicando") {
      if (!p) { return "Publicando…"; }
      return "Publicando " + p.i + " de " + p.n + (p.total ? " · " + P.mb(p.done + p.sent) + " de " + P.mb(p.total) : "") + (p.speed ? " · " + p.speed : "");
    }
    if (x.estado === "error") { return "✖ " + (x.error || "Falló"); }
    if (x.estado === "publicado") { return "✓ Publicada en el grupo" + (p && p.skip ? " · " + p.skip + " ya estaban" : ""); }
    return ESTADO[x.estado] || x.estado;
  }
  function rowPct(x) {
    var r = C.render[x.id];
    var p = C.pub[x.id] || x.pub; // el avance local (si esta página sube) o el que manda el servidor (si sube otra pestaña)
    if (x.estado === "renderizando" && r) { return ((r.i + r.pct / 100) / r.n) * 100; }
    if (x.estado === "publicando" && p && p.total) { return ((p.done + p.sent) / p.total) * 100; }
    if (x.estado === "publicando" && p) { return (p.i / Math.max(1, p.n)) * 100; }
    return x.estado === "publicado" ? 100 : x.estado === "renderizado" ? 100 : 0;
  }
  function paint() {
    var btn = $("colaBtn");
    var pend = pendientes();
    var run = C.items.filter(function (x) { return x.estado === "renderizando" || x.estado === "publicando"; })[0];
    if (btn) {
      btn.classList.toggle("hidden", !C.items.length);
      btn.classList.toggle("run", !!run);
      btn.innerHTML = '<span class="d"></span>' + (run ? (run.estado === "publicando" ? "Publicando" : "Renderizando") + " · " + Math.round(rowPct(run)) + " %" + (pend.length > 1 ? " · cola " + pend.length : "") : "Cola · " + pend.length);
    }
    var box = $("cqBox");
    if (!box) { return; }
    var pos = 0;
    var rows = C.items.map(function (x, i) {
      if (x.estado === "espera") { pos += 1; }
      var pct = rowPct(x);
      var showBar = x.estado === "renderizando" || x.estado === "publicando";
      var act = "";
      if (x.estado === "espera") {
        act = '<button class="ghost" data-cq="up" data-id="' + x.id + '" title="Subir"' + (i === 0 ? " disabled" : "") + '>↑</button><button class="ghost" data-cq="down" data-id="' + x.id + '" title="Bajar"' + (i === C.items.length - 1 ? " disabled" : "") + '>↓</button>';
      }
      if (x.estado === "renderizado" && (!C.auto || !P.T().peer)) { act += '<button data-cq="pub" data-id="' + x.id + '"' + (C.busy || P.pubBusy() || !P.T().peer ? " disabled" : "") + ">Publicar</button>"; }
      if (x.estado === "error" || x.estado === "cancelado") { act += '<button data-cq="retry" data-id="' + x.id + '">Reintentar</button>'; }
      if (x.estado === "publicando") { act += '<button class="danger" data-cq="stop" data-id="' + x.id + '">Detener</button>'; }
      if (x.outDir && x.estado !== "espera") { act += '<button class="ghost" data-cq="open" data-id="' + x.id + '" title="Abrir la carpeta">📁</button>'; }
      if (x.estado !== "renderizando" && x.estado !== "publicando") { act += '<button class="ghost" data-cq="del" data-id="' + x.id + '" title="Quitar de la cola">✕</button>'; }
      return '<div class="cq-row ' + x.estado + (C.flash === x.id ? " flash" : "") + (P.viewing && P.viewing() === x.id ? " sel" : "") + '" data-row="' + x.id + '" title="Ver esta película en las pestañas 1 a 4"><span class="cq-n">' + (x.estado === "publicado" ? "✓" : i + 1) + '</span><div class="cq-main"><b title="' + esc(x.nombre) + '">' + esc(x.nombre) + "</b><small>" + esc(rowText(x, pos)) + "</small>" +
        (showBar ? '<div class="cq-bar' + (x.estado === "publicando" ? " up" : "") + '"><i style="width:' + pct.toFixed(1) + '%"></i></div>' : "") + '</div><div class="cq-act">' + act + "</div></div>";
    }).join("");
    box.innerHTML = '<div class="cq-panel"><div class="cq-head"><h2>Cola de películas</h2><button class="ghost" data-cq="close">Cerrar</button></div>' +
      '<div class="cq-opts"><label><input type="checkbox" id="cqAuto"' + (C.auto ? " checked" : "") + "> Publicar en el grupo al terminar de renderizar</label>" +
      '<label><input type="checkbox" id="cqPausa"' + (C.pausa ? " checked" : "") + "> Pausar la cola</label></div>" +
      '<div class="cq-note">Se renderizan una tras otra; mientras tanto puedes preparar la siguiente desde el paso 1 hasta el 3 y pulsar «＋ Agregar a la cola». <b>Toca una película</b> para ver sus datos y su avance en las pestañas 1 a 4. ' +
      "La publicación la hace esta ventana del navegador: <b>déjala abierta</b> (puede estar minimizada). Lo que ya está en el grupo no se sube dos veces.</div>" +
      (rows || '<div class="cq-empty">La cola está vacía. Prepara una película (pasos 1 a 3) y pulsa «Crear versiones».</div>') +
      '<div class="cq-foot"><button class="ghost" data-cq="speed"' + (C.speedBusy ? " disabled" : "") + ' title="Sube datos de prueba a Telegram (no se envía nada a ningún chat) y mide cuántos MB/s da este navegador">⚡ ' + (C.speedBusy ? "Midiendo…" : "Probar velocidad de subida") + "</button>" +
      (C.items.some(function (x) { return x.estado === "publicado"; }) ? '<button class="ghost" data-cq="clean">Quitar las publicadas</button>' : "<span></span>") + "</div>" +
      (C.speedText ? '<div class="cq-note cq-speed">' + esc(C.speedText) + "</div>" : "") + "</div>";
  }
  function open() {
    if ($("cqBox")) { return; }
    var el = document.createElement("div");
    el.id = "cqBox";
    el.className = "cq";
    document.body.appendChild(el);
    el.addEventListener("click", onClick);
    el.addEventListener("change", function (e) {
      if (e.target.id === "cqAuto") { P.api("/api/cola/auto", { auto: e.target.checked }).then(set); }
      if (e.target.id === "cqPausa") { P.api("/api/cola/pausa", { pausa: e.target.checked }).then(set); }
    });
    paint();
  }
  function close() { var el = $("cqBox"); if (el) { el.remove(); } }
  function onClick(e) {
    if (e.target.id === "cqBox") { close(); return; }
    var b = e.target.closest("[data-cq]");
    if (!b) {
      var rowEl = e.target.closest("[data-row]");
      var sel = rowEl && C.items.filter(function (i) { return i.id === rowEl.getAttribute("data-row"); })[0];
      if (sel && P.viewQueue) {
        P.viewQueue(sel, sel.estado === "espera" ? 1 : sel.estado === "renderizando" ? 3 : 4);
        close();
      }
      return;
    }
    var what = b.getAttribute("data-cq");
    var id = b.getAttribute("data-id");
    var x = C.items.filter(function (i) { return i.id === id; })[0];
    if (what === "close") { close(); }
    if (what === "up" || what === "down") { P.api("/api/cola/mover", { id: id, dir: what === "up" ? -1 : 1 }).then(set); }
    if (what === "del") { P.api("/api/cola/quitar", { id: id }).then(set, function (er) { alert(er.message); }); }
    if (what === "retry") { P.api("/api/cola/reintentar", { id: id }).then(set); }
    if (what === "clean") { P.api("/api/cola/limpiar", {}).then(set); }
    if (what === "speed") { speed(); }
    if (what === "open" && x) { P.api("/api/open", { path: x.outDir }); }
    if (what === "pub" && x) { publish(x); }
    if (what === "stop" && C.abort) { C.abort.abort(); }
  }
  document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("#colaBtn")) { open(); } });

  /* «⚡ Probar velocidad de subida»: mide lo que sube ESTE navegador a Telegram con datos al azar (no se envía nada a ningún chat).
   * Sirve para saber si la lentitud de una publicación viene del navegador/internet o de otra cosa (disco, antivirus, otro programa). */
  function speed() {
    var T = P.T();
    if (C.speedBusy) { return; }
    var say = function (t) { C.speedText = t; paint(); };
    if (!T.client) { say("Esta pestaña no tiene la sesión de Telegram (solo una pestaña la usa): hazlo en la que publica."); return; }
    if (C.busy || P.pubBusy()) { say("Hay una publicación en marcha: espera a que termine para medir sin estorbarla."); return; }
    C.speedBusy = true;
    say("Subiendo datos de prueba a Telegram (no se envía nada a ningún chat)…");
    P.speedTest(function (t) { C.speedText = t; paint(); }).then(function (r) { C.speedBusy = false; say(r); }, function (e) { C.speedBusy = false; say("No se pudo medir: " + P.errText(e)); });
  }

  /* ----- publicación automática ----- */
  var fixing = false;
  function kick() {
    if (C.busy || P.pubBusy() || fixing) { return; }
    var T = P.T();
    if (!T.client || !T.peer) { return; }
    /* Una película en «publicando» cuando ESTA página (la única que tiene la sesión de Telegram) no está publicando nada quedó huérfana:
     * la página que la subía se cerró o se recargó (por ejemplo al actualizar el preparador) y el servidor no se entera. Antes se quedaba
     * así para siempre —y las siguientes esperando— hasta reiniciar el preparador. Se devuelve a «renderizada» y se vuelve a publicar
     * (lo que ya está en el grupo no se repite). */
    var huerfana = C.items.filter(function (i) { return i.estado === "publicando"; })[0];
    if (huerfana) {
      fixing = true;
      P.api("/api/cola/estado", { id: huerfana.id, estado: "renderizado" }).then(function (v) { fixing = false; set(v); }, function () { fixing = false; });
      return;
    }
    if (!C.auto) { return; }
    var x = C.items.filter(function (i) { return i.estado === "renderizado"; })[0];
    if (x) { publish(x); }
  }
  setInterval(kick, 5000); // por si Telegram se conectó o se eligió el chat después

  /* lo que ya está en el grupo (como «checkExisting» de la pestaña 4) */
  function existing(T) {
    var ex = { videos: {}, photos: {}, thumbs: {}, sizes: {}, subs: {} };
    var peers = [T.peer].concat(T.oldPeer ? [T.oldPeer] : []);
    return Promise.all([VIDEO_F, DOCS_F, PHOTO_F].map(function (f) {
      return Promise.all(peers.map(function (pp) { return T.client.searchMessages({ chatId: pp, filter: f, limit: 100 }); }))
        .then(function (lists) { return [].concat.apply([], lists); });
    })).then(function (res) {
      res[0].concat(res[1]).forEach(function (m) {
        var d = m.media;
        if (d && d.fileName) { ex.videos[d.fileName + "|" + d.fileSize] = m.id; }
        if (d && d.fileSize > 50 * 1048576) { ex.sizes[d.fileSize] = m.id; }
        if (d && /miniaturas[\s_]+\d+s[\s_]+\d+x\d+[\s_]+\d+x\d+[\s_]+hoja[\s_]+\d+[\s_]+de[\s_]+\d+\.jpe?g$/i.test(d.fileName || "")) { ex.thumbs[String(m.text || "").trim()] = m.id; }
        if (d && /\.(srt|vtt|ass|ssa)$/i.test(d.fileName || "")) { ex.subs[P.subKey(m.text, d.fileName)] = m.id; }
      });
      res[2].forEach(function (m) { ex.photos[String(m.text || "").trim()] = m.id; });
      return ex;
    });
  }

  /* qué se sube de una carpeta: miniaturas, portada, banner y versiones (sin lo que ya está en el grupo) */
  function plan(r, cap, thumbs, ex, T) {
    var movie = cap.type !== "series";
    var head = movie ? "pelicula#" + cap.name + (cap.year ? " (" + cap.year + ")" : "") : "serie#" + cap.name;
    var base = (movie ? cap.name + (cap.year ? " (" + cap.year + ")" : "") : cap.name + " T" + (cap.season || 1) + "E" + (cap.episode || 1)).replace(/[#\\/:*?"<>|]/g, "").trim() || "Video";
    var maxBytes = (T.me && T.me.isPremium ? 4000 : 2000) * 1048576;
    var list = [];
    var skip = 0;
    var skipped = [];
    if (thumbs && thumbs.sheets && thumbs.sheets.length) {
      var tcap = (movie ? head : "serie(" + (cap.season || 1) + "/" + (cap.episode || 1) + ")#" + cap.name) + " #miniaturas";
      if (ex.thumbs[tcap]) { skip += 1; skipped.push("thumbs"); } else { list.push({ kind: "thumbs", thumbs: thumbs, caption: tcap, base: base, key: "thumbs" }); }
    }
    ["portada", "banner", "vertical", "capitulo", "capitulos"].forEach(function (k) {
      if (!r.images[k]) { return; }
      /* capitulo: la de este capítulo (serie(1/3)#…); capitulos: una común a todos (serie#…); las dos llevan #capitulo */
      var pc = k === "capitulo" ? "serie(" + (cap.season || 1) + "/" + (cap.episode || 1) + ")#" + cap.name + " #capitulo" : k === "capitulos" ? head + " #capitulo" : head + " #" + k;
      if (ex.photos[pc]) { skip += 1; skipped.push("img-" + k); } else { list.push({ kind: "photo", img: r.images[k], caption: pc, key: "img-" + k }); }
    });
    /* escenas de la galería: una foto por escena, con #galeria1, #galeria2… */
    (r.images.galeria || []).forEach(function (g) {
      var gc = head + " #galeria" + g.num;
      if (ex.photos[gc]) { skip += 1; skipped.push("img-galeria-" + g.num); } else { list.push({ kind: "photo", img: g, caption: gc, key: "img-galeria-" + g.num }); }
    });
    /* subtítulos aparte: uno por idioma, para todas las calidades (también las que ya estaban en el grupo) */
    (r.subs || []).forEach(function (x) {
      var scap = (movie ? head : "serie(" + (cap.season || 1) + "/" + (cap.episode || 1) + ")#" + cap.name) + " #subs-" + (x.lang || "und") + (x.forced ? "-f" : "");
      if (ex.subs[P.subKey(scap, x.name)]) { skip += 1; skipped.push("sub-" + x.id); return; }
      var ext = (/\.[a-z]{3}$/i.exec(x.name) || [".srt"])[0];
      var at = x.name.lastIndexOf("." + x.lang + ".");
      list.push({ kind: "sub", sub: x, caption: scap, key: "sub-" + x.id, fileName: P.tgShort(base, at >= 0 ? x.name.slice(at, x.name.length - ext.length) : "." + x.lang, ext) });
    });
    r.files.forEach(function (f) {
      if (ex.videos[f.name + "|" + f.size] || ex.videos[P.tgName(f.name) + "|" + f.size] || ex.sizes[f.size]) { skip += 1; skipped.push("v" + f.id); return; }
      if (f.size > maxBytes) { throw new Error("«" + f.name + "» pesa " + P.mb(f.size) + ", más de lo que Telegram acepta."); }
      list.push({ kind: "video", f: f, caption: r.caption, key: "v" + f.id });
    });
    return { list: list, skip: skip, skipped: skipped };
  }

  function publish(x) {
    var T = P.T();
    if (C.busy || P.pubBusy() || !T.client || !T.peer) { return; }
    C.busy = true;
    P.setPubBusy(true);
    C.abort = new AbortController();
    var signal = C.abort.signal;
    var p = C.pub[x.id] = { i: 0, n: 0, done: 0, sent: 0, total: 0, speed: "", skip: 0 };
    x.estado = "publicando";
    paint();
    P.api("/api/cola/estado", { id: x.id, estado: "publicando" }).then(function () {
      return P.api("/api/versions", { dir: x.outDir });
    }).then(function (r) {
      var cap = r.caption && window.HFLibrary ? HFLibrary.parseCaption(r.caption) : null;
      if (!cap) { throw new Error("La carpeta no tiene el comentario de la película (COMO-SUBIR.txt)."); }
      var th = r.thumbs ? Promise.resolve(r.thumbs) : r.files.length ? P.api("/api/thumbs", { dir: x.outDir }).then(null, function () { return null; }) : Promise.resolve(null);
      return Promise.all([th, guard(existing(T), STALL_SMALL, "revisar lo que ya está en el grupo")]).then(function (res) { return { r: r, cap: cap, thumbs: res[0], ex: res[1] }; });
    }).then(function (d) {
      var pl = plan(d.r, d.cap, d.thumbs, d.ex, T);
      p.n = pl.list.length;
      p.skip = pl.skip;
      pl.skipped.forEach(function (k) { prog(x.id, k, { state: "listo", on: false, dup: true }); });
      pl.list.forEach(function (it) { prog(x.id, it.key, { state: "", on: true }); });
      p.total = pl.list.reduce(function (n, it) { return n + (it.f ? it.f.size : SMALL); }, 0);
      return upload(pl.list, T, p, signal, x.id);
    }).then(function () {
      x.estado = "publicado";
      return P.api("/api/cola/estado", { id: x.id, estado: "publicado" });
    }, function (e) {
      x.estado = "error";
      var msg = signal.aborted ? "Detenida: pulsa Reintentar para seguir (lo que ya subió no se repite)." : P.errText(e);
      return P.api("/api/cola/estado", { id: x.id, estado: "error", error: msg });
    }).then(set, function () { /* nada */ }).then(function () {
      C.busy = false;
      C.abort = null;
      P.setPubBusy(false);
      paint();
      setTimeout(kick, 500);
    });
  }

  /* la subida, igual que «Publicar» de la pestaña 4 (videos con streaming, miniaturas en álbumes de 10) */
  /* estado de cada archivo de lo que ESTA página sube: PK[id][key] = {state, sent, speed, error}. Además de pintarlo aquí, se manda al servidor
   * (cada cambio de estado enseguida y el avance de bytes cada ~0,8 s) para que cualquier pestaña —o esta misma tras recargar— lo vea. */
  var PK = {};
  var SMALL = 1048576; // lo que pesa en la barra una imagen, un subtítulo o un álbum de miniaturas
  var pubLast = 0;
  var pubTimer = null;
  function sendPub(id, now) {
    var p = C.pub[id];
    if (!p) { return; }
    var go = function () {
      pubTimer = null;
      pubLast = Date.now();
      P.api("/api/cola/progreso", { id: id, pub: { i: p.i, n: p.n, done: p.done, sent: p.sent, total: p.total, speed: p.speed, skip: p.skip, keys: PK[id] || {} } }).then(null, function () { /* sin servidor */ });
    };
    if (now || Date.now() - pubLast > 800) { clearTimeout(pubTimer); go(); }
    else if (!pubTimer) { pubTimer = setTimeout(go, 800); }
  }
  function prog(id, key, patch) {
    if (!key) { return; }
    var m = PK[id] || (PK[id] = {});
    m[key] = Object.assign(m[key] || {}, patch);
    if (P.qprog) { P.qprog(id, key, patch); }
    sendPub(id, patch.state !== "subiendo");
  }

  /* Telegram a veces deja una petición colgada sin responder ni fallar (conexión caída a medias, red que se cortó un momento): antes la
   * publicación se quedaba esperando para siempre —«Publicando 1 de 8 · 0 MB» sin moverse— y las demás películas detrás. Ahora cada
   * llamada tiene un tiempo máximo (y los videos, un tiempo máximo SIN avanzar): si se cumple, se reintenta el archivo hasta 3 veces
   * (lo que ya llegó al grupo se reconoce y no se repite) y, si sigue sin responder, la película queda en error con el motivo. */
  var STALL_SMALL = 90000; // una foto, un subtítulo o un álbum de miniaturas: sin respuesta de Telegram en este tiempo
  var STALL_VIDEO = 120000; // un video: sin avanzar un solo byte en este tiempo
  var TRIES = 3;
  function stalled(what, ms) {
    var e = new Error("Telegram no respondió en " + Math.round(ms / 1000) + " s (" + what + ")");
    e.stalled = true;
    return e;
  }
  function guard(promise, ms, what) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(stalled(what, ms)); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (er) { clearTimeout(t); reject(er); });
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function upload(list, T, p, signal, qid) {
    var c = T.client;
    var peer = T.peer;
    var t0 = Date.now();
    for (var i = 0; i < list.length; i += 1) {
      var it = list[i];
      if (signal.aborted) { throw new Error("Detenida"); }
      p.i = i + 1;
      p.sent = 0;
      paint();
      var since = Date.now() - 120000;
      var sentStage = false;
      var done = false;
      for (var attempt = 1; !done; attempt += 1) {
        p.sent = 0;
        prog(qid, it.key, { state: "subiendo", sent: 0, error: attempt > 1 ? "Telegram no respondía: reintento " + attempt + " de " + TRIES + "…" : "" });
        try {
          await sendOne(it, c, peer, p, qid, signal, function () { sentStage = true; });
          done = true;
        } catch (e) {
          if (signal.aborted && !e.stalled) { throw e; }
          /* Telegram pudo haberlo publicado y fallar después: si ya está en el grupo, cuenta como hecho */
          if (sentStage && await P.landed(it, since)) { done = true; break; }
          if (e.stalled && attempt < TRIES && !signal.aborted) { await sleep(4000); continue; }
          prog(qid, it.key, { state: "error", error: P.errText(e) });
          throw e;
        }
      }
      prog(qid, it.key, { state: "listo", on: false });
      if (it.f) { p.sent = 0; } else { p.done += SMALL; }
    }
    p.speed = "";
    p.time = Date.now() - t0;
  }

  /* un archivo de la lista, con sus tiempos máximos; marca con «sent()» el momento en que ya empezó a salir hacia el grupo */
  async function sendOne(it, c, peer, p, qid, signal, sent) {
    if (it.kind === "thumbs") {
      var th = it.thumbs;
      var sheets = [];
      for (var si = 0; si < th.sheets.length; si += 1) { sheets.push(await guard(P.readBytes("/api/media/" + th.sheets[si].id), STALL_SMALL, "leer la hoja " + (si + 1))); }
      sent();
      for (var g0 = 0; g0 < sheets.length; g0 += 10) {
        await guard(c.sendMediaGroup(peer, sheets.slice(g0, g0 + 10).map(function (b, j) {
          var n = g0 + j + 1;
          return { type: "document", file: b, fileMime: "image/jpeg", caption: it.caption,
            fileName: P.tgShort(it.base, " miniaturas " + th.every + "s " + th.w + "x" + th.h + " " + th.cols + "x" + th.rows + " hoja " + n + " de " + th.sheets.length, ".jpg") };
        })), STALL_SMALL, "enviar las miniaturas");
      }
    } else if (it.kind === "photo") {
      var bytes = await guard(P.readBytes("/api/media/" + it.img.id), STALL_SMALL, "leer la imagen");
      sent();
      await guard(c.sendMedia(peer, { type: "photo", file: bytes, fileName: it.key.slice(4) + ".jpg", caption: it.caption }), STALL_SMALL, "enviar la imagen");
    } else if (it.kind === "sub") {
      var sb = await guard(P.readBytes("/api/media/" + it.sub.id), STALL_SMALL, "leer el subtítulo");
      sent();
      await guard(c.sendMedia(peer, { type: "document", file: sb, fileName: it.fileName, fileMime: "text/plain", caption: it.caption }), STALL_SMALL, "enviar el subtítulo");
    } else {
      var f = it.f;
      /* el video: si pasan STALL_VIDEO sin que avance ni un byte, se corta esta subida (y el llamador la reintenta) */
      var ctl = new AbortController();
      var onStop = function () { ctl.abort(); };
      signal.addEventListener("abort", onStop);
      var lastMove = Date.now();
      var hung = false;
      var dog = setInterval(function () {
        if (Date.now() - lastMove > STALL_VIDEO) { hung = true; ctl.abort(); }
      }, 5000);
      try {
        var res = await guard(fetch("/api/media/" + f.id), STALL_SMALL, "abrir el video");
        var tStart = Date.now();
        var up = await c.uploadFile({
          file: res.body, fileSize: f.size, fileName: P.tgName(f.name), fileMime: f.mime, abortSignal: ctl.signal,
          progressCallback: function (u) {
            lastMove = Date.now();
            var secs = (Date.now() - tStart) / 1000;
            var rate = secs > 1 ? u / secs : 0;
            p.sent = u;
            p.speed = rate ? (rate / 1048576).toFixed(1) + " MB/s" : "";
            prog(qid, it.key, { state: "subiendo", sent: u, speed: rate ? (rate / 1048576).toFixed(1) + " MB/s · faltan ~" + P.clock((f.size - u) / rate) : "" });
            paint();
          }
        });
        p.done += f.size;
        p.sent = 0;
        sent();
        var thumb = f.thumb ? await guard(P.readBytes("/api/media/" + f.thumb), STALL_SMALL, "leer la miniatura") : undefined;
        try {
          await guard(c.sendMedia(peer, f.mime === "video/mp4" ?
            { type: "video", file: up, thumb: thumb, fileName: P.tgName(f.name), fileMime: f.mime, duration: f.duration, width: f.width, height: f.height, supportsStreaming: true, caption: it.caption } :
            { type: "document", file: up, thumb: thumb, fileName: P.tgName(f.name), fileMime: f.mime, caption: it.caption }), STALL_VIDEO, "publicar el video");
        } catch (e2) { p.done -= f.size; throw e2; } // si falla al publicar, el reintento vuelve a subirlo: que no cuente doble en la barra
      } catch (e) {
        if (hung && !signal.aborted) { throw stalled("la subida de «" + f.name + "» no avanzó", STALL_VIDEO); }
        throw e;
      } finally {
        clearInterval(dog);
        signal.removeEventListener("abort", onStop);
      }
    }
  }

  window.COLA = {
    set: set,
    onEvent: onEvent,
    auto: function () { return C.auto; },
    /* cuántas películas están esperando o renderizándose (con eso, el botón de envío pasa de «Crear versiones» a «＋ Agregar a la cola») */
    pending: function () { return C.items.filter(function (x) { return x.estado === "espera" || x.estado === "renderizando"; }).length; },
    all: function () { return C.items.slice(); },
    item: function (id) { return C.items.filter(function (x) { return x.id === id; })[0] || null; },
    /* la película de la cola que publica esa carpeta (para que la pestaña 4 no la vuelva a subir) */
    owner: function (dir) {
      var k = function (d) { return String(d || "").replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase(); };
      return C.items.filter(function (x) { return x.outDir && k(x.outDir) === k(dir) && x.estado !== "error" && x.estado !== "cancelado" && (C.auto || x.estado === "publicando" || x.estado === "publicado"); })[0] || null;
    },
    text: function (x) { var pos = 0; C.items.some(function (y) { if (y.estado === "espera") { pos += 1; } return y === x; }); return rowText(x, pos); },
    pct: function (x) { return rowPct(x); },
    flash: function (id) { C.flash = id; paint(); setTimeout(function () { C.flash = ""; }, 1800); },
    open: open
  };
  load();
})();
