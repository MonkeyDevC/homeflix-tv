package com.homeflix.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.WebResourceResponse;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

/**
 * Actualizaciones del celular desde el servidor de HomeFlix (js/update.js decide; aquí se hace lo nativo).
 *
 * Interfaz por internet: el paquete web-&lt;v&gt;.json ({files: {"mobile/m.js": "…", …}}) se guarda en
 * files/web/&lt;v&gt;/ y se sirve ANTES que lo del APK (lo que no esté ahí, como las imágenes, sale del APK).
 * Vuelta atrás: al abrir con una interfaz nueva queda «probando»; la app avisa que arrancó (otaOk) y queda «ok».
 * Si la vez anterior quedó en «probando», se marca «mala» y se usa la del APK. Si el APK instalado ya es igual o
 * más nuevo, lo bajado se borra.
 *
 * Programa nuevo: el .apk se baja a cache/apk/ y se abre el instalador de Android (el usuario confirma).
 */
class Actualizador {
    private final Activity act;
    private final SharedPreferences prefs;
    private volatile File activa; // carpeta de la interfaz en uso, o null (la del APK)
    private volatile String estado = "";
    private volatile long got = 0;
    private volatile long total = 0;
    private volatile String error = "";

    Actualizador(Activity act) {
        this.act = act;
        this.prefs = act.getSharedPreferences("hf-ota", Context.MODE_PRIVATE);
        decidir();
    }

