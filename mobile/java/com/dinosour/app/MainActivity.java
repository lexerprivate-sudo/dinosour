package com.dinosour.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A fully standalone dinosour client: the site is bundled in assets and the
 * YouTube API is proxied in Java, so no server or deployment is required.
 */
public class MainActivity extends Activity {
  /* A stable made-up origin keeps localStorage and same-origin requests working. */
  private static final String ORIGIN = "https://dinosour.local";
  private static final String HOST = "dinosour.local";

  private static final String PREFS = "dinosour";
  private static final String UPDATE_REPO = "lexerprivate-sudo/dinosour";
  private static final String UPDATE_API =
      "https://api.github.com/repos/" + UPDATE_REPO + "/releases/latest";
  private static final long UPDATE_INTERVAL = 15 * 60 * 1000L;
  private static final String KEY_LAST_UPDATE = "last_update_check";
  private static final String KEY_PENDING_VERSION = "pending_version";
  private static final String KEY_SKIPPED_VERSION = "skipped_version";

  private WebView web;
  private FrameLayout root;
  private ProgressBar pageProgress;
  private View offline;
  private TextView offlineMsg;
  private Button retryBtn;

  private boolean mainError = false;
  private View customView;
  private WebChromeClient.CustomViewCallback customViewCallback;
  private File pendingUpdate;
  private boolean installRequested;
  private boolean checkedThisLaunch;

  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private final Handler ui = new Handler(Looper.getMainLooper());

  @SuppressLint("SetJavaScriptEnabled")
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().setStatusBarColor(Color.parseColor("#0F0F0F"));
    getWindow().setNavigationBarColor(Color.parseColor("#0F0F0F"));
    setContentView(R.layout.activity_main);

    root = findViewById(R.id.root);
    web = findViewById(R.id.web);
    pageProgress = findViewById(R.id.pageProgress);
    offline = findViewById(R.id.offline);
    offlineMsg = findViewById(R.id.offlineMsg);
    retryBtn = findViewById(R.id.retryBtn);

    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setLoadWithOverviewMode(true);
    settings.setUseWideViewPort(true);
    settings.setSupportZoom(false);
    settings.setBuiltInZoomControls(false);
    settings.setDisplayZoomControls(false);
    settings.setJavaScriptCanOpenWindowsAutomatically(false);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
    settings.setUserAgentString(settings.getUserAgentString() + " dinosourApp/2.0");

    CookieManager cookies = CookieManager.getInstance();
    cookies.setAcceptCookie(true);
    cookies.setAcceptThirdPartyCookies(web, true);

    web.setBackgroundColor(Color.parseColor("#0F0F0F"));
    web.setOverScrollMode(View.OVER_SCROLL_NEVER);
    WebView.setWebContentsDebuggingEnabled(true);
    web.addJavascriptInterface(new Bridge(), "Dinosour");

    web.setWebViewClient(new WebViewClient() {
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        return intercept(request.getUrl());
      }

      @Override
      @SuppressWarnings("deprecation")
      public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
        return intercept(Uri.parse(url));
      }

