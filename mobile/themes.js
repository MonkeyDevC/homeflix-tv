/* HomeFlix celular · apariencias (el mismo criterio que la web de computador, js/themes.js).
 * Se elige en Ajustes › «Apariencia» y se guarda en este navegador/app (localStorage «hf.theme», la misma llave que usa el computador, así que en la web
 * el tema elegido en un tamaño vale en el otro). Hoy: Clásica (la de siempre) y Plaza Celeste; Cobalto y Esmeralda quedan anunciadas.
 * Nombres propios: nunca el de una marca.
 *
 * Plaza Celeste en el celular:
 *   - paleta clara con celeste (css: mobile/themes.css) en todas las pantallas de catálogo, fichas y ajustes; el reproductor, el inicio de sesión y la galería siguen oscuros;
 *   - el inicio, Películas, Series, Mi lista y cada categoría se dibujan como una plaza de «canales»: páginas de portadas que se deslizan, con puntos de página;
 *   - la barra de abajo es una curva con el reloj, el botón de categorías (redondo), Mi lista y Buscar; las secciones pasan arriba como píldoras.
 * Se carga ANTES de m.js: m.js le pregunta en cada pintado (HFMTheme.view / .nav / .light / .after) y le presta lo que necesita (el «kit»). */
(function () {
  "use strict";
  var KEY = "hf.theme";
  var TEMAS = [
    { id: "clasica", nombre: "Clásica", desc: "El aspecto de siempre: destacado grande y filas de títulos.", listo: true },
    { id: "wii", nombre: "Plaza Celeste", desc: "Plaza de canales: portadas por páginas, curva con reloj y botones redondos.", listo: true },
    { id: "ps5", nombre: "Cobalto", desc: "Fondo azul a pantalla completa con una fila de títulos abajo.", listo: false },
    { id: "xbox", nombre: "Esmeralda", desc: "Inicio verde con mosaicos y el último título destacado.", listo: false }
  ];
  /* pantallas que se pintan claras con el tema; el resto (reproductor, inicio de sesión, galería, control remoto, TV en vivo) siguen oscuras */
  var CLARAS = { profiles: 1, home: 1, movies: 1, series: 1, mylist: 1, category: 1, anime: 1, search: 1, detail: 1, account: 1, settings: 1, iptv: 1, "profile-edit": 1, pin: 1, "account-pick": 1 };
  var PLAZA = { home: 1, movies: 1, series: 1, mylist: 1, category: 1 };
  var pagina = {}; // página de la plaza en la que se estaba, por pantalla
  var K = null;    // último kit recibido de m.js (para los toques sobre botones del tema)

  function tema(id) { var i; for (i = 0; i < TEMAS.length; i += 1) { if (TEMAS[i].id === id) { return TEMAS[i]; } } return null; }
  function actual() {
    var v = "";
    try { v = window.localStorage.getItem(KEY) || ""; } catch (e) { v = ""; }
    return tema(v) && tema(v).listo ? v : "clasica";
  }
  function themed() { return actual() === "wii"; }
  function guarda(id) {
    try { window.localStorage.setItem(KEY, id); } catch (e) { /* sin guardar */ }
    document.documentElement.setAttribute("data-theme", id);
  }
  document.documentElement.setAttribute("data-theme", actual());

  var IC = {
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></svg>',
    sd: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M7 3h8l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M10 3v4M13 3v4"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>'
  };

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function reloj() {
    var d = new Date();
    var h = d.getHours();
    var dias = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    return { hora: ((h + 11) % 12 + 1) + ":" + pad(d.getMinutes()), ampm: h < 12 ? "AM" : "PM", fecha: dias[d.getDay()] + " " + d.getDate() + "/" + (d.getMonth() + 1) };
  }
  function pintaReloj() {
    var c = reloj();
    Array.prototype.forEach.call(document.querySelectorAll(".wii-clock"), function (el) {
      el.innerHTML = "<b>" + c.hora + "</b><i>" + c.ampm + "</i><span>" + c.fecha + "</span>";
    });
  }
  setInterval(pintaReloj, 20000);

  function geometria() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var cols = w >= 1000 ? 4 : w >= 720 ? 3 : 2;
    var ancho = (Math.min(w, 1100) - 32 - (cols - 1) * 12) / cols;
    var alto = ancho * 9 / 16 + 52 + 12; // portada + título y subtítulo + hueco
    var libre = h - 64 - 56 - 48 - 34 - 132; // barra superior, píldoras, título, puntos y la curva de abajo
    return { cols: cols, rows: Math.max(2, Math.min(5, Math.floor(libre / alto))) };
  }

  /* El inicio y las listas, como una plaza de canales. */
  function plaza(view, kit) {
    var esc = kit.esc;
    var L = kit.lobby(view);
    var g = geometria();
    var por = g.cols * g.rows;
    var paginas = [];
    var i;
    var cabeza;
    var puntos = "";
    if (!L.list.length) { return null; }
    for (i = 0; i < L.list.length; i += por) { paginas.push(L.list.slice(i, i + por)); }
    if (view === "category") {
      cabeza = '<div class="wii-head"><button class="m-iconbtn" data-back aria-label="Volver">' + kit.I.back + "</button><b>" + esc(L.name) + "</b><em>" + kit.plural(L.list.length, "título", "títulos") + "</em></div>";
    } else {
      cabeza = '<div class="m-chips wii-pills">' + kit.tabs().filter(function (x) { return x[0] !== "search"; }).map(function (x) {
        return '<button class="m-chip' + (x[0] === view ? " on" : "") + '" data-tab="' + x[0] + '">' + x[1] + "</button>";
      }).join("") + "</div>" +
        '<div class="wii-head"><b>' + esc(L.name) + "</b><em>" + kit.plural(L.list.length, "título", "títulos") + "</em></div>";
    }
    for (i = 0; i < paginas.length && paginas.length > 1; i += 1) { puntos += '<button class="' + (i === 0 ? "on" : "") + '" data-wii-pg="' + i + '" aria-label="Página ' + (i + 1) + '"></button>'; }
    return kit.topbar() + '<div class="m-scroll wii-lobby" style="--cols:' + g.cols + '">' + cabeza +
      '<div class="wii-stage"><div class="wii-pages" data-key="' + esc(view + ":" + (kit.S.category || "")) + '">' + paginas.map(function (p) {
        return '<div class="wii-page">' + p.map(function (t) { return kit.card(t, { tile: true, progress: kit.progress(t) }); }).join("") + "</div>";
      }).join("") + "</div>" +
      (paginas.length > 1 ? '<button class="wii-arrow l" data-wii-step="-1" aria-label="Página anterior">‹</button><button class="wii-arrow r" data-wii-step="1" aria-label="Página siguiente">›</button>' : "") +
      "</div>" + (puntos ? '<div class="wii-dots">' + puntos + "</div>" : "") + "</div>" + kit.nav(view === "category" ? "" : view);
  }

  /* La barra de abajo: curva con el reloj, categorías (redondo), Mi lista y Buscar. */
  function barra(kit, tabs, on) {
    var c = reloj();
    var soloAnime = !tabs.some(function (x) { return x[0] === "home"; });
    return '<nav class="m-nav wii-bar"><svg class="wii-curve" viewBox="0 0 390 112" preserveAspectRatio="none" aria-hidden="true"><path class="fill" d="M0 18 C 100 18, 150 50, 195 50 C 240 50, 290 18, 390 18 L390 112 L0 112 Z"/><path class="line" d="M0 18 C 100 18, 150 50, 195 50 C 240 50, 290 18, 390 18"/></svg>' +
      (soloAnime ? "" : '<button class="wii-rb cat" data-act="categories" aria-label="Categorías">' + IC.grid + "</button>") +
      '<button class="wii-sd' + (on === "mylist" ? " on" : "") + '" data-tab="mylist" aria-label="Mi lista">' + IC.sd + "</button>" +
      '<div class="wii-clock"><b>' + c.hora + "</b><i>" + c.ampm + "</i><span>" + c.fecha + "</span></div>" +
      '<button class="wii-rb sr' + (on === "search" ? " on" : "") + '" data-tab="search" aria-label="Buscar">' + IC.search + "</button></nav>";
  }

  function hoja(kit) {
    var cur = actual();
    return kit.sheetHtml("Apariencia",
      TEMAS.map(function (t) {
        return kit.radio(kit.esc(t.nombre) + (t.listo ? "" : " · Próximamente"), kit.esc(t.desc), t.id === cur, t.listo ? 'data-wii-theme="' + t.id + '"' : 'disabled style="opacity:.55"');
      }).join(""),
      kit.I.info + "Cambia el aspecto del inicio, las listas y las fichas. Se guarda en este " + (window.HFAndroid ? "celular" : "navegador") + ".");
  }

  function irPagina(cont, i) {
    var n = cont.children.length;
    i = Math.max(0, Math.min(n - 1, i));
    cont.scrollTo ? cont.scrollTo({ left: i * cont.clientWidth, behavior: "smooth" }) : (cont.scrollLeft = i * cont.clientWidth);
  }
  function marcaPunto(cont) {
    var i = cont.clientWidth ? Math.round(cont.scrollLeft / cont.clientWidth) : 0;
    var dots = cont.parentNode && cont.parentNode.parentNode ? cont.parentNode.parentNode.querySelectorAll(".wii-dots button") : [];
    pagina[cont.getAttribute("data-key")] = i;
    Array.prototype.forEach.call(dots, function (d, n) { d.classList.toggle("on", n === i); });
  }

  /* los toques sobre lo que dibuja el tema (m.js solo atiende data-act / data-tab / data-open…) */
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-wii-theme],[data-wii-pg],[data-wii-step]") : null;
    var cont;
    var id;
    if (!t) { return; }
    if (t.hasAttribute("data-wii-theme")) {
      id = t.getAttribute("data-wii-theme");
      if (tema(id) && tema(id).listo) { guarda(id); if (K) { K.closeSheet(); } }
      return;
    }
    cont = document.querySelector(".wii-pages");
    if (!cont) { return; }
    if (t.hasAttribute("data-wii-pg")) { irPagina(cont, Number(t.getAttribute("data-wii-pg")) || 0); return; }
    irPagina(cont, Math.round(cont.scrollLeft / Math.max(1, cont.clientWidth)) + (Number(t.getAttribute("data-wii-step")) || 0));
  }, true);
  document.addEventListener("scroll", function (e) {
    if (e.target && e.target.classList && e.target.classList.contains("wii-pages")) { marcaPunto(e.target); }
  }, true);
  /* al girar el celular o cambiar el tamaño de la ventana cambian las filas que caben por página */
  (function () {
    var timer = null;
    var w = window.innerWidth;
    var h = window.innerHeight;
    window.addEventListener("resize", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (!K || !document.querySelector(".wii-pages")) { return; }
        if (Math.abs(window.innerWidth - w) < 2 && Math.abs(window.innerHeight - h) < 80) { return; } // el teclado o la barra del navegador no cuentan
        w = window.innerWidth; h = window.innerHeight;
        K.render(true);
      }, 220);
    });
  })();

  window.HFMTheme = {
    list: TEMAS,
    actual: actual,
    themed: themed,
    nombre: function () { return (tema(actual()) || TEMAS[0]).nombre; },
    light: function (view) { return themed() && !!CLARAS[view]; },
    view: function (view, kit) { K = kit; return themed() && PLAZA[view] ? plaza(view, kit) : null; },
    nav: function (kit, tabs, on) { K = kit; return barra(kit, tabs, on); },
    sheet: function (kit) { K = kit; return hoja(kit); },
    after: function (root) {
      var cont = root.querySelector(".wii-pages");
      pintaReloj();
      if (!cont) { return; }
      cont.scrollLeft = (pagina[cont.getAttribute("data-key")] || 0) * cont.clientWidth;
      marcaPunto(cont);
    }
  };
})();
