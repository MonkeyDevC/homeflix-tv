/* Captura el HTML de cada pantalla de HomeFlix con datos de demostración y lo guarda en design/snapshots/.
 * Uso (solo desarrollo, con node tools/serve.mjs): abrir http://localhost:5173 a 1920×1080 y ejecutar en la consola:
 *   var s = document.createElement("script"); s.src = "design/capture.js"; document.head.appendChild(s);
 * No usa datos reales de la cuenta: nombres de chats, cuenta y videos son inventados. No escribe progreso real. */
(async function () {
  "use strict";
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var done = [];

  /* ---------- Datos de demostración ---------- */
  var mk = function (k, cap, d, dur, extra) {
    return Object.assign({ key: "demo:" + k, chatId: "demo", chatTitle: "Películas Familia", msgId: k, kind: "video", caption: cap,
      fileName: "video_" + k + ".mp4", duration: dur || 1500, size: 9e8, width: 1920, height: 1080, date: d }, extra || {});
  };
  var demo = [
    mk(1, "pelicula#El Rey León (1994)#Simba, un joven león, debe aceptar su destino y reclamar el lugar que le corresponde como rey de la sabana. #infantil", 10, 5300),
    mk(2, "pelicula#Coco (2017)#Miguel sueña con ser músico y termina en la Tierra de los Muertos buscando a su tatarabuelo, un legendario cantante. #infantil", 20, 6300),
    mk(3, "pelicula#Intensamente (2015)#Las emociones de Riley intentan guiarla durante una mudanza difícil.", 30, 5700),
    mk(4, "pelicula#Matrix (1999)#Un programador descubre que la realidad es una simulación.", 31, 8160),
    mk(5, "pelicula#Up (2009)#Un anciano ata miles de globos a su casa para cumplir una promesa.", 32, 5760),
    mk(10, "serie(1/1)#Bluey#Mágico xilófono#Bluey y Bingo descubren un xilófono que congela a papá. #infantil", 40, 420),
    mk(11, "serie(1/2)#Bluey#Hospital#Bluey juega a ser doctora y papá es el paciente. #infantil", 41, 430),
    mk(12, "serie(1/3)#Bluey#Llaves#Juegan a que el suelo es lava. #infantil", 42, 410),
    mk(13, "serie(2/1)#Bluey#Bailar#Bingo aprende un baile nuevo. #infantil", 43, 440),
    mk(20, "serie(1x01)#Dark#Secretos#Un niño desaparece en Winden y saca a la luz los secretos de cuatro familias.", 50, 3200),
    mk(21, "serie(1x02)#Dark#Mentiras#Mikkel aparece en otra época.", 51, 3100),
    mk(22, "serie(1x03)#Dark#Pasado y presente#Ulrich busca respuestas en la cueva.", 52, 3300),
    mk(30, "Vacaciones en la playa 2024", 60, 300, { fileName: "VID_20240712_playa.mp4" }),
    mk(31, "", 61, 200, { fileName: "Cumpleaños_Ana.mp4" })
  ];

  /* Progreso en memoria (sin tocar el localStorage real) */
  var fakeProgress = { "demo:2": { t: 2400, d: 6300, at: 3 }, "demo:10": { t: 0, d: 420, at: 1, done: true }, "demo:11": { t: 200, d: 430, at: 2 }, "demo:20": { t: 900, d: 3200, at: 1 } };
  HFLibrary.progress = function (k) { return fakeProgress[k] || null; };
  HFLibrary.allProgress = function () { return fakeProgress; };
  HFLibrary.setProgress = function () {};
  HFLibrary.myList = function () { return ["m:coco:2017", "s:dark"]; };
  HFLibrary.inMyList = function (k) { return k === "m:coco:2017" || k === "s:dark"; };
  HFLibrary.enabledSources = function () { return { demo: "Películas Familia" }; };
  HFTelegram.image = function () { return Promise.resolve(null); };

  telegramUser = { id: 1, name: "Usuario Demo", username: "usuario" };
  libraryItems = demo;
  fullLibrary = HFLibrary.build(demo, {});
  activeProfile = HFLibrary.profiles()[0];
  library = fullLibrary;
  syncing = false;
  syncError = "";
  lastSyncAt = Date.now();

  /* ---------- Captura ---------- */
  async function snap(name, label) {
    var app = byId("app");
    var route = app.getAttribute("data-route");
    var screen = document.querySelector('#app > [data-screen="' + route + '"]');
    var status = byId("status");
    toArray(screen.querySelectorAll("input")).forEach(function (i) { i.setAttribute("value", i.value); });
    await sleep(400);
    var html = '<div id="app" data-route="' + route + '" data-active-area="' + (app.getAttribute("data-active-area") || "") + '">' +
      screen.outerHTML + status.outerHTML + "</div>";
    await fetch("/__snapshot/" + name, { method: "POST", body: JSON.stringify({ label: label, html: html }) });
    done.push(name);
  }

  // 1. Inicio (splash)
  navigateTo("splash", "Selecciona una opción para continuar");
  splashPrimaryEl.textContent = "INICIAR SESIÓN";
  await snap("01-splash", "Pantalla inicial");

  // 2. Login con QR
  showRoute("login");
  loginQrEl.innerHTML = HFTelegram.qrSvg("tg://login?token=AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8w", 8);
  loginState = "qr"; loginShellEl.setAttribute("data-login-state", "qr");
  setAreas([{ name: "login", selector: '[data-area="login-qr"]', dir: "v" }]);
  updateStatus("Escanea el código con Telegram");
  await snap("02-login-qr", "Login: código QR de Telegram");

  // 3. Login: clave de API (respaldo)
  loginState = "api"; loginShellEl.setAttribute("data-login-state", "api");
  setAreas([{ name: "login", selector: '[data-area="login-api"]', dir: "v" }]);
  updateStatus("Configura la clave de API de Telegram");
  await snap("03-login-api", "Login: clave de API (solo si Telegram rechaza la incluida)");

  // 4. Perfiles
  showRoute("profiles"); renderProfiles(false);
  updateStatus("Hola, Usuario Demo. Selecciona un perfil");
  await snap("04-profiles", "¿Quién está viendo?");

  // 5. Editor de perfil
  openProfileEditor(HFLibrary.profiles()[2].id);
  focusAreaByName("form", 1);
  await snap("05-profile-edit", "Editar perfil");

  // 6. Ajustes: chats
  settings.dialogs = [
    { id: "s", title: "Mensajes guardados", kind: "saved" },
    { id: "a", title: "Películas Familia", kind: "channel" },
    { id: "b", title: "Series HD", kind: "channel" },
    { id: "c", title: "Grupo de la familia", kind: "group" },
    { id: "d", title: "Dibujos animados", kind: "channel" },
    { id: "e", title: "Documentales", kind: "group" },
    { id: "f", title: "Música y conciertos", kind: "channel" }
  ];
  settings.counts = { s: 303, a: 128, b: 64, c: 13, d: 42, e: 7, f: 0 };
  settings.tab = "groups";
  settings.firstTime = false;
  showRoute("settings");
  settings.selected = { a: "Películas Familia", d: "Dibujos animados" };
  renderSettings();
  focusAreaByName("settings-list", 1);
  updateStatus("Activa o desactiva chats con OK");
  await snap("06-settings", "Ajustes: chats de la biblioteca");

  // 7. Catálogo: inicio
  browse.section = "home";
  showRoute("browse"); renderBrowse(null, 0);
  updateStatus("Perfil: Familia");
  await snap("07-browse-home", "Catálogo: Inicio (destacado)");

  // 8. Catálogo: filas (bajando)
  focusAreaByName("row-recent", 1);
  await snap("08-browse-rows", "Catálogo: filas");

  // 9. Catálogo: series (cuadrícula)
  browse.section = "series";
  renderBrowse("topnav", 2);
  focusAreaByName("grid-0", 0);
  await snap("09-browse-series", "Catálogo: Series (cuadrícula)");

  // 10. Catálogo vacío
  var savedLib = library;
  library = HFLibrary.build([], {});
  browse.section = "home";
  renderBrowse(null, 0);
  await snap("10-browse-empty", "Catálogo sin videos");
  library = savedLib;

  // 11. Ficha película
  openDetail(library.titles["m:coco:2017"]);
  await snap("11-detail-movie", "Ficha de película (a medias)");

  // 12. Ficha serie
  openDetail(library.titles["s:bluey"]);
  await snap("12-detail-series", "Ficha de serie");
  focusAreaByName("episodes", 1);
  await snap("13-detail-episodes", "Ficha de serie: capítulos");

  // 14. Video sin clasificar
  openDetail(library.unclassified[0]);
  await snap("14-detail-video", "Video sin clasificar");

  // 15. Etiquetar
  openTagEditor(library.unclassified[0], function () {});
  tagEdit.f.type = "series"; tagEdit.f.name = "Bluey"; tagEdit.f.episode = 4; tagEdit.f.kids = true;
  renderTagEditor("form", 1);
  await snap("15-tag-edit", "Etiquetar video desde la TV");

  // 16. Buscar
  showRoute("search");
  byId("searchInput").value = "co";
  renderSearchResults("grid-0", 0);
  await snap("16-search", "Buscar");

  // 17-19. Reproductor (simulado)
  openPlayer(library.titles["s:dark"].seasons[0].episodes[1], 900, library.titles["s:dark"]);
  await sleep(1800);
  HFPlayback.seek(1500);
  focusAreaByName("player-controls", 1);
  await snap("17-player", "Reproductor con controles");
  player.tracksOpen = true;
  byId("playerTracks").setAttribute("data-visible", "true");
  byId("playerTracksAudio").innerHTML = '<div class="tracks-item" data-focusable="true" data-on="true" tabindex="0">Español Latino · 5.1</div><div class="tracks-item" data-focusable="true" data-on="false" tabindex="0">Inglés · Estéreo</div>';
  byId("playerTracksSubs").innerHTML = '<div class="tracks-item" data-focusable="true" data-on="false" tabindex="0">Desactivados</div><div class="tracks-item" data-focusable="true" data-on="true" tabindex="0">Español</div><div class="tracks-item" data-focusable="true" data-on="false" tabindex="0">Inglés · forzados</div>';
  setAreas([{ name: "a", items: byId("playerTracksAudio").children, dir: "v", sideways: true }, { name: "b", items: byId("playerTracksSubs").children, dir: "v", sideways: true }], "b", 1);
  await snap("18-player-tracks", "Reproductor: audio y subtítulos");
  player.tracksOpen = false;
  byId("playerTracks").setAttribute("data-visible", "false");
  HFPlayback.seek(HFPlayback.duration() - 12);
  await sleep(1500);
  await snap("19-player-next", "Reproductor: siguiente capítulo");
  HFPlayback.close();

  console.log("Capturas listas:", done.join(", "));
  window.__captureDone = done;
})();
