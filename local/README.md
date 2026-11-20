# HomeFlix en este computador (Docker)

El VPS ya no existe. El servidor de HomeFlix y el motor de recomendaciones corren aquí, en Docker Desktop:

| Contenedor | Qué es | Dónde |
|---|---|---|
| `homeflix` | Servidor Node: sincronización, «Ver en la TV», actualizaciones y puerta a las recomendaciones | http://192.168.1.12:4500/productos/HomeFlix (toda la red de la casa) |
| `reco-api` | Motor de recomendaciones (FastAPI) | Sin puerto; solo lo alcanza `homeflix` |
| `reco-worker` | Lee NETSUCKS, TMDB, historial y **@night_monkey_bot** (búsqueda por voz) | Usa la sesión de Telegram Premium |
| `reco-db` | Postgres + pgvector del motor | Sin puerto |

## Uso
```bash
bash local/levantar.sh            # levanta o actualiza todo (y lo reconstruye si cambió el código)
bash local/levantar.sh --estado   # cómo está cada contenedor
bash local/levantar.sh --parar    # lo detiene; los datos quedan en los volúmenes
docker logs -f reco-worker        # qué está haciendo el motor / el bot
```
Docker Desktop tiene que estar abierto. Los contenedores tienen `restart: unless-stopped`, así que vuelven solos al abrir Docker.

## Claves y sesiones
- `recomendador/.env` y `servidor/.env` se crearon con secretos al azar. Están en `.gitignore`.
  - Las claves de Telegram y del bot salen de `~/Documents/night_monkey_bot/.env`.
  - La de TMDB, del `.env` de la raíz.
- La sesión de Telegram Premium y la del bot están en el volumen `homeflix-local_reco-sesiones`.
- **No vuelvas a correr `~/Documents/night_monkey_bot/bot.py`.** Ese bot ya vive en `reco-worker`. Si la misma sesión corre en dos lugares, Telegram la invalida (`AUTH_KEY_DUPLICATED`).
- `CATALOGO_CHATS=-1004437120043` es NETSUCKS. Para sumar otro grupo, sepáralo con coma (por ejemplo «HOMEFLIX», `-1003963265138`) y vuelve a correr `levantar.sh`.
- **Buzón** (opcional): sirve para que el bot entienda los audios de toda la familia, no solo los del dueño.
  1. Crea un grupo privado con la cuenta Premium y @night_monkey_bot.
  2. Pon su id en `BUZON_CHAT`.
  3. Vuelve a correr `levantar.sh`.

## Red de la casa (desde la 1.2.0)
- **Dirección de fábrica:** las apps 1.2.0 traen `http://192.168.1.12:4500/productos/HomeFlix` (`js/config.js`, `HF_SERVIDOR_DEFECTO`).
  - **Reserva esa IP para el Mac en el router**, para que no cambie.
  - Si cambia: en el celular, Ajustes → **Servidor de HomeFlix**. La app prueba la dirección, la guarda y la deja en tu cuenta de Telegram, y la TV la toma sola la próxima vez que abra.
- **Solo HTTP dentro de la casa:** el APK acepta `http://` solo hacia direcciones de la red local (192.168.x, 10.x, 172.16–31.x, `*.local`). Hacia afuera, solo HTTPS.
  - La llave de la cuenta viaja sin cifrar dentro del Wi-Fi.
- **Actualizaciones:** salen de este Mac con `node tools/publicar-version.mjs <x.y.z> --notas "…" --local` (y `--programa` si cambió lo nativo).
  - Para compilar el APK hace falta `ANDROID_HOME=~/Library/Android/sdk` y `JAVA_HOME=$(/usr/libexec/java_home)`.
- **Rutas internas:** `/interno/v1/*` ahora se alcanzan desde la red de la casa, pero piden `ADMIN_TOKEN` o `RECO_TOKEN`; sin el token responden 404.

## Reinstalar una vez (las apps anteriores a la 1.2.0 buscaban el VPS y no pueden actualizarse solas)
- **Celular Android / Android TV:** con el celular en el mismo Wi-Fi, abre en el navegador
  `http://192.168.1.12:4500/productos/HomeFlix/actualizaciones/archivos/1.2.0/homeflix-1.2.0.apk`, bájalo e instálalo.
  - **Ojo con la firma:** el APK se firma con la llave de depuración de la máquina que lo arma (`~/.android/debug.keystore`).
    - La 1.2.0 se armó en este Mac, y las anteriores en el PC Windows: Android **no deja instalarla encima** de la vieja.
    - Para instalar encima sin perder nada, copia la llave del PC (`C:\Users\<tú>\.android\debug.keystore`) a `~/.android/debug.keystore` en este Mac y vuelve a armar la versión.
    - Si no, hay que desinstalar la app vieja primero. Se pierde lo guardado en ese celular: la sesión de Telegram (se vuelve a escanear el QR) y el progreso que no se haya sincronizado.
- **TV Samsung:** Apps2Samsung instala desde los releases de GitHub (`MonkeyDevC/homeflix-tv`). Hay que publicar ahí la 1.2.0: commit, etiqueta `v1.2.0` y push, y GitHub Actions arma el `.wgt`.
  El `.wgt` ya armado también está en `local/versiones/1.2.0/`.
- **Después de la 1.2.0** todo llega solo por OTA desde este Mac.
