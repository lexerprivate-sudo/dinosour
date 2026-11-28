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
    private static final String ACTION_NEXT = "com.dinosour.app.MEDIA_NEXT";

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
        int pipMargin = Math.round(16 * getResources().getDisplayMetrics().density);
        btnParams.setMargins(pipMargin, pipMargin, pipMargin, pipMargin);
        pipButton.setBackgroundResource(android.R.drawable.btn_default_small);
        pipButton.setAlpha(0.85f);
        pipButton.setOnClickListener(v -> enterPip());
        root.addView(pipButton, btnParams);
        setContentView(root);

        // Enable auto-enter at creation time. Doing it only inside enterPip()
        // means swiping away from the app never creates a PiP on Android 12+.
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                PictureInPictureParams params = new PictureInPictureParams.Builder()
                        .setAutoEnterEnabled(true)
                        .setSeamlessResizeEnabled(true)
                        .build();
                setPictureInPictureParams(params);
            } catch (Throwable ignored) {
            }
        }

        receiver = new PipReceiver();
        try {
            // One filter with all actions. Two-arg registerReceiver throws
            // SecurityException on API 34+ for non-system actions, and the
            // previous two separate registrations leaked one on unregister.
            IntentFilter filter = new IntentFilter();
            filter.addAction(ACTION_PLAY);
            filter.addAction(ACTION_PAUSE);
            filter.addAction(ACTION_NEXT);
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(receiver, filter);
            }
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
                showSeekFeedback(pos <= 3000);
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
        // PiP reuses the activity while the service is already playing; sending
        // the same URL again restarted ExoPlayer from 0:00.
        if (PlayerService.isPlayingVideo(videoId)) {
            lastStartedVideoId = videoId;
            return;
        }
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
                    pending(ACTION_NEXT, 101)));
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
            // Fade rather than hard-pop when entering/leaving PiP.
            if (isInPictureInPictureMode) {
                pipButton.animate().alpha(0f).setDuration(140)
                        .withEndAction(() -> pipButton.setVisibility(android.view.View.GONE));
            } else {
                pipButton.setVisibility(android.view.View.VISIBLE);
                pipButton.setAlpha(0f);
                pipButton.animate().alpha(0.85f).setDuration(180);
            }
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

    /** Brief on-screen bubble confirming a double-tap seek. */
    private void showSeekFeedback(boolean forward) {
        try {
            final FrameLayout root = (FrameLayout) getWindow().getDecorView().findViewById(android.R.id.content);
            if (root == null) return;
            final android.widget.TextView bubble = new android.widget.TextView(this);
            bubble.setText(forward ? "» 10 seconds" : "« 10 seconds");
            bubble.setTextColor(android.graphics.Color.WHITE);
            bubble.setTextSize(13f);
            bubble.setBackgroundColor(0xAA000000);
            int pad = Math.round(10 * getResources().getDisplayMetrics().density);
            bubble.setPadding(pad, pad / 2, pad, pad / 2);
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
            lp.gravity = Gravity.CENTER_VERTICAL | (forward ? Gravity.END : Gravity.START);
            lp.setMargins(forward ? 48 : 48, 0, 48, 0);
            root.addView(bubble, lp);
            bubble.setAlpha(0f);
            bubble.animate().alpha(1f).setDuration(120).withEndAction(() ->
                    bubble.animate().alpha(0f).setStartDelay(350).setDuration(180)
                            .withEndAction(() -> root.removeView(bubble)));
        } catch (Throwable ignored) {
        }
    }

    /** Keeps the PiP play/pause icons honest after a tap. */
    private void refreshPipActions(boolean playing) {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            PictureInPictureParams.Builder params = new PictureInPictureParams.Builder();
            java.util.List<android.app.RemoteAction> actions = new java.util.ArrayList<>();
            actions.add(new android.app.RemoteAction(
                    Icon.createWithResource(this,
                            playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play),
                    playing ? "Pause" : "Play",
                    playing ? "Pause playback" : "Resume playback",
                    pending(playing ? ACTION_PAUSE : ACTION_PLAY, 100)));
            actions.add(new android.app.RemoteAction(
                    Icon.createWithResource(this, android.R.drawable.ic_media_next),
                    "Next", "Play next video", pending(ACTION_NEXT, 101)));
            params.setActions(actions);
            setPictureInPictureParams(params.build());
        } catch (Throwable ignored) {
        }
    }

    public class PipReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (controller == null || intent == null) return;
            String action = intent.getAction();
            try {
                if (ACTION_PLAY.equals(action)) { controller.play(); refreshPipActions(true); }
                else if (ACTION_PAUSE.equals(action)) { controller.pause(); refreshPipActions(false); }
                else if (ACTION_NEXT.equals(action)) {
                    Intent service = new Intent(PlayerActivity.this, PlayerService.class);
                    service.setAction(ACTION_NEXT);
                    startService(service);
                }
            } catch (Throwable ignored) {
            }
        }
    }
}
