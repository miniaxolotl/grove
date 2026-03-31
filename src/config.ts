export const config = {
  qdrant: {
    url: process.env.QDRANT_URL ?? "http://localhost:6333",
    apiKey: process.env.QDRANT_API_KEY ?? "",
  },
  collection: {
    prefix: process.env.COLLECTION_PREFIX ?? "memory",
  },
  embedding: {
    url: process.env.EMBEDDING_URL,
    model: process.env.EMBEDDING_MODEL ?? "bge-m3",
    batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE ?? "10", 10),
    maxTokensPerText: parseInt(process.env.EMBEDDING_MAX_TOKENS ?? "512", 10),
  },
  reranking: {
    url: process.env.RERANKING_URL,
    model: process.env.RERANKING_MODEL ?? "bge-reranker-v2-m3",
  },
  vector: {
    dim: parseInt(
      process.env.VECTOR_DIM ?? (process.env.EMBEDDING_URL ? "1024" : "384"),
      10,
    ),
  },
} as const;

export const hasRemoteEmbedding = !!config.embedding.url;
export const hasRemoteReranking = !!config.reranking.url;
