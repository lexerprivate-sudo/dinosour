package com.dinosour.app;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;

/**
 * YouTube search, suggestions and metadata via YouTube's public InnerTube API.
 *
 * This mirrors the server-side proxy in functions/_lib/youtube.js, but runs
 * inside the app so the standalone APK never needs a server.
 */
final class YouTubeApi {
  private static final String INNERTUBE = "https://www.youtube.com/youtubei/v1";
  private static final String SUGGEST = "https://suggestqueries.google.com/complete/search";
  private static final String CLIENT_NAME = "WEB";
  private static final String CLIENT_VERSION = "2.20240910.00.00";
  private static final String USER_AGENT =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          + "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
  private static final int TIMEOUT_MS = 12000;

  private static final String[] PIPED = {
    "https://api.piped.private.coffee",
    "https://pipedapi.kavin.rocks",
  };

  private YouTubeApi() {}

  /* ------------------------------------------------------------- public */

  static String search(String query, String continuation) throws Exception {
    String q = clean(query);
    String token = continuation == null ? "" : continuation.trim();

    if (q.isEmpty() && token.isEmpty()) {
      return new JSONObject()
          .put("query", q)
          .put("videos", new JSONArray())
          .put("channels", new JSONArray())
          .put("continuation", JSONObject.NULL)
          .put("source", "youtube")
          .toString();
    }

    JSONObject body = new JSONObject();
    body.put("context", context());
    if (!token.isEmpty()) {
      body.put("continuation", token);
    } else {
      body.put("query", q);
      body.put("params", "EgIQAQ%3D%3D");
    }

    try {
      return parseSearch(q, innertube("search", body)).toString();
    } catch (Exception error) {
      JSONObject fallback = searchFallback(q, token);
      if (fallback != null) return fallback.toString();
      throw error;
    }
  }

