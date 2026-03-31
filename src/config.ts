export const config = {
  transport: (process.env.TRANSPORT ?? "stdio") as "stdio" | "http",
  port: parseInt(process.env.PORT ?? "3001", 10),
  qdrant: {
    url: process.env.QDRANT_URL ?? "http://localhost:6333",
    apiKey: process.env.QDRANT_API_KEY ?? "",
  },
  collection: {
    prefix: process.env.COLLECTION_PREFIX ?? "memory",
  },
  embedding: {
    url: process.env.EMBEDDING_URL ?? undefined,
    model: process.env.EMBEDDING_MODEL ?? undefined,
    batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE ?? "10", 10),
    maxTokensPerText: parseInt(process.env.EMBEDDING_MAX_TOKENS ?? "512", 10),
  },
  reranking: {
    url: process.env.RERANKING_URL ?? undefined,
    model: process.env.RERANKING_MODEL ?? undefined,
  },
  vector: {
    dim: parseInt(process.env.VECTOR_DIM ?? "384", 10),
  },
} as const;

export const hasRemoteEmbedding = !!config.embedding.url;
export const hasRemoteReranking = !!config.reranking.url;