    static int cmp(String a, String b) {
        String[] x = (a == null ? "0" : a).split("\\.");
        String[] y = (b == null ? "0" : b).split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int d = num(i < x.length ? x[i] : "0") - num(i < y.length ? y[i] : "0");
            if (d != 0) return d > 0 ? 1 : -1;
        }
        return 0;
    }

    private static int num(String s) {
        try { return Integer.parseInt(s.replaceAll("\\D", "")); } catch (Exception e) { return 0; }
    }

    private File raiz() { return new File(act.getFilesDir(), "web"); }

    /** Al abrir: qué interfaz se usa. */
    private void decidir() {
        /* bajada y sin activar (se cerró la app sin «Reiniciar»): se usa desde esta apertura, a prueba */
        String pend = prefs.getString("pendiente", "");
        if (!pend.isEmpty()) {
            if (new File(new File(raiz(), pend), "mobile/index.html").isFile()) {
                prefs.edit().putString("version", pend).putString("estado", "nueva").remove("pendiente").apply();
            } else {
                prefs.edit().remove("pendiente").apply();
            }
        }
        String ver = prefs.getString("version", "");
        String st = prefs.getString("estado", "");
        activa = null;
        if (ver.isEmpty() || "mala".equals(st)) return;
        if (cmp(BuildConfig.VERSION_NAME, ver) >= 0) { borrarTodo(); return; } // se instaló un APK igual o más nuevo
        File dir = new File(raiz(), ver);
        if (!new File(dir, "mobile/index.html").isFile()) { borrarTodo(); return; }
        if ("probando".equals(st)) { prefs.edit().putString("estado", "mala").apply(); return; } // no llegó a arrancar
        if (!"ok".equals(st)) prefs.edit().putString("estado", "probando").apply();
        activa = dir;
    }

    String versionWeb() { return activa != null ? prefs.getString("version", "") : BuildConfig.VERSION_NAME; }

    /** Va primero en el WebViewAssetLoader: lo que esté en la interfaz bajada; si no, null y lo sirve el APK. */
    WebViewAssetLoader.PathHandler handler() {
        return new WebViewAssetLoader.PathHandler() {
            @Override
            public WebResourceResponse handle(@NonNull String path) {
                File dir = activa;
                if (dir == null) return null;
                File f = new File(dir, path);
                try {
                    if (!f.getCanonicalPath().startsWith(dir.getCanonicalPath() + File.separator) || !f.isFile()) return null;
                    return new WebResourceResponse(mime(path), "utf-8", new FileInputStream(f));
                } catch (Exception e) {
                    return null;
                }
            }
        };
    }

    private static String mime(String p) {
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        return "application/octet-stream";
    }

    private void borrarTodo() {
        prefs.edit().clear().apply();
        borrar(raiz());
    }

    private static void borrar(File f) {
        if (f.isDirectory()) {
            File[] l = f.listFiles();
            if (l != null) for (File c : l) borrar(c);
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private byte[] bajar(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        if (c.getResponseCode() != 200) throw new Exception("El servidor respondió " + c.getResponseCode());
        total = Math.max(total, c.getContentLengthLong());
        try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] b = new byte[64 * 1024];
            int n;
            while ((n = in.read(b)) > 0) { out.write(b, 0, n); got += n; }
            return out.toByteArray();
        } finally {
            c.disconnect();
        }
    }

    /** Baja e instala la interfaz (en segundo plano); el avance se lee con estado(). */
    void instalar(String url, String version, long bytes) {
        if ("bajando".equals(estado)) return;
        estado = "bajando"; got = 0; total = bytes; error = "";
        new Thread(() -> {
            File tmp = new File(raiz(), version + ".tmp");
            try {
                JSONObject b = new JSONObject(new String(bajar(url), StandardCharsets.UTF_8));
                if (!"homeflix-web".equals(b.optString("app")) || !version.equals(b.optString("version"))) throw new Exception("La actualización llegó dañada");
                JSONObject files = b.getJSONObject("files");
                if (!files.has("mobile/index.html")) throw new Exception("La actualización no trae la app del celular");
                borrar(tmp);
                Iterator<String> it = files.keys();
                while (it.hasNext()) {
                    String name = it.next();
                    if (name.contains("..")) continue;
                    File f = new File(tmp, name);
                    //noinspection ResultOfMethodCallIgnored
                    f.getParentFile().mkdirs();
                    try (OutputStream o = new FileOutputStream(f)) { o.write(files.getString(name).getBytes(StandardCharsets.UTF_8)); }
                }
                File dest = new File(raiz(), version);
                borrar(dest);
                if (!tmp.renameTo(dest)) throw new Exception("No se pudo guardar la actualización");
                /* lo viejo bajado (otras versiones) se borra */
                File[] l = raiz().listFiles();
                if (l != null) for (File c : l) if (!c.getName().equals(version) && (activa == null || !c.equals(activa))) borrar(c);
                prefs.edit().putString("pendiente", version).apply();
                estado = "listo";
            } catch (Exception e) {
                borrar(tmp);
                error = e.getMessage() != null ? e.getMessage() : e.toString();
                estado = "error";
            }
        }).start();
    }

    String estado() {
        try {
            return new JSONObject().put("estado", estado).put("got", got).put("total", total).put("error", error).toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    /** Pasa a la interfaz recién bajada (la app recarga la página enseguida). */
    void activar() {
        String v = prefs.getString("pendiente", "");
        if (v.isEmpty()) return;
        File dir = new File(raiz(), v);
        if (!new File(dir, "mobile/index.html").isFile()) return;
        prefs.edit().putString("version", v).putString("estado", "probando").remove("pendiente").apply();
        activa = dir;
    }

    /** La app arrancó bien con esta interfaz. */
    void ok() {
        if (activa != null && "probando".equals(prefs.getString("estado", ""))) prefs.edit().putString("estado", "ok").apply();
    }

    /** Baja el APK nuevo y abre el instalador de Android. */
    void instalarApk(String url) {
        new Thread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= 26 && !act.getPackageManager().canRequestPackageInstalls()) {
                    act.runOnUiThread(() -> {
                        Toast.makeText(act, "Permite instalar apps desde HomeFlix y vuelve a tocar «Instalar»", Toast.LENGTH_LONG).show();
                        act.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.getPackageName())));
                    });
                    return;
                }
                act.runOnUiThread(() -> Toast.makeText(act, "Bajando HomeFlix…", Toast.LENGTH_SHORT).show());
                got = 0; total = 0;
                byte[] apk = bajar(url);
                File dir = new File(act.getCacheDir(), "apk");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                File f = new File(dir, "homeflix.apk");
                try (OutputStream o = new FileOutputStream(f)) { o.write(apk); }
                Uri uri = FileProvider.getUriForFile(act, act.getPackageName() + ".archivos", f);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                act.runOnUiThread(() -> act.startActivity(i));
            } catch (Exception e) {
                act.runOnUiThread(() -> Toast.makeText(act, "No se pudo bajar la app: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }).start();
    }
}
