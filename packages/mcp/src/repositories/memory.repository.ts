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
    importance?: number;
    sessionId?: string;
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

export async function compactMemories(options: {
  project?: string;
  sessionId?: string;
  importanceThreshold?: number;
}): Promise<{ compacted: number }> {
  const threshold = options.importanceThreshold ?? 0.6;
  const filter = buildFilter([
    options.project ? { key: "metadata.project", value: options.project } : null,
    options.sessionId ? { key: "metadata.sessionId", value: options.sessionId } : null,
  ]);

  let offset: string | null = null;
  let deleted = 0;

  do {
    const { points, nextPageOffset } = await qdrant.scrollPoints(
      COLLECTION,
      filter,
      100,
      offset ?? undefined,
    );

    const toDelete = points
      .filter((p) => {
        const imp = (p.payload.metadata as Memory["metadata"])?.importance;
        return imp !== undefined && imp < threshold;
      })
      .map((p) => p.id);

    if (toDelete.length > 0) {
      await qdrant.deletePoints(COLLECTION, toDelete);
      deleted += toDelete.length;
    }

    offset = nextPageOffset;
  } while (offset !== null);

  return { compacted: deleted };
}

export async function pruneMemories(options: {
  threshold: number;
  project?: string;
}): Promise<{ pruned: number }> {
  const filter = buildFilter([
    options.project ? { key: "metadata.project", value: options.project } : null,
  ]);

  let offset: string | null = null;
  let deleted = 0;

  do {
    const { points, nextPageOffset } = await qdrant.scrollPoints(
      COLLECTION,
      filter,
      100,
      offset ?? undefined,
    );

    const toDelete = points
      .filter((p) => {
        const imp = (p.payload.metadata as Memory["metadata"])?.importance;
        return imp !== undefined && imp < options.threshold;
      })
      .map((p) => p.id);

    if (toDelete.length > 0) {
      await qdrant.deletePoints(COLLECTION, toDelete);
      deleted += toDelete.length;
    }

    offset = nextPageOffset;
  } while (offset !== null);

  return { pruned: deleted };
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
  update: updateMemory,
  scroll: scrollMemories,
  stats: getMemoriesStats,
  compact: compactMemories,
  prune: pruneMemories,
};
