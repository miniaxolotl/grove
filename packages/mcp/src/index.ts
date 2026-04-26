import { FastMCP } from "fastmcp";
import { z } from "zod";
import { createServer } from "node:http";
import { memoryRepository } from "./repositories/memory.repository.ts";
import { entityRepository } from "./repositories/entity.repository.ts";
import { relationRepository } from "./repositories/relation.repository.ts";
import { config, hasRemoteReranking } from "./config.ts";
import { rerankDocuments } from "./services/reranking.ts";
import { warmup } from "./services/embedding.ts";

let collectionsReady = false;

const server = new FastMCP({
  name: "grove",
  version: "0.1.0",
});

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

function toolErr(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return text(`Error: ${message}`);
}

// ── Memory Tools ──────────────────────────────────────────────────────────────

server.addTool({
  name: "memory_save",
  description: "Save a memory document to semantic storage",
  parameters: z.object({
    information: z.string(),
    metadata: z
      .object({
        source: z.string().optional(),
        project: z.string().optional(),
        tags: z.array(z.string()).optional(),
        importance: z.number().optional(),
        sessionId: z.string().optional(),
      })
      .optional(),
  }),
  execute: async (args) => {
    try {
      const result = await memoryRepository.save(args.information, {
        ...args.metadata,
        createdAt: new Date().toISOString(),
      });
      return text(`Saved memory: ${result.id}`);
    } catch (err) {
      return toolErr(err);
    }
  },
});

server.addTool({
  name: "memory_search",
  description: "Search memories by semantic similarity with optional reranking",
  parameters: z.object({
    query: z.string(),
    project: z.string().optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().optional().default(5),
    rerank: z.boolean().optional().default(hasRemoteReranking),
    rerankTopK: z.number().optional().default(20),
  }),
  execute: async (args) => {
    try {
      const limit = args.limit ?? 5;
      const rerankTopK = args.rerankTopK ?? 20;

      const results = await memoryRepository.search(args.query, {
        project: args.project,
        tags: args.tags,
        limit: args.rerank && hasRemoteReranking ? rerankTopK : limit,
      });

      if (args.rerank && hasRemoteReranking && results.length > limit) {
        const docs = results.map((r) => r.text);
        const reranked = await rerankDocuments(args.query, docs, limit);
        const rerankedResults = reranked
          .map((r) => ({ ...results[r.index], score: r.relevanceScore }))
          .filter((r) => r.text !== undefined);

        return text(JSON.stringify(rerankedResults, null, 2));
      }

      return text(JSON.stringify(results, null, 2));
    } catch (err) {
      return toolErr(err);
    }
  },
});

