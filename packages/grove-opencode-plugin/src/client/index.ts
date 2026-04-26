import type { MemoryMetadata } from "@lib/shared";

export interface MCPToolResult {
  content: Array<{ type: string; text: string }>;
}

export interface MemorySearchResult {
  id: string;
  text: string;
  metadata?: MemoryMetadata;
  score: number;
}

export interface MCPClientOptions {
  url: string;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: string;
  result?: MCPToolResult;
  error?: { code: number; message: string };
}

export class MCPClient {
  private url: string;

  constructor(options: MCPClientOptions) {
    this.url = options.url;
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
        id: crypto.randomUUID(),
      }),
    });

    if (!response.ok) {
      throw new Error(`MCP call failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as JSONRPCResponse;

    if (data.error) {
      throw new Error(`MCP error: ${data.error.message}`);
    }

    if (!data.result) {
      throw new Error("MCP returned no result");
    }

    return data.result;
  }

  async saveMemory(
    information: string,
    metadata?: {
      source?: string;
      project?: string;
      tags?: string[];
      sessionId?: string;
      importance?: number;
    },
  ): Promise<string> {
    const result = await this.callTool("memory_save", {
      information,
      metadata,
    });

    const text = result.content[0]?.text ?? "";
    const match = text.match(/Saved memory: (.+)/);
    return match ? match[1] : text;
  }

  async searchMemories(options: {
    query: string;
    project?: string;
    tags?: string[];
    limit?: number;
  }): Promise<MemorySearchResult[]> {
    const result = await this.callTool("memory_search", {
      query: options.query,
      project: options.project,
      tags: options.tags,
      limit: options.limit ?? 10,
    });

    try {
      return JSON.parse(result.content[0]?.text ?? "[]");
    } catch {
      return [];
    }
  }

  async compactMemories(options: {
    project?: string;
    sessionId?: string;
    importanceThreshold?: number;
  }): Promise<number> {
    const result = await this.callTool("memory_compact", {
      project: options.project,
      sessionId: options.sessionId,
      importanceThreshold: options.importanceThreshold ?? 0.6,
    });

    const text = result.content[0]?.text ?? "";
    const match = text.match(/Compacted (\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async pruneMemories(options: {
    threshold: number;
    project?: string;
  }): Promise<number> {
    const result = await this.callTool("memory_prune", {
      threshold: options.threshold,
      project: options.project,
    });

    const text = result.content[0]?.text ?? "";
    const match = text.match(/Pruned (\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async updateMemory(
    id: string,
    updates: {
      text?: string;
      metadata?: {
        source?: string;
        project?: string;
        tags?: string[];
        importance?: number;
        sessionId?: string;
      };
    },
  ): Promise<unknown> {
    return this.callTool("memory_update", { id, ...updates });
  }
}
