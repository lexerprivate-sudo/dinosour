package com.dinosour.app;

import android.app.PictureInPictureParams;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Rect;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;

import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import androidx.media3.ui.PlayerView;

import com.google.common.util.concurrent.ListenableFuture;

import java.util.ArrayList;
import java.util.List;

/**
 * Standalone player surface. The ExoPlayer lives in PlayerService, so this
 * activity is only a remote control and can enter picture-in-picture without
 * interrupting playback (the LibreTube PictureInPictureParamsCompat pattern).
 */
@UnstableApi
public class PlayerActivity extends AppCompatActivity {
    public static final String EXTRA_VIDEO_ID = "video_id";
    private static final String ACTION_PLAY = "com.dinosour.app.PIP_PLAY";
    private static final String ACTION_PAUSE = "com.dinosour.app.PIP_PAUSE";

    private PlayerView playerView;
    private MediaController controller;
    private ListenableFuture<MediaController> controllerFuture;
    private Button pipButton;
    private PipReceiver receiver;
    private String videoId;
    private String lastStartedVideoId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        videoId = getIntent().getStringExtra(EXTRA_VIDEO_ID);

        FrameLayout root = new FrameLayout(this);
        playerView = new PlayerView(this);
        root.addView(playerView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        pipButton = new Button(this);
        pipButton.setText("PiP");
        FrameLayout.LayoutParams btnParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        btnParams.gravity = Gravity.TOP | Gravity.END;
        btnParams.setMargins(16, 16, 16, 16);
        pipButton.setOnClickListener(v -> enterPip());
        root.addView(pipButton, btnParams);
        setContentView(root);

        receiver = new PipReceiver();
        try {
            registerReceiver(receiver, new IntentFilter(ACTION_PLAY));
            registerReceiver(receiver, new IntentFilter(ACTION_PAUSE));
        } catch (Throwable ignored) {
        }

        // Double-tap the native surface to seek +/- 10 seconds. Only the second
        // UP is consumed, so Media3's own controls keep working normally.
        final long[] lastTapAt = {0L};
        playerView.setOnTouchListener((v, event) -> {
            if (event.getActionMasked() != MotionEvent.ACTION_UP) return false;
            long now = SystemClock.uptimeMillis();
            if (now - lastTapAt[0] >= ViewConfiguration.get(this).getDoubleTapTimeout()) {
                lastTapAt[0] = now;
                return false;
            }
            lastTapAt[0] = 0L;
            if (controller == null) return false;
            try {
                long pos = controller.getCurrentPosition();
                long duration = controller.getDuration();
                long target = pos + (pos > 3000 ? -10000L : 10000L);
                if (target < 0) target = 0;
                if (duration > 0 && target > duration) target = duration;
                controller.seekTo(target);
            } catch (Throwable ignored) {
            }
            return true;
        });

        connectPlayer();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String next = intent.getStringExtra(EXTRA_VIDEO_ID);
        if (next != null && !next.equals(videoId)) {
            videoId = next;
            lastStartedVideoId = null;
            startVideo();
        }
    }

    private void startVideo() {
        if (videoId == null || videoId.isEmpty() || videoId.equals(lastStartedVideoId)) return;
        lastStartedVideoId = videoId;
        Intent intent = new Intent(this, PlayerService.class);
        intent.putExtra(PlayerService.EXTRA_VIDEO_URL,
                "https://www.youtube.com/watch?v=" + videoId);
        try {
            startService(intent);
        } catch (Throwable ignored) {
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        startVideo();
    }

    private void connectPlayer() {
        if (controllerFuture != null) return;
        try {
            SessionToken token = new SessionToken(this, new ComponentName(this, PlayerService.class));
            controllerFuture = new MediaController.Builder(this, token).buildAsync();
            controllerFuture.addListener(() -> {
                try {
                    controller = controllerFuture.get();
                    playerView.setPlayer(controller);
                } catch (Throwable ignored) {
                }
            }, this::runOnUiThread);
        } catch (Throwable ignored) {
        }
    }

    private void enterPip() {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            PictureInPictureParams.Builder params = new PictureInPictureParams.Builder();
            Rect hint = new Rect();
            playerView.getGlobalVisibleRect(hint);
            if (!hint.isEmpty()) params.setSourceRectHint(hint);
            params.setAspectRatio(new android.util.Rational(16, 9));
            if (Build.VERSION.SDK_INT >= 31) {
                params.setAutoEnterEnabled(true).setSeamlessResizeEnabled(true);
            }

            boolean playing = controller != null && controller.getPlayWhenReady();
            List<android.app.RemoteAction> actions = new ArrayList<>();
            actions.add(new android.app.RemoteAction(
                    Icon.createWithResource(this,
                            playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play),
                    playing ? "Pause" : "Play",
                    playing ? "Pause playback" : "Resume playback",
                    pending(playing ? ACTION_PAUSE : ACTION_PLAY, 100)));
            actions.add(new android.app.RemoteAction(
                    Icon.createWithResource(this, android.R.drawable.ic_media_next),
                    "Next", "Play next video",
                    pending("com.dinosour.app.MEDIA_NEXT", 101)));
            params.setActions(actions);

            enterPictureInPictureMode(params.build());
        } catch (Throwable ignored) {
        }
    }

    private android.app.PendingIntent pending(String action, int requestCode) {
        Intent intent = new Intent(action).setPackage(getPackageName());
        int flags = android.app.PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= android.app.PendingIntent.FLAG_IMMUTABLE;
        return android.app.PendingIntent.getBroadcast(this, requestCode, intent, flags);
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        // API 31+ auto-enter already handles this; doing it manually causes a
        // double transition and visible flicker.
        if (Build.VERSION.SDK_INT < 31 && controller != null && controller.getPlayWhenReady()) enterPip();
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode,
                                              android.content.res.Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        if (pipButton != null) {
            pipButton.setVisibility(isInPictureInPictureMode ? android.view.View.GONE : android.view.View.VISIBLE);
        }
    }

    @Override
    protected void onDestroy() {
        try {
            if (receiver != null) unregisterReceiver(receiver);
        } catch (Throwable ignored) {
        }
        if (playerView != null) playerView.setPlayer(null);
        if (controllerFuture != null) MediaController.releaseFuture(controllerFuture);
        super.onDestroy();
    }

    public class PipReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (controller == null || intent == null) return;
            String action = intent.getAction();
            try {
                if (ACTION_PLAY.equals(action)) controller.play();
                else if (ACTION_PAUSE.equals(action)) controller.pause();
                else if ("com.dinosour.app.MEDIA_NEXT".equals(action)) {
                    Intent service = new Intent(PlayerActivity.this, PlayerService.class);
                    service.setAction("com.dinosour.app.MEDIA_NEXT");
                    startService(service);
                }
            } catch (Throwable ignored) {
            }
        }
    }
}
