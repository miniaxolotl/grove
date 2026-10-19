export const policy = {
  handoffActiveDays: 30,
  handoffPurgeDays: 90,
  maxMemories: 10000,
  maxProjects: 100,
  requestsPerMinute: 180,
  jobLeaseSeconds: 120,
  jobMaxAttempts: 5,
  embeddingDimensions: 384,
  embeddingModel: "Xenova/all-MiniLM-L6-v2",
  embeddingProfile: "minilm-l6-v2-mean-normalized-v1",
} as const;