      @Override
      public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
        mainError = false;
        pageProgress.setVisibility(View.VISIBLE);
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        pageProgress.setVisibility(View.GONE);
        if (mainError) showOffline();
        else hideOffline();
      }

      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) mainError = true;
      }

      @Override
      public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        if (request.isForMainFrame() && response != null && response.getStatusCode() >= 500) {
          mainError = true;
        }
      }

      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        // Subframes (the YouTube embed) must load in place.
        if (!request.isForMainFrame()) return false;
        return handleUrl(request.getUrl());
      }

      @Override
      @SuppressWarnings("deprecation")
      public boolean shouldOverrideUrlLoading(WebView view, String url) {
        return handleUrl(Uri.parse(url));
      }
    });

    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public void onProgressChanged(WebView view, int progress) {
        pageProgress.setProgress(progress);
        pageProgress.setVisibility(progress < 100 ? View.VISIBLE : View.GONE);
      }

      @Override
      public void onShowCustomView(View view, CustomViewCallback callback) {
        if (customView != null) {
          callback.onCustomViewHidden();
          return;
        }
        customView = view;
        customViewCallback = callback;
        root.addView(view, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        view.setKeepScreenOn(true);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        hideSystemUi();
      }

      @Override
      public void onHideCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        showSystemUi();
        if (customViewCallback != null) {
          customViewCallback.onCustomViewHidden();
          customViewCallback = null;
        }
      }
    });

    retryBtn.setOnClickListener(v -> {
      mainError = false;
      hideOffline();
      web.reload();
    });

    web.loadUrl(ORIGIN + "/");
  }

  /* --------------------------------------------------- bundled site + API */

  private WebResourceResponse intercept(Uri uri) {
    if (uri == null) return null;
    String host = uri.getHost();
    if (host == null || !host.equalsIgnoreCase(HOST)) return null;

    String path = uri.getPath() == null || uri.getPath().isEmpty() ? "/" : uri.getPath();
    try {
      if (path.startsWith("/api/")) return apiResponse(path, uri.getEncodedQuery());
      return assetResponse(path);
    } catch (Exception error) {
      return textResponse("Something went wrong.", 500);
    }
  }

  private WebResourceResponse apiResponse(String path, String query) {
    String json;
    int status = 200;
    try {
      if (path.equals("/api/search")) {
        json = YouTubeApi.search(param(query, "q"), param(query, "continuation"));
      } else if (path.equals("/api/suggest")) {
        json = YouTubeApi.suggest(param(query, "q"));
      } else if (path.equals("/api/video")) {
        json = YouTubeApi.video(param(query, "id"));
      } else {
        json = "{\"error\":\"Not found\"}";
        status = 404;
      }
    } catch (Exception error) {
      json = "{\"error\":\"" + escape(error.getMessage()) + "\"}";
      status = 502;
    }
    return jsonResponse(json, status);
  }

  private WebResourceResponse assetResponse(String path) {
    String name = path.startsWith("/") ? path.substring(1) : path;
    name = Uri.decode(name);
    if (name.isEmpty() || name.contains("..")) name = "index.html";

    try {
      InputStream in;
      String mime;
      if (name.contains(".")) {
        in = getAssets().open("site/" + name);
        mime = mimeFor(name);
      } else {
        // Client-side route such as /watch/yt/abc: serve the app shell.
        in = getAssets().open("site/index.html");
        mime = "text/html";
      }
      return response(mime, in, 200);
    } catch (IOException missing) {
      try {
        return response("text/html", getAssets().open("site/index.html"), 200);
      } catch (IOException fatal) {
        return textResponse("The app files are missing. Reinstall dinosour.", 404);
      }
    }
  }

  private WebResourceResponse response(String mime, InputStream in, int status) {
    Map<String, String> headers = new HashMap<>();
    headers.put("Cache-Control", "no-cache");
    headers.put("Content-Type", mime + "; charset=utf-8");
    return new WebResourceResponse(mime, "UTF-8", status, "OK", headers, in);
  }

  private WebResourceResponse jsonResponse(String json, int status) {
    Map<String, String> headers = new HashMap<>();
    headers.put("Cache-Control", "no-store");
    headers.put("Content-Type", "application/json; charset=utf-8");
    return new WebResourceResponse(
        "application/json",
        "UTF-8",
        status,
        status == 200 ? "OK" : "Error",
        headers,
        new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));
  }

  private WebResourceResponse textResponse(String message, int status) {
    Map<String, String> headers = new HashMap<>();
    headers.put("Cache-Control", "no-store");
    return new WebResourceResponse(
        "text/plain",
        "UTF-8",
        status,
        status == 200 ? "OK" : "Error",
        headers,
        new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)));
  }

  private static String param(String query, String key) {
    if (query == null || query.isEmpty()) return "";
    String value = Uri.parse(ORIGIN + "/?" + query).getQueryParameter(key);
    return value == null ? "" : value;
  }

  private static String mimeFor(String name) {
    String lower = name.toLowerCase();
    if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
    if (lower.endsWith(".css")) return "text/css";
    if (lower.endsWith(".json")) return "application/json";
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
    if (lower.endsWith(".svg")) return "image/svg+xml";
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".ico")) return "image/x-icon";
    if (lower.endsWith(".woff2")) return "font/woff2";
    if (lower.endsWith(".woff")) return "font/woff";
    if (lower.endsWith(".txt")) return "text/plain";
    return "application/octet-stream";
  }

  private static String escape(String value) {
    if (value == null) return "Unknown error";
    return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
  }

  /* ------------------------------------------------------------- offline */

  private void showOffline() {
    offlineMsg.setText(R.string.offline_body);
    offline.setVisibility(View.VISIBLE);
    pageProgress.setVisibility(View.GONE);
  }

  private void hideOffline() {
    offline.setVisibility(View.GONE);
  }

  private boolean handleUrl(Uri uri) {
    if (uri == null) return true;
    String scheme = uri.getScheme() == null ? "" : uri.getScheme();
    if (!scheme.equals("http") && !scheme.equals("https")) return true;

    String host = uri.getHost() == null ? "" : uri.getHost();
    String path = uri.getPath() == null ? "" : uri.getPath();

    if (host.equalsIgnoreCase(HOST)) return false;
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      if (path.startsWith("/embed/")) return false;
    }
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, uri));
    } catch (Exception ignored) {
      /* no browser installed */
    }
    return true;
  }

  /* ------------------------------------------------------------- updates */

  private void checkForUpdate() {
    checkForUpdate(false, false);
  }

  /**
   * Looks at the latest GitHub release, downloads the APK in the background,
   * and prompts to install. Runs automatically and from Settings.
   *
   * @param force  ignore the throttle (Settings' "Check for updates")
   * @param notify report progress to the page and show result dialogs
   */
  private void checkForUpdate(final boolean force, final boolean notify) {
    final SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
    long last = prefs.getLong(KEY_LAST_UPDATE, 0);
    if (!force && System.currentTimeMillis() - last < UPDATE_INTERVAL) return;
    prefs.edit().putLong(KEY_LAST_UPDATE, System.currentTimeMillis()).apply();
    if (notify) emitUpdate("checking", "Checking for updates…");

    io.execute(() -> {
      try {
        JSONObject release = getJson(UPDATE_API);
        final String tag = release.optString("tag_name", "").replaceFirst("^[vV]", "");
        if (tag.isEmpty() || !isNewer(tag, currentVersion())) {
          if (notify) {
            emitUpdate("uptodate", "dinosour " + currentVersion() + " is up to date.");
            ui.post(this::showUpToDate);
          }
          return;
        }

        String apkUrl = "";
        JSONArray assets = release.optJSONArray("assets");
        if (assets != null) {
          for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            if (asset.optString("name", "").endsWith(".apk")) {
              apkUrl = asset.optString("browser_download_url", "");
              break;
            }
          }
        }
        if (apkUrl.isEmpty()) {
          if (notify) emitUpdate("error", "The update has no APK attached.");
          return;
        }

        final String url = apkUrl;
        final File file = UpdateProvider.apkFile(this);
        final String cached = prefs.getString(KEY_PENDING_VERSION, "");
        if (!file.exists() || !file.isFile() || !tag.equals(cached)) {
          if (notify) emitUpdate("downloading", "Downloading dinosour " + tag + "…");
          if (!download(url, file, tag)) {
            if (notify) emitUpdate("error", "Couldn't download the update. Try again.");
            return;
          }
        }

        pendingUpdate = file;
        prefs.edit().putString(KEY_PENDING_VERSION, tag).apply();
        emitUpdate("ready", "dinosour " + tag + " is ready to install.");

        boolean skipped = tag.equals(prefs.getString(KEY_SKIPPED_VERSION, ""));
        if (notify) {
          prefs.edit().remove(KEY_SKIPPED_VERSION).apply();
          ui.post(() -> promptUpdate(tag));
        } else if (!skipped) {
          ui.post(() -> promptUpdate(tag));
        }
      } catch (Exception error) {
        if (notify) {
          emitUpdate("error", "Couldn't check for updates. Check your connection.");
          ui.post(this::showUpdateError);
        }
        // Otherwise offline or rate limited; try again later.
      }
    });
  }

  private boolean download(String url, File file, String version) {
    HttpURLConnection conn = null;
    try {
      if (file.exists() && !file.delete()) return false;
      conn = (HttpURLConnection) new URL(url).openConnection();
      conn.setInstanceFollowRedirects(true);
      conn.setConnectTimeout(10000);
      conn.setReadTimeout(30000);
      conn.setRequestProperty("User-Agent", "dinosour-app");
      conn.setRequestProperty("Accept", "application/octet-stream");

      int total = conn.getContentLength();
      long read = 0;
      int lastPercent = -1;
      try (InputStream in = conn.getInputStream();
           FileOutputStream out = new FileOutputStream(file)) {
        byte[] buffer = new byte[16384];
        int n;
        while ((n = in.read(buffer)) != -1) {
          out.write(buffer, 0, n);
          read += n;
          if (total > 0) {
            int percent = (int) (read * 100 / total);
            if (percent >= lastPercent + 10) {
              lastPercent = percent;
              emitUpdate("downloading", "Downloading dinosour " + version + "… " + percent + "%");
            }
          }
        }
      }
      return true;
    } catch (Exception error) {
      if (file.exists()) file.delete();
      return false;
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  private void showUpToDate() {
    if (isFinishing()) return;
    new AlertDialog.Builder(this)
        .setTitle(R.string.update_current_title)
        .setMessage(getString(R.string.update_current_body, currentVersion()))
        .setPositiveButton(android.R.string.ok, null)
        .show();
  }

  private void showUpdateError() {
    if (isFinishing()) return;
    new AlertDialog.Builder(this)
        .setTitle(R.string.update_error_title)
        .setMessage(R.string.update_error_body)
        .setPositiveButton(android.R.string.ok, null)
        .show();
  }

  private void promptUpdate(final String version) {
    if (isFinishing()) return;
    new AlertDialog.Builder(this)
        .setTitle(R.string.update_title)
        .setMessage(getString(R.string.update_body, version))
        .setPositiveButton(R.string.update_now, (dialog, which) -> {
          installRequested = true;
          installUpdate();
        })
        .setNegativeButton(R.string.update_later, (dialog, which) -> {
          installRequested = false;
          getSharedPreferences(PREFS, MODE_PRIVATE)
              .edit()
              .putString(KEY_SKIPPED_VERSION, version)
              .apply();
        })
        .show();
  }

  /** Sends update progress to the Settings page, if it is open. */
  private void emitUpdate(final String state, final String message) {
    ui.post(() -> {
      if (web == null) return;
      String js = "window.__dinosourNative&&window.__dinosourNative.update("
          + JSONObject.quote(state) + "," + JSONObject.quote(message) + ")";
      web.evaluateJavascript(js, null);
    });
  }

  private boolean canInstallUpdates() {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
        || getPackageManager().canRequestPackageInstalls();
  }

  private void installUpdate() {
    if (pendingApk() == null) {
      // Ask the update server once; this also sets pendingUpdate.
      checkForUpdate(true, true);
      return;
    }
    if (!canInstallUpdates()) {
      new AlertDialog.Builder(this)
          .setTitle(R.string.update_install_title)
          .setMessage(R.string.update_install_body)
          .setPositiveButton(R.string.open_settings, (dialog, which) -> {
            try {
              startActivity(new Intent(
                  Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                  Uri.parse("package:" + getPackageName())));
            } catch (Exception ignored) {
              /* settings unavailable */
            }
          })
          .setNegativeButton(android.R.string.cancel, (dialog, which) -> installRequested = false)
          .show();
      return;
    }

    Uri apk = Uri.parse("content://" + UpdateProvider.AUTHORITY + "/" + UpdateProvider.FILE_NAME);
    Intent intent = new Intent(Intent.ACTION_VIEW);
    intent.setDataAndType(apk, "application/vnd.android.package-archive");
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
    pendingUpdate = null;
    installRequested = false;
    emitUpdate("installing", "Opening the installer…");
    try {
      startActivity(intent);
    } catch (Exception error) {
      Toast.makeText(this, R.string.update_failed, Toast.LENGTH_LONG).show();
    }
  }

  /** The downloaded APK, restored from disk after a restart as well. */
  private File pendingApk() {
    if (pendingUpdate != null && pendingUpdate.exists()) return pendingUpdate;
    SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
    if (prefs.getString(KEY_PENDING_VERSION, "").isEmpty()) return null;
    File file = UpdateProvider.apkFile(this);
    if (!file.exists() || !file.isFile()) return null;
    pendingUpdate = file;
    return file;
  }

  /** Small API exposed to the bundled site as window.Dinosour. */
  public class Bridge {
    @JavascriptInterface
    public String appVersion() {
      return currentVersion();
    }

    @JavascriptInterface
    public String readyVersion() {
      SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
      String pending = prefs.getString(KEY_PENDING_VERSION, "");
      if (pending.isEmpty() || !isNewer(pending, currentVersion())) return "";
      File file = UpdateProvider.apkFile(MainActivity.this);
      return file.exists() && file.isFile() ? pending : "";
    }

    @JavascriptInterface
    public void checkNow() {
      ui.post(() -> checkForUpdate(true, true));
    }

    @JavascriptInterface
    public void installNow() {
      ui.post(() -> {
        if (pendingApk() == null) {
          checkForUpdate(true, true);
        } else {
          installRequested = true;
          installUpdate();
        }
      });
    }
  }

  private JSONObject getJson(String url) throws Exception {
    HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
    conn.setConnectTimeout(8000);
    conn.setReadTimeout(8000);
    conn.setRequestProperty("User-Agent", "dinosour-app");
    conn.setRequestProperty("Accept", "application/vnd.github+json");
    try (InputStream in = conn.getInputStream()) {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buffer = new byte[8192];
      int n;
      while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
      return new JSONObject(out.toString("UTF-8"));
    } finally {
      conn.disconnect();
    }
  }

  private String currentVersion() {
    try {
      return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
    } catch (PackageManager.NameNotFoundException error) {
      return "0";
    }
  }

  private static boolean isNewer(String remote, String local) {
    String[] a = remote.split("[.-]");
    String[] b = local.split("[.-]");
    for (int i = 0; i < Math.max(a.length, b.length); i++) {
      int x = i < a.length ? number(a[i]) : 0;
      int y = i < b.length ? number(b[i]) : 0;
      if (x != y) return x > y;
    }
    return false;
  }

  private static int number(String value) {
    try {
      return Integer.parseInt(value.replaceAll("[^0-9].*$", ""));
    } catch (Exception error) {
      return 0;
    }
  }

  /* ------------------------------------------------------- window chrome */

  @SuppressWarnings("deprecation")
  private void hideSystemUi() {
    getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
  }

  @SuppressWarnings("deprecation")
  private void showSystemUi() {
    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
  }

  @Override
  @SuppressWarnings("deprecation")
  public void onBackPressed() {
    if (customView != null) {
      WebChromeClient client = web.getWebChromeClient();
      if (client != null) client.onHideCustomView();
      return;
    }
    if (web.canGoBack()) {
      web.goBack();
    } else {
      super.onBackPressed();
    }
  }

  @Override
  protected void onPause() {
    if (web != null) web.onPause();
    super.onPause();
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (web != null) web.onResume();
    if (pendingUpdate != null && pendingUpdate.exists() && installRequested && canInstallUpdates()) {
      installUpdate();
    } else if (!checkedThisLaunch) {
      // Always look once when the app is opened, then throttle background resumes.
      checkedThisLaunch = true;
      checkForUpdate(true, false);
    } else {
      checkForUpdate();
    }
  }

  @Override
  protected void onDestroy() {
    io.shutdownNow();
    if (web != null) {
      web.loadUrl("about:blank");
      web.destroy();
    }
    super.onDestroy();
  }
}
