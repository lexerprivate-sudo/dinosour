package com.dinosour.app;

import android.app.Application;

/**
 * Installs the crash logger before any Activity, Service or ContentProvider is
 * created, so even very early startup failures are captured.
 */
public class DinosourApp extends Application {
  @Override
  public void onCreate() {
    super.onCreate();
    CrashLogger.install(this);
  }
}
