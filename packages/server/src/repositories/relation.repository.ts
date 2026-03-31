import { randomUUID } from "crypto";
import { config } from "../config.ts";
import { qdrant, type VectorPoint } from "../services/qdrant.ts";

const COLLECTION = `${config.collection.prefix}_relations`;

export interface Relation {
  id: string;
  from: string;
  relationType: string;
  to: string;
  metadata?: Record<string, unknown>;
}

export async function createRelation(
  from: string,
  relationType: string,
  to: string,
  metadata?: Record<string, unknown>,
): Promise<Relation> {
  const existing = await searchRelations({ from, relationType, to, limit: 1 }, 1);
  if (existing.length > 0) {
    const rel = existing[0];
    const mergedMetadata = { ...rel.metadata, ...metadata };

    await qdrant.upsertPoints(COLLECTION, [
      {
        id: rel.id,
        vector: Array(config.vector.dim).fill(0),
        payload: { id: rel.id, from, relationType, to, metadata: mergedMetadata },
      },
    ]);

    return { id: rel.id, from, relationType, to, metadata: mergedMetadata };
  }

  const id = randomUUID();
  const point = {
    id,
    vector: Array(config.vector.dim).fill(0),
    payload: { id, from, relationType, to, metadata },
  };

  await qdrant.upsertPoints(COLLECTION, [point]);

  return { id, from, relationType, to, metadata };
}

export async function searchRelations(
  options: {
    from?: string;
    to?: string;
    relationType?: string;
    limit?: number;
  } = {},
  defaultLimit: number = 20,
): Promise<Relation[]> {
  const must: Record<string, unknown>[] = [];
  if (options.from) must.push({ key: "from", match: { value: options.from } });
  if (options.to) must.push({ key: "to", match: { value: options.to } });
  if (options.relationType) must.push({ key: "relationType", match: { value: options.relationType } });

  const filter = must.length > 0 ? { must } : undefined;
  const points = await qdrant.scrollPoints(COLLECTION, filter, options.limit ?? defaultLimit);

  return points.map((p) => ({
    id: p.id,
    from: p.payload.from as string,
    relationType: p.payload.relationType as string,
    to: p.payload.to as string,
    metadata: p.payload.metadata as Record<string, unknown> | undefined,
  }));
}

export async function deleteRelations(options: { from?: string; to?: string; relationType?: string }): Promise<void> {
  const must: Record<string, unknown>[] = [];
  if (options.from) must.push({ key: "from", match: { value: options.from } });
  if (options.to) must.push({ key: "to", match: { value: options.to } });
  if (options.relationType) must.push({ key: "relationType", match: { value: options.relationType } });
  if (must.length === 0) return;

  await qdrant.deleteByFilter(COLLECTION, { must });
}

export async function getRelationStats(): Promise<{
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

export async function listRelations(
  relationType?: string,
  limit: number = 100,
  offset?: string,
): Promise<{ relations: Relation[]; offset: string | null }> {
  const must: Record<string, unknown>[] = [];
  if (relationType) must.push({ key: "relationType", match: { value: relationType } });
  const filter = must.length > 0 ? { must } : undefined;

  const url = `${config.qdrant.url}/collections/${COLLECTION}/points/scroll`;
  const body: Record<string, unknown> = { limit, with_payload: true };
  if (filter) body.filter = filter;
  if (offset) body.offset = offset;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": config.qdrant.apiKey,
      "User-Agent": "qdrant-memory/1.0",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`scroll failed: ${response.status}`);
  const data = (await response.json()) as {
    result: { points: VectorPoint[]; next_page_offset: string | null };
  };

  return {
    relations: data.result.points.map((p) => ({
      id: p.id,
      from: p.payload.from as string,
      relationType: p.payload.relationType as string,
      to: p.payload.to as string,
      metadata: p.payload.metadata as Record<string, unknown> | undefined,
    })),
    offset: data.result.next_page_offset ?? null,
  };
}

export async function initRelationCollection(): Promise<void> {
  await qdrant.ensureCollection(COLLECTION, config.vector.dim);
}

export const relationRepository = {
  create: createRelation,
  search: searchRelations,
  delete: deleteRelations,
  init: initRelationCollection,
  stats: getRelationStats,
  list: listRelations,
};
