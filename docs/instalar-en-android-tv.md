# HomeFlix en un Android TV / stick (por ejemplo, el de la mamá)

El APK de HomeFlix es **uno solo** para celular y Android TV. Al abrirlo en un aparato sin pantalla táctil (o con el
inicio «Leanback» de Android TV / Google TV / Fire TV) muestra **la interfaz de la TV** (la misma de Samsung) y se maneja
con el control remoto. En un celular sigue abriendo la del celular.

Qué cambia en un stick respecto a la TV Samsung:

- Flechas y OK funcionan solas. **ATRÁS** vuelve a la pantalla anterior; en la pantalla inicial cierra la app.
- Teclas ▶/❚❚, ◀◀, ▶▶, ■ y canales del control funcionan en el reproductor.
- La pantalla no se apaga mientras se ve una película.
- Las actualizaciones llegan igual que en la TV: botón ↻ de la barra de arriba → «Actualizar» → «Reiniciar ahora».
  Si una versión pide programa nuevo, el aviso dice **«Instalar»** y abre el instalador de Android (la primera vez pide
  permiso para instalar apps desconocidas: activarlo para HomeFlix).
- Aparece en «Ver en la TV» del celular como **«TV Android <modelo>»**. Igual que en Samsung, HomeFlix tiene que estar
  **abierta** en el stick (Android TV no deja abrirla desde el celular).

## Instalar sin sacar el stick del televisor

**A. Con la app «Downloader» (sirve aunque el PC no esté en esa casa)**

1. En el stick: instalar **Downloader** (tienda de apps del stick; en Fire TV se busca «Downloader»).
2. Ajustes del stick → Seguridad / Privacidad → **Instalar apps desconocidas** (o «Fuentes desconocidas») → activar
   para Downloader.
3. Abrir Downloader, escribir la dirección del APK y pulsar **Ir**:
   `https://scalvache.shop/productos/HomeFlix/actualizaciones/archivos/<versión>/homeflix-<versión>.apk`
   (la versión vigente se ve en `https://scalvache.shop/productos/HomeFlix/actualizaciones/v1`; la 1.1.68, la primera con
   modo TV y sin «(dev)» en el nombre, es `https://scalvache.shop/productos/HomeFlix/actualizaciones/archivos/1.1.68/homeflix-1.1.68.apk`).
4. Al terminar la descarga: **Instalar** → **Abrir**. HomeFlix queda en el inicio del stick.

**B. Por Wi-Fi desde el PC de HomeFlix (lo hace Claude; el PC y el stick en la misma red)**

1. En el stick: Ajustes → Preferencias del dispositivo → Acerca de → pulsar **7 veces** «Compilación» (activa las
   opciones de desarrollador).
2. Ajustes → Preferencias del dispositivo → Opciones de desarrollador → activar **Depuración por USB** y
   **Depuración inalámbrica** (Android 11 o más nuevo) o **Depuración ADB / de red** (versiones viejas, Fire TV).
3. Pasarle a Claude la **IP y el puerto** que muestra esa pantalla (y, en Android 11+, «Vincular con código»: el código y
   su puerto). Claude hace `adb pair` / `adb connect` / `adb install` desde el PC y abre la app.

El APK que se publica es el de compilación «debug» (paquete `com.homeflix.app.dev`, el mismo del celular); desde la 1.1.68 se llama «HomeFlix» en el inicio.

## Para probar en un celular sin tener un stick

`adb shell am start -n com.homeflix.app/.MainActivity --ez tv true` abre la interfaz de TV en el celular
(`--ez tv false` fuerza la del celular). El APK de prueba (`node tools/build-apk.mjs`) se llama `com.homeflix.app.dev`.

## Sin probar todavía (hay que ver en un stick real)

- El primer arranque completo: intro en video, inicio de sesión con QR, biblioteca, reproducción.
- Reproducir 4K / HEVC: depende del chip del stick (los de 1080p H.264 deberían ir bien en todos).
- «TV en vivo»: el APK trae ExoPlayer y `HFAndroid.liveOpen`; en modo TV no se ha probado el recuadro de vista previa.
- Escribir con el teclado en pantalla de Android TV (búsqueda, PIN, contraseña de Telegram).
