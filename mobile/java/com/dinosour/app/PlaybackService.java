package com.dinosour.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps the audio session alive while dinosour is in the background and gives
 * the lock screen / notification shade play, pause and stop controls.
 *
 * YouTube's embedded player can still decide to pause itself when the page is
 * hidden, so this is a best-effort fallback rather than a guarantee.
 */
public class PlaybackService extends Service {
  public static final String ACTION_UPDATE = "com.dinosour.app.MEDIA_UPDATE";
  public static final String ACTION_STOP = "com.dinosour.app.MEDIA_STOP";
  public static final String ACTION_PLAY = "com.dinosour.app.MEDIA_PLAY";
  public static final String ACTION_PAUSE = "com.dinosour.app.MEDIA_PAUSE";

  public static final String EXTRA_PLAYING = "playing";
  public static final String EXTRA_TITLE = "title";
  public static final String EXTRA_CHANNEL = "channel";

  private static final String CHANNEL_ID = "dinosour-playback";
  private static final int NOTIFICATION_ID = 4101;

  /** Lets the activity know whether the WebView may be paused. */
  static volatile boolean RUNNING = false;

  private MediaSession session;
  private PowerManager.WakeLock wakeLock;
  private boolean playing = true;
  private String title = "dinosour";
  private String channel = "YouTube";

  @Override
  public void onCreate() {
    super.onCreate();
    RUNNING = true;
    createChannel();

    PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
    if (power != null) {
      wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "dinosour:playback");
      wakeLock.setReferenceCounted(false);
      wakeLock.acquire();
    }

    session = new MediaSession(this, "dinosour");
    session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS
        | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
    session.setPlaybackToLocal(new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build());
    session.setCallback(new MediaSession.Callback() {
      @Override
      public void onPlay() {
        playing = true;
        MainActivity.sendMediaCommand("play");
        update();
      }

      @Override
      public void onPause() {
        playing = false;
        MainActivity.sendMediaCommand("pause");
        update();
      }

      @Override
      public void onStop() {
        MainActivity.sendMediaCommand("stop");
        stopSelf();
      }
    });
    session.setActive(true);
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent != null ? intent.getAction() : null;

    if (ACTION_STOP.equals(action)) {
      MainActivity.sendMediaCommand("stop");
      stopSelf();
      return START_NOT_STICKY;
    }

    if (ACTION_PLAY.equals(action)) {
      playing = true;
      MainActivity.sendMediaCommand("play");
      update();
      return START_STICKY;
    }

    if (ACTION_PAUSE.equals(action)) {
      playing = false;
      MainActivity.sendMediaCommand("pause");
      update();
      return START_STICKY;
    }

    if (ACTION_UPDATE.equals(action) || intent == null) {
      playing = intent == null || intent.getBooleanExtra(EXTRA_PLAYING, true);
      if (intent != null) {
        String nextTitle = intent.getStringExtra(EXTRA_TITLE);
        String nextChannel = intent.getStringExtra(EXTRA_CHANNEL);
        if (nextTitle != null && !nextTitle.isEmpty()) title = nextTitle;
        if (nextChannel != null && !nextChannel.isEmpty()) channel = nextChannel;
      }
    }

    update();
    return START_STICKY;
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT < 26) return;
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null) return;
    NotificationChannel channel = new NotificationChannel(
        CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW);
    channel.setDescription("Background audio controls");
    channel.setShowBadge(false);
    channel.setSound(null, null);
    manager.createNotificationChannel(channel);
  }

  private int pendingFlags() {
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
    return flags;
  }

  private void update() {
    if (session != null) {
      session.setMetadata(new MediaMetadata.Builder()
          .putString(MediaMetadata.METADATA_KEY_TITLE, title)
          .putString(MediaMetadata.METADATA_KEY_ARTIST, channel)
          .build());
      session.setPlaybackState(new PlaybackState.Builder()
          .setActions(PlaybackState.ACTION_PLAY
              | PlaybackState.ACTION_PAUSE
              | PlaybackState.ACTION_PLAY_PAUSE
              | PlaybackState.ACTION_STOP
              | PlaybackState.ACTION_SEEK_TO)
          .setState(
              playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
              PlaybackState.PLAYBACK_POSITION_UNKNOWN,
              playing ? 1f : 0f)
          .build());
    }

    Intent open = new Intent(this, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent content = PendingIntent.getActivity(this, 0, open, pendingFlags());

    Intent toggle = new Intent(this, PlaybackService.class)
        .setAction(playing ? ACTION_PAUSE : ACTION_PLAY);
    PendingIntent toggleIntent = PendingIntent.getService(this, 1, toggle, pendingFlags());

    Intent stop = new Intent(this, PlaybackService.class).setAction(ACTION_STOP);
    PendingIntent stopIntent = PendingIntent.getService(this, 2, stop, pendingFlags());

    Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_stat_play)
        .setContentTitle(title)
        .setContentText(channel)
        .setContentIntent(content)
        .setOngoing(playing)
        .setOnlyAlertOnce(true)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .addAction(new Notification.Action.Builder(
            playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
            playing ? "Pause" : "Play",
            toggleIntent).build())
        .addAction(new Notification.Action.Builder(
            android.R.drawable.ic_menu_close_clear_cancel,
            "Stop",
            stopIntent).build());

    if (session != null) {
      builder.setStyle(new Notification.MediaStyle()
          .setMediaSession(session.getSessionToken())
          .setShowActionsInCompactView(0, 1));
    }

    Notification notification = builder.build();
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
    } else {
      startForeground(NOTIFICATION_ID, notification);
    }
  }

  @Override
  public void onDestroy() {
    RUNNING = false;
    if (session != null) {
      session.setActive(false);
      session.release();
      session = null;
    }
    if (wakeLock != null) {
      if (wakeLock.isHeld()) wakeLock.release();
      wakeLock = null;
    }
    if (Build.VERSION.SDK_INT >= 24) {
      stopForeground(STOP_FOREGROUND_REMOVE);
    } else {
      stopForeground(true);
    }
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
