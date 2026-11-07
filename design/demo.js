/* Solo desarrollo: carga una biblioteca de demostración (cuenta «demo-ui») para revisar las pantallas sin Telegram.
 * En la consola de http://localhost:5173:  var s=document.createElement("script");s.src="design/demo.js";document.head.appendChild(s);
 * Para borrar sus datos: Object.keys(localStorage).filter(k=>k.indexOf(".demo-ui")>0).forEach(k=>localStorage.removeItem(k)) */
(function () {
  "use strict";
  var mk = function (k, cap, d, dur, extra) {
    return Object.assign({ key: "demo:" + k, chatId: "demo", chatTitle: "Películas Familia", msgId: k, kind: "video", caption: cap,
      fileName: "video_" + k + ".mp4", duration: dur || 1500, size: 9e8, width: 1920, height: 1080, date: d }, extra || {});
  };
  var demo = [
    mk(1, "pelicula#Viaje espacial (2023)#Una familia cruza la galaxia en busca de un nuevo hogar, entre planetas desconocidos y decisiones difíciles.", 60, 6720),
    mk(2, "pelicula#Montaña lejana (2021)#Una familia viaja a la montaña y aprende a reconectar lejos del ruido cotidiano.", 20, 5880),
    mk(3, "pelicula#Cabaña nevada (2019)#Una cabaña en la nieve reúne a una familia. #infantil", 30, 6060),
    mk(4, "pelicula#Luces nocturnas (2022)#Una noche en la carretera cambia los planes de una familia.", 31, 7500),
    mk(5, "pelicula#Aventura lunar (2024)#La imaginación no tiene gravedad. #infantil", 55, 5340),
    mk(10, "serie(1/1)#Bosque mágico#La primera luz#Mía y Leo siguen una luciérnaga. #infantil", 40, 1320),
    mk(11, "serie(1/2)#Bosque mágico#El río que canta#El río guarda una melodía. #infantil", 41, 1440),
    mk(12, "serie(1/3)#Bosque mágico#El secreto de las luces#Descubren por qué el bosque brilla. #infantil", 42, 1380),
    mk(13, "serie(1/4)#Bosque mágico#La lechuza sabia#Una lechuza les enseña a leer las estrellas. #infantil", 43, 1320),
    mk(14, "serie(2/1)#Bosque mágico#Invierno#El bosque se cubre de nieve. #infantil", 44, 1320),
    mk(20, "serie(1x01)#Ciudad neón#Luces de neón#La ciudad se apaga y solo una torre sigue encendida.", 50, 2640),
    mk(21, "serie(1x02)#Ciudad neón#El taller#Nora encuentra un aparato.", 51, 2460),
    mk(22, "serie(1x03)#Ciudad neón#Señales#La misma luz aparece cada noche.", 52, 2580),
    mk(23, "serie(1x04)#Ciudad neón#Interferencia#La señal se repite.", 53, 2760),
    mk(30, "Vacaciones en la playa 2024", 61, 300, { fileName: "VID_20240712_playa.mp4" }),
    mk(31, "", 62, 200, { fileName: "Cumpleaños_Ana.mp4" })
  ];
  cancelLogin();
  telegramUser = { id: "demo-ui", name: "Usuario Demo", username: "demo" };
  HFLibrary.setAccount("demo-ui");
  HFLibrary.setEnabledSources({ demo: "Películas Familia" });
  settings.dialogs = [
    { id: "s", title: "Mensajes guardados", kind: "saved" }, { id: "demo", title: "Películas Familia", kind: "channel" },
    { id: "b", title: "Series HD", kind: "channel" }, { id: "c", title: "Grupo de la familia", kind: "group" },
    { id: "d", title: "Dibujos animados", kind: "channel" }, { id: "e", title: "Documentales", kind: "group" },
    { id: "u1", title: "Ana", kind: "user" }, { id: "u2", title: "Carlos", kind: "user" }
  ];
  settings.counts = { s: 303, demo: 16, b: 64, c: 13, d: 42, e: 7, u1: 2, u2: 0 };
  HFTelegram.videoCount = function (id) { return Promise.resolve(settings.counts[id] || 0); };
  lastSyncAt = Date.now();
  setLibraryItems(demo);
  HFLibrary.setProgress("demo:2", 2400, 5880);
  HFLibrary.setProgress("demo:10", 1320, 1320);
  HFLibrary.setProgress("demo:11", 1440, 1440);
  HFLibrary.setProgress("demo:12", 800, 1380);
  window.__demoReady = true;
})();
