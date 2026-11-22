package com.dinosour.app;

import android.content.Intent;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
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

    private MediaSession session;

    @Override
    public void onCreate() {
        super.onCreate();
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
            session = new MediaSession.Builder(this, player).build();
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
        if (intent == null || session == null) {
            MainActivity.notifyNativeFailure();
            return START_STICKY;
        }
        final String url = intent.getStringExtra(EXTRA_VIDEO_URL);
        final String title = intent.getStringExtra(EXTRA_TITLE);
        final String channel = intent.getStringExtra(EXTRA_CHANNEL);
        if (url == null) return START_STICKY;
        new Thread(() -> {
            try {
                if (session == null) {
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
                session.getPlayer().setMediaItem(item);
                session.getPlayer().prepare();
                session.getPlayer().play();
            } catch (Throwable error) {
                MainActivity.notifyNativeFailure();
                android.util.Log.w("DinosourPlayer", "stream extraction failed", error);
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
            if (session == null || !session.getPlayer().getPlayWhenReady()) {
                stopSelf();
            }
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onDestroy() {
        if (session != null) {
            session.getPlayer().release();
            session.release();
            session = null;
        }
        super.onDestroy();
    }
}
