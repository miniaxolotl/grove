package org.languagetool.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Keep LT's own check handler and engine; constrain its private HTTP listener. */
public final class GroveServer extends HTTPServer {
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
        } else {
          httpHandler.handle(exchange);
        }
      }
    });
  }

  private static void finish(HttpExchange exchange, int status) throws IOException {
    exchange.sendResponseHeaders(status, -1);
    exchange.close();
  }

  @Override
  protected ThreadPoolExecutor getExecutorService(HTTPServerConfig config) {
    // LT's default server executor queues requests. With a direct hand-off,
    // HttpServer instead closes excess connections before reading their drafts.
    return new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, new SynchronousQueue<>());
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
      HttpResponse<String> response = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build()
          .send(probe, HttpResponse.BodyHandlers.ofString());
      JsonNode json = new ObjectMapper().readTree(response.body());
      JsonNode match = json.at("/matches/0");
      if (response.statusCode() != 200 || !json.at("/software/version").asText().equals("6.8") ||
          !match.at("/rule/id").asText().equals("EN_A_VS_AN") || !match.at("/replacements/0/value").asText().equals("an")) {
        throw new IllegalStateException("English startup check failed");
      }
      lt.ready = true;
    } catch (Exception e) {
      System.exit(1);
    }
  }
}
