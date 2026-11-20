/* Tablero de diseño · abre la app de TV real en una vista concreta con la biblioteca exportada (solo desarrollo).
 * La carga js/ui/app.js cuando la dirección lleva ?design=<vista> (en la TV nunca pasa: design/ no va en el .wgt).
 * No se conecta a Telegram: las funciones de red quedan reemplazadas por los datos de design/media/. */
(function () {
  "use strict";
  var s = document.createElement("script");
  s.src = "design/demo-data.js";
  s.onload = start;
  document.head.appendChild(s);

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function stubTelegram(items) {
    var exists = {};
    HFTelegram.image = function (key) {
      var url = HFDemo.mediaUrl(key);
      if (exists[url] === undefined) {
        exists[url] = fetch(url, { method: "HEAD" }).then(function (r) { return r.ok ? url : null; }, function () { return null; });
      }
      return exists[url];
    };
    HFTelegram.imageReady = function () { return null; };
    HFTelegram.scan = function () { return Promise.resolve(items); };
    HFTelegram.videoCount = function () { return Promise.resolve(18); };
    HFTelegram.dialogs = function () { return Promise.resolve(DIALOGS); };
    HFTelegram.available = function () { return true; }; // portadas sí; el reproductor pasa al simulador en su vista
  }

  var DIALOGS = [
    { id: "self", title: "Mensajes guardados", kind: "saved" }, { id: "-5479575394", title: "NETSUCKS", kind: "group" },
    { id: "b", title: "Series HD", kind: "channel" }, { id: "c", title: "Grupo de la familia", kind: "group" },
    { id: "d", title: "Dibujos animados", kind: "channel" }, { id: "e", title: "Documentales", kind: "group" }
  ];

  function title(re) {
    return Object.keys(library.titles).map(function (k) { return library.titles[k]; }).filter(function (t) { return re.test(t.name); })[0];
  }

  var VIEWS = {
    "splash": function () { openSplash("Pulsa OK para iniciar sesión con Telegram"); },
    "login-qr": function () {
      showRoute("login");
      loginState = "qr";
      renderLogin();
      byId("loginQr").innerHTML = HFTelegram.qrSvg("tg://login?token=AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8w", 8);
      updateStatus("Esperando que escanees el código…");
    },
    "login-password": function () { showRoute("login"); loginState = "password"; renderLogin(); },
    "profiles": function () { openProfiles("Hola, David Vasquez. ¿Quién está viendo?"); },
    "profile-edit": function () { showProfileEditor(HFLibrary.profiles()[1].id); },
    "settings": function () { openSettings({ returnTo: "browse" }); },
    "browse-home": function () { enterProfile(HFLibrary.profiles()[0].id); },
    "browse-rows": async function () {
      enterProfile(HFLibrary.profiles()[0].id);
      await sleep(300);
      focusAreaByName("row-recent", 1);
    },
    "browse-movies": function () { enterProfile(HFLibrary.profiles()[0].id); openBrowse("movies"); },
    "browse-series": function () { enterProfile(HFLibrary.profiles()[0].id); openBrowse("series"); },
    "guide": function () { enterProfile(HFLibrary.profiles()[0].id); openGuide(); },
    "search": function () {
      enterProfile(HFLibrary.profiles()[0].id);
      openSearch();
      byId("searchInput").value = "spi";
      renderSearchResults("grid-0", 0);
    },
    "detail-movie": function () { enterProfile(HFLibrary.profiles()[0].id); openDetail(title(/Hoppers/)); },
    "detail-series": function () { enterProfile(HFLibrary.profiles()[0].id); openDetail(title(/Ciudad ne/)); },
    "player": async function () {
      var t = title(/Hoppers/);
      enterProfile(HFLibrary.profiles()[0].id);
      HFTelegram.available = function () { return false; }; // sin Telegram: el reproductor usa su simulador
      openPlayer(t.video, 600);
      await sleep(1500);
      HFPlayback.pause();
      showPlayerOverlay();
    }
  };

  function start() {
    var view = HFDemo.param("design");
    HFDemo.load().then(async function (items) {
      var prog = HFDemo.progressFor(items);
      cancelLogin();
      telegramUser = { id: "demo-ui", name: "David Vasquez", username: "AndresVz14" };
      HFLibrary.setAccount("demo-ui");
      /* los avatares de la cuenta real (solo en el origen del tablero, 127.0.0.1: no toca los perfiles de verdad) */
      var AV = { Familia: "01-Spider-Man", Santiago: "02-Captain_Carter", Kids: "04-Spider-Man_comic", Invitado: "03-Iron_Man" };
      HFLibrary.profiles().forEach(function (p) {
        if (AV[p.name] && p.avatar !== AV[p.name]) {
          HFLibrary.saveProfile({ id: p.id, name: p.name, avatar: AV[p.name], kids: p.kids });
        }
      });
      HFLibrary.setEnabledSources({ "-5479575394": "NETSUCKS" });
      HFLibrary.progress = function (k) { return prog[k] || null; };
      HFLibrary.allProgress = function () { return prog; };
      HFLibrary.setProgress = function () {};
      stubTelegram(items);
      syncedAt[HFLibrary.accountId() + ":-5479575394"] = Date.now();
      setLibraryItems(items);

      await sleep(50);
      /* La app carga las portadas al entrar en pantalla; dentro del tablero (cuadro reducido) eso casi nunca pasa,
       * así que aquí se piden todas. */
      setInterval(function () {
        toArray(document.querySelectorAll("[data-img]:not([data-queued])")).forEach(queueImage);
      }, 400);
      (VIEWS[view] || VIEWS["browse-home"])();
      document.documentElement.setAttribute("data-design-ready", view);
    });
  }
})();
