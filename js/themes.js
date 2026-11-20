/* HomeFlix web · APARIENCIAS (temas) — solo se carga con ?web=1 (computador). Las demás pantallas siguen igual: un tema cambia el «lobby» (el inicio).
 *
 * Se elige en Ajustes › «Apariencia». Hoy: Clásica (la de siempre) y Plaza Celeste (inspirada en un menú de canales); Cobalto y Esmeralda quedan anunciadas («Próximamente»). Nombres propios: nunca el de una marca.
 * Cada tema pone `data-theme="<id>"` en <html> (el estilo vive en css/themes.css) y, si cambia la estructura del lobby, un dibujante propio que
 * se engancha a renderBrowse (js/ui/library.js) sin tocar el motor: usa los mismos datos (continuar viendo, recientes, Mi lista…), las mismas
 * áreas del motor de foco y la misma ficha al elegir un título. Se guarda en este navegador (localStorage «hf.theme»).
 *
 * Para agregar un tema: una entrada en TEMAS (listo: true), su CSS en css/themes.css y, si cambia la estructura, un dibujante parecido a renderWii. */
(function () {
  "use strict";
  if (!window.HF_WEB && !/[?&]web=1/.test(location.search)) { return; }

  var KEY = "hf.theme";
  var TEMAS = [
    { id: "clasica", nombre: "Clásica", desc: "El aspecto de siempre: destacado grande y filas de títulos.", listo: true },
    { id: "wii", nombre: "Plaza Celeste", desc: "Plaza de canales: cuadrícula clara de títulos por páginas, reloj y botones redondos.", listo: true },
    { id: "ps5", nombre: "Cobalto", desc: "Fondo azul a pantalla completa con una fila de títulos abajo.", listo: false },
    { id: "xbox", nombre: "Esmeralda", desc: "Inicio verde con mosaicos y el último título destacado.", listo: false }
  ];

  function tema(id) { var i; for (i = 0; i < TEMAS.length; i += 1) { if (TEMAS[i].id === id) { return TEMAS[i]; } } return null; }
  function actual() {
    var v = "";
    try { v = window.localStorage.getItem(KEY) || ""; } catch (e) { v = ""; }
    return tema(v) && tema(v).listo ? v : "clasica";
  }
  function pon(id) {
    document.documentElement.setAttribute("data-theme", id);
    try { window.localStorage.setItem(KEY, id); } catch (e) { /* sin guardar */ }
  }
  document.documentElement.setAttribute("data-theme", actual());

  function esWii() { return actual() === "wii"; }

  /* ===================== Wii: el menú de canales ===================== */

  var COLS = 4;
  var FILAS = 3;
  var POR_PAGINA = COLS * FILAS;
  var wii = { pagina: {}, filtro: {}, ultimaRueda: 0, reloj: null, enDetalle: false };
  var SECCIONES = { home: 1, movies: 1, series: 1, mylist: 1, anime: 1 };

  function seccionWii() {
    var s = browse.section;
    if (!esWii() || !SECCIONES[s]) { return false; }
    if (s === "mylist") { return true; }
    if (s === "anime") { return !!(HFAnime.hasFeed && HFAnime.hasFeed()); }
    return !!(library.recent.length || library.unclassified.length);
  }

  function grupoDe(e) { return e.type === "episode" ? e.seriesKey : (e.titleKey || e.key); }
  function sinRepetir(lista) {
    var vistos = {};
    return lista.filter(function (e) {
      var g;
      if (!e) { return false; }
      g = grupoDe(e);
      if (vistos[g]) { return false; }
      vistos[g] = true;
      return true;
    });
  }
  function porFecha(a, b) { return (b.date || 0) - (a.date || 0); }

  /* Todo lo de la sección, sin repetir, en el orden en que se quiere ver (lo que se está viendo primero). */
  function baseWii(seccion) {
    var l = [];
    if (seccion === "home") {
      l = continueWatching().concat(myListTitles(), library.recent, library.movies.concat(library.series).sort(porFecha), library.unclassified.slice(0, 40));
    } else if (seccion === "movies") {
      l = library.movies.slice().sort(porFecha);
    } else if (seccion === "series") {
      l = library.series.slice().sort(porFecha);
    } else if (seccion === "mylist") {
      l = myListTitles();
    } else if (seccion === "anime") {
      l = continueWatching().filter(function (e) { return e.anime; });
      HFAnime.rows().forEach(function (r) { l = l.concat(r.titles); });
    }
    return sinRepetir(l);
  }

  /* Las categorías que se pueden elegir en el botón de abajo a la izquierda: [{id, nombre, items}] (la primera es «Todo»). */
  function opcionesWii(seccion) {
    var ops = [{ id: "todo", nombre: "Todo", items: baseWii(seccion) }];
    var pool;
    function add(id, nombre, lista) {
      lista = sinRepetir(lista);
      if (lista.length) { ops.push({ id: id, nombre: nombre, items: lista }); }
    }
    if (seccion === "home") {
      add("continuar", "Continuar viendo", continueWatching());
      add("lista", "Mi lista", myListTitles());
      add("recientes", "Agregados recientemente", library.recent.slice(0, 20));
      add("peliculas", "Películas", library.movies.slice().sort(porFecha));
      add("series", "Series", library.series.slice().sort(porFecha));
    }
    if (seccion === "movies" || seccion === "series" || seccion === "home") {
      pool = (seccion === "movies" ? library.movies : seccion === "series" ? library.series : library.movies.concat(library.series)).slice().sort(porFecha);
      if (!currentProfileIsKids()) { add("infantil", "Infantil", pool.filter(function (t) { return t.kids; })); }
      categoryRows(pool, "w", false).forEach(function (r) { add("c:" + r[0], r[1], r[2]); });
    }
    if (seccion === "anime") {
      HFAnime.rows().forEach(function (r) { add("a:" + r.id, r.name, r.titles); });
    }
    return ops;
  }

  function filtroDe(seccion) {
    var id = wii.filtro[seccion] || "todo";
    var ops = opcionesWii(seccion);
    var op = ops.filter(function (o) { return o.id === id; })[0] || ops[0];
    return { op: op, ops: ops };
  }

  /* Lo que se ve en la cuadrícula: la sección entera o la categoría elegida. */
  function itemsWii(seccion) { return filtroDe(seccion).op.items; }

  function teselaHtml(e, i) {
    var nombre = e.type === "episode" ? e.seriesName : e.name;
    var sub = e.type === "episode" ? epTag(e) + " · " + e.title : titleMeta(e);
    var etiqueta = e.type === "movie" ? "Película" : e.type === "series" ? (e.anime ? "Anime" : "Serie") : e.type === "episode" ? epTag(e) : "Sin clasificar";
    var ref = e.type === "episode" || e.type === "video" ? "v:" + e.key : "t:" + e.titleKey;
    var img = e.type === "episode" ? (e.coverKey || e.key) : e.type === "video" ? e.key : (e.bannerKey || e.imageKey);
    var prog = e.type === "episode" || e.type === "movie" ? progressInfo(entryVideoKey(e)) : null;
    return '<div class="wii-tile" data-focusable="true" data-ref="' + esc(ref) + '" data-title="' + esc(nombre) + '" data-description="' + esc(nombre + (sub ? " · " + sub : "")) + '" tabindex="0">' +
      '<div class="wii-art hf2-img"' + (img ? ' data-img="' + esc(img) + '" data-img-w="640"' : "") + ">" + fallbackArt(img || nombre, "c") + "</div>" +
      '<span class="wii-chip">' + esc(etiqueta) + "</span>" + (e.kids ? '<span class="wii-kids">' + IC.star + "</span>" : "") +
      '<div class="wii-cap"><b>' + esc(nombre) + "</b><small>" + esc(sub) + "</small></div>" +
      (prog ? '<span class="wii-prog"><i style="width:' + prog.pct + '%"></i></span>' : "") + "</div>";
  }

  function paginaHtml(items, pagina) {
    var ini = pagina * POR_PAGINA;
    var html = "";
    var i;
    for (i = 0; i < POR_PAGINA; i += 1) {
      html += items[ini + i] ? teselaHtml(items[ini + i], i) : '<div class="wii-tile empty"><span>HomeFlix</span></div>';
    }
    return '<div class="wii-page" data-page="' + pagina + '">' + html + "</div>";
  }

  function filtroHtml(seccion) {
    var id = wii.filtro[seccion];
    var op;
    if (!id || id === "todo") { return ""; }
    op = filtroDe(seccion).op;
    return '<div class="wii-filtro" data-wii-quitar="1" title="Quitar el filtro"><span>Categoría</span><b>' + esc(op.nombre) + "</b><i>×</i></div>";
  }

  function totalPaginas(items) { return Math.max(1, Math.ceil(items.length / POR_PAGINA)); }

  function puntosHtml(total, pagina) {
    var s = "";
    var i;
    if (total < 2) { return ""; }
    for (i = 0; i < total; i += 1) { s += '<i data-wii-page="' + i + '"' + (i === pagina ? ' class="on"' : "") + "></i>"; }
    return '<div class="wii-dots">' + s + "</div>";
  }

  /* La curva de la referencia: bordes altos y planos que se hunden en un fondo ancho y redondo bajo el reloj */
  var CURVA = "M0 30 C 330 30, 610 124, 960 124 C 1310 124, 1590 30, 1920 30";
  var ICONO_CATEGORIAS = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></svg>';
  function barraHtml(busqueda) {
    var h = '<div class="wii-bar">' +
      '<svg class="wii-curve" viewBox="0 0 1920 250" preserveAspectRatio="none"><path class="fill" d="' + CURVA + ' L1920 250 L0 250 Z"/><path class="line" d="' + CURVA + '"/></svg>' +
      '<div class="wii-btn left" data-focusable="true" data-wii="categorias" data-title="Categorías" data-description="Elegir qué categoría mostrar" tabindex="0">' + ICONO_CATEGORIAS + "</div>" +
      '<div class="wii-sd" data-focusable="true" data-menu="mylist" data-title="Mi lista" data-description="Lo que guardaste para ver después" tabindex="0">' +
        '<svg viewBox="0 0 24 30" fill="none" stroke-width="1.6" stroke-linejoin="round"><path d="M3 4a2 2 0 012-2h9l7 7v17a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M8 2v6M11 2v6M14 2v6"/></svg></div>' +
      '<div class="wii-clock"><b class="wii-hora"></b><i class="wii-ampm"></i><span class="wii-punto">·</span><em class="wii-date"></em></div>' +
      '<div class="wii-btn right" data-focusable="true" data-menu="search" data-title="Buscar" data-description="Buscar películas y series" tabindex="0">' + IC.search + "</div>" +
    "</div>";
    /* en la búsqueda la barra es solo de adorno y atajos (no están en las áreas del motor): sin foco, sin categorías y sin el botón de buscar */
    if (busqueda) { h = h.replace(/ data-focusable="true"/g, "").replace(/<div class="wii-btn left"[\s\S]*?<\/svg><\/div>/, "").replace(/<div class="wii-btn right"[\s\S]*?<\/svg><\/div>/, ""); }
    return h;
  }

  function pintaReloj() {
    var d = new Date();
    var hh = d.getHours() % 12 || 12;
    var mm = d.getMinutes();
    var hora = hh + ":" + (mm < 10 ? "0" : "") + mm;
    var fecha = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][d.getDay()] + " " + d.getDate() + "/" + (d.getMonth() + 1);
    var horas = document.querySelectorAll(".wii-hora");
    if (!horas.length || (currentRoute !== "browse" && currentRoute !== "search" && currentRoute !== "detail")) { clearInterval(wii.reloj); wii.reloj = null; return; }
    toArray(horas).forEach(function (el) { el.textContent = hora; });
    toArray(document.querySelectorAll(".wii-ampm")).forEach(function (el) { el.textContent = d.getHours() < 12 ? "AM" : "PM"; });
    toArray(document.querySelectorAll(".wii-date")).forEach(function (el) { el.textContent = fecha; });
  }
  function arrancaReloj() {
    pintaReloj();
    clearInterval(wii.reloj);
    wii.reloj = setInterval(pintaReloj, 1000);
  }

  function areasWii(root, total) {
    var defs = [{ name: "top", items: root.querySelectorAll(".hf2-topbar [data-focusable]"), dir: "h", holdPage: true }];
    var r;
    var fila;
    for (r = 0; r < FILAS; r += 1) {
      fila = root.querySelectorAll(".wii-page:last-child .wii-tile[data-focusable]:nth-child(n+" + (r * COLS + 1) + "):nth-child(-n+" + ((r + 1) * COLS) + ")");
      if (fila.length) { defs.push({ name: "wii-r" + r, items: fila, dir: "h", keepColumn: true, edge: edgeWii }); }
    }
    if (total > 1) { defs.push({ name: "wii-pager", items: root.querySelectorAll(".wii-arrow"), dir: "h" }); }
    defs.push({ name: "wii-bar", items: root.querySelectorAll(".wii-bar [data-focusable]"), dir: "h" });
    return defs;
  }

  function edgeWii(dir) {
    var a = currentArea();
    var fila = a && /^wii-r(\d)$/.exec(a.name);
    irPagina(dir, fila ? { fila: Number(fila[1]), ultimo: dir < 0 } : null);
  }

  function renderWii(focusName, focusIndex) {
    var root = byId("scrBrowse");
    cierraCategorias();
    var seccion = browse.section;
    var items = baseWii(seccion);
    var total = totalPaginas(items);
    var pagina = Math.min(wii.pagina[seccion] || 0, total - 1);
    var defs;
    wii.pagina[seccion] = pagina;
    paintedSig = browseSigNow(); // la huella de lo que se pinta (browseRepaint)
    heroPvCancel();
    browse.resume = null;
    root.classList.add("wii-on");
    root.innerHTML = '<div class="wii-stage"><div class="wii-pages" id="wiiPages">' + paginaHtml(items, pagina) + "</div>" +
      (total > 1 ? '<div class="wii-arrow prev" data-focusable="true" data-wii="prev" data-title="Página anterior" data-description="Página anterior" tabindex="0"' + (pagina === 0 ? ' data-off="1"' : "") + '><svg viewBox="0 0 24 24"><path d="M16 4L7 12l9 8z"/></svg></div>' +
        '<div class="wii-arrow next" data-focusable="true" data-wii="next" data-title="Página siguiente" data-description="Página siguiente" tabindex="0"' + (pagina === total - 1 ? ' data-off="1"' : "") + '><svg viewBox="0 0 24 24"><path d="M8 4l9 8-9 8z"/></svg></div>' : "") +
      "</div>" + puntosHtml(total, pagina) + barraHtml() + topbarHtml(seccion);
    setSyncBadge();
    defs = areasWii(root, total);
    wii.total = total;
    setAreas(defs, focusName || 1, focusIndex || 0);
    if (focusName && (!currentArea() || currentArea().name !== focusName)) { setAreas(defs, defs.length > 1 ? 1 : 0, 0); }
    observeImages(root);
    reattachUpdateModal();
    arrancaReloj();
    updateStatus(items.length + (items.length === 1 ? " título" : " títulos") + (total > 1 ? " · página " + (pagina + 1) + " de " + total : ""));
  }

  /* Cambia de página (dir: 1 siguiente, -1 anterior) con un deslizamiento y la entrada de las teselas en cascada. ubicar: dónde queda el foco. */
  function irPagina(dir, ubicar) {
    var root = byId("scrBrowse");
    var seccion = browse.section;
    var items = baseWii(seccion);
    var total = totalPaginas(items);
    var actualP = wii.pagina[seccion] || 0;
    var destino = actualP + dir;
    var cont = byId("wiiPages");
    var vieja;
    var nueva;
    var tmp;
    var defs;
    var fila;
    var cuantas;
    if (!cont || destino < 0 || destino >= total || wii.animando) { return false; }
    wii.pagina[seccion] = destino;
    vieja = cont.querySelector(".wii-page");
    tmp = document.createElement("div");
    tmp.innerHTML = paginaHtml(items, destino);
    nueva = tmp.firstChild;
    cont.appendChild(nueva);
    if (vieja && vieja.animate) {
      wii.animando = true;
      vieja.animate([{ transform: "none", opacity: 1 }, { transform: "translateX(" + (-dir * 140) + "px)", opacity: 0 }], { duration: 300, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" });
      nueva.animate([{ transform: "translateX(" + (dir * 140) + "px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      toArray(nueva.querySelectorAll(".wii-tile")).forEach(function (t, i) {
        t.animate([{ transform: "scale(0.86)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 360, delay: 40 + ((i % COLS) + Math.floor(i / COLS)) * 35, easing: "cubic-bezier(0.22, 1.2, 0.36, 1)", fill: "backwards" });
      });
      setTimeout(function () { if (vieja.parentNode) { vieja.parentNode.removeChild(vieja); } wii.animando = false; }, 330);
    } else if (vieja) {
      vieja.parentNode.removeChild(vieja);
    }
    /* flechas, puntos y áreas del motor de foco */
    toArray(root.querySelectorAll(".wii-dots i")).forEach(function (p, i) { p.className = i === destino ? "on" : ""; });
    toArray(root.querySelectorAll(".wii-arrow")).forEach(function (a) {
      var prev = a.className.indexOf("prev") >= 0;
      if ((prev && destino === 0) || (!prev && destino === total - 1)) { a.setAttribute("data-off", "1"); } else { a.removeAttribute("data-off"); }
    });
    defs = areasWii(root, total);
    fila = ubicar ? "wii-r" + ubicar.fila : "wii-r0";
    cuantas = nueva.querySelectorAll(".wii-tile[data-focusable]").length;
    if (!defs.some(function (d) { return d.name === fila; })) { fila = defs[1] ? defs[1].name : "top"; }
    setAreas(defs, fila, ubicar && ubicar.ultimo ? 99 : 0);
    if (cuantas) { /* el foco ya quedó en la fila pedida */ }
    observeImages(root);
    updateStatus(items.length + " títulos · página " + (destino + 1) + " de " + total);
    return true;
  }

  function irAPagina(n) {
    var cur = wii.pagina[browse.section] || 0;
    if (n === cur) { return; }
    wii.pagina[browse.section] = n > cur ? n - 1 : n + 1; // se llega con un solo deslizamiento hacia ese lado
    if (!irPagina(n > cur ? 1 : -1, null)) { wii.pagina[browse.section] = cur; }
  }

  /* ===================== Wii: la película elegida (en lugar de la ficha aparte) =====================
   * La cuadrícula del lobby pasa a una LISTA a la izquierda (la misma lista y filtro que se estaban viendo); a la derecha, un mini reproductor con la
   * vista previa del video (la misma de la ficha: detailPvArm en js/ui/detail.js) y, debajo, los datos y los botones. Elegir otra película de la lista
   * cambia solo el lado derecho. Series, anime y videos sin clasificar siguen con la ficha de siempre (con los colores del tema). */

  function filaListaHtml(e, actualGrupo) {
    var nombre = e.type === "episode" ? e.seriesName : e.name;
    var sub = e.type === "episode" ? epTag(e) + " · " + e.title : titleMeta(e);
    var ref = e.type === "episode" || e.type === "video" ? "v:" + e.key : "t:" + e.titleKey;
    var img = e.type === "episode" ? (e.coverKey || e.key) : e.type === "video" ? e.key : (e.bannerKey || e.imageKey);
    var prog = e.type === "movie" ? progressInfo(entryVideoKey(e)) : null;
    return '<div class="wii-row' + (grupoDe(e) === actualGrupo ? " on" : "") + '" data-focusable="true" data-ref="' + esc(ref) + '" data-title="' + esc(nombre) + '" data-description="' + esc(nombre + (sub ? " · " + sub : "")) + '" tabindex="0">' +
      '<div class="wii-thumb hf2-img"' + (img ? ' data-img="' + esc(img) + '" data-img-w="320"' : "") + ">" + fallbackArt(img || nombre, "c") + (prog ? '<span class="wii-prog"><i style="width:' + prog.pct + '%"></i></span>' : "") + "</div>" +
      '<div class="wii-rt"><b>' + esc(nombre) + "</b><small>" + esc(sub) + "</small></div></div>";
  }

  /* Fila de un capítulo en la lista de la izquierda (en las series la lista son los capítulos de la temporada) */
  function filaCapituloHtml(ep, siguiente) {
    var p = HFLibrary.progress(ep.key);
    var prog = progressInfo(ep.key);
    var visto = !!(p && p.done);
    return '<div class="wii-row' + (siguiente ? " on" : "") + '" data-focusable="true" data-ref="v:' + esc(ep.key) + '" data-title="' + esc(ep.title) + '" data-description="' + esc(epTag(ep) + " · " + ep.title + (visto ? " · visto" : "") + (prog ? " · " + prog.left : "")) + '" tabindex="0">' +
      '<div class="wii-thumb hf2-img" data-img="' + esc(ep.coverKey || ep.key) + '" data-img-w="320">' + fallbackArt(ep.key, "ep") + '<span class="wii-num">' + ep.episode + "</span>" +
        (prog ? '<span class="wii-prog"><i style="width:' + prog.pct + '%"></i></span>' : "") + "</div>" +
      '<div class="wii-rt"><b>' + esc(ep.title) + "</b><small>" + esc(epTag(ep)) + " · " + esc(HFLibrary.formatDuration(ep.video.duration)) + "</small></div>" +
      (visto ? '<span class="wii-visto">' + IC.check + "</span>" : "") + "</div>";
  }

  // Botón de sonido de la vista previa (a la derecha del lápiz). Se recuerda en este navegador («hf.pv.sonido»); detail.js lo lee al arrancar la vista previa.
  var IC_SONIDO = '<svg viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18.2 6.3a8 8 0 0 1 0 11.4"/></svg>';
  var IC_MUDO = '<svg viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
  function sonidoApagado() {
    var v = HeroPv.el;
    var activo = navigator.userActivation && navigator.userActivation.hasBeenActive;
    if (v && v.isConnected) { return v.muted; }
    return (typeof detailPvSinSonido === "function" && detailPvSinSonido()) || (typeof HERO_PV_MUTED !== "undefined" && HERO_PV_MUTED) || !activo;
  }
  function textoSonido(mudo) { return mudo ? "Activar el sonido de la vista previa" : "Silenciar la vista previa"; }
  function botonSonido() {
    var mudo = sonidoApagado();
    return '<div class="wii-ico wii-sonido' + (mudo ? " mudo" : "") + '" data-focusable="true" data-action="pv-sound" data-title="' + textoSonido(mudo) + '" data-description="' + textoSonido(mudo) + '" tabindex="0">' + (mudo ? IC_MUDO : IC_SONIDO) + "</div>";
  }
  function alternaSonido(el) {
    var mudo = !el.classList.contains("mudo"); // lo contrario de lo que muestra el botón (el propio clic cambia lo que permite el navegador)
    var v = HeroPv.el;
    try { localStorage.setItem("hf.pv.sonido", mudo ? "0" : "1"); } catch (e) { /* solo esta vez */ }
    if (v && v.isConnected) {
      v.muted = mudo;
      if (!mudo) { v.volume = typeof HERO_PV_VOLUME === "number" ? HERO_PV_VOLUME : 0.7; }
    }
    el.innerHTML = mudo ? IC_MUDO : IC_SONIDO;
    el.classList.toggle("mudo", mudo);
    el.setAttribute("data-title", textoSonido(mudo));
    el.setAttribute("data-description", textoSonido(mudo));
    el._hfDescription = textoSonido(mudo);
    updateStatus(mudo ? "Vista previa en silencio" : "Vista previa con sonido");
  }
  // Si la vista previa arranca después de pintar el botón (o el navegador la silencia), el ícono se pone al día.
  setInterval(function () {
    var b = document.querySelector("#scrDetail .wii-sonido");
    var v = HeroPv.el;
    if (!b || !v || !v.isConnected || b.classList.contains("mudo") === v.muted) { return; }
    b.innerHTML = v.muted ? IC_MUDO : IC_SONIDO;
    b.classList.toggle("mudo", v.muted);
  }, 500);

  function renderWiiDetalle(focusName, focusIndex) {
    var root = byId("scrDetail");
    var t = detail.title;
    var esSerie = t.type === "series";
    var seccion = browse.section;
    var filtro = filtroDe(seccion);
    var lista = [];
    var grupo = grupoDe(t);
    var idx = 0;
    var primera = !wii.enDetalle;
    var kids = currentProfileIsKids();
    var botones = "";
    var inList;
    var art = t.bannerKey || t.imageKey;
    var defs;
    var a;
    var offset;
    var cabeza;
    var cuerpoLista;
    var datos;
    var pastillas = "";
    var p;
    var prog = null;
    var next;
    var season;
    var vistos;
    var accion = "play";
    var descPv = "Reproducir";
    var icono = function (a, svg, d) { return '<div class="wii-ico" data-focusable="true" data-action="' + a + '" data-title="' + esc(d) + '" data-description="' + esc(d) + '" tabindex="0">' + svg + "</div>"; };
    cierraCategorias();
    inList = HFLibrary.inMyList(t.titleKey);
    if (!esSerie) {
      lista = filtro.op.items.slice(0, 300);
      if (!lista.some(function (e) { return grupoDe(e) === grupo; })) { lista = [t].concat(lista); }
      idx = Math.max(0, lista.map(grupoDe).indexOf(grupo));
      p = HFLibrary.progress(entryVideoKey(t));
      prog = progressInfo(entryVideoKey(t));
      accion = "play";
      descPv = prog ? "Reanudar desde " + HFLibrary.formatClock(p.t) : p && p.done ? "Ver otra vez" : "Reproducir";
      botones += icono("mylist", inList ? IC.check : IC.plus, inList ? "Quitar de Mi lista" : "Guardar en Mi lista");
      if (!kids) { botones += icono("tag", IC.pencil, "Editar: nombre, año, descripción o infantil"); }
      cabeza = "<b>" + esc(filtro.op.nombre) + "</b><em>" + lista.length + (lista.length === 1 ? " título" : " títulos") + "</em>";
      cuerpoLista = lista.map(function (e) { return filaListaHtml(e, grupo); }).join("");
      datos = '<div class="hf2-bb-meta">' + (t.year ? "<b>" + t.year + "</b>" : "") + (t.video.duration ? "<span>" + HFLibrary.formatDuration(t.video.duration) + "</span>" : "") +
        (t.quality ? '<span class="hf2-q">' + t.quality + "</span>" : "") + (t.video.size ? "<span>" + HFLibrary.formatSize(t.video.size) + "</span>" : "") + "</div>" + sourceLine(t) +
        (prog ? '<div class="hf2-dt-progress"><span class="bar"><i style="width:' + prog.pct + '%"></i></span><span>Viste ' + HFLibrary.formatDuration(p.t) + " · " + prog.left.toLowerCase() + "</span></div>" : "");
    } else {
      next = HFLibrary.nextEpisode(t);
      season = t.seasons[detail.season] || t.seasons[0] || { episodes: [] };
      vistos = season.episodes.filter(function (ep) { var x = HFLibrary.progress(ep.key); return x && x.done; }).length;
      accion = next.episode ? (next.finished ? "play-first" : "play-next") : "play-first";
      descPv = next.episode ? (next.finished ? "Ver desde " + epTag(t.seasons[0].episodes[0]) : next.started && next.resume > 0 ? "Continuar " + epTag(next.episode) : "Ver " + epTag(next.episode)) : "Reproducir";
      botones += icono("mylist", inList ? IC.check : IC.plus, inList ? "Quitar de Mi lista" : "Guardar en Mi lista");
      idx = Math.max(0, season.episodes.map(function (ep) { return ep.key; }).indexOf(next.episode ? next.episode.key : ""));
      cabeza = "<b>" + esc(t.name) + "</b><em>" + season.episodes.length + (season.episodes.length === 1 ? " capítulo" : " capítulos") + "</em>";
      pastillas = '<div class="wii-pills">' + t.seasons.map(function (sn, i) {
        return '<span class="wii-pill' + (i === detail.season ? " on" : "") + '" data-focusable="true" data-season="' + i + '" data-title="' + esc(seasonLabel(sn)) + '" data-description="' + esc(seasonLabel(sn)) + " · " + sn.episodes.length + ' capítulos" tabindex="0">' + esc(seasonLabel(sn)) + " <b>" + sn.episodes.length + "</b></span>";
      }).join("") + '<span class="wii-pills-note">Viste ' + vistos + " de " + season.episodes.length + "</span></div>";
      cuerpoLista = season.episodes.map(function (ep) { return filaCapituloHtml(ep, next.episode && ep.key === next.episode.key); }).join("");
      datos = '<div class="hf2-bb-meta"><b>' + t.seasons.length + (t.seasons.length === 1 ? " temporada" : " temporadas") + "</b><span>" + t.episodeCount + " capítulos</span></div>" + sourceLine(t);
    }

    root.className = "screen hf2 cat wii-detalle";
    root.innerHTML = '<div class="wii-det">' +
      '<div class="wii-lv' + (esSerie ? " serie" : "") + '"><div class="wii-lv-head"><span class="wii-volver" title="Volver (Esc)"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></span>' +
        cabeza + "</div>" + pastillas +
        '<div class="wii-lv-viewport"><div class="wii-lv-track" id="wiiLista">' + cuerpoLista + "</div></div></div>" +
      '<div class="wii-right"><div class="wii-pv" data-focusable="true" data-action="' + accion + '" data-title="' + esc(descPv) + '" data-description="' + esc(descPv + " · " + t.name) + '" tabindex="0"><div class="wii-pv-art hf2-img"' + (art ? ' data-img="' + esc(art) + '" data-img-w="1280"' : "") + ">" + fallbackArt(art || t.name, "dt") + "</div>" +
        '<div class="wii-pv-play">' + IC.play + "</div>" + (prog ? '<span class="wii-prog"><i style="width:' + prog.pct + '%"></i></span>' : "") + "</div>" +
        '<div class="wii-info"><div class="hf2-bb-badges"><span class="hf2-chip gold">' + (esSerie ? "Serie" : "Película") + "</span>" + (t.kids ? '<span class="hf2-chip kids">' + IC.star + "Infantil</span>" : "") + "</div>" +
        "<h1" + (t.name.length > 28 ? ' class="long"' : "") + ">" + esc(t.name) + "</h1>" + datos +
        (t.description ? "<p>" + esc(t.description) + "</p>" : "") + '</div><div class="wii-icos">' + botones + botonSonido() + "</div></div>" +
      "</div>" + barraHtml() + topbarHtml(seccion);
    setSyncBadge();
    defs = [{ name: "top", items: root.querySelectorAll(".hf2-topbar [data-focusable]"), dir: "h", holdPage: true }];
    if (esSerie) { defs.push({ name: "wii-temporadas", items: root.querySelectorAll(".wii-pill"), dir: "h" }); }
    defs.push({ name: "wii-lista", items: root.querySelectorAll(".wii-row"), dir: "v", track: byId("wiiLista"), sideways: true });
    defs.push({ name: "actions", items: root.querySelectorAll(".wii-right [data-focusable]"), dir: "h", sideways: true });
    defs.push({ name: "wii-bar", items: root.querySelectorAll(".wii-bar [data-focusable]"), dir: "h" });
    if (focusName === "episodes") { focusName = "wii-lista"; focusIndex = 0; }
    setAreas(defs, focusName || "actions", focusIndex || 0);
    /* la lista arranca con la película (o el próximo capítulo) a la vista */
    a = areas.filter(function (x) { return x.name === "wii-lista"; })[0];
    /* la lista se ve hasta debajo de la curva, pero para desplazarla cuenta solo lo que queda por encima de ella: así la última tarjeta sí se puede subir a la vista */
    if (a) { a.viewSize = Math.min(a.viewSize, 630); }
    if (a && idx > 3 && typeof setTrackOffset === "function") {
      offset = Math.max(0, idx * 110 - 220);
      try { setTrackOffset(a, Math.min(offset, Math.max(0, a.total + 40 - a.viewSize))); } catch (e) { /* sin desplazar */ }
    }
    observeImages(root);
    arrancaReloj();
    updateStatus(t.name + " · " + (esSerie ? t.seasons.length + (t.seasons.length === 1 ? " temporada" : " temporadas") : titleMeta(t)));
    wii.enDetalle = true;
    if (primera && root.animate) {
      root.querySelector(".wii-lv").animate([{ transform: "translateX(-70px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      root.querySelector(".wii-right").animate([{ transform: "translateX(70px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 460, delay: 60, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" });
      toArray(root.querySelectorAll(".wii-row")).slice(0, 9).forEach(function (r, i) {
        r.animate([{ transform: "translateX(-40px) scale(0.96)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 360, delay: 80 + i * 40, easing: "cubic-bezier(0.22, 1.2, 0.36, 1)", fill: "backwards" });
      });
    }
    detailPvArm();
  }

  /* ===================== Selector de categorías (botón de abajo a la izquierda) ===================== */

  var menuCat = { el: null, sel: 0, ops: [] };

  function cierraCategorias() {
    if (menuCat.el && menuCat.el.parentNode) { menuCat.el.parentNode.removeChild(menuCat.el); }
    menuCat.el = null;
    document.removeEventListener("keydown", teclasCategorias, true);
    document.removeEventListener("click", fueraCategorias, true);
  }
  function eligeCategoria(id) {
    var seccion = browse.section;
    var lista;
    var primero;
    cierraCategorias();
    wii.pagina[seccion] = 0;
    if (id === "todo") {
      wii.filtro[seccion] = "todo";
      if (currentRoute === "detail") { renderDetail("actions", 0); } else { renderBrowse("wii-r0", 0); }
      return;
    }
    /* una categoría abre la vista de película: la lista de la izquierda trae todo lo de esa categoría y su nombre es el título de la lista */
    wii.filtro[seccion] = id;
    lista = filtroDe(seccion).op.items;
    primero = lista.filter(function (e) { return e.type === "movie"; })[0] || lista[0];
    if (!primero) { return; }
    if (primero.type === "episode") { primero = library.titles[primero.seriesKey] || primero; }
    openDetail(primero);
  }
  function pintaSeleccion() {
    toArray(menuCat.el.querySelectorAll(".wii-op")).forEach(function (o, i) {
      o.classList.toggle("sel", i === menuCat.sel);
      if (i === menuCat.sel && o.scrollIntoView) { o.scrollIntoView({ block: "nearest" }); }
    });
  }
  function teclasCategorias(e) {
    var k = e.key;
    if (!menuCat.el) { return; }
    e.stopImmediatePropagation();
    if (k === "Escape" || k === "ArrowLeft") { e.preventDefault(); cierraCategorias(); return; }
    if (k === "ArrowDown") { menuCat.sel = (menuCat.sel + 1) % menuCat.ops.length; }
    else if (k === "ArrowUp") { menuCat.sel = (menuCat.sel + menuCat.ops.length - 1) % menuCat.ops.length; }
    else if (k === "Enter" || k === " ") { e.preventDefault(); eligeCategoria(menuCat.ops[menuCat.sel].id); return; }
    else { return; }
    e.preventDefault();
    pintaSeleccion();
  }
  function fueraCategorias(e) {
    if (!menuCat.el) { return; }
    if (e.target.closest && (e.target.closest("#wiiMenu") || e.target.closest('[data-wii="categorias"]'))) { return; }
    cierraCategorias();
  }
  function alternaCategorias() {
    var f;
    var root = byId(currentRoute === "detail" ? "scrDetail" : "scrBrowse");
    if (menuCat.el) { cierraCategorias(); return; }
    f = filtroDe(browse.section);
    menuCat.ops = f.ops;
    menuCat.sel = Math.max(0, f.ops.indexOf(f.op));
    menuCat.el = document.createElement("div");
    menuCat.el.id = "wiiMenu";
    menuCat.el.className = "wii-menu";
    menuCat.el.innerHTML = "<h3>Categorías</h3>" + '<div class="wii-ops">' + f.ops.map(function (o, i) {
      return '<div class="wii-op' + (o === f.op ? " on" : "") + '" data-i="' + i + '"><span>' + esc(o.nombre) + "</span><em>" + o.items.length + "</em></div>";
    }).join("") + "</div>";
    menuCat.el.addEventListener("click", function (e) {
      var op = e.target.closest ? e.target.closest(".wii-op") : null;
      e.stopPropagation();
      if (op) { eligeCategoria(menuCat.ops[Number(op.getAttribute("data-i"))].id); }
    });
    menuCat.el.addEventListener("mousemove", function (e) {
      var op = e.target.closest ? e.target.closest(".wii-op") : null;
      if (op) { menuCat.sel = Number(op.getAttribute("data-i")); toArray(menuCat.el.querySelectorAll(".wii-op")).forEach(function (o, i) { o.classList.toggle("sel", i === menuCat.sel); }); }
    });
    root.appendChild(menuCat.el);
    pintaSeleccion();
    document.addEventListener("keydown", teclasCategorias, true);
    setTimeout(function () { document.addEventListener("click", fueraCategorias, true); }, 0);
  }

  /* ===================== Selector de apariencia (Ajustes) ===================== */

  var modal = null;
  var seleccion = 0;

  function vistaPrevia(id) {
    var i;
    var s = "";
    if (id === "wii") {
      for (i = 0; i < 12; i += 1) { s += "<i></i>"; }
      return '<div class="pv wii"><div class="g">' + s + '</div><div class="b"></div></div>';
    }
    if (id === "ps5") { return '<div class="pv ps5"><div class="t"><i></i><i></i><i></i><i></i><i></i></div></div>'; }
    if (id === "xbox") { return '<div class="pv xbox"><div class="t"><i></i><i></i><i></i><i></i></div><div class="u"><i></i><i></i><i></i></div></div>'; }
    return '<div class="pv clasica"><div class="h"></div><div class="r"><i></i><i></i><i></i><i></i></div></div>';
  }

  function cierraSelector() {
    if (modal && modal.parentNode) { modal.parentNode.removeChild(modal); }
    modal = null;
    document.removeEventListener("keydown", teclasSelector, true);
  }

  function eligeTema(id) {
    var t = tema(id);
    if (!t || !t.listo) { return; }
    pon(id);
    cierraSelector();
    if (currentRoute === "settings") { renderSettings("top", 1); }
    updateStatus("Apariencia: " + t.nombre);
  }

  function teclasSelector(e) {
    var k = e.key;
    var cards;
    if (!modal) { return; }
    e.stopImmediatePropagation();
    cards = modal.querySelectorAll(".hf-th-card");
    if (k === "Escape") { e.preventDefault(); cierraSelector(); return; }
    if (k === "ArrowRight" || k === "ArrowDown") { seleccion = (seleccion + 1) % cards.length; }
    else if (k === "ArrowLeft" || k === "ArrowUp") { seleccion = (seleccion + cards.length - 1) % cards.length; }
    else if (k === "Enter" || k === " ") { e.preventDefault(); eligeTema(TEMAS[seleccion].id); return; }
    else { return; }
    e.preventDefault();
    toArray(cards).forEach(function (c, i) { c.classList.toggle("sel", i === seleccion); });
  }

  function abreSelector() {
    var cur = actual();
    var app = byId("app");
    if (modal) { return; }
    seleccion = Math.max(0, TEMAS.map(function (t) { return t.id; }).indexOf(cur));
    modal = document.createElement("div");
    modal.className = "hf-th-modal";
    modal.innerHTML = '<div class="hf-th-box"><h2>Apariencia</h2><p>Cambia cómo se ve el inicio de HomeFlix. Por ahora solo en la web del computador; después llegará a los demás equipos.</p>' +
      '<div class="hf-th-grid">' + TEMAS.map(function (t, i) {
        return '<button type="button" class="hf-th-card' + (t.id === cur ? " on" : "") + (i === seleccion ? " sel" : "") + (t.listo ? "" : " off") + '" data-th="' + t.id + '">' + vistaPrevia(t.id) +
          "<b>" + esc(t.nombre) + "</b><small>" + esc(t.desc) + "</small>" +
          (t.id === cur ? '<em class="ok">Activa</em>' : t.listo ? "" : '<em class="pronto">Próximamente</em>') + "</button>";
      }).join("") + '</div><div class="hf-th-foot"><span>← → para elegir · Enter aplica · Esc cierra</span><button type="button" class="hf-th-ok">Listo</button></div></div>';
    modal.addEventListener("click", function (e) {
      var c = e.target.closest ? e.target.closest(".hf-th-card") : null;
      e.stopPropagation();
      if (c) { eligeTema(c.getAttribute("data-th")); return; }
      if (e.target === modal || (e.target.closest && e.target.closest(".hf-th-ok"))) { cierraSelector(); }
    });
    app.appendChild(modal);
    document.addEventListener("keydown", teclasSelector, true);
  }

  /* ===================== Enganches (sin tocar el motor) ===================== */

  function instala() {
    var oRender = window.renderBrowse;
    var oSelect = window.handleBrowseSelect;
    if (oRender) {
      window.renderBrowse = function () {
        if (seccionWii()) { return renderWii.apply(this, arguments); }
        clearInterval(wii.reloj);
        wii.reloj = null;
        byId("scrBrowse").classList.remove("wii-on");
        return oRender.apply(this, arguments);
      };
    }
    var oDetail = window.renderDetail;
    var oDetailSel = window.handleDetailSelect;
    var oShow = window.showRoute;
    var oScrolled = window.setDetailScrolled;
    var oClose = window.closeDetail;
    if (oClose) { /* al salir de una categoría, el lobby vuelve a mostrar todo */
      window.closeDetail = function () { if (wii.filtro[browse.section] && wii.filtro[browse.section] !== "todo") { wii.filtro[browse.section] = "todo"; } return oClose.apply(this, arguments); };
    }
    if (oScrolled) { /* la vista Wii no usa la cabecera que se recoge: sin esto, al cambiar de temporada se perdía su clase */
      window.setDetailScrolled = function () { if (byId("scrDetail").classList.contains("wii-detalle")) { return undefined; } return oScrolled.apply(this, arguments); };
    }
    if (oShow) {
      window.showRoute = function (r) { if (r !== "detail") { wii.enDetalle = false; } return oShow.apply(this, arguments); };
    }
    if (oDetail) {
      window.renderDetail = function () {
        var t = detail.title;
        if (esWii() && t && !t.anime && ((t.type === "movie" && t.video) || (t.type === "series" && t.seasons && t.seasons.length))) { return renderWiiDetalle.apply(this, arguments); }
        wii.enDetalle = false;
        return oDetail.apply(this, arguments);
      };
    }
    if (oDetailSel) {
      window.handleDetailSelect = function (el) {
        var menu = el.getAttribute("data-menu");
        if (el.getAttribute("data-wii") === "categorias") { alternaCategorias(); return undefined; }
        if (el.classList.contains("wii-ico") && el.getAttribute("data-action") === "pv-sound") { alternaSonido(el); return undefined; }
        if (el.classList.contains("wii-ico") && el.getAttribute("data-action") === "mylist") {
          var añadida = HFLibrary.toggleMyList(detail.title.titleKey);
          el.innerHTML = añadida ? IC.check : IC.plus;
          el.setAttribute("data-title", añadida ? "Quitar de Mi lista" : "Guardar en Mi lista");
          el._hfDescription = añadida ? "Quitar de Mi lista" : "Guardar en Mi lista";
          updateStatus(añadida ? "Agregada a Mi lista" : "Quitada de Mi lista");
          return undefined;
        }
        if (menu && byId("scrDetail").classList.contains("wii-detalle")) {
          if (/^(search|settings|refresh|profiles|live)$/.test(menu)) { handleBrowseSelect(el); return undefined; }
          browse.section = menu;
          browse.resume = null;
          showRoute("browse");
          renderBrowse("top", menuIndex(menu));
          if (menu === "anime") { animeRefresh(); }
          return undefined;
        }
        return oDetailSel.apply(this, arguments);
      };
    }
    /* volver a la cuadrícula y tocar el mini reproductor (reproduce) */
    document.addEventListener("click", function (e) {
      var v;
      if (currentRoute !== "detail" || !e.target.closest) { return; }
      v = e.target.closest("#scrDetail .wii-volver");
      if (v) { e.stopPropagation(); closeDetail(); }
    }, true);
    var oSearch = window.openSearch;
    if (oSearch) {
      window.openSearch = function () {
        var r = oSearch.apply(this, arguments);
        var pant = byId("scrSearch");
        var bar = pant.querySelector(".wii-bar");
        if (esWii()) {
          pant.classList.add("wii-on");
          if (!bar) { pant.insertAdjacentHTML("beforeend", barraHtml(true)); }
          arrancaReloj();
        } else {
          pant.classList.remove("wii-on");
          if (bar) { bar.parentNode.removeChild(bar); }
        }
        return r;
      };
    }
    if (oSelect) {
      window.handleBrowseSelect = function (el) {
        var w = el && el.getAttribute && el.getAttribute("data-wii");
        if (w) {
          if (w === "categorias") { alternaCategorias(); }
          else if (!el.getAttribute("data-off")) { irPagina(w === "next" ? 1 : -1, null); }
          return undefined;
        }
        return oSelect.apply(this, arguments);
      };
    }
    /* búsqueda: los botones redondos de la barra son atajos (Inicio y Mi lista) */
    document.addEventListener("click", function (e) {
      var b = currentRoute === "search" && e.target.closest ? e.target.closest("#scrSearch .wii-btn, #scrSearch .wii-sd") : null;
      if (b) { e.stopPropagation(); openBrowse(b.getAttribute("data-menu") === "mylist" ? "mylist" : "home"); }
    }, true);
    /* quitar el filtro de categoría (la píldora de abajo a la izquierda no es enfocable) */
    document.addEventListener("click", function (e) {
      var q = currentRoute === "browse" && e.target.closest ? e.target.closest(".wii-filtro") : null;
      if (q) { e.stopPropagation(); wii.filtro[browse.section] = "todo"; wii.pagina[browse.section] = 0; renderBrowse("wii-r0", 0); }
    }, true);
    /* clic en los puntos de página (no son enfocables) */
    document.addEventListener("click", function (e) {
      var p = e.target.closest ? e.target.closest(".wii-dots i") : null;
      if (p && currentRoute === "browse") { e.stopPropagation(); irAPagina(Number(p.getAttribute("data-wii-page"))); }
    }, true);
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", instala, false); } else { instala(); }

  /* la rueda y el trackpad pasan de página en el lobby de Wii (js/web-pc.js lo consulta antes de desplazar) */
  window.HFTheme = {
    actual: actual,
    nombre: function () { return (tema(actual()) || TEMAS[0]).nombre; },
    abrirSelector: abreSelector,
    wheel: function (dx, dy) {
      var d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      if (!esWii() || currentRoute !== "browse" || !seccionWii() || Math.abs(d) < 4) { return false; }
      if (Date.now() - wii.ultimaRueda > 520) { wii.ultimaRueda = Date.now(); irPagina(d > 0 ? 1 : -1, null); }
      return true;
    }
  };
})();
