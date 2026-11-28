package com.dinosour.app;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.common.MediaMetadata;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import org.schabi.newpipe.extractor.ServiceList;
import org.schabi.newpipe.extractor.stream.StreamInfo;

/**
 * Foreground mediaPlayback service that owns the ExoPlayer. Because the player
 * lives here (not in an Activity), audio keeps playing when the screen is off
 * or the app is backgrounded.
 */
@UnstableApi
public class PlayerService extends MediaSessionService {
    public static final String EXTRA_VIDEO_URL = "video_url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_CHANNEL = "channel";
    public static final String ACTION_PAUSE = "com.dinosour.app.PLAYER_PAUSE";
    public static final String ACTION_RESUME = "com.dinosour.app.PLAYER_RESUME";

    private static volatile String currentVideoId = null;

    /** True when the service is already playing this video (PiP must not restart it). */
    public static boolean isPlayingVideo(String id) {
        if (id == null || !id.equals(currentVideoId) || session == null) return false;
        try {
            androidx.media3.common.Player p = session.getPlayer();
            return p.getPlayWhenReady() && p.getPlaybackState() != androidx.media3.common.Player.STATE_IDLE;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static volatile MediaSession session;
    private volatile boolean destroyed = false;
    private volatile boolean loading = false;

    @Override
    public void onCreate() {
        super.onCreate();
        destroyed = false;
        try {
            // REA finding (NewPipe): ExoPlayer handles audio focus and wake
            // locks itself when configured; the app should not hand-roll them.
            // Mirrors NewPipe's initPlayback (REA): ExoPlayer owns audio focus and
            // wake locks; platform diagnostics disabled; media tunneling on.
            ExoPlayer player = new ExoPlayer.Builder(this)
                    .setAudioAttributes(AudioAttributes.DEFAULT, true)
                    .setHandleAudioBecomingNoisy(true)
                    .setWakeMode(C.WAKE_MODE_NETWORK)
                    .setUsePlatformDiagnostics(false)
                    .build();
            if (player.getTrackSelector() instanceof androidx.media3.exoplayer.trackselection.DefaultTrackSelector) {
                androidx.media3.exoplayer.trackselection.DefaultTrackSelector ts =
                        (androidx.media3.exoplayer.trackselection.DefaultTrackSelector) player.getTrackSelector();
                ts.setParameters(ts.buildUponParameters().setTunnelingEnabled(true));
            }
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                    | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
            PendingIntent openPlayer = PendingIntent.getActivity(
                    this, 0, new Intent(this, PlayerActivity.class), piFlags);
            session = new MediaSession.Builder(this, player)
                    .setSessionActivity(openPlayer)
                    .build();
        } catch (Throwable error) {
            // An incomplete media stack must never crash the whole app process.
            session = null;
            stopSelf();
        }
    }

    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "com.dinosour.app.MEDIA_NEXT".equals(intent.getAction())) {
            MainActivity.sendMediaCommand("next");
            return START_STICKY;
        }
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_PAUSE.equals(action) || ACTION_RESUME.equals(action)) {
            if (session != null) {
                Player player = session.getPlayer();
                boolean resume = ACTION_RESUME.equals(action);
                new android.os.Handler(player.getApplicationLooper()).post(() -> {
                    try {
                        if (resume) player.play();
                        else player.pause();
                    } catch (Throwable ignored) {
                    }
                });
            }
            return START_STICKY;
        }
        if (intent == null || session == null) {
            MainActivity.notifyNativeFailure();
            return START_STICKY;
        }
        final String url = intent.getStringExtra(EXTRA_VIDEO_URL);
        final String title = intent.getStringExtra(EXTRA_TITLE);
        final String channel = intent.getStringExtra(EXTRA_CHANNEL);
        if (url == null) return START_STICKY;
        int mark = url.indexOf("watch?v=");
        currentVideoId = mark >= 0 ? url.substring(mark + 8, Math.min(url.length(), mark + 19)) : null;
        loading = true;
        new Thread(() -> {
            MediaSession ref = session;
            try {
                if (destroyed || ref == null) {
                    MainActivity.notifyNativeFailure();
                    return;
                }
                StreamInfo info = StreamInfo.getInfo(ServiceList.YouTube, url);
                String streamUrl = null;
                if (info.getVideoStreams() != null && !info.getVideoStreams().isEmpty()) {
                    streamUrl = info.getVideoStreams().get(0).getUrl();
                }
                if (streamUrl == null) {
                    MainActivity.notifyNativeFailure();
                    return;
                }
                MediaItem item = new MediaItem.Builder()
                    .setUri(streamUrl)
                    .setMediaMetadata(new MediaMetadata.Builder()
                        .setTitle(title != null ? title : info.getName())
                        .setArtist(channel != null ? channel : info.getUploaderName())
                        .build())
                    .build();
                final MediaItem ready = item;
                Player player = ref.getPlayer();
                // ExoPlayer requires all calls on its own thread. Stop the old
                // item first so switching videos cannot leave stale audio.
                new android.os.Handler(player.getApplicationLooper()).post(() -> {
                    if (destroyed || session != ref) return;
                    try {
                        player.stop();
                        player.setMediaItem(ready);
                        player.prepare();
                        player.play();
                    } catch (Throwable ignored) {
                    }
                });
            } catch (Throwable error) {
                if (!destroyed) MainActivity.notifyNativeFailure();
                android.util.Log.w("DinosourPlayer", "stream extraction failed", error);
            } finally {
                loading = false;
            }
        }).start();
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        try {
            // ViMusic/OnClearFromRecentService pattern: if nothing is playing,
            // swiping the app away stops the foreground service instead of
            // leaving an orphan notification.
            if (session == null || loading || !session.getPlayer().getPlayWhenReady()) {
                stopSelf();
            }
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        loading = false;
        currentVideoId = null;
        MediaSession ref = session;
        session = null;
        if (ref != null) {
            Player player = ref.getPlayer();
            try {
                ref.release();
            } catch (Throwable ignored) {
            }
            if (player != null) {
                try {
                    player.release();
                } catch (Throwable ignored) {
                }
            }
        }
        super.onDestroy();
    }
}