server.addTool({
  name: "memory_forget",
  description: "Delete memories by IDs or filter",
  parameters: z.object({
    ids: z.array(z.string()).optional(),
    project: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  execute: async (args) => {
    try {
      if (args.ids && args.ids.length > 0) {
        await memoryRepository.delete(args.ids);
        return text(`Deleted ${args.ids.length} memories`);
      }
      if (args.project || args.tags) {
        await memoryRepository.deleteByFilter({
          project: args.project,
          tags: args.tags,
        });
        return text("Deleted memories by filter");
      }
      return text("No IDs or filter provided");
    } catch (err) {
      return toolErr(err);
    }
  },
});

server.addTool({
  name: "memory_compact",
  description: "Compact memories by session or project, removing low-importance ones (importance < 0.6)",
  parameters: z.object({
    project: z.string().optional(),
    sessionId: z.string().optional(),
    importanceThreshold: z.number().optional().default(0.6),
  }),
  execute: async (args) => {
    try {
      const result = await memoryRepository.compact({
        project: args.project,
        sessionId: args.sessionId,
        importanceThreshold: args.importanceThreshold,
      });
      return text(`Compacted ${result.compacted} memories`);
    } catch (err) {
      return toolErr(err);
    }
  },
});

server.addTool({
  name: "memory_prune",
  description: "Delete memories below an importance threshold",
  parameters: z.object({
    threshold: z.number(),
    project: z.string().optional(),
  }),
  execute: async (args) => {
    try {
      const result = await memoryRepository.prune({
        threshold: args.threshold,
        project: args.project,
      });
      return text(`Pruned ${result.pruned} memories`);
    } catch (err) {
      return toolErr(err);
    }
  },
});

// ── Entity Tools ──────────────────────────────────────────────────────────────

server.addTool({
  name: "entity_create",
  description: "Create an entity",
  parameters: z.object({
    name: z.string(),
    entityType: z.string(),
    observations: z.array(z.string()).optional().default([]),
    metadata: z.record(z.unknown()).optional(),
  }),
  execute: async (args) => {
    try {
      const result = await entityRepository.create(
        args.name,
        args.entityType,
        args.observations ?? [],
        args.metadata,
      );
      return text(`Created entity: ${result.name} (${result.id})`);
    } catch (err) {
      return toolErr(err);
    }
  },
});

server.addTool({
  name: "entity_search",
  description: "Find entities by name or type",
  parameters: z.object({
    query: z.string().optional(),
    entityType: z.string().optional(),
    limit: z.number().optional().default(10),
  }),
  execute: async (args) => {
    try {
      const results = await entityRepository.search(
        args.query,
        args.entityType,
        args.limit,
      );
      return text(JSON.stringify(results, null, 2));
    } catch (err) {
      return toolErr(err);
    }
  },
});

server.addTool({
  name: "entity_add_observations",
  description: "Add observations to an existing entity",
  parameters: z.object({
    name: z.string(),
    observations: z.array(z.string()),
  }),
  execute: async (args) => {
    try {
      const result = await entityRepository.addObservations(
        args.name,
        args.observations,
      );
      if (!result) return text(`Entity not found: ${args.name}`);
      return text(`Added observations to: ${result.name}`);
    } catch (err) {
      return toolErr(err);
    }
  },
});

server.addTool({
  name: "entity_get",
  description: "Get full entity details by name",
  parameters: z.object({
    name: z.string(),
  }),
  execute: async (args) => {
    try {
      const result = await entityRepository.get(args.name);
      if (!result) return text(`Entity not found: ${args.name}`);
      return text(JSON.stringify(result, null, 2));
    } catch (err) {
      return toolErr(err);
    }
  },
});

// ── Relation Tools ────────────────────────────────────────────────────────────

server.addTool({
  name: "relation_create",
  description: "Create a relation between two entities",
  parameters: z.object({
    from: z.string(),
    relationType: z.string(),
    to: z.string(),
    metadata: z.record(z.unknown()).optional(),
  }),
  execute: async (args) => {
    try {
      const result = await relationRepository.create(
        args.from,
        args.relationType,
        args.to,
        args.metadata,
      );
      return text(
        `Created relation: ${args.from} --[${args.relationType}]--> ${args.to} (${result.id})`,
      );
    } catch (err) {
      return toolErr(err);
    }
  },
});

server.addTool({
  name: "relation_search",
  description: "Find relations by source, target, or type",
  parameters: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    relationType: z.string().optional(),
    limit: z.number().optional().default(20),
  }),
  execute: async (args) => {
    try {
      const results = await relationRepository.search(args, args.limit);
      return text(JSON.stringify(results, null, 2));
    } catch (err) {
      return toolErr(err);
    }
  },
});

server.addTool({
  name: "relation_delete",
  description: "Delete relations",
  parameters: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    relationType: z.string().optional(),
  }),
  execute: async (args) => {
    try {
      await relationRepository.delete(args);
      return text("Relations deleted");
    } catch (err) {
      return toolErr(err);
    }
  },
});

// ── Memory Update ─────────────────────────────────────────────────────────────

server.addTool({
  name: "memory_update",
  description: "Update text or metadata of an existing memory by ID",
  parameters: z.object({
    id: z.string(),
    text: z.string().optional(),
    metadata: z
      .object({
        source: z.string().optional(),
        project: z.string().optional(),
        tags: z.array(z.string()).optional(),
        importance: z.number().optional(),
        sessionId: z.string().optional(),
      })
      .optional(),
  }),
  execute: async (args) => {
    try {
      const result = await memoryRepository.update(args.id, {
        text: args.text,
        metadata: args.metadata,
      });
      if (!result) return text(`Memory not found: ${args.id}`);
      return text(JSON.stringify(result, null, 2));
    } catch (err) {
      return toolErr(err);
    }
  },
});

// ── Memory Scroll / Stats ─────────────────────────────────────────────────────

server.addTool({
  name: "memory_scroll",
  description: "Paginate through memories with cursor-based pagination",
  parameters: z.object({
    project: z.string().optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().optional().default(100),
    offset: z.string().optional(),
  }),
  execute: async (args) => {
    try {
      const { memories, offset } = await memoryRepository.scroll({
        project: args.project,
        tags: args.tags,
        limit: args.limit,
        offset: args.offset,
      });
      return text(JSON.stringify({ memories, nextOffset: offset }, null, 2));
    } catch (err) {
      return toolErr(err);
    }
  },
});

server.addTool({
  name: "memory_stats",
  description: "Get statistics about the memories collection",
  parameters: z.object({}),
  execute: async () => {
    try {
      const stats = await memoryRepository.stats();
      return text(JSON.stringify(stats, null, 2));
    } catch (err) {
      return toolErr(err);
    }
  },
});

