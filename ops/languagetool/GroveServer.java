package org.languagetool.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.Semaphore;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Keep LT's own check handler and engine; constrain its private HTTP listener. */
public final class GroveServer extends HTTPServer {
  private final Semaphore checkSlot = new Semaphore(1);
  private volatile boolean ready;

  private GroveServer(HTTPServerConfig config) {
    super(config, false, null, null);
    server.removeContext("/");
    server.createContext("/", exchange -> {
      String path = exchange.getRequestURI().toString();
      if (path.equals("/ready") && exchange.getRequestMethod().equals("GET")) {
        finish(exchange, ready ? 200 : 503);
      } else if (!path.equals("/v2/check") || !exchange.getRequestMethod().equals("POST")) {
        finish(exchange, 404);
      } else if (!ready && !exchange.getRemoteAddress().getAddress().isLoopbackAddress()) {
        finish(exchange, 503);
      } else {
        // The sole caller sends a URL-encoded form with a known byte length.
        String length = exchange.getRequestHeaders().getFirst("Content-Length");
        if (length == null || !length.matches("[0-9]{1,5}") || Integer.parseInt(length) > 65536) {
          finish(exchange, 413);
        } else if (!checkSlot.tryAcquire()) {
          finish(exchange, 503);
        } else {
          handleCheck(exchange);
        }
      }
    });
  }

  private void handleCheck(HttpExchange exchange) throws IOException {
    // LT 6.8 computes its complete result before writing it, then performs
    // bookkeeping after the client can already have read the response. Release
    // admission before sending that result, not at the end of bookkeeping.
    class ResultStream extends FilterOutputStream {
      private boolean held = true;
      ResultStream(OutputStream out) { super(out); }
      void release() {
        if (held) { held = false; checkSlot.release(); }
      }
      @Override public void write(int b) throws IOException { release(); out.write(b); }
      @Override public void write(byte[] bytes, int off, int len) throws IOException {
        release(); out.write(bytes, off, len);
      }
    }
    ResultStream result = new ResultStream(exchange.getResponseBody());
    try {
      exchange.setStreams(exchange.getRequestBody(), result);
      httpHandler.handle(exchange);
    } finally {
      result.release(); // Includes a disconnect before any result was written.
    }
  }

  private static void finish(HttpExchange exchange, int status) throws IOException {
    exchange.sendResponseHeaders(status, -1);
    exchange.close();
  }

  @Override
  protected ThreadPoolExecutor getExecutorService(HTTPServerConfig config) {
    // Dispatch a check, a health probe and a busy response concurrently. Only
    // one check can compute a result, and the dispatcher never queues requests.
    return new ThreadPoolExecutor(3, 3, 0, TimeUnit.SECONDS, new SynchronousQueue<>());
  }

  public static void main(String[] args) {
    try {
      HTTPServerConfig config = new HTTPServerConfig(new String[]{"--port", "8081", "--config", "server.properties", "--notLogIP"});
      DatabaseAccess.init(config);
      GroveServer lt = new GroveServer(config);
      lt.run();
      HttpRequest probe = HttpRequest.newBuilder(URI.create("http://127.0.0.1:8081/v2/check"))
          .timeout(Duration.ofSeconds(45)).header("Content-Type", "application/x-www-form-urlencoded")
          .POST(HttpRequest.BodyPublishers.ofString("language=en-US&enabledOnly=true&enabledRules=EN_A_VS_AN&text=This+is+a+hour+away."))
          .build();
      HttpClient client = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
      boolean healthy = false;
      // Cold English initialization can exceed the normal check budget on a
      // shared CPU. Retry only this fixed synthetic startup check; retain the
      // normal engine limits and reject non-loopback checks until it succeeds.
      for (int attempt = 0; attempt < 3; attempt++) {
        try {
          HttpResponse<String> response = client.send(probe, HttpResponse.BodyHandlers.ofString());
          JsonNode json = new ObjectMapper().readTree(response.body());
          JsonNode match = json.at("/matches/0");
          healthy = response.statusCode() == 200 && json.at("/software/version").asText().equals("6.8") &&
              match.at("/rule/id").asText().equals("EN_A_VS_AN") && match.at("/replacements/0/value").asText().equals("an");
          if (healthy) break;
        } catch (IOException e) {
          // No upstream body or exception message is safe to log.
        }
        if (attempt < 2) Thread.sleep(250);
      }
      if (!healthy) throw new IllegalStateException("English startup check failed");
      lt.ready = true;
    } catch (Exception e) {
      System.exit(1);
    }
  }
}
