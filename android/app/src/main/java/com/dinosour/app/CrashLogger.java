package com.dinosour.app;

import android.content.Context;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileWriter;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Captures uncaught exceptions so the app can survive the "it just closed" bug
 * reports: every crash is written to files/crash-last.txt, appended to
 * files/crash-history.txt, and logged to logcat under the DinosourCrash tag.
 *
 * The Settings page can read the report through window.Dinosour.crashLog(), and
 * adb logcat can capture it live with tools/capture-logcat.bat.
 */
public final class CrashLogger {
  private static final String TAG = "DinosourCrash";
  private static final String LAST = "crash-last.txt";
  private static final String HISTORY = "crash-history.txt";
  private static boolean installed = false;

  private CrashLogger() {}

  /** Safe to call more than once; never lets a failure here affect the app. */
  public static synchronized void install(Context context) {
    if (installed) return;
    installed = true;
    try {
      final Thread.UncaughtExceptionHandler previous =
          Thread.getDefaultUncaughtExceptionHandler();
      Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
        try {
          record(context, thread, error);
        } catch (Throwable ignored) {
        }
        // Preserve normal crash behaviour (the system kills the app as usual).
        if (previous != null) {
          try {
            previous.uncaughtException(thread, error);
          } catch (Throwable ignored) {
          }
        }
      });
    } catch (Throwable ignored) {
    }
  }

  private static void record(Context context, Thread thread, Throwable error) {
    String time = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date());
    StringWriter buffer = new StringWriter();
    PrintWriter out = new PrintWriter(buffer);
    out.println("=== dinosour crash " + time + " ===");
    out.println("thread: " + (thread == null ? "?" : thread.getName()));
    try {
      out.println("version: "
          + context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName);
    } catch (Exception ignored) {
    }
    out.println("device: " + android.os.Build.MANUFACTURER + " "
        + android.os.Build.MODEL + " / Android " + android.os.Build.VERSION.RELEASE);
    error.printStackTrace(out);
    Throwable cause = error.getCause();
    while (cause != null) {
      out.println("--- caused by ---");
      cause.printStackTrace(out);
      cause = cause.getCause();
    }
    out.flush();
    String text = buffer.toString();
    Log.e(TAG, text);
    try {
      File dir = context.getFilesDir();
      if (dir != null && dir.exists()) {
        try (FileWriter last = new FileWriter(new File(dir, LAST), false)) {
          last.write(text);
        }
        try (FileWriter history = new FileWriter(new File(dir, HISTORY), true)) {
          history.write(text + "\n");
        }
      }
    } catch (Throwable ignored) {
    }
  }

  /** Returns the last crash report, or an empty string when there is none. */
  public static String readLast(Context context) {
    try {
      File file = new File(context.getFilesDir(), LAST);
      if (!file.exists()) return "";
      StringBuilder text = new StringBuilder();
      try (BufferedReader reader = new BufferedReader(
          new InputStreamReader(new FileInputStream(file), "UTF-8"))) {
        String line;
        while ((line = reader.readLine()) != null) text.append(line).append('\n');
      }
      return text.toString();
    } catch (Throwable ignored) {
      return "";
    }
  }

  public static void clear(Context context) {
    try {
      new File(context.getFilesDir(), LAST).delete();
    } catch (Throwable ignored) {
    }
  }
}
