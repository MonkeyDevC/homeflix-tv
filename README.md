# HomeFlix TV

App de películas y series para televisores Samsung (Tizen), hecha con HTML, CSS y JavaScript sin frameworks.

**Versión web (iPhone, instalable desde Safari):** está en [`web/`](web/CLAUDE.md). Para verla: `node tools/serve.mjs` → `http://localhost:5173/web/`.

## Instalar en la TV con Apps2Samsung

1. En Apps2Samsung, agrega esta fuente: `github.com/MonkeyDevC/homeflix-tv`
   (CLI: `apps2samsung-cli sources add github.com/MonkeyDevC/homeflix-tv`).
2. Busca **HomeFlix** en el catálogo e instálala. Apps2Samsung la firma con tu certificado de Samsung.
3. Cuando salga una versión nueva, el gestor de apps instaladas ofrece actualizarla.

## Publicar una versión nueva

1. Sube `version="X.Y.Z"` en `config.xml` (tiene que ser mayor que la anterior).
2. Haz commit y crea la etiqueta:

   ```bash
   git tag vX.Y.Z && git push origin main vX.Y.Z
   ```

3. GitHub Actions arma `homeflix-X.Y.Z.wgt` y lo publica como release.

Para probar el paquete localmente: `node tools/build-wgt.mjs` → `dist/homeflix-<versión>.wgt`.

## Trabajar en local

```bash
node tools/serve.mjs
```

Abre http://localhost:5173 a 1920×1080. Flechas = mando, Enter = OK, Esc = Back.

### Clave de Telegram (una sola vez)

Quien usa HomeFlix solo escanea el QR. Para eso la app lleva la clave de API del publicador (tú), como Telegram pide a las apps publicadas:

1. En my.telegram.org → **API development tools**, crea una app y copia `api_id` y `api_hash`.
2. **Para los releases**: guárdalos como secretos del repo (el comando pide el valor):

   ```bash
   gh secret set TG_API_ID -R MonkeyDevC/homeflix-tv
   gh secret set TG_API_HASH -R MonkeyDevC/homeflix-tv
   ```

3. **Para trabajar en local**: crea `.env` en la raíz (está en `.gitignore`):

   ```
   TG_API_ID=1234567
   TG_API_HASH=tu_api_hash
   ```

La clave va ofuscada dentro de `js/config.js` del `.wgt`; el repo nunca la contiene. Si Telegram la rechazara, la app muestra un formulario de respaldo para escribir otra.

### Motor de Telegram

`js/tg.bundle.js` ya viene compilado. Solo hay que recompilarlo si cambias algo en `engine/`:

```bash
cd engine && npm ci && node build.mjs
```

Necesita Tizen 5.5 o más nuevo (BigInt). Basado en [titlog/telegram-tizen](https://github.com/titlog/telegram-tizen), ver `THIRD_PARTY_NOTICES.md`.

## Estructura

- `index.html`, `css/style.css`, `js/main.js`: la app.
- `config.xml`: manifiesto de Tizen (id del paquete, versión, perfil `tv-samsung`).
- `tools/build-wgt.mjs`: empaquetador sin dependencias.
- `.cursor/rules/`: reglas de ingeniería para TV (foco, rendimiento, APIs prohibidas).
