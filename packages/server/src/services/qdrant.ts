import { config } from "../config.ts";

const QDRANT_HEADERS = {
  "Content-Type": "application/json",
  "api-key": config.qdrant.apiKey,
  "User-Agent": "qdrant-memory/1.0",
};

async function qdrantFetch(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${config.qdrant.url}${path}`;
  const response = await fetch(url, {
    method,
    headers: QDRANT_HEADERS,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    throw new Error(
      `Qdrant ${method} ${path} failed: ${response.status} ${await response.text()}`,
    );
  }

  return response.json();
}

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface SearchResult extends VectorPoint {
  score?: number;
}

export async function ensureCollection(
  name: string,
  vectorDim: number = config.vector.dim,
): Promise<void> {
  const data = (await qdrantFetch("GET", "/collections")) as {
    result: { collections: { name: string }[] };
  };

  if (!data.result.collections.some((c) => c.name === name)) {
    await qdrantFetch("PUT", `/collections/${name}`, {
      vectors: {
        size: vectorDim,
        distance: "Cosine",
      },
    });
  }
}

export async function createIndex(
  collection: string,
  field: string,
  fieldSchema: string = "keyword",
): Promise<void> {
  await qdrantFetch("PUT", `/collections/${collection}/index`, {
    field_name: field,
    field_schema: fieldSchema,
  });
}

export async function upsertPoints(
  collection: string,
  points: VectorPoint[],
): Promise<void> {
  await qdrantFetch("PUT", `/collections/${collection}/points`, { points });
}

export async function searchVectors(
  collection: string,
  vector: number[],
  limit: number = 5,
  queryFilter?: Record<string, unknown>,
): Promise<SearchResult[]> {
  const body: Record<string, unknown> = { vector, limit, with_payload: true };
  if (queryFilter) body.filter = queryFilter;

  const data = (await qdrantFetch(
    "POST",
    `/collections/${collection}/points/search`,
    body,
  )) as {
    result: SearchResult[];
  };
  return data.result;
}

export async function deletePoints(
  collection: string,
  ids: string[],
): Promise<void> {
  await qdrantFetch("POST", `/collections/${collection}/points/delete`, {
    points: ids,
  });
}

export async function deleteByFilter(
  collection: string,
  filter: Record<string, unknown>,
): Promise<void> {
  await qdrantFetch("POST", `/collections/${collection}/points/delete`, {
    filter,
  });
}

export async function scrollPoints(
  collection: string,
  filter?: Record<string, unknown>,
  limit: number = 100,
): Promise<VectorPoint[]> {
  const body: Record<string, unknown> = { limit, with_payload: true };
  if (filter) body.filter = filter;

  const data = (await qdrantFetch(
    "POST",
    `/collections/${collection}/points/scroll`,
    body,
  )) as {
    result: { points: VectorPoint[] };
  };
  return data.result.points;
}

export async function deleteCollection(name: string): Promise<void> {
  await qdrantFetch("DELETE", `/collections/${name}`);
}

export async function getPoint(
  collection: string,
  id: string,
): Promise<VectorPoint | null> {
  try {
    const data = (await qdrantFetch(
      "GET",
      `/collections/${collection}/points/${id}`,
    )) as { result: VectorPoint | null };
    return data.result;
  } catch {
    return null;
  }
}

export async function getCollectionInfo(name: string): Promise<{
  vectorsCount: number;
  pointsCount: number;
  indexedVectorsCount: number;
} | null> {
  try {
    const data = (await qdrantFetch("GET", `/collections/${name}`)) as {
      result: {
        vectors_count: number;
        points_count: number;
        indexed_vectors_count: number;
      };
    };
    return {
      vectorsCount: data.result.vectors_count,
      pointsCount: data.result.points_count,
      indexedVectorsCount: data.result.indexed_vectors_count,
    };
  } catch {
    return null;
  }
}

export const qdrant = {
  ensureCollection,
  createIndex,
  upsertPoints,
  searchVectors,
  deletePoints,
  deleteByFilter,
  scrollPoints,
  deleteCollection,
  getPoint,
  getCollectionInfo,
};