  static String suggest(String query) {
    String q = clean(query);
    JSONArray list = new JSONArray();
    if (q.isEmpty()) {
      try {
        return new JSONObject().put("suggestions", list).toString();
      } catch (JSONException ignored) {
        return "{\"suggestions\":[]}";
      }
    }

    HttpURLConnection conn = null;
    try {
      String url = SUGGEST + "?client=firefox&ds=yt&hl=en&q=" + encode(q);
      conn = open(url, "GET", false);
      int code = conn.getResponseCode();
      if (code >= 400) return "{\"suggestions\":[]}";

      String raw = read(conn.getInputStream());
      JSONArray parsed = new JSONArray(raw);
      JSONArray items = parsed.optJSONArray(1);
      Set<String> seen = new HashSet<>();
      if (items != null) {
        for (int i = 0; i < items.length() && list.length() < 10; i++) {
          String value = items.optString(i, "").trim();
          if (!value.isEmpty() && seen.add(value.toLowerCase(Locale.US))) list.put(value);
        }
      }
      return new JSONObject().put("suggestions", list).toString();
    } catch (Exception ignored) {
      return "{\"suggestions\":[]}";
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  static String video(String id) throws Exception {
    String videoId = clean(id);
    if (!videoId.matches("[\\w-]{11}")) return "null";

    JSONObject body = new JSONObject();
    body.put("context", context());
    body.put("videoId", videoId);

    JSONObject data = innertube("player", body);
    JSONObject details = data.optJSONObject("videoDetails");
    if (details == null || details.optString("videoId", "").isEmpty()) return "null";

    JSONObject playability = data.optJSONObject("playabilityStatus");
    String status = playability == null ? "UNKNOWN" : playability.optString("status", "UNKNOWN");

    JSONObject out = new JSONObject();
    out.put("id", details.optString("videoId"));
    out.put("title", details.optString("title", "YouTube video"));
    out.put("channel", details.optString("author", "YouTube"));
    out.put("channelId", details.optString("channelId", ""));

    String views = details.optString("viewCount", "");
    out.put("viewsText", views.isEmpty() ? "" : String.format(Locale.US, "%,d views", number(views)));

    JSONObject micro = data.optJSONObject("microformat");
    JSONObject playerMicro = micro == null ? null : micro.optJSONObject("playerMicroformatRenderer");
    String published = "";
    if (playerMicro != null) {
      published = playerMicro.optString("publishDate", playerMicro.optString("uploadDate", ""));
    }
    out.put("published", published);
    out.put("publishedText", "");
    out.put("length", "");
    out.put("lengthSeconds", number(details.optString("lengthSeconds", "0")));
    out.put("thumb", "https://i.ytimg.com/vi/" + details.optString("videoId") + "/hqdefault.jpg");
    out.put("description", details.optString("shortDescription", ""));

    JSONArray keywords = details.optJSONArray("keywords");
    JSONArray trimmed = new JSONArray();
    if (keywords != null) {
      for (int i = 0; i < keywords.length() && i < 12; i++) trimmed.put(keywords.optString(i));
    }
    out.put("keywords", trimmed);

    JSONObject streaming = data.optJSONObject("streamingData");
    boolean hasAudio = false;
    if (streaming != null) {
      JSONArray adaptive = streaming.optJSONArray("adaptiveFormats");
      if (adaptive != null) {
        for (int i = 0; i < adaptive.length(); i++) {
          JSONObject format = adaptive.optJSONObject(i);
          if (format != null && !format.optString("audioQuality", "").isEmpty()) {
            hasAudio = true;
            break;
          }
        }
      }
      JSONArray formats = streaming.optJSONArray("formats");
      if (!hasAudio && formats != null && formats.length() > 0) hasAudio = true;
    }

    out.put("playable", "OK".equals(status) || "LIVE_STREAM_OFFLINE".equals(status));
    out.put("hasAudio", hasAudio);
    out.put("status", status);
    out.put("source", "youtube");
    return out.toString();
  }

  /* ------------------------------------------------------- InnerTube I/O */

  private static JSONObject context() throws JSONException {
    JSONObject client = new JSONObject();
    client.put("clientName", CLIENT_NAME);
    client.put("clientVersion", CLIENT_VERSION);
    client.put("hl", "en");
    client.put("gl", "US");
    client.put("originalUrl", "https://www.youtube.com/");
    client.put("platform", "DESKTOP");
    return new JSONObject().put("client", client);
  }

  private static JSONObject innertube(String endpoint, JSONObject body) throws Exception {
    HttpURLConnection conn = null;
    try {
      String url = INNERTUBE + "/" + endpoint + "?prettyPrint=false";
      conn = open(url, "POST", true);

      try (OutputStream out = conn.getOutputStream()) {
        out.write(body.toString().getBytes(StandardCharsets.UTF_8));
      }

      int code = conn.getResponseCode();
      if (code >= 400) {
        drain(conn.getErrorStream());
        throw new IOException("YouTube responded " + code);
      }
      return new JSONObject(read(conn.getInputStream()));
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  private static HttpURLConnection open(String url, String method, boolean json) throws IOException {
    HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
    conn.setRequestMethod(method);
    conn.setConnectTimeout(TIMEOUT_MS);
    conn.setReadTimeout(TIMEOUT_MS);
    conn.setInstanceFollowRedirects(true);
    conn.setRequestProperty("user-agent", USER_AGENT);
    conn.setRequestProperty("accept-language", "en-US,en;q=0.9");
    conn.setRequestProperty("origin", "https://www.youtube.com");
    conn.setRequestProperty("referer", "https://www.youtube.com/");
    if (json) {
      conn.setDoOutput(true);
      conn.setRequestProperty("content-type", "application/json");
    }
    return conn;
  }

  private static String read(InputStream in) throws IOException {
    if (in == null) return "";
    try (InputStream stream = in) {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buffer = new byte[8192];
      int n;
      while ((n = stream.read(buffer)) != -1) out.write(buffer, 0, n);
      return out.toString("UTF-8");
    }
  }

  private static void drain(InputStream in) {
    try {
      read(in);
    } catch (Exception ignored) {
      /* nothing useful to do */
    }
  }

  /* ------------------------------------------------------------- parsing */

  private interface Visitor {
    void visit(JSONObject node) throws JSONException;
  }

  private static void walk(Object node, Visitor visitor) throws JSONException {
    if (node instanceof JSONObject) {
      JSONObject object = (JSONObject) node;
      visitor.visit(object);
      Iterator<String> keys = object.keys();
      while (keys.hasNext()) walk(object.opt(keys.next()), visitor);
    } else if (node instanceof JSONArray) {
      JSONArray array = (JSONArray) node;
      for (int i = 0; i < array.length(); i++) walk(array.opt(i), visitor);
    }
  }

  private static JSONObject parseSearch(String query, JSONObject data) throws JSONException {
    final JSONArray videos = new JSONArray();
    final JSONArray channels = new JSONArray();
    final Set<String> seenVideos = new HashSet<>();
    final Set<String> seenChannels = new HashSet<>();
    final String[] continuation = {""};

    walk(data, node -> {
      JSONObject video = node.optJSONObject("videoRenderer");
      if (video != null) {
        JSONObject item = normalizeVideo(video);
        if (item != null) {
          String id = item.optString("id", "");
          if (!id.isEmpty() && seenVideos.add(id)) videos.put(item);
        }
        return;
      }

      JSONObject channel = node.optJSONObject("channelRenderer");
      if (channel != null) {
        String id = channel.optString("channelId", "");
        if (!id.isEmpty() && seenChannels.add(id)) {
          JSONObject item = new JSONObject();
          item.put("id", id);
          item.put("title", defaultValue(text(channel.opt("title")), "YouTube channel"));
          item.put("subscribersText", text(channel.opt("videoCountText")));
          item.put("videoCountText", text(channel.opt("videoCountText")));
          item.put("thumb", lastThumb(channel.optJSONObject("thumbnail")));
          String subscribers = text(channel.opt("subscriberCountText"));
          item.put("handle", subscribers.startsWith("@") ? subscribers : "");
          channels.put(item);
        }
        return;
      }

      if (continuation[0].isEmpty()) {
        JSONObject command = node.optJSONObject("continuationCommand");
        if (command != null) {
          String token = command.optString("token", "");
          if (!token.isEmpty()) continuation[0] = token;
        }
      }
    });

    JSONObject out = new JSONObject();
    out.put("query", query);
    out.put("videos", videos);
    out.put("channels", channels);
    out.put("continuation", continuation[0].isEmpty() ? JSONObject.NULL : continuation[0]);
    out.put("source", "youtube");
    return out;
  }

  private static JSONObject normalizeVideo(JSONObject r) throws JSONException {
    String id = r.optString("videoId", "");
    if (id.isEmpty()) return null;

    JSONObject out = new JSONObject();
    out.put("id", id);
    out.put("title", defaultValue(text(r.opt("title")), "Untitled video"));

    String channel = text(r.opt("ownerText"));
    if (channel.isEmpty()) channel = text(r.opt("longBylineText"));
    out.put("channel", defaultValue(channel, "YouTube"));
    out.put("channelId", channelId(r));
    out.put("viewsText", text(r.opt("viewCountText")));
    out.put("publishedText", text(r.opt("publishedTimeText")));

    String length = text(r.opt("lengthText"));
    out.put("length", length);
    out.put("lengthSeconds", seconds(length));
    out.put("thumb", "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg");
    out.put("description", description(r));
    out.put("isShort", isShort(r, length));
    return out;
  }

  private static String text(Object value) {
    if (value == null || value == JSONObject.NULL) return "";
    if (value instanceof String) return (String) value;
    if (value instanceof JSONObject) {
      JSONObject object = (JSONObject) value;
      if (object.has("simpleText")) return object.optString("simpleText", "");
      JSONArray runs = object.optJSONArray("runs");
      if (runs != null) {
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < runs.length(); i++) {
          JSONObject run = runs.optJSONObject(i);
          if (run != null) builder.append(run.optString("text", ""));
        }
        return builder.toString();
      }
    }
    return "";
  }

  private static String lastThumb(JSONObject thumbnail) {
    if (thumbnail == null) return "";
    JSONArray list = thumbnail.optJSONArray("thumbnails");
    if (list == null || list.length() == 0) return "";
    JSONObject last = list.optJSONObject(list.length() - 1);
    return last == null ? "" : last.optString("url", "");
  }

  private static String channelId(JSONObject r) {
    JSONObject owner = r.optJSONObject("ownerText");
    if (owner == null) return "";
    JSONArray runs = owner.optJSONArray("runs");
    if (runs == null || runs.length() == 0) return "";
    JSONObject run = runs.optJSONObject(0);
    if (run == null) return "";
    JSONObject nav = run.optJSONObject("navigationEndpoint");
    if (nav == null) return "";
    JSONObject browse = nav.optJSONObject("browseEndpoint");
    return browse == null ? "" : browse.optString("browseId", "");
  }

  private static String description(JSONObject r) {
    JSONArray snippets = r.optJSONArray("detailedMetadataSnippets");
    if (snippets == null || snippets.length() == 0) return "";
    JSONObject snippet = snippets.optJSONObject(0);
    return snippet == null ? "" : text(snippet.opt("snippetText"));
  }

  private static boolean isShort(JSONObject r, String length) {
    JSONArray overlays = r.optJSONArray("thumbnailOverlays");
    if (overlays == null) return false;
    for (int i = 0; i < overlays.length(); i++) {
      JSONObject overlay = overlays.optJSONObject(i);
      JSONObject status = overlay == null ? null : overlay.optJSONObject("thumbnailOverlayTimeStatusRenderer");
      if (status != null && "SHORTS".equals(status.optString("style"))) return true;
    }
    return length.isEmpty() && overlays.length() > 0;
  }

  /* ------------------------------------------------------ Piped fallback */

  private static JSONObject searchFallback(String query, String continuation) {
    if (!continuation.isEmpty() || query.isEmpty()) return null;
    for (String base : PIPED) {
      HttpURLConnection conn = null;
      try {
        String url = base + "/search?q=" + encode(query) + "&filter=videos";
        conn = open(url, "GET", false);
        if (conn.getResponseCode() >= 400) continue;
        JSONObject data = new JSONObject(read(conn.getInputStream()));
        JSONArray items = data.optJSONArray("items");
        JSONArray videos = new JSONArray();
        if (items != null) {
          for (int i = 0; i < items.length(); i++) {
            JSONObject item = pipedVideo(items.optJSONObject(i));
            if (item != null) videos.put(item);
          }
        }
        JSONObject out = new JSONObject();
        out.put("query", query);
        out.put("videos", videos);
        out.put("channels", new JSONArray());
        String next = data.optString("nextpage", "");
        out.put("continuation", next.isEmpty() ? JSONObject.NULL : next);
        out.put("source", "fallback");
        return out;
      } catch (Exception ignored) {
        /* try the next mirror */
      } finally {
        if (conn != null) conn.disconnect();
      }
    }
    return null;
  }

  private static JSONObject pipedVideo(JSONObject item) {
    if (item == null) return null;
    try {
      String url = item.optString("url", "");
      String id = url.contains("v=") ? url.substring(url.indexOf("v=") + 2) : "";
      if (id.isEmpty()) return null;

      JSONObject out = new JSONObject();
      out.put("id", id);
      out.put("title", defaultValue(item.optString("title", ""), "Untitled video"));
      out.put("channel", defaultValue(item.optString("uploaderName", ""), "YouTube"));
      String channelUrl = item.optString("uploaderUrl", "");
      out.put("channelId", channelUrl.contains("/channel/") ? channelUrl.substring(channelUrl.indexOf("/channel/") + 9) : "");
      long views = item.optLong("views", -1);
      out.put("viewsText", views >= 0 ? String.format(Locale.US, "%,d views", views) : "");
      out.put("publishedText", item.optString("uploadedDate", ""));
      long duration = item.optLong("duration", -1);
      out.put("length", duration >= 0 ? formatDuration(duration) : "");
      out.put("lengthSeconds", duration > 0 ? duration : 0);
      out.put("thumb", defaultValue(item.optString("thumbnail", ""), "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg"));
      out.put("description", item.optString("shortDescription", ""));
      out.put("isShort", duration > 0 && duration <= 60);
      return out;
    } catch (JSONException ignored) {
      return null;
    }
  }

  /* -------------------------------------------------------------- helpers */

  private static String clean(String value) {
    return value == null ? "" : value.trim();
  }

  private static String encode(String value) {
    try {
      return URLEncoder.encode(value, "UTF-8");
    } catch (Exception ignored) {
      return value;
    }
  }

  private static String defaultValue(String value, String fallback) {
    return value == null || value.isEmpty() ? fallback : value;
  }

  private static long number(String value) {
    try {
      return Long.parseLong(value.replaceAll("[^0-9].*$", ""));
    } catch (Exception ignored) {
      return 0;
    }
  }

  private static int seconds(String label) {
    if (label == null || label.isEmpty()) return 0;
    String[] parts = label.split(":");
    int total = 0;
    try {
      for (String part : parts) total = total * 60 + Integer.parseInt(part.trim());
    } catch (Exception ignored) {
      return 0;
    }
    return total;
  }

  private static String formatDuration(long total) {
    long seconds = Math.max(0, total);
    long h = seconds / 3600;
    long m = (seconds % 3600) / 60;
    long s = seconds % 60;
    if (h > 0) return String.format(Locale.US, "%d:%02d:%02d", h, m, s);
    return String.format(Locale.US, "%d:%02d", m, s);
  }
}
