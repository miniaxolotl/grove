import { config, hasRemoteEmbedding } from "../config.js";

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function embedRemote(texts: string[]): Promise<number[][]> {
  const batchSize = config.embedding.batchSize;
  const maxTokens = config.embedding.maxTokensPerText;

  for (const text of texts) {
    const tokens = estimateTokens(text);
    if (tokens > maxTokens) {
      console.warn(
        `Text exceeds max tokens (${tokens} > ${maxTokens}), truncation may occur`,
      );
    }
  }

  const batches = chunk(texts, batchSize);
  const allResults: number[][] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    const response = await fetch(`${config.embedding.url}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.embedding.model,
        input: batch,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Embedding failed (batch ${i + 1}/${batches.length}): ${response.status} ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      data: { embedding: number[]; index: number }[];
    };

    const sorted = data.data.sort((a, b) => a.index - b.index);
    allResults.push(...sorted.map((d) => d.embedding));
  }

  return allResults;
}

let _localEmbedder: ((texts: string[]) => Promise<number[][]>) | null = null;

async function getLocalEmbedder(): Promise<
  ((texts: string[]) => Promise<number[][]>) | null
> {
  if (_localEmbedder !== null) return _localEmbedder;

  try {
    const { pipeline, env } = await import("@huggingface/transformers");

    env.backends.onnx.enableParallelTensorization = true;

    const embedder = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
      {
        device: "cpu",
        dtype: "fp32",
      },
    );

    _localEmbedder = async (texts: string[]) => {
      const outputs = await embedder(texts, {
        pooling: "mean",
        normalize: true,
      });
      const numTexts = outputs.dims[0];
      const hiddenDim = outputs.dims[1];
      if (numTexts === 1) {
        return [Array.from(outputs.data)];
      }
      return Array.from({ length: numTexts }, (_, i) => {
        const start = i * hiddenDim;
        return Array.from(outputs.data.slice(start, start + hiddenDim));
      });
    };

    return _localEmbedder;
  } catch {
    _localEmbedder = null;
    return null;
  }
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (hasRemoteEmbedding) {
    try {
      return await embedRemote(texts);
    } catch (err) {
      console.warn("Remote embedding failed, falling back to local:", err);
    }
  }

  const localEmbedder = await getLocalEmbedder();
  if (!localEmbedder) {
    throw new Error(
      "No embedding backend available. Set EMBEDDING_URL or install @huggingface/transformers.",
    );
  }

  const batchSize = config.embedding.batchSize;
  if (texts.length <= batchSize) {
    return localEmbedder(texts);
  }

  const batches = chunk(texts, batchSize);
  const allResults: number[][] = [];

  for (const batch of batches) {
    const results = await localEmbedder(batch);
    allResults.push(...results);
  }

  return allResults;
}

export async function embedText(text: string): Promise<number[]> {
  const results = await embedTexts([text]);
  return results[0];
}
