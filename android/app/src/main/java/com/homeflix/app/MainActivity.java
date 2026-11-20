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
    private int safeTop = 0;
    private int safeBottom = 0;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0b0c0e"));
        setContentView(web);

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

        assets = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
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

    /** Lo que la app web puede pedirle al celular: window.HFAndroid.* */
    private class Bridge {
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
                } else {
                    c.show(WindowInsetsCompat.Type.systemBars());
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }

        /** Versión de la app instalada (la misma de config.xml). */
        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        /** Vibración corta al tocar (opcional). */
        @JavascriptInterface
        public void tick() {
            runOnUiThread(() -> web.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY));
        }
    }
}
