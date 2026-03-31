import { FastMCP } from "fastmcp";
import { z } from "zod";
import { createServer } from "node:http";
import { memoryRepository } from "./repositories/memory.repository.ts";
import { entityRepository } from "./repositories/entity.repository.ts";
import { relationRepository } from "./repositories/relation.repository.ts";
import { config, hasRemoteReranking } from "./config.ts";
import { rerankDocuments } from "./services/reranking.ts";

let collectionsReady = false;

const server = new FastMCP({
  name: "qdrant-memory",
  version: "0.1.0",
});

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
      })
      .optional(),
  }),
  execute: async (args) => {
    const result = await memoryRepository.save(args.information, {
      ...args.metadata,
      createdAt: new Date().toISOString(),
    });
    return `Saved memory: ${result.id}`;
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
    rerank: z.boolean().optional().default(true),
    rerankTopK: z.number().optional().default(20),
  }),
  execute: async (args) => {
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

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(rerankedResults, null, 2),
          },
        ],
      };
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(results, null, 2) },
      ],
    };
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
    if (args.ids && args.ids.length > 0) {
      await memoryRepository.delete(args.ids);
      return `Deleted ${args.ids.length} memories`;
    }
    if (args.project || args.tags) {
      await memoryRepository.deleteByFilter({
        project: args.project,
        tags: args.tags,
      });
      return "Deleted memories by filter";
    }
    return "No IDs or filter provided";
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
    const result = await entityRepository.create(
      args.name,
      args.entityType,
      args.observations ?? [],
      args.metadata,
    );
    return `Created entity: ${result.name} (${result.id})`;
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
    const results = await entityRepository.search(
      args.query,
      args.entityType,
      args.limit,
    );
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(results, null, 2) },
      ],
    };
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
    const result = await entityRepository.addObservations(
      args.name,
      args.observations,
    );
    if (!result) return `Entity not found: ${args.name}`;
    return `Added observations to: ${result.name}`;
  },
});

server.addTool({
  name: "entity_get",
  description: "Get full entity details by name",
  parameters: z.object({
    name: z.string(),
  }),
  execute: async (args) => {
    const result = await entityRepository.get(args.name);
    if (!result) return `Entity not found: ${args.name}`;
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
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
    const result = await relationRepository.create(
      args.from,
      args.relationType,
      args.to,
      args.metadata,
    );
    return `Created relation: ${args.from} --[${args.relationType}]--> ${args.to} (${result.id})`;
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
    const results = await relationRepository.search(args, args.limit);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(results, null, 2) },
      ],
    };
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
    await relationRepository.delete(args);
    return "Relations deleted";
  },
});

// ── Batch Memory Tools ─────────────────────────────────────────────────────────

server.addTool({
  name: "memory_save_batch",
  description: "Save multiple memories in a single call for efficiency",
  parameters: z.object({
    items: z.array(
      z.object({
        information: z.string(),
        metadata: z
          .object({
            source: z.string().optional(),
            project: z.string().optional(),
            tags: z.array(z.string()).optional(),
          })
          .optional(),
      }),
    ),
  }),
  execute: async (args) => {
    const items = args.items.map((item) => ({
      text: item.information,
      metadata: item.metadata,
    }));
    const results = await memoryRepository.saveBatch(items);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { saved: results.length, ids: results.map((r) => r.id) },
            null,
            2,
          ),
        },
      ],
    };
  },
});

server.addTool({
  name: "memory_search_batch",
  description: "Search multiple queries at once for efficiency",
  parameters: z.object({
    queries: z.array(
      z.object({
        query: z.string(),
        project: z.string().optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().optional().default(5),
      }),
    ),
  }),
  execute: async (args) => {
    const results = await memoryRepository.searchBatch(args.queries);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(results, null, 2) },
      ],
    };
  },
});

// ── Memory Update / Get ────────────────────────────────────────────────────────

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
      })
      .optional(),
  }),
  execute: async (args) => {
    const result = await memoryRepository.update(args.id, {
      text: args.text,
      metadata: args.metadata,
    });
    if (!result) return `Memory not found: ${args.id}`;
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  },
});

