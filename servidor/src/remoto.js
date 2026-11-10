// HomeFlix · «Ver en la TV»: un canal en vivo entre los dispositivos de una misma cuenta.
//
// Cada app abierta escucha (GET …/remoto/escuchar, Server-Sent Events). Otra app de la misma cuenta pregunta quién
// está conectado (GET …/remoto/dispositivos) y le manda mensajes (POST …/remoto/enviar {a, msg}); el servidor solo los
// reparte, no los interpreta ni los guarda. Así el celular le dice a la TV «reproduce esto en el minuto 39» y luego
// «pausa», y la TV le contesta con su estado.
//
// Todo vive en memoria: si el contenedor se reinicia, las apps se vuelven a conectar solas en unos segundos.

const MAX_MSG = 16 * 1024;
const LATIDO = 20_000; // un comentario cada 20 s mantiene viva la conexión (Caddy, routers, la app)

export function crearRemoto({ ahora = () => Date.now() } = {}) {
  const cuentas = new Map(); // cuenta → Map(idDispositivo → {id, tipo, nombre, desde, res})

  function escribir(res, texto) {
    try { res.write(texto); return true; } catch { return false; }
  }

  function quitar(cuenta, id, res) {
    const m = cuentas.get(cuenta);
    if (!m) return;
    const d = m.get(id);
    if (d && (!res || d.res === res)) m.delete(id);
    if (!m.size) cuentas.delete(cuenta);
  }

  /** Deja abierta la respuesta como flujo de eventos para este dispositivo. */
  function escuchar(cuenta, dispositivo, req, res, cabeceras) {
    const id = String(dispositivo.id || '').slice(0, 64);
    if (!id) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', ...cabeceras });
      res.end(JSON.stringify({ error: 'sin_dispositivo' }));
      return;
    }
    let m = cuentas.get(cuenta);
    if (!m) cuentas.set(cuenta, (m = new Map()));
    const viejo = m.get(id);
    if (viejo) { try { viejo.res.end(); } catch { /* ya cerrada */ } } // el mismo dispositivo se reconectó
    const yo = { id, tipo: String(dispositivo.tipo || '').slice(0, 16), nombre: String(dispositivo.nombre || '').slice(0, 80), desde: ahora(), res };
    m.set(id, yo);

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
      ...cabeceras,
    });
    escribir(res, 'retry: 3000\n\n');
    escribir(res, `event: hola\ndata: ${JSON.stringify({ id })}\n\n`);
    const latido = setInterval(() => { if (!escribir(res, ': k\n\n')) cerrar(); }, LATIDO);
    latido.unref?.();
    function cerrar() { clearInterval(latido); quitar(cuenta, id, res); }
    req.on('close', cerrar);
    res.on('error', cerrar);
  }

  /** Los dispositivos de la cuenta conectados ahora, menos el que pregunta. */
  function dispositivos(cuenta, menos) {
    const m = cuentas.get(cuenta);
    if (!m) return [];
    return [...m.values()].filter((d) => d.id !== menos).map(({ id, tipo, nombre, desde }) => ({ id, tipo, nombre, desde }));
  }

  /** Manda msg a un dispositivo (a = su id) o a todos los demás (a = '*'). Devuelve a cuántos llegó. */
  function enviar(cuenta, de, a, msg) {
    const m = cuentas.get(cuenta);
    if (!m) return 0;
    const yo = m.get(de) || { id: de, tipo: '', nombre: '' };
    const texto = `data: ${JSON.stringify({ de: { id: yo.id, tipo: yo.tipo, nombre: yo.nombre }, msg })}\n\n`;
    let n = 0;
    for (const d of m.values()) {
      if (d.id === de || (a !== '*' && d.id !== a)) continue;
      if (escribir(d.res, texto)) n += 1;
    }
    return n;
  }

  function conectados() {
    let n = 0;
    for (const m of cuentas.values()) n += m.size;
    return n;
  }

  return { escuchar, dispositivos, enviar, conectados, MAX_MSG };
}
