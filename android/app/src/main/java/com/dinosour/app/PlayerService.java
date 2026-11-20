package com.dinosour.app;

import android.content.Intent;
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
            ExoPlayer player = new ExoPlayer.Builder(this).build();
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
    public void onDestroy() {
        if (session != null) {
            session.getPlayer().release();
            session.release();
            session = null;
        }
        super.onDestroy();
    }
}
