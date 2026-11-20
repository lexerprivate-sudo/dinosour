package com.dinosour.app;

import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import androidx.media3.ui.PlayerView;
import com.google.common.util.concurrent.ListenableFuture;

import java.util.concurrent.Executors;

@UnstableApi
public class PlayerActivity extends AppCompatActivity {
    private PlayerView playerView;
    private MediaController controller;
    private ListenableFuture<MediaController> controllerFuture;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        playerView = new PlayerView(this);
        setContentView(playerView);

        SessionToken token = new SessionToken(this, new ComponentName(this, PlayerService.class));
        controllerFuture = new MediaController.Builder(this, token).buildAsync();
        controllerFuture.addListener(() -> {
            try {
                controller = controllerFuture.get();
                playerView.setPlayer(controller);
            } catch (Exception ignored) {
            }
        }, Executors.newSingleThreadExecutor());
    }

    @Override
    protected void onStart() {
        super.onStart();
        String url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
        Intent intent = new Intent(this, PlayerService.class);
        intent.putExtra(PlayerService.EXTRA_VIDEO_URL, url);
        startService(intent);
    }

    @Override
    protected void onDestroy() {
        if (playerView != null) playerView.setPlayer(null);
        if (controllerFuture != null) MediaController.releaseFuture(controllerFuture);
        super.onDestroy();
    }
}
