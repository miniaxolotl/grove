export type McpToolName =
  | "memory_save"
  | "memory_search"
  | "memory_compact"
  | "memory_prune"
  | "memory_update"
  | "memory_delete";

export type MemorySearchOptions = {
  query: string;
  project?: string;
  tags?: string[];
  limit?: number;
  rerank?: boolean;
  rerankTopK?: number;
};

export type MemorySaveOptions = {
  information: string;
  metadata?: Partial<import("../schema/memory.js").MemoryMetadata>;
};

export type MemoryCompactOptions = {
  project?: string;
  sessionId?: string;
  importanceThreshold?: number;
};

export type MemoryPruneOptions = {
  threshold: number;
  project?: string;
};

export type MemoryUpdateOptions = {
  id: string;
  text?: string;
  metadata?: Partial<import("../schema/memory.js").MemoryMetadata>;
};
