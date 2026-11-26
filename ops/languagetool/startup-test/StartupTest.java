package org.languagetool.server;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Runs the production launcher against a deterministic upstream-engine fixture.
 * Real JDK HTTP transport, readiness handler and admission executor are retained.
 * Only the upstream grammar engine is replaced, so cold failure is deterministic
 * without relying on machine speed or sending any user text. */
public final class StartupTest {
  public static void main(String[] args) throws Exception {
    coldCheckCanRecover();
    failedChecksNeverBecomeReady();
    System.out.println("Startup recovery and fail-closed readiness passed.");
  }

  private static Process start(String mode, Path count) throws IOException {
    return new ProcessBuilder(
        Path.of(System.getProperty("java.home"), "bin", "java").toString(),
        "-Dfixture.mode=" + mode, "-Dfixture.count=" + count,
        "-cp", System.getProperty("java.class.path"), GroveServer.class.getName())
        .redirectOutput(ProcessBuilder.Redirect.DISCARD)
        .redirectError(ProcessBuilder.Redirect.DISCARD)
        .start();
  }

  private static boolean ready() {
    try {
      HttpURLConnection connection = (HttpURLConnection) URI.create("http://127.0.0.1:8081/ready").toURL().openConnection();
      connection.setConnectTimeout(200);
      connection.setReadTimeout(200);
      try { return connection.getResponseCode() == 200; }
      finally { connection.disconnect(); }
    } catch (IOException e) { return false; }
  }

  private static void stop(Process child) throws InterruptedException {
    child.destroy();
    if (!child.waitFor(3, TimeUnit.SECONDS)) {
      child.destroyForcibly();
      if (!child.waitFor(3, TimeUnit.SECONDS)) throw new AssertionError("Fixture child did not stop");
    }
  }

  private static void coldCheckCanRecover() throws Exception {
    Path count = Files.createTempFile("lt-cold-start-", ".count");
    Process child = start("cold", count);
    try {
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
      boolean healthy = false;
      while (child.isAlive() && System.nanoTime() < deadline) {
        if (ready()) { healthy = true; break; }
        Thread.sleep(25);
      }
      if (!healthy) throw new AssertionError("Cold startup exited after a transient first-check failure instead of retrying");
      if (!Files.readString(count).equals("2")) throw new AssertionError("Readiness must follow exactly one failed and one successful synthetic check");
    } finally { stop(child); Files.deleteIfExists(count); }
  }

  private static void failedChecksNeverBecomeReady() throws Exception {
    Path count = Files.createTempFile("lt-failed-start-", ".count");
    Process child = start("failed", count);
    try {
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
      while (child.isAlive() && System.nanoTime() < deadline) {
        if (ready()) throw new AssertionError("A failed startup check became ready");
        Thread.sleep(25);
      }
      if (child.isAlive()) throw new AssertionError("Startup retries were not bounded");
      if (child.exitValue() == 0) throw new AssertionError("Permanent startup failure did not fail closed");
      int requests = Integer.parseInt(Files.readString(count));
      if (requests < 1 || requests > 3) throw new AssertionError("Unexpected startup attempt bound");
    } finally { stop(child); Files.deleteIfExists(count); }
  }
}

// Minimal upstream fixture types. These compile only into the disposable test
// directory; they are never copied into the checker image or runtime classpath.
final class HTTPServerConfig {
  HTTPServerConfig(String[] args) {}
}

final class DatabaseAccess {
  static void init(HTTPServerConfig config) {}
}

class HTTPServer {
  protected final HttpServer server;
  protected final HttpHandler httpHandler;
  private int checks;

  HTTPServer(HTTPServerConfig config, boolean ignored, Object first, Object second) {
    try {
      server = HttpServer.create(new InetSocketAddress("127.0.0.1", 8081), 0);
      httpHandler = this::check;
      server.createContext("/", httpHandler);
      server.setExecutor(getExecutorService(config));
    } catch (IOException e) { throw new UncheckedIOException(e); }
  }

  protected ThreadPoolExecutor getExecutorService(HTTPServerConfig config) {
    throw new AssertionError("The production admission executor must be used");
  }

  public void run() { server.start(); }

  private void check(HttpExchange exchange) throws IOException {
    exchange.getRequestBody().readAllBytes();
    checks++;
    Files.writeString(Path.of(System.getProperty("fixture.count")), String.valueOf(checks));
    boolean success = System.getProperty("fixture.mode").equals("cold") && checks > 1;
    byte[] body = (success
        ? "{\"software\":{\"version\":\"6.8\"},\"matches\":[{\"rule\":{\"id\":\"EN_A_VS_AN\"},\"replacements\":[{\"value\":\"an\"}]}]}"
        : "{\"error\":\"synthetic cold-check timeout\"}").getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json");
    exchange.sendResponseHeaders(success ? 200 : 503, body.length);
    exchange.getResponseBody().write(body);
    exchange.close();
  }
}