// ── Entity / Relation Stats ───────────────────────────────────────────────────

server.addTool({
  name: "entity_update",
  description: "Update an existing entity by ID",
  parameters: z.object({
    id: z.string(),
    name: z.string().optional(),
    entityType: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  execute: async (args) => {
    try {
      const result = await entityRepository.update(args.id, {
        name: args.name,
        entityType: args.entityType,
        metadata: args.metadata,
      });
      if (!result) return text(`Entity not found: ${args.id}`);
      return text(JSON.stringify(result, null, 2));
    } catch (err) {
      return toolErr(err);
    }
  },
});

server.addTool({
  name: "entity_stats",
  description: "Get statistics about the entities collection",
  parameters: z.object({}),
  execute: async () => {
    try {
      const stats = await entityRepository.stats();
      return text(JSON.stringify(stats, null, 2));
    } catch (err) {
      return toolErr(err);
    }
  },
});

server.addTool({
  name: "relation_stats",
  description: "Get statistics about the relations collection",
  parameters: z.object({}),
  execute: async () => {
    try {
      const stats = await relationRepository.stats();
      return text(JSON.stringify(stats, null, 2));
    } catch (err) {
      return toolErr(err);
    }
  },
});

// ── List Tools ────────────────────────────────────────────────────────────────

server.addTool({
  name: "memory_note",
  description: "Quick-save a note (lightweight memory with auto-tag 'note')",
  parameters: z.object({
    content: z.string(),
    project: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  execute: async (args) => {
    try {
      const tags = [...(args.tags ?? []), "note"];
      const result = await memoryRepository.save(args.content, {
        project: args.project,
        tags,
        createdAt: new Date().toISOString(),
      });
      return text(`Saved note: ${result.id}`);
    } catch (err) {
      return toolErr(err);
    }
  },
});

server.addTool({
  name: "entity_list",
  description:
    "List all entities, optionally filtered by type, with pagination",
  parameters: z.object({
    entityType: z.string().optional(),
    limit: z.number().optional().default(100),
    offset: z.string().optional(),
  }),
  execute: async (args) => {
    try {
      const { entities, offset } = await entityRepository.list(
        args.entityType,
        args.limit,
        args.offset,
      );
      return text(JSON.stringify({ entities, nextOffset: offset }, null, 2));
    } catch (err) {
      return toolErr(err);
    }
  },
});

server.addTool({
  name: "relation_list",
  description:
    "List all relations, optionally filtered by type, with pagination",
  parameters: z.object({
    relationType: z.string().optional(),
    limit: z.number().optional().default(100),
    offset: z.string().optional(),
  }),
  execute: async (args) => {
    try {
      const { relations, offset } = await relationRepository.list(
        args.relationType,
        args.limit,
        args.offset,
      );
      return text(JSON.stringify({ relations, nextOffset: offset }, null, 2));
    } catch (err) {
      return toolErr(err);
    }
  },
});

// ── Initialize collections on startup ────────────────────────────────────────

async function init(retries = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await memoryRepository.init();
      await entityRepository.init();
      await relationRepository.init();
      collectionsReady = true;
      console.error("Collections initialized");
      try {
        await warmup();
      } catch (err) {
        console.warn("Embedding warmup failed (non-fatal):", err);
      }
      return;
    } catch (err) {
      if (attempt === retries) {
        console.error(`Failed to initialize collections after ${retries} attempts:`, err);
        process.exit(1);
      }
      console.error(`Collection init attempt ${attempt}/${retries} failed, retrying in ${delayMs / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

init();

if (config.transport === "http") {
  // Health check server (separate port)
  const healthPort = config.port + 1;
  createServer((req, res) => {
    if (req.url === "/ready") {
      if (collectionsReady) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ready" }));
      } else {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "initializing" }));
      }
      return;
    }
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "healthy", uptime: process.uptime() }));
      return;
    }
    res.writeHead(404);
    res.end();
  }).listen(healthPort, () => {
    console.error(
      `[grove] Health check server on http://localhost:${healthPort}`,
    );
  });

  server.start({
    transportType: "httpStream",
    httpStream: { endpoint: "/mcp", port: config.port },
  });
  console.error(
    `[grove] HTTP server listening on http://localhost:${config.port}/mcp`,
  );
} else {
  server.start({ transportType: "stdio" });
}

function shutdown(signal: string) {
  console.error(`[grove] Received ${signal}, shutting down...`);
  server.stop().then(() => {
    console.error("[grove] Server stopped");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("[grove] Force exit after timeout");
    process.exit(1);
  }, 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