server.addTool({
  name: "memory_get",
  description: "Get a single memory by its ID",
  parameters: z.object({
    id: z.string(),
  }),
  execute: async (args) => {
    const result = await memoryRepository.getById(args.id);
    if (!result) return `Memory not found: ${args.id}`;
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
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
    const { memories, offset } = await memoryRepository.scroll({
      project: args.project,
      tags: args.tags,
      limit: args.limit,
      offset: args.offset,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ memories, nextOffset: offset }, null, 2),
        },
      ],
    };
  },
});

server.addTool({
  name: "memory_stats",
  description: "Get statistics about the memories collection",
  parameters: z.object({}),
  execute: async () => {
    const stats = await memoryRepository.stats();
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(stats, null, 2) },
      ],
    };
  },
});

// ── Memory Import / Export ────────────────────────────────────────────────────

server.addTool({
  name: "memory_export",
  description: "Export all memories as JSON",
  parameters: z.object({}),
  execute: async () => {
    const memories = await memoryRepository.export();
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(memories, null, 2) },
      ],
    };
  },
});

server.addTool({
  name: "memory_import",
  description: "Import memories from JSON array",
  parameters: z.object({
    items: z.array(
      z.object({
        text: z.string(),
        metadata: z
          .object({
            source: z.string().optional(),
            project: z.string().optional(),
            tags: z.array(z.string()).optional(),
          })
          .optional(),
      }),
    ),
  }),
  execute: async (args) => {
    const result = await memoryRepository.import(args.items);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
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
    const result = await entityRepository.update(args.id, {
      name: args.name,
      entityType: args.entityType,
      metadata: args.metadata,
    });
    if (!result) return `Entity not found: ${args.id}`;
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  },
});

server.addTool({
  name: "entity_stats",
  description: "Get statistics about the entities collection",
  parameters: z.object({}),
  execute: async () => {
    const stats = await entityRepository.stats();
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(stats, null, 2) },
      ],
    };
  },
});

server.addTool({
  name: "relation_stats",
  description: "Get statistics about the relations collection",
  parameters: z.object({}),
  execute: async () => {
    const stats = await relationRepository.stats();
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(stats, null, 2) },
      ],
    };
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
    const tags = [...(args.tags ?? []), "note"];
    const result = await memoryRepository.save(args.content, {
      project: args.project,
      tags,
      createdAt: new Date().toISOString(),
    });
    return `Saved note: ${result.id}`;
  },
});

server.addTool({
  name: "memory_notes",
  description: "Save multiple notes at once (batch lightweight memory saves)",
  parameters: z.object({
    notes: z.array(
      z.object({
        content: z.string(),
        project: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
    ),
  }),
  execute: async (args) => {
    const items = args.notes.map((n) => ({
      text: n.content,
      metadata: {
        project: n.project,
        tags: [...(n.tags ?? []), "note"],
      },
    }));
    const results = await memoryRepository.saveBatch(items);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { saved: results.length, ids: results.map((r) => r.id) },
            null,
            2,
          ),
        },
      ],
    };
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
    const { entities, offset } = await entityRepository.list(
      args.entityType,
      args.limit,
      args.offset,
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ entities, nextOffset: offset }, null, 2),
        },
      ],
    };
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
    const { relations, offset } = await relationRepository.list(
      args.relationType,
      args.limit,
      args.offset,
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ relations, nextOffset: offset }, null, 2),
        },
      ],
    };
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
      return;
    } catch (err) {
      if (attempt === retries) {
        console.error(`Failed to initialize collections after ${retries} attempts:`, err);
        return;
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
      `[qdrant-memory] Health check server on http://localhost:${healthPort}`,
    );
  });

  server.start({
    transportType: "httpStream",
    httpStream: { endpoint: "/mcp", port: config.port },
  });
  console.error(
    `[qdrant-memory] HTTP server listening on http://localhost:${config.port}/mcp`,
  );
} else {
  server.start({ transportType: "stdio" });
}
