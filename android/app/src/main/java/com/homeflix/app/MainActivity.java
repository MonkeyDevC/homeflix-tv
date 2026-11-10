package com.homeflix.app;

import android.annotation.SuppressLint;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

/**
 * HomeFlix en el celular: una sola pantalla con un WebView que carga mobile/index.html.
 * Todo lo de la app (Telegram, biblioteca, reproductor) es el mismo motor web que la TV (js/).
 *
 * Los archivos se sirven desde el propio APK en https://appassets.androidplatform.net/ (origen https fijo:
 * IndexedDB y localStorage guardan la sesión de Telegram entre aperturas).
 * Lo nativo es lo mínimo que la web no puede hacer sola: pantalla completa y giro para el reproductor,
 * mantener la pantalla encendida, el botón Atrás y los márgenes de la barra de estado y de navegación.
 */
public class MainActivity extends AppCompatActivity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/mobile/index.html";

    private WebView web;
    private WebViewAssetLoader assets;
    private Actualizador actualizador;
    private int safeTop = 0;
    private int safeBottom = 0;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        preferHighRefresh(true);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0b0c0e"));
        /* El video de TV en vivo (ExoPlayer) va DETRÁS del WebView: la página es transparente donde se ve. */
        rootView = new android.widget.FrameLayout(this);
        rootView.setBackgroundColor(Color.parseColor("#0b0c0e"));
        liveView = new androidx.media3.ui.PlayerView(this);
        liveView.setUseController(false);
        liveView.setResizeMode(androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT);
        liveView.setShutterBackgroundColor(Color.BLACK);
        liveView.setVisibility(View.GONE);
        rootView.addView(liveView, new android.widget.FrameLayout.LayoutParams(1, 1));
        rootView.addView(web, new android.widget.FrameLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(rootView);

        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true); // chrome://inspect desde el PC
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setTextZoom(100); // el tamaño de letra del sistema no desarma el diseño

        /* Primero la interfaz bajada del servidor de HomeFlix (si hay y arrancó bien); lo que no esté ahí, del APK. */
        actualizador = new Actualizador(this);
        assets = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/", actualizador.handler())
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                return !(HOST.equals(u.getHost()) || isDevUrl(u.toString()));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pushInsets();
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "HFAndroid");

        /* Márgenes de la barra de estado y de navegación → variables CSS (--safe-top / --safe-bottom). */
        ViewCompat.setOnApplyWindowInsetsListener(web, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            float d = getResources().getDisplayMetrics().density;
            safeTop = Math.round(bars.top / d);
            safeBottom = Math.round(bars.bottom / d);
            pushInsets();
            return insets;
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                /* La app web decide (cerrar una hoja, volver de la ficha…); si no hay a dónde volver, se sale. */
                web.evaluateJavascript("(window.HFMobile && HFMobile.back) ? String(HFMobile.back()) : 'false'", r -> {
                    if (!"\"true\"".equals(r)) {
                        finish();
                    }
                });
            }
        });

        if (savedInstanceState == null) {
            String dev = BuildConfig.DEV_URL;
            web.loadUrl(BuildConfig.DEBUG && dev != null && !dev.isEmpty() ? dev : START);
        } else {
            web.restoreState(savedInstanceState);
        }
    }

    /** Pide el modo de pantalla con más Hz (120 en paneles que lo tienen) para que la app y la intro se vean fluidas;
     *  Android 15+ deja a las apps en 60 Hz si no lo piden. Con off, el sistema decide (en el reproductor: ahorra batería). */
    private void preferHighRefresh(boolean on) {
        try {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            int best = 0;
            float bestHz = 0;
            if (on) {
                android.view.Display d = getWindowManager().getDefaultDisplay();
                android.view.Display.Mode cur = d.getMode();
                for (android.view.Display.Mode m : d.getSupportedModes()) {
                    if (m.getPhysicalWidth() == cur.getPhysicalWidth() && m.getPhysicalHeight() == cur.getPhysicalHeight() && m.getRefreshRate() > bestHz) {
                        best = m.getModeId();
                        bestHz = m.getRefreshRate();
                    }
                }
            }
            lp.preferredDisplayModeId = best;
            lp.preferredRefreshRate = on ? bestHz : 0;
            getWindow().setAttributes(lp);
        } catch (Exception e) {
            /* el sistema decide */
        }
    }

    private boolean isDevUrl(String url) {
        String dev = BuildConfig.DEV_URL;
        return BuildConfig.DEBUG && dev != null && !dev.isEmpty() && url.startsWith(dev.replaceAll("(https?://[^/]+).*", "$1"));
    }

    private void pushInsets() {
        if (web == null) {
            return;
        }
        web.evaluateJavascript("document.documentElement.style.setProperty('--safe-top','" + safeTop + "px');" +
                "document.documentElement.style.setProperty('--safe-bottom','" + safeBottom + "px');", null);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    /* ===================== TVs Samsung en la red de la casa ===================== */

    private final java.util.concurrent.ExecutorService bg = java.util.concurrent.Executors.newCachedThreadPool();

    /** Respuesta a una llamada asíncrona de la página: HFNative.done(id, json). */
    private void reply(int cb, String json) {
        runOnUiThread(() -> {
            if (web != null) {
                web.evaluateJavascript("window.HFNative&&HFNative.done(" + cb + "," + org.json.JSONObject.quote(json) + ")", null);
            }
        });
    }

    /** HTTP mínimo por socket, solo para la API local de la TV (la app no permite HTTP sin cifrar por lo demás).
     *  Devuelve {código, cuerpo} (código vacío si la TV no respondió). */
    private String[] http(String method, String host, int port, String path, int timeout) {
        try (java.net.Socket s = new java.net.Socket()) {
            s.connect(new java.net.InetSocketAddress(host, port), timeout);
            s.setSoTimeout(timeout);
            /* HTTP/1.0: la respuesta llega entera, sin «chunked» */
            String req = method + " " + path + " HTTP/1.0\r\nHost: " + host + ":" + port + "\r\nConnection: close\r\n" +
                    ("POST".equals(method) ? "Content-Length: 0\r\n" : "") + "\r\n";
            s.getOutputStream().write(req.getBytes(java.nio.charset.StandardCharsets.US_ASCII));
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            java.io.InputStream in = s.getInputStream();
            while ((n = in.read(b)) > 0 && buf.size() < 512 * 1024) {
                buf.write(b, 0, n);
            }
            String all = buf.toString("UTF-8");
            int sp = all.indexOf(' ');
            int code = sp > 0 ? Integer.parseInt(all.substring(sp + 1, sp + 4)) : 0;
            int body = all.indexOf("\r\n\r\n");
            return new String[]{String.valueOf(code), body >= 0 ? all.substring(body + 4) : ""};
        } catch (Exception e) {
            return new String[]{"", ""};
        }
    }

    /** "on", "standby" (apagada pero con la red despierta) o null si no responde. */
    private String tvPower(String ip) {
        String[] r = http("GET", ip, 8001, "/api/v2/", 1500);
        if (!"200".equals(r[0])) {
            return null;
        }
        try {
            String p = new org.json.JSONObject(r[1]).getJSONObject("device").optString("PowerState", "on");
            return p.isEmpty() ? "on" : p;
        } catch (Exception e) {
            return "on";
        }
    }

    private org.json.JSONObject tvInfo(String ip, String appId) {
        String[] r = http("GET", ip, 8001, "/api/v2/", 1500);
        if (!"200".equals(r[0])) {
            return null;
        }
        try {
            org.json.JSONObject d = new org.json.JSONObject(r[1]).getJSONObject("device");
            org.json.JSONObject tv = new org.json.JSONObject();
            tv.put("ip", ip);
            tv.put("name", d.optString("name", "TV Samsung"));
            tv.put("model", d.optString("modelName", ""));
            tv.put("mac", d.optString("wifiMac", ""));
            tv.put("power", d.optString("PowerState", "on"));
            String[] a = http("GET", ip, 8001, "/api/v2/applications/" + appId, 2000);
            tv.put("installed", "200".equals(a[0]));
            tv.put("running", a[1].contains("\"running\":true"));
            return tv;
        } catch (Exception e) {
            return null;
        }
    }

    /** Busca TVs Samsung con SSDP (como la app SmartThings): devuelve sus IPs. */
    private java.util.List<String> ssdpSamsung(int ms) {
        java.util.List<String> ips = new java.util.ArrayList<>();
        try (java.net.DatagramSocket s = new java.net.DatagramSocket()) {
            s.setSoTimeout(300);
            byte[] q = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\n" +
                    "ST: urn:samsung.com:device:RemoteControlReceiver:1\r\n\r\n").getBytes(java.nio.charset.StandardCharsets.US_ASCII);
            java.net.InetAddress group = java.net.InetAddress.getByName("239.255.255.250");
            s.send(new java.net.DatagramPacket(q, q.length, group, 1900));
            s.send(new java.net.DatagramPacket(q, q.length, group, 1900));
            long until = System.currentTimeMillis() + ms;
            byte[] b = new byte[2048];
            while (System.currentTimeMillis() < until) {
                java.net.DatagramPacket p = new java.net.DatagramPacket(b, b.length);
                try {
                    s.receive(p);
                    String ip = p.getAddress().getHostAddress();
                    if (!ips.contains(ip)) {
                        ips.add(ip);
                    }
                } catch (java.net.SocketTimeoutException e) {
                    /* sigue esperando */
                }
            }
        } catch (Exception e) {
            /* sin red */
        }
        return ips;
    }

    /** Las IPs de la red de la casa (/24 del celular) con ese puerto abierto: 254 intentos en paralelo, ~2 s. */
    private java.util.List<String> sweepSubnet(int port) {
        java.util.List<String> found = java.util.Collections.synchronizedList(new java.util.ArrayList<>());
        try {
            java.util.List<String> prefixes = new java.util.ArrayList<>();
            for (java.net.NetworkInterface ni : java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) {
                    continue;
                }
                for (java.net.InetAddress a : java.util.Collections.list(ni.getInetAddresses())) {
                    if (a instanceof java.net.Inet4Address && a.isSiteLocalAddress()) {
                        String ip = a.getHostAddress();
                        String pre = ip.substring(0, ip.lastIndexOf('.') + 1);
                        if (!prefixes.contains(pre)) {
                            prefixes.add(pre);
                        }
                    }
                }
            }
            java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(64);
            for (String pre : prefixes) {
                for (int i = 1; i < 255; i++) {
                    final String host = pre + i;
                    pool.execute(() -> {
                        try (java.net.Socket s = new java.net.Socket()) {
                            s.connect(new java.net.InetSocketAddress(host, port), 350);
                            found.add(host);
                        } catch (Exception e) {
                            /* nada ahí */
                        }
                    });
                }
            }
            pool.shutdown();
            pool.awaitTermination(6, java.util.concurrent.TimeUnit.SECONDS);
        } catch (Exception e) {
            /* sin red */
        }
        return new java.util.ArrayList<>(found);
    }

    /** Wake-on-LAN: «paquete mágico» a la MAC de la TV (por difusión general y de su subred). */
    private void wakeOnLan(String mac, String ip) {
        try {
            String[] hex = mac.split("[:-]");
            byte[] m = new byte[6];
            for (int i = 0; i < 6; i++) {
                m[i] = (byte) Integer.parseInt(hex[i], 16);
            }
            byte[] pkt = new byte[6 + 16 * 6];
            for (int i = 0; i < 6; i++) {
                pkt[i] = (byte) 0xff;
            }
            for (int i = 6; i < pkt.length; i += 6) {
                System.arraycopy(m, 0, pkt, i, 6);
            }
            String subnet = ip.substring(0, ip.lastIndexOf('.')) + ".255";
            try (java.net.DatagramSocket s = new java.net.DatagramSocket()) {
                s.setBroadcast(true);
                for (String to : new String[]{"255.255.255.255", subnet}) {
                    for (int port : new int[]{9, 7}) {
                        s.send(new java.net.DatagramPacket(pkt, pkt.length, java.net.InetAddress.getByName(to), port));
                    }
                }
            }
        } catch (Exception e) {
            /* MAC mal escrita o sin red */
        }
    }

    /* ===================== TV en vivo (IPTV): ExoPlayer detrás del WebView ===================== */

    private android.widget.FrameLayout rootView;
    private androidx.media3.ui.PlayerView liveView;
    private androidx.media3.exoplayer.ExoPlayer live;
    private String liveUrl = "";
    private String liveUa = "";
    private String liveRef = "";
    private boolean liveHlsTried = false;

    /** Avisa a la página: HFNative.live(estado, detalle) → HFLive.nativeEvent (js/iptv.js). */
    private void liveEmit(String st, String detail) {
        runOnUiThread(() -> {
            if (web != null) {
                web.evaluateJavascript("window.HFNative&&HFNative.live&&HFNative.live(" + org.json.JSONObject.quote(st) + "," +
                        org.json.JSONObject.quote(detail == null ? "" : detail) + ")", null);
            }
        });
    }

    /** El rectángulo (en px CSS de la página) donde se ve el video: el WebView es transparente encima. */
    private void liveRectPx(float x, float y, float w, float h) {
        if (liveView == null) {
            return;
        }
        float d = getResources().getDisplayMetrics().density;
        android.widget.FrameLayout.LayoutParams lp = new android.widget.FrameLayout.LayoutParams(Math.max(1, Math.round(w * d)), Math.max(1, Math.round(h * d)));
        lp.leftMargin = Math.round(x * d);
        lp.topMargin = Math.round(y * d);
        liveView.setLayoutParams(lp);
    }

    private void liveStart(boolean asHls) {
        if (live == null) {
            return;
        }
        String ua = liveUa == null || liveUa.isEmpty() ? "VLC/3.0.20 LibVLC/3.0.20" : liveUa;
        androidx.media3.datasource.DefaultHttpDataSource.Factory http = new androidx.media3.datasource.DefaultHttpDataSource.Factory()
                .setUserAgent(ua)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(20000);
        if (liveRef != null && !liveRef.isEmpty()) {
            http.setDefaultRequestProperties(java.util.Collections.singletonMap("Referer", liveRef));
        }
        androidx.media3.common.MediaItem item = androidx.media3.common.MediaItem.fromUri(liveUrl);
        boolean hls = asHls || liveUrl.toLowerCase(java.util.Locale.ROOT).contains("m3u8");
        androidx.media3.exoplayer.source.MediaSource src = hls
                ? new androidx.media3.exoplayer.hls.HlsMediaSource.Factory(http).createMediaSource(item)
                : new androidx.media3.exoplayer.source.DefaultMediaSourceFactory(http).createMediaSource(item);
        live.setMediaSource(src);
        live.prepare();
        live.setPlayWhenReady(true);
    }

    private void liveOpenOnUi(String url, String ua, String ref, float x, float y, float w, float h) {
        liveStopOnUi();
        liveUrl = url;
        liveUa = ua;
        liveRef = ref;
        liveHlsTried = false;
        live = new androidx.media3.exoplayer.ExoPlayer.Builder(this).build();
        live.addListener(new androidx.media3.common.Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == androidx.media3.common.Player.STATE_BUFFERING) {
                    liveEmit("esperando", "");
                } else if (state == androidx.media3.common.Player.STATE_READY) {
                    liveEmit("reproduciendo", "");
                } else if (state == androidx.media3.common.Player.STATE_ENDED) {
                    liveEmit("error", "La transmisión del canal terminó.");
                }
            }

            @Override
            public void onPlayerError(androidx.media3.common.PlaybackException e) {
                /* sin extensión conocida ExoPlayer no sabe si es HLS: se prueba una vez como HLS */
                Throwable c = e;
                while (c != null) {
                    if (c instanceof androidx.media3.exoplayer.source.UnrecognizedInputFormatException && !liveHlsTried) {
                        liveHlsTried = true;
                        liveStart(true);
                        return;
                    }
                    c = c.getCause();
                }
                String why = "No se pudo reproducir el canal.";
                if (e.errorCode == androidx.media3.common.PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
                        || e.errorCode == androidx.media3.common.PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT) {
                    why = "No hay conexión con el canal.";
                } else if (e.errorCode == androidx.media3.common.PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS) {
                    why = "El canal ya no está disponible en ese enlace.";
                }
                liveEmit("error", why);
            }
        });
        liveView.setPlayer(live);
        liveRectPx(x, y, w, h);
        liveView.setVisibility(View.VISIBLE);
        web.setBackgroundColor(Color.TRANSPARENT); // la página deja ver el video detrás
        liveEmit("cargando", "");
        liveStart(false);
    }

    private void liveStopOnUi() {
        if (live != null) {
            try {
                live.release();
            } catch (Exception e) {
                /* ya estaba suelto */
            }
            live = null;
        }
        if (liveView != null) {
            liveView.setPlayer(null);
            liveView.setVisibility(View.GONE);
        }
        if (web != null) {
            web.setBackgroundColor(Color.parseColor("#0b0c0e"));
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (live != null) {
            live.play();
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        /* en segundo plano (y no en imagen en imagen) el canal se pausa: no gasta datos ni suena con la pantalla apagada */
        if (live != null && !(android.os.Build.VERSION.SDK_INT >= 24 && isInPictureInPictureMode())) {
            live.pause();
        }
    }

    @Override
    protected void onDestroy() {
        liveStopOnUi();
        super.onDestroy();
    }

    @Override
    public void onPictureInPictureModeChanged(boolean in, android.content.res.Configuration cfg) {
        super.onPictureInPictureModeChanged(in, cfg);
        if (web != null) {
            web.evaluateJavascript("document.documentElement.classList.toggle('m-pip'," + in + ");window.dispatchEvent(new Event('resize'))", null);
        }
    }

    /** Baja un texto (la lista M3U o la guía XMLTV) sin las reglas del navegador: sin CORS, con http, siguiendo
     *  redirecciones entre http y https y descomprimiendo .gz. Con mode "epg" deja solo los programas de las próximas horas. */
    private String fetchText(String url, String mode) throws Exception {
        String cur = url;
        for (int i = 0; i < 6; i++) {
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(cur).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(60000);
            c.setRequestProperty("User-Agent", "VLC/3.0.20 LibVLC/3.0.20");
            c.setRequestProperty("Accept-Encoding", "identity");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) {
                    throw new Exception("redirección sin destino");
                }
                cur = new java.net.URL(new java.net.URL(cur), loc).toString();
                continue;
            }
            if (code < 200 || code >= 300) {
                c.disconnect();
                throw new Exception("HTTP " + code);
            }
            java.io.InputStream in = new java.io.BufferedInputStream(c.getInputStream(), 65536);
            in.mark(2);
            int b1 = in.read();
            int b2 = in.read();
            in.reset();
            if (b1 == 0x1f && b2 == 0x8b) {
                in = new java.util.zip.GZIPInputStream(in, 65536);
            }
            try (java.io.Reader r = new java.io.InputStreamReader(in, java.nio.charset.StandardCharsets.UTF_8)) {
                return "epg".equals(mode) ? filterEpg(r) : readAll(r, 60 * 1024 * 1024);
            } finally {
                c.disconnect();
            }
        }
        throw new Exception("demasiadas redirecciones");
    }

    private String readAll(java.io.Reader r, int max) throws java.io.IOException {
        StringBuilder sb = new StringBuilder();
        char[] cb = new char[65536];
        int n;
        while ((n = r.read(cb)) > 0 && sb.length() < max) {
            sb.append(cb, 0, n);
        }
        return sb.toString();
    }

    /** XMLTV pesa decenas de MB: se recorre por partes y solo se devuelven los programas de hace 16 h a dentro de 30 h
     *  (las horas se comparan sin zona; la página afina). */
    private String filterEpg(java.io.Reader r) throws java.io.IOException {
        java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyyMMddHHmmss", java.util.Locale.US);
        f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        long now = System.currentTimeMillis();
        String lo = f.format(new java.util.Date(now - 16L * 3600000L));
        String hi = f.format(new java.util.Date(now + 30L * 3600000L));
        StringBuilder out = new StringBuilder("<tv>\n");
        StringBuilder buf = new StringBuilder();
        char[] cb = new char[65536];
        int n;
        while ((n = r.read(cb)) > 0) {
            buf.append(cb, 0, n);
            while (true) {
                int s = buf.indexOf("<programme");
                if (s < 0) {
                    if (buf.length() > 20) {
                        buf.delete(0, buf.length() - 20);
                    }
                    break;
                }
                int e = buf.indexOf("</programme>", s);
                if (e < 0) {
                    if (s > 0) {
                        buf.delete(0, s);
                    }
                    break;
                }
                e += 12;
                String p = buf.substring(s, e);
                buf.delete(0, e);
                int a = p.indexOf("start=\"");
                int b = p.indexOf("stop=\"");
                if (a < 0 || b < 0 || p.length() < Math.max(a + 21, b + 20)) {
                    continue;
                }
                String st = p.substring(a + 7, a + 21);
                String en = p.substring(b + 6, b + 20);
                if (st.compareTo(hi) <= 0 && en.compareTo(lo) >= 0) {
                    out.append(p).append('\n');
                }
            }
        }
        return out.append("</tv>").toString();
    }

    /** Lo que la app web puede pedirle al celular: window.HFAndroid.* */
    private class Bridge {
        /* ----- TV en vivo (IPTV) ----- */
        @JavascriptInterface
        public void liveOpen(String url, String ua, String ref, float x, float y, float w, float h) {
            runOnUiThread(() -> liveOpenOnUi(url, ua, ref, x, y, w, h));
        }

        @JavascriptInterface
        public void liveRect(float x, float y, float w, float h) {
            runOnUiThread(() -> liveRectPx(x, y, w, h));
        }

        @JavascriptInterface
        public void liveStop() {
            runOnUiThread(() -> liveStopOnUi());
        }

        /** Imagen en imagen con el canal que suena. */
        @JavascriptInterface
        public void livePip() {
            runOnUiThread(() -> {
                if (live != null && android.os.Build.VERSION.SDK_INT >= 26) {
                    try {
                        enterPictureInPictureMode(new android.app.PictureInPictureParams.Builder().setAspectRatio(new android.util.Rational(16, 9)).build());
                    } catch (Exception e) {
                        /* el sistema no lo permite ahora */
                    }
                }
            });
        }

        /** Texto de una dirección (lista M3U o guía XMLTV) sin las reglas del navegador → HFNative.done(cb, {ok, text}). */
        @JavascriptInterface
        public void httpText(int cb, String url, String mode) {
            bg.execute(() -> {
                org.json.JSONObject r = new org.json.JSONObject();
                try {
                    r.put("ok", true);
                    r.put("text", fetchText(url, mode));
                } catch (Exception e) {
                    try {
                        r.put("ok", false);
                        r.put("error", String.valueOf(e.getMessage()));
                    } catch (Exception ignored) {
                        /* nada */
                    }
                }
                reply(cb, r.toString());
            });
        }

        /** Vibración corta al tocar la barra de abajo (la hace la propia vista: no pide permisos). */
        @JavascriptInterface
        public void haptic() {
            runOnUiThread(() -> web.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY));
        }

        /** Reproductor: pantalla completa (sin barras) y en horizontal; al salir, todo vuelve a la normalidad. */
        @JavascriptInterface
        public void setPlayerMode(boolean on) {
            runOnUiThread(() -> {
                WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), web);
                if (on) {
                    c.hide(WindowInsetsCompat.Type.systemBars());
                    c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    preferHighRefresh(false); // el video no gana nada a 120 Hz: que el sistema ahorre batería
                } else {
                    c.show(WindowInsetsCompat.Type.systemBars());
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    preferHighRefresh(true);
                    /* el brillo que se ajustó en el reproductor no sigue fuera de él */
                    WindowManager.LayoutParams lp = getWindow().getAttributes();
                    lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
                    getWindow().setAttributes(lp);
                }
            });
        }

        /** Versión de la app instalada (la misma de config.xml). */
        /* ----- Actualizaciones (Actualizador.java; las pide js/update.js) ----- */
        @JavascriptInterface
        public void otaInstalar(String url, String version, double bytes) { actualizador.instalar(url, version, (long) bytes); }

        @JavascriptInterface
        public String otaEstado() { return actualizador.estado(); }

        @JavascriptInterface
        public void otaActivar() { actualizador.activar(); }

        @JavascriptInterface
        public void otaOk() { actualizador.ok(); }

        @JavascriptInterface
        public void apkInstalar(String url) { actualizador.instalarApk(url); }

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        /** Vibración corta al tocar (opcional). */
        @JavascriptInterface
        public void tick() {
            runOnUiThread(() -> web.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY));
        }

        /** Brillo de esta pantalla (0–1) mientras se ve un video; -1 vuelve al del sistema. No cambia el ajuste del celular. */
        @JavascriptInterface
        public void setBrightness(float value) {
            runOnUiThread(() -> {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.screenBrightness = value < 0 ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE : Math.max(0.01f, Math.min(1f, value));
                getWindow().setAttributes(lp);
            });
        }

        /** El brillo actual (0–1): el que puso la app o, si no, el del sistema. */
        @JavascriptInterface
        public float getBrightness() {
            float own = getWindow().getAttributes().screenBrightness;
            if (own >= 0) {
                return own;
            }
            try {
                int v = android.provider.Settings.System.getInt(getContentResolver(), android.provider.Settings.System.SCREEN_BRIGHTNESS);
                int id = getResources().getIdentifier("config_screenBrightnessSettingMaximum", "integer", "android");
                int max = id != 0 ? getResources().getInteger(id) : 255;
                return Math.max(0f, Math.min(1f, v / (float) Math.max(1, max)));
            } catch (Exception e) {
                return 0.5f;
            }
        }

        /* ----- Guardar un archivo en Descargas/HomeFlix (los recortes de video) -----
         * saveBegin(nombre, tipo) → id; saveChunk(id, base64) por partes; saveEnd(id) → la dirección del archivo o "". */
        private final java.util.Map<Integer, Object[]> saves = new java.util.HashMap<>();
        private int nextSave = 1;

        @JavascriptInterface
        public synchronized int saveBegin(String name, String mime) {
            try {
                String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                Uri uri;
                java.io.OutputStream out;
                if (android.os.Build.VERSION.SDK_INT >= 29) {
                    android.content.ContentValues cv = new android.content.ContentValues();
                    cv.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, safe);
                    cv.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime);
                    cv.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS + "/HomeFlix");
                    cv.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1);
                    uri = getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) {
                        return 0;
                    }
                    out = getContentResolver().openOutputStream(uri);
                } else {
                    java.io.File dir = new java.io.File(getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS), "HomeFlix");
                    dir.mkdirs();
                    java.io.File f = new java.io.File(dir, safe);
                    uri = Uri.fromFile(f);
                    out = new java.io.FileOutputStream(f);
                }
                int id = nextSave++;
                saves.put(id, new Object[]{uri, out});
                return id;
            } catch (Exception e) {
                return 0;
            }
        }

        @JavascriptInterface
        public synchronized boolean saveChunk(int id, String base64) {
            Object[] s = saves.get(id);
            if (s == null) {
                return false;
            }
            try {
                ((java.io.OutputStream) s[1]).write(android.util.Base64.decode(base64, android.util.Base64.DEFAULT));
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public synchronized String saveEnd(int id) {
            Object[] s = saves.remove(id);
            if (s == null) {
                return "";
            }
            Uri uri = (Uri) s[0];
            try {
                ((java.io.OutputStream) s[1]).close();
                if (android.os.Build.VERSION.SDK_INT >= 29) {
                    android.content.ContentValues cv = new android.content.ContentValues();
                    cv.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0);
                    getContentResolver().update(uri, cv, null, null);
                }
                return uri.toString();
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public synchronized void saveCancel(int id) {
            Object[] s = saves.remove(id);
            if (s == null) {
                return;
            }
            try {
                ((java.io.OutputStream) s[1]).close();
                if (android.os.Build.VERSION.SDK_INT >= 29) {
                    getContentResolver().delete((Uri) s[0], null, null);
                }
            } catch (Exception e) {
                /* nada */
            }
        }

        /* ----- Ver en la TV con HomeFlix cerrada (TVs Samsung de la casa) -----
         * tvScan(cb, ipsConocidas)  busca TVs Samsung en la red (SSDP) y les pregunta nombre, MAC, si están encendidas
         *                           y si tienen HomeFlix instalada/abierta (API local http://IP:8001/api/v2/).
         * tvLaunch(cb, ip, mac, app) si la TV está apagada la despierta (Wake-on-LAN), abre HomeFlix y espera a que esté
         *                           al frente. Las respuestas llegan a la página por HFNative.done(cb, json). */
        @JavascriptInterface
        public void tvScan(int cb, String knownJson, String appId) {
            bg.execute(() -> {
                org.json.JSONArray out = new org.json.JSONArray();
                java.util.LinkedHashSet<String> done = new java.util.LinkedHashSet<>();
                /* 1) las que este celular ya conoce: si responden, listo (rápido) */
                try {
                    org.json.JSONArray known = new org.json.JSONArray(knownJson == null ? "[]" : knownJson);
                    for (int i = 0; i < known.length(); i++) {
                        String ip = known.getString(i);
                        done.add(ip);
                        org.json.JSONObject tv = tvInfo(ip, appId);
                        if (tv != null) {
                            out.put(tv);
                        }
                    }
                } catch (Exception e) {
                    /* sin lista */
                }
                /* 2) si no hay ninguna, buscar: SSDP y, si el router no lo deja pasar, toda la red de la casa */
                if (out.length() == 0) {
                    java.util.List<String> ips = ssdpSamsung(1500);
                    if (ips.isEmpty()) {
                        ips = sweepSubnet(8001);
                    }
                    for (String ip : ips) {
                        if (done.add(ip)) {
                            org.json.JSONObject tv = tvInfo(ip, appId);
                            if (tv != null) {
                                out.put(tv);
                            }
                        }
                    }
                }
                reply(cb, out.toString());
            });
        }

        @JavascriptInterface
        public void tvLaunch(int cb, String ip, String mac, String appId) {
            bg.execute(() -> {
                org.json.JSONObject r = new org.json.JSONObject();
                try {
                    String power = tvPower(ip);
                    if (!"on".equals(power)) {
                        long until = System.currentTimeMillis() + 35000;
                        long nextWol = 0;
                        while (System.currentTimeMillis() < until && !"on".equals(power)) {
                            if (System.currentTimeMillis() >= nextWol && mac != null && !mac.isEmpty()) {
                                wakeOnLan(mac, ip);
                                nextWol = System.currentTimeMillis() + 5000;
                            }
                            Thread.sleep(1000);
                            power = tvPower(ip);
                        }
                    }
                    if (!"on".equals(power)) {
                        r.put("ok", false);
                        r.put("error", power == null ? "unreachable" : "standby");
                        reply(cb, r.toString());
                        return;
                    }
                    Thread.sleep(800); // recién encendida tarda un poco en aceptar órdenes
                    int code = 0;
                    for (int i = 0; i < 4 && code != 200; i++) {
                        String[] pr = http("POST", ip, 8001, "/api/v2/applications/" + appId, 6000);
                        code = pr[0].isEmpty() ? 0 : Integer.parseInt(pr[0]);
                        if (code != 200) {
                            Thread.sleep(1500);
                        }
                    }
                    if (code != 200) {
                        r.put("ok", false);
                        r.put("error", "launch_" + code);
                        reply(cb, r.toString());
                        return;
                    }
                    boolean up = false;
                    for (int i = 0; i < 20 && !up; i++) {
                        Thread.sleep(600);
                        String[] st = http("GET", ip, 8001, "/api/v2/applications/" + appId, 3000);
                        up = st[1].contains("\"running\":true") && st[1].contains("\"visible\":true");
                    }
                    r.put("ok", true);
                    r.put("visible", up);
                } catch (Exception e) {
                    try {
                        r.put("ok", false);
                        r.put("error", String.valueOf(e.getMessage()));
                    } catch (Exception ignored) {
                        /* nada */
                    }
                }
                reply(cb, r.toString());
            });
        }

        /** Compartir un archivo guardado (WhatsApp, Telegram…). */
        @JavascriptInterface
        public void shareFile(String uri, String mime) {
            runOnUiThread(() -> {
                try {
                    android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_SEND);
                    i.setType(mime);
                    i.putExtra(android.content.Intent.EXTRA_STREAM, Uri.parse(uri));
                    i.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(android.content.Intent.createChooser(i, "Compartir recorte"));
                } catch (Exception e) {
                    /* sin apps para compartir */
                }
            });
        }
    }
}
