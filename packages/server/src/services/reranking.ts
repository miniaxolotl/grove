import { config } from "../config";

export interface RerankResult {
  index: number;
  relevanceScore: number;
}

export async function rerankDocuments(
  query: string,
  documents: string[],
  topK: number = 5,
): Promise<RerankResult[]> {
  const response = await fetch(`${config.reranking.url}/rerank`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.reranking.model,
      query,
      documents,
      top_k: topK,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Reranking failed: ${response.status} ${await response.text()}`,
    );
  }

  const data = (await response.json()) as {
    results: { index: number; relevance_score: number }[];
  };

  return data.results
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .map((r) => ({
      index: r.index,
      relevanceScore: r.relevance_score,
    }));
}
