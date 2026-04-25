import { randomUUID } from "crypto";
import { config } from "../config.ts";
import { qdrant, type VectorPoint } from "../services/qdrant.ts";
import { buildFilter } from "../utils/filter.ts";

const COLLECTION = `${config.collection.prefix}_memories`;

export interface Memory {
  id: string;
  text: string;
  metadata: {
    source?: string;
    project?: string;
    tags?: string[];
    createdAt: string;
    updatedAt?: string;
  };
}

export interface MemorySearchResult extends Memory {
  score: number;
}

let _embedTexts: ((texts: string[]) => Promise<number[][]>) | null = null;

async function getEmbedTexts(): Promise<
  ((texts: string[]) => Promise<number[][]>) | null
> {
  if (_embedTexts === null) {
    try {
      const { embedTexts } = await import("../services/embedding.ts");
      _embedTexts = embedTexts;
    } catch {
      _embedTexts = null;
    }
  }
  return _embedTexts;
}

export async function saveMemory(
  text: string,
  metadata: Partial<Memory["metadata"]> = {},
): Promise<Memory> {
  const id = randomUUID();
  const embedFn = await getEmbedTexts();

  let vector: number[];
  if (embedFn) {
    [vector] = await embedFn([text]);
  } else {
    vector = Array(config.vector.dim).fill(0);
  }

  const point: VectorPoint = {
    id,
    vector,
    payload: {
      id,
      text,
      metadata: {
        ...metadata,
        createdAt: metadata.createdAt ?? new Date().toISOString(),
      },
    },
  };

  await qdrant.upsertPoints(COLLECTION, [point]);

  return { id, text, metadata: point.payload.metadata as Memory["metadata"] };
}

export async function searchMemories(
  query: string,
  options: {
    project?: string;
    tags?: string[];
    limit?: number;
  } = {},
): Promise<MemorySearchResult[]> {
  const limit = options.limit ?? 5;
  const embedFn = await getEmbedTexts();

  if (!embedFn) {
    const filter = buildFilter([
      options.project ? { key: "metadata.project", value: options.project } : null,
      options.tags?.length ? { key: "metadata.tags", any: options.tags } : null,
    ]);
    const { points } = await qdrant.scrollPoints(COLLECTION, filter, limit);
    return points.map((r) => ({
      id: r.id,
      text: r.payload.text as string,
      metadata: r.payload.metadata as Memory["metadata"],
      score: 0,
    }));
  }

  const [queryVector] = await embedFn([query]);

  const filter = buildFilter([
    options.project ? { key: "metadata.project", value: options.project } : null,
    options.tags?.length ? { key: "metadata.tags", any: options.tags } : null,
  ]);

  const results = await qdrant.searchVectors(
    COLLECTION,
    queryVector,
    limit,
    filter,
  );

  return results.map((r) => ({
    id: r.id,
    text: r.payload.text as string,
    metadata: r.payload.metadata as Memory["metadata"],
    score: r.score ?? 0,
  }));
}

export async function deleteMemories(ids: string[]): Promise<void> {
  await qdrant.deletePoints(COLLECTION, ids);
}

export async function deleteMemoriesByFilter(filter: {
  project?: string;
  tags?: string[];
}): Promise<void> {
  const qdrantFilter = buildFilter([
    filter.project ? { key: "metadata.project", value: filter.project } : null,
    filter.tags?.length ? { key: "metadata.tags", any: filter.tags } : null,
  ]);
  if (!qdrantFilter) return;

  await qdrant.deleteByFilter(COLLECTION, qdrantFilter);
}

export async function getMemoryById(id: string): Promise<Memory | null> {
  const point = await qdrant.getPoint(COLLECTION, id);
  if (!point) return null;
  return {
    id: point.id,
    text: point.payload.text as string,
    metadata: point.payload.metadata as Memory["metadata"],
  };
}

export async function updateMemory(
  id: string,
  updates: { text?: string; metadata?: Partial<Memory["metadata"]> },
): Promise<Memory | null> {
  const existing = await getMemoryById(id);
  if (!existing) return null;

  const updated: Memory = {
    ...existing,
    text: updates.text ?? existing.text,
    metadata: {
      ...existing.metadata,
      ...updates.metadata,
      updatedAt: new Date().toISOString(),
    },
  };

  let vector: number[];
  if (updates.text !== undefined) {
    const embedFn = await getEmbedTexts();
    if (embedFn) {
      [vector] = await embedFn([updated.text]);
    } else {
      vector = Array(config.vector.dim).fill(0);
    }
  } else {
    const point = await qdrant.getPoint(COLLECTION, id);
    vector = point?.vector ?? Array(config.vector.dim).fill(0);
  }

  await qdrant.upsertPoints(COLLECTION, [
    {
      id,
      vector,
      payload: { id, text: updated.text, metadata: updated.metadata },
    },
  ]);

  return updated;
}

