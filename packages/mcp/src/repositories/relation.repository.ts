import { randomUUID } from "crypto";
import { config } from "../config.ts";
import { qdrant } from "../services/qdrant.ts";
import { buildFilter } from "../utils/filter.ts";

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
  const filter = buildFilter([
    options.from ? { key: "from", value: options.from } : null,
    options.to ? { key: "to", value: options.to } : null,
    options.relationType ? { key: "relationType", value: options.relationType } : null,
  ]);
  const { points } = await qdrant.scrollPoints(COLLECTION, filter, options.limit ?? defaultLimit);

  return points.map((p) => ({
    id: p.id,
    from: p.payload.from as string,
    relationType: p.payload.relationType as string,
    to: p.payload.to as string,
    metadata: p.payload.metadata as Record<string, unknown> | undefined,
  }));
}

export async function deleteRelations(options: { from?: string; to?: string; relationType?: string }): Promise<void> {
  const filter = buildFilter([
    options.from ? { key: "from", value: options.from } : null,
    options.to ? { key: "to", value: options.to } : null,
    options.relationType ? { key: "relationType", value: options.relationType } : null,
  ]);
  if (!filter) return;

  await qdrant.deleteByFilter(COLLECTION, filter);
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
  const filter = buildFilter([
    relationType ? { key: "relationType", value: relationType } : null,
  ]);

  const { points, nextPageOffset } = await qdrant.scrollPoints(
    COLLECTION,
    filter,
    limit,
    offset,
  );

  return {
    relations: points.map((p) => ({
      id: p.id,
      from: p.payload.from as string,
      relationType: p.payload.relationType as string,
      to: p.payload.to as string,
      metadata: p.payload.metadata as Record<string, unknown> | undefined,
    })),
    offset: nextPageOffset,
  };
}

export async function initRelationCollection(): Promise<void> {
  await qdrant.ensureCollection(COLLECTION, config.vector.dim, [
    "from",
    "to",
    "relationType",
  ]);
}

export const relationRepository = {
  create: createRelation,
  search: searchRelations,
  delete: deleteRelations,
  init: initRelationCollection,
  stats: getRelationStats,
  list: listRelations,
};
