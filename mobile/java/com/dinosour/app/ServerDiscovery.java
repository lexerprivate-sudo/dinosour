package com.dinosour.app;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;

import org.json.JSONObject;

/** Finds the dinosour server on the same Wi-Fi network via a UDP broadcast. */
final class ServerDiscovery {
  private static final int DISCOVERY_PORT = 41234;
  private static final String PING = "DINOSOUR_DISCOVER_V1";

  private ServerDiscovery() {}

  static String find() {
    DatagramSocket socket = null;
    try {
      socket = new DatagramSocket();
      socket.setBroadcast(true);
      socket.setSoTimeout(700);

      byte[] payload = PING.getBytes(StandardCharsets.UTF_8);
      InetAddress broadcast = InetAddress.getByName("255.255.255.255");
      InetAddress emulatorHost = InetAddress.getByName("10.0.2.2");

      long deadline = System.currentTimeMillis() + 4500;
      while (System.currentTimeMillis() < deadline) {
        try {
          socket.send(new DatagramPacket(payload, payload.length, broadcast, DISCOVERY_PORT));
        } catch (Exception ignored) {}
        try {
          socket.send(new DatagramPacket(payload, payload.length, emulatorHost, DISCOVERY_PORT));
        } catch (Exception ignored) {}

        long roundEnd = Math.min(deadline, System.currentTimeMillis() + 900);
        while (System.currentTimeMillis() < roundEnd) {
          try {
            byte[] buffer = new byte[512];
            DatagramPacket reply = new DatagramPacket(buffer, buffer.length);
            socket.receive(reply);
            String body = new String(reply.getData(), 0, reply.getLength(), StandardCharsets.UTF_8);
            JSONObject json = new JSONObject(body);
            if (!"dinosour".equals(json.optString("app"))) continue;
            int port = json.optInt("port", 0);
            if (port <= 0) continue;
            return "http://" + reply.getAddress().getHostAddress() + ":" + port;
          } catch (SocketTimeoutException timeout) {
            break;
          } catch (Exception malformed) {
            // Keep listening until the deadline.
          }
        }
      }
    } catch (Exception ignored) {
      // No network, broadcast blocked, or Wi-Fi off.
    } finally {
      if (socket != null) socket.close();
    }
    return null;
  }
}