export async function saveMemoryBatch(
  items: Array<{
    text: string;
    metadata?: Partial<Memory["metadata"]>;
  }>,
): Promise<Memory[]> {
  const embedFn = await getEmbedTexts();
  const texts = items.map((i) => i.text);

  let vectors: number[][];
  if (embedFn) {
    vectors = await embedFn(texts);
  } else {
    vectors = items.map(() => Array(config.vector.dim).fill(0));
  }

  const now = new Date().toISOString();
  const points: VectorPoint[] = items.map((item, i) => {
    const id = randomUUID();
    return {
      id,
      vector: vectors[i],
      payload: {
        id,
        text: item.text,
        metadata: {
          ...item.metadata,
          createdAt: item.metadata?.createdAt ?? now,
        },
      },
    };
  });

  if (points.length > 0) {
    await qdrant.upsertPoints(COLLECTION, points);
  }

  return points.map((p) => ({
    id: p.id,
    text: p.payload.text as string,
    metadata: p.payload.metadata as Memory["metadata"],
  }));
}

export async function searchMemoriesBatch(
  queries: Array<{
    query: string;
    project?: string;
    tags?: string[];
    limit?: number;
  }>,
): Promise<Array<MemorySearchResult[]>> {
  const embedFn = await getEmbedTexts();

  if (!embedFn) {
    return queries.map(() => []);
  }

  const queryTexts = queries.map((q) => q.query);
  const allVectors = await embedFn(queryTexts);

  const results: Array<MemorySearchResult[]> = await Promise.all(
    queries.map(async (q, i) => {
      const filter = buildFilter([
        q.project ? { key: "metadata.project", value: q.project } : null,
        q.tags?.length ? { key: "metadata.tags", any: q.tags } : null,
      ]);
      const limit = q.limit ?? 5;

      const found = await qdrant.searchVectors(
        COLLECTION,
        allVectors[i],
        limit,
        filter,
      );
      return found.map((r) => ({
        id: r.id,
        text: r.payload.text as string,
        metadata: r.payload.metadata as Memory["metadata"],
        score: r.score ?? 0,
      }));
    }),
  );

  return results;
}

export async function scrollMemories(
  options: {
    project?: string;
    tags?: string[];
    limit?: number;
    offset?: string;
  } = {},
): Promise<{ memories: Memory[]; offset: string | null }> {
  const limit = options.limit ?? 100;
  const filter = buildFilter([
    options.project ? { key: "metadata.project", value: options.project } : null,
    options.tags?.length ? { key: "metadata.tags", any: options.tags } : null,
  ]);

  const { points, nextPageOffset } = await qdrant.scrollPoints(
    COLLECTION,
    filter,
    limit,
    options.offset,
  );

  const memories: Memory[] = points.map((p) => ({
    id: p.id,
    text: p.payload.text as string,
    metadata: p.payload.metadata as Memory["metadata"],
  }));

  return {
    memories,
    offset: nextPageOffset,
  };
}

export async function getMemoriesStats(): Promise<{
  count: number;
  vectorsCount: number;
  indexedVectorsCount: number;
}> {
  const info = await qdrant.getCollectionInfo(COLLECTION);
  if (!info) return { count: 0, vectorsCount: 0, indexedVectorsCount: 0 };
  return {
    count: info.pointsCount,
    vectorsCount: info.vectorsCount,
    indexedVectorsCount: info.indexedVectorsCount,
  };
}

export async function exportMemories(): Promise<Memory[]> {
  let offset: string | null = null;
  const allMemories: Memory[] = [];

  do {
    const { memories, offset: nextOffset } = await scrollMemories({
      limit: 1000,
      offset: offset ?? undefined,
    });
    allMemories.push(...memories);
    offset = nextOffset;
  } while (offset !== null);

  return allMemories;
}

export async function importMemories(
  items: Array<{
    text: string;
    metadata?: Partial<Memory["metadata"]>;
  }>,
): Promise<{ imported: number }> {
  if (items.length === 0) return { imported: 0 };
  const saved = await saveMemoryBatch(items);
  return { imported: saved.length };
}

export async function initMemoryCollection(): Promise<void> {
  await qdrant.ensureCollection(COLLECTION, config.vector.dim, [
    "metadata.project",
    "metadata.tags",
  ]);
}

export const memoryRepository = {
  save: saveMemory,
  search: searchMemories,
  delete: deleteMemories,
  deleteByFilter: deleteMemoriesByFilter,
  init: initMemoryCollection,
  getById: getMemoryById,
  update: updateMemory,
  saveBatch: saveMemoryBatch,
  searchBatch: searchMemoriesBatch,
  scroll: scrollMemories,
  stats: getMemoriesStats,
  export: exportMemories,
  import: importMemories,
};
