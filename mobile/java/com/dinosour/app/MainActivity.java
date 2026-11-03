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
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
  private static final String PREFS = "dinosour";
  private static final String KEY_URL = "server_url";
  private static final String CLOUD_URL = "https://dinosour.pages.dev";
  private static final String UPDATE_REPO = "lexerprivate-sudo/dinosour";
  private static final String UPDATE_API = "https://api.github.com/repos/" + UPDATE_REPO + "/releases/latest";
  private static final long UPDATE_INTERVAL = 60 * 60 * 1000L;
  private static final String KEY_LAST_UPDATE = "last_update_check";
  private static final String KEY_PENDING_VERSION = "pending_version";

  private WebView web;
  private View setup;
  private TextView setupMsg;
  private EditText urlInput;
  private ProgressBar pageProgress;
  private ProgressBar findProgress;
  private Button connectBtn;
  private Button findBtn;
  private Button cloudBtn;
  private FrameLayout root;

  private String currentBase = "";
  private boolean mainError = false;
  private View customView;
  private WebChromeClient.CustomViewCallback customViewCallback;
  private File pendingUpdate;
  private boolean installRequested;

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
    setup = findViewById(R.id.setup);
    setupMsg = findViewById(R.id.setupMsg);
    urlInput = findViewById(R.id.urlInput);
    pageProgress = findViewById(R.id.pageProgress);
    findProgress = findViewById(R.id.findProgress);
    connectBtn = findViewById(R.id.connectBtn);
    findBtn = findViewById(R.id.findBtn);
    cloudBtn = findViewById(R.id.cloudBtn);

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
    settings.setUserAgentString(settings.getUserAgentString() + " dinosourApp/1.0");
    CookieManager cookies = CookieManager.getInstance();
    cookies.setAcceptCookie(true);
    cookies.setAcceptThirdPartyCookies(web, true);

    web.setBackgroundColor(Color.parseColor("#0F0F0F"));
    web.setOverScrollMode(View.OVER_SCROLL_NEVER);
    WebView.setWebContentsDebuggingEnabled(true);

    web.setWebViewClient(new WebViewClient() {
      @Override
      public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
        mainError = false;
        pageProgress.setVisibility(View.VISIBLE);
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        pageProgress.setVisibility(View.GONE);
        if (url != null && url.startsWith(currentBase)) {
          if (mainError) {
            showSetup(getString(R.string.unreachable));
          } else {
            hideSetup();
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_URL, currentBase).apply();
          }
        }
      }

      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) mainError = true;
      }

      @Override
      public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        if (request.isForMainFrame() && response != null && response.getStatusCode() >= 500) mainError = true;
      }

      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
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

    connectBtn.setOnClickListener(v -> connect(urlInput.getText().toString()));
    urlInput.setOnEditorActionListener((v, actionId, event) -> {
      connect(urlInput.getText().toString());
      return true;
    });
    findBtn.setOnClickListener(v -> findAutomatically());
    cloudBtn.setOnClickListener(v -> {
      urlInput.setText(CLOUD_URL);
      connect(CLOUD_URL);
    });

    SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
    String saved = prefs.getString(KEY_URL, null);
    if (saved != null && !saved.isEmpty()) {
      connect(saved);
    } else {
      showSetup(getString(R.string.connect_body));
      findAutomatically();
    }
  }

  private String normalize(String raw) {
    String value = raw == null ? "" : raw.trim();
    if (value.isEmpty()) return "";
    if (!value.startsWith("http://") && !value.startsWith("https://")) {
      value = "http://" + value;
    }
    while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
    return value;
  }

  private void connect(String raw) {
    String base = normalize(raw);
    if (base.isEmpty()) {
      setupMsg.setText(R.string.unreachable);
      setup.setVisibility(View.VISIBLE);
      return;
    }
    currentBase = base;
    mainError = false;
    hideSetup();
    web.loadUrl(base + "/");
  }

  private void findAutomatically() {
    connectBtn.setEnabled(false);
    findBtn.setEnabled(false);
    findProgress.setVisibility(View.VISIBLE);
    setupMsg.setText(R.string.searching);
    io.execute(() -> {
      final String found = ServerDiscovery.find();
      ui.post(() -> {
        connectBtn.setEnabled(true);
        findBtn.setEnabled(true);
        findProgress.setVisibility(View.GONE);
        if (found != null) {
          urlInput.setText(found);
          setupMsg.setText(R.string.found);
          connect(found);
        } else {
          setupMsg.setText(R.string.not_found);
        }
      });
    });
  }

  private void showSetup(String message) {
    setupMsg.setText(message);
    if (!currentBase.isEmpty() && urlInput.getText().toString().isEmpty()) {
      urlInput.setText(currentBase);
    }
    if (!urlInput.getText().toString().isEmpty()) {
      urlInput.setSelection(urlInput.getText().length());
    }
    setup.setVisibility(View.VISIBLE);
    pageProgress.setVisibility(View.GONE);
  }

  private void hideSetup() {
    setup.setVisibility(View.GONE);
  }

  private boolean handleUrl(Uri uri) {
    if (uri == null) return true;
    String scheme = uri.getScheme() == null ? "" : uri.getScheme();
    if (!scheme.equals("http") && !scheme.equals("https")) return true;

    String host = uri.getHost() == null ? "" : uri.getHost();
    String baseHost = Uri.parse(currentBase).getHost();
    String path = uri.getPath() == null ? "" : uri.getPath();

    if (baseHost != null && host.equalsIgnoreCase(baseHost)) return false;
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      if (path.startsWith("/embed/")) return false;
    }
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, uri));
    } catch (Exception ignored) {}
    return true;
  }

  /* ------------------------------------------------------- updates */

  private void checkForUpdate() {
    final SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
    if (System.currentTimeMillis() - prefs.getLong(KEY_LAST_UPDATE, 0) < UPDATE_INTERVAL) return;
    prefs.edit().putLong(KEY_LAST_UPDATE, System.currentTimeMillis()).apply();

    io.execute(() -> {
      try {
        JSONObject release = getJson(UPDATE_API);
        final String tag = release.optString("tag_name", "").replaceFirst("^[vV]", "");
        if (tag.isEmpty() || !isNewer(tag, currentVersion())) return;

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
        if (apkUrl.isEmpty()) return;

        final File file = UpdateProvider.apkFile(this);
        final String cached = prefs.getString(KEY_PENDING_VERSION, "");
        if (!file.exists() || !file.isFile() || !tag.equals(cached)) {
          if (!download(url, file)) return;
        }
        pendingUpdate = file;
        prefs.edit().putString(KEY_PENDING_VERSION, tag).apply();
        ui.post(() -> promptUpdate(tag));
      } catch (Exception ignored) {
        // Offline or rate limited; try again later.
      }
    });
  }

  private boolean download(String url, File file) {
    HttpURLConnection conn = null;
    try {
      if (file.exists() && !file.delete()) return false;
      conn = (HttpURLConnection) new URL(url).openConnection();
      conn.setInstanceFollowRedirects(true);
      conn.setConnectTimeout(10000);
      conn.setReadTimeout(30000);
      conn.setRequestProperty("User-Agent", "dinosour-app");
      conn.setRequestProperty("Accept", "application/octet-stream");

      try (InputStream in = conn.getInputStream();
           FileOutputStream out = new FileOutputStream(file)) {
        byte[] buffer = new byte[16384];
        int n;
        while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
      }
      return true;
    } catch (Exception error) {
      if (file.exists()) file.delete();
      return false;
    } finally {
      if (conn != null) conn.disconnect();
    }
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
        .setNegativeButton(R.string.update_later, (dialog, which) -> installRequested = false)
        .show();
  }

  private boolean canInstallUpdates() {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls();
  }

  private void installUpdate() {
    if (pendingUpdate == null || !pendingUpdate.exists()) return;
    if (!canInstallUpdates()) {
      new AlertDialog.Builder(this)
          .setTitle(R.string.update_install_title)
          .setMessage(R.string.update_install_body)
          .setPositiveButton(R.string.open_settings, (dialog, which) -> {
            try {
              startActivity(new Intent(
                  Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                  Uri.parse("package:" + getPackageName())));
            } catch (Exception ignored) {}
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
    try {
      startActivity(intent);
    } catch (Exception error) {
      Toast.makeText(this, R.string.update_failed, Toast.LENGTH_LONG).show();
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
