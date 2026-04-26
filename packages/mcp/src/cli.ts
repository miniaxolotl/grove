import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const command = process.argv[2];

if (command === "serve" || command === undefined) {
  await import("./index.js");
} else if (command === "--version" || command === "-v") {
  const pkg = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../package.json", import.meta.url)),
      "utf8",
    ),
  );
  console.log(pkg.version);
} else if (command === "--help" || command === "-h") {
  console.log(`grove - Self-hosted agentic memory MCP server

Usage:
  grove serve    Start the MCP server
  grove          Start the MCP server (default)

Options:
  --version, -v  Show version
  --help, -h     Show this help

Environment:
  TRANSPORT      Transport type: http (default) or stdio
  PORT           Server port (default: 26080)
  QDRANT_URL     Qdrant server URL (default: http://localhost:6333)
  QDRANT_API_KEY Qdrant API key
  EMBEDDING_URL  Remote embedding URL (optional, falls back to local ONNX)
  RERANKING_URL  Remote reranking URL (optional)`);
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
