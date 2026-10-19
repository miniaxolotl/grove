import { policy } from "@lib/config";
import type { Embedder } from "@lib/memory";

export async function createLocalEmbedder(cacheDir: string): Promise<Embedder> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = cacheDir;
  const model = await pipeline("feature-extraction", policy.embeddingModel, {
    device: "cpu",
    dtype: "fp32",
  });
  const embedder: Embedder = {
    profile: policy.embeddingProfile,
    async embed(text) {
      const result = await model(text, { pooling: "mean", normalize: true });
      const vector = Array.from(result.data, Number);
      if (
        vector.length !== policy.embeddingDimensions ||
        vector.some((n) => !Number.isFinite(n))
      )
        throw new Error("Embedding profile mismatch");
      return vector;
    },
  };
  await embedder.embed("ready");
  return embedder;
}
