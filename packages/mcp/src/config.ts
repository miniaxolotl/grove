export const config = {
  transport: (process.env.TRANSPORT ?? "http") as "stdio" | "http",
  port: parseInt(process.env.PORT ?? "26080", 10),
  qdrant: {
    url: process.env.QDRANT_URL ?? "http://localhost:6333",
    apiKey: process.env.QDRANT_API_KEY || undefined,
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

if (isNaN(config.port)) throw new Error("Invalid PORT: must be a valid number");
if (isNaN(config.embedding.batchSize)) throw new Error("Invalid EMBEDDING_BATCH_SIZE: must be a valid number");
if (isNaN(config.embedding.maxTokensPerText)) throw new Error("Invalid EMBEDDING_MAX_TOKENS: must be a valid number");
if (isNaN(config.vector.dim)) throw new Error("Invalid VECTOR_DIM: must be a valid number");

export const hasRemoteEmbedding = !!config.embedding.url;
export const hasRemoteReranking = !!config.reranking.url;
