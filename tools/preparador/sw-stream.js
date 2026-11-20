/* Reproducir un video de Telegram dentro del preparador SIN bajarlo entero.
 * El <video> pide trozos (Range) a /hf-stream/…; este service worker se los pide a la página, que los lee de Telegram con el cliente
 * (ya abierto con tu sesión) y los devuelve. Nada se guarda en el disco. */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (url.pathname.indexOf("/hf-stream/") !== 0) { return; }
  event.respondWith(serve(event, url));
});
function ask(client, msg) {
  return new Promise(function (ok, no) {
    var ch = new MessageChannel();
    var t = setTimeout(function () { no(new Error("Telegram tardó demasiado")); }, 60000);
    ch.port1.onmessage = function (e) { clearTimeout(t); if (e.data && e.data.ok) { ok(e.data.buf); } else { no(new Error((e.data && e.data.error) || "No se pudo leer el video")); } };
    client.postMessage(msg, [ch.port2]);
  });
}
async function serve(event, url) {
  var size = Number(url.searchParams.get("size")) || 0;
  var type = url.searchParams.get("type") || "video/mp4";
  var key = url.searchParams.get("k") || "";
  var m = /bytes=(\d+)-(\d*)/.exec(event.request.headers.get("range") || "");
  var start = m ? Number(m[1]) : 0;
  var end = m && m[2] ? Number(m[2]) : size - 1;
  var client;
  var buf;
  if (!size || start >= size) { return new Response("", { status: 416, headers: { "Content-Range": "bytes */" + size } }); }
  end = Math.min(end, size - 1, start + 4 * 1048576 - 1); // trozos de hasta 4 MB: el navegador pide el siguiente
  try {
    client = (event.clientId && (await self.clients.get(event.clientId))) || (await self.clients.matchAll({ type: "window" }))[0];
    if (!client) { throw new Error("No hay página abierta"); }
    buf = await ask(client, { k: key, start: start, len: end - start + 1 });
  } catch (e) {
    return new Response(String(e.message || e), { status: 502 });
  }
  return new Response(buf, { status: 206, headers: { "Content-Type": type, "Content-Range": "bytes " + start + "-" + (start + buf.byteLength - 1) + "/" + size, "Content-Length": String(buf.byteLength), "Accept-Ranges": "bytes", "Cache-Control": "no-store" } });
}
