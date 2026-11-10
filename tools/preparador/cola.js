/* HomeFlix · preparador · cola de películas.
 *
 * Se encolan varias películas («＋ A la cola» o «Crear versiones»); el servidor las renderiza una tras otra
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
  }
  function load() { P.api("/api/cola").then(set, function () { /* sin servidor */ }); }

  /* eventos del render (los manda el servidor con el id de la película en «cola») */
  function onEvent(ev) {
    if (ev.type === "cola") { set(ev.cola); return; }
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
    var p = C.pub[x.id];
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
    var p = C.pub[x.id];
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
      '<div class="cq-note">Se renderizan una tras otra; mientras tanto puedes preparar la siguiente en la pestaña 1 y pulsar «＋ A la cola». <b>Toca una película</b> para ver sus datos y su avance en las pestañas 1 a 4. ' +
      "La publicación la hace esta ventana del navegador: <b>déjala abierta</b> (puede estar minimizada). Lo que ya está en el grupo no se sube dos veces.</div>" +
      (rows || '<div class="cq-empty">La cola está vacía. Prepara una película en la pestaña 1 y pulsa «＋ A la cola».</div>') +
      (C.items.some(function (x) { return x.estado === "publicado"; }) ? '<div class="cq-foot"><span></span><button class="ghost" data-cq="clean">Quitar las publicadas</button></div>' : "") + "</div>";
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
    if (what === "open" && x) { P.api("/api/open", { path: x.outDir }); }
    if (what === "pub" && x) { publish(x); }
    if (what === "stop" && C.abort) { C.abort.abort(); }
  }
  document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("#colaBtn")) { open(); } });

  /* ----- publicación automática ----- */
  function kick() {
    if (!C.auto || C.busy || P.pubBusy()) { return; }
    var T = P.T();
    if (!T.client || !T.peer) { return; }
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
    ["portada", "banner"].forEach(function (k) {
      if (!r.images[k]) { return; }
      var pc = head + " #" + k;
      if (ex.photos[pc]) { skip += 1; skipped.push("img-" + k); } else { list.push({ kind: "photo", img: r.images[k], caption: pc, key: "img-" + k }); }
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
      return Promise.all([th, existing(T)]).then(function (res) { return { r: r, cap: cap, thumbs: res[0], ex: res[1] }; });
    }).then(function (d) {
      var pl = plan(d.r, d.cap, d.thumbs, d.ex, T);
      p.n = pl.list.length;
      p.skip = pl.skip;
      pl.skipped.forEach(function (k) { prog(x.id, k, { state: "listo", on: false, dup: true }); });
      pl.list.forEach(function (it) { prog(x.id, it.key, { state: "", on: true }); });
      p.total = pl.list.reduce(function (n, it) { return n + (it.f ? it.f.size : 0); }, 0);
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
  function prog(id, key, patch) { if (P.qprog && key) { P.qprog(id, key, patch); } }

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
      prog(qid, it.key, { state: "subiendo", sent: 0, error: "" });
      try {
        if (it.kind === "thumbs") {
          var th = it.thumbs;
          var sheets = [];
          for (var si = 0; si < th.sheets.length; si += 1) { sheets.push(await P.readBytes("/api/media/" + th.sheets[si].id)); }
          sentStage = true;
          for (var g0 = 0; g0 < sheets.length; g0 += 10) {
            await c.sendMediaGroup(peer, sheets.slice(g0, g0 + 10).map(function (b, j) {
              var n = g0 + j + 1;
              return { type: "document", file: b, fileMime: "image/jpeg", caption: it.caption,
                fileName: P.tgShort(it.base, " miniaturas " + th.every + "s " + th.w + "x" + th.h + " " + th.cols + "x" + th.rows + " hoja " + n + " de " + th.sheets.length, ".jpg") };
            }));
          }
        } else if (it.kind === "photo") {
          var bytes = await P.readBytes("/api/media/" + it.img.id);
          sentStage = true;
          await c.sendMedia(peer, { type: "photo", file: bytes, fileName: it.key.slice(4) + ".jpg", caption: it.caption });
        } else if (it.kind === "sub") {
          var sb = await P.readBytes("/api/media/" + it.sub.id);
          sentStage = true;
          await c.sendMedia(peer, { type: "document", file: sb, fileName: it.fileName, fileMime: "text/plain", caption: it.caption });
        } else {
          var f = it.f;
          var res = await fetch("/api/media/" + f.id);
          var tStart = Date.now();
          var up = await c.uploadFile({
            file: res.body, fileSize: f.size, fileName: P.tgName(f.name), fileMime: f.mime, abortSignal: signal,
            progressCallback: function (u) {
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
          sentStage = true;
          var thumb = f.thumb ? await P.readBytes("/api/media/" + f.thumb) : undefined;
          await c.sendMedia(peer, f.mime === "video/mp4" ?
            { type: "video", file: up, thumb: thumb, fileName: P.tgName(f.name), fileMime: f.mime, duration: f.duration, width: f.width, height: f.height, supportsStreaming: true, caption: it.caption } :
            { type: "document", file: up, thumb: thumb, fileName: P.tgName(f.name), fileMime: f.mime, caption: it.caption });
        }
        prog(qid, it.key, { state: "listo", on: false });
      } catch (e) {
        /* Telegram pudo haberlo publicado y fallar después: si ya está en el grupo, cuenta como hecho */
        if (!(sentStage && await P.landed(it, since))) {
          prog(qid, it.key, { state: "error", error: P.errText(e) });
          throw e;
        }
        prog(qid, it.key, { state: "listo", on: false });
      }
    }
    p.speed = "";
    p.time = Date.now() - t0;
  }

  window.COLA = {
    set: set,
    onEvent: onEvent,
    auto: function () { return C.auto; },
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
