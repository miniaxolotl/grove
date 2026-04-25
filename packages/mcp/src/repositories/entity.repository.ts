import { randomUUID } from "crypto";
import { config } from "../config.ts";
import { qdrant } from "../services/qdrant.ts";
import { buildFilter } from "../utils/filter.ts";

const COLLECTION = `${config.collection.prefix}_entities`;

export interface Entity {
  id: string;
  name: string;
  entityType: string;
  observations: string[];
  metadata?: Record<string, unknown>;
}

export async function createEntity(
  name: string,
  entityType: string,
  observations: string[] = [],
  metadata?: Record<string, unknown>,
): Promise<Entity> {
  const existing = await getEntity(name);
  if (existing) {
    const mergedObservations = [
      ...existing.observations,
      ...observations.filter((o) => !existing.observations.includes(o)),
    ];
    const mergedMetadata = { ...existing.metadata, ...metadata };

    await qdrant.upsertPoints(COLLECTION, [
      {
        id: existing.id,
        vector: Array(config.vector.dim).fill(0),
        payload: {
          id: existing.id,
          name,
          entityType,
          observations: mergedObservations,
          metadata: mergedMetadata,
        },
      },
    ]);

    return {
      id: existing.id,
      name,
      entityType,
      observations: mergedObservations,
      metadata: mergedMetadata,
    };
  }

  const id = randomUUID();
  const point = {
    id,
    vector: Array(config.vector.dim).fill(0),
    payload: { id, name, entityType, observations, metadata },
  };

  await qdrant.upsertPoints(COLLECTION, [point]);

  return { id, name, entityType, observations, metadata };
}

export async function getEntity(name: string): Promise<Entity | null> {
  const { points } = await qdrant.scrollPoints(COLLECTION, {
    must: [{ key: "name", match: { value: name } }],
  });

  if (points.length === 0) return null;

  const p = points[0];
  return {
    id: p.id,
    name: p.payload.name as string,
    entityType: p.payload.entityType as string,
    observations: (p.payload.observations as string[]) ?? [],
    metadata: p.payload.metadata as Record<string, unknown> | undefined,
  };
}

export async function searchEntities(
  query?: string,
  entityType?: string,
  limit: number = 10,
): Promise<Entity[]> {
  const filter = buildFilter([
    query ? { key: "name", value: query } : null,
    entityType ? { key: "entityType", value: entityType } : null,
  ]);
  const { points } = await qdrant.scrollPoints(COLLECTION, filter, limit);

  return points.map((p) => ({
    id: p.id,
    name: p.payload.name as string,
    entityType: p.payload.entityType as string,
    observations: (p.payload.observations as string[]) ?? [],
    metadata: p.payload.metadata as Record<string, unknown> | undefined,
  }));
}

export async function addObservations(
  name: string,
  newObservations: string[],
): Promise<Entity | null> {
  const entity = await getEntity(name);
  if (!entity) return null;

  const updated = {
    ...entity,
    observations: Array.from(new Set([...entity.observations, ...newObservations])),
  };

  await qdrant.upsertPoints(COLLECTION, [
    {
      id: entity.id,
      vector: Array(config.vector.dim).fill(0),
      payload: {
        id: updated.id,
        name: updated.name,
        entityType: updated.entityType,
        observations: updated.observations,
        metadata: updated.metadata,
      },
    },
  ]);

  return updated;
}

export async function deleteEntities(
  filter: {
    name?: string;
    entityType?: string;
  } = {},
): Promise<void> {
  const qdrantFilter = buildFilter([
    filter.name ? { key: "name", value: filter.name } : null,
    filter.entityType ? { key: "entityType", value: filter.entityType } : null,
  ]);
  if (!qdrantFilter) return;

  await qdrant.deleteByFilter(COLLECTION, qdrantFilter);
}

export async function getEntityById(id: string): Promise<Entity | null> {
  const point = await qdrant.getPoint(COLLECTION, id);
  if (!point) return null;
  return {
    id: point.id,
    name: point.payload.name as string,
    entityType: point.payload.entityType as string,
    observations: (point.payload.observations as string[]) ?? [],
    metadata: point.payload.metadata as Record<string, unknown> | undefined,
  };
}

export async function updateEntity(
  id: string,
  updates: {
    name?: string;
    entityType?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<Entity | null> {
  const existing = await getEntityById(id);
  if (!existing) return null;

  const updated: Entity = {
    ...existing,
    name: updates.name ?? existing.name,
    entityType: updates.entityType ?? existing.entityType,
    metadata: updates.metadata ?? existing.metadata,
  };

  await qdrant.upsertPoints(COLLECTION, [
    {
      id,
      vector: Array(config.vector.dim).fill(0),
      payload: {
        id,
        name: updated.name,
        entityType: updated.entityType,
        observations: updated.observations,
        metadata: updated.metadata,
      },
    },
  ]);

  return updated;
}

export async function getEntityStats(): Promise<{
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

export async function listEntities(
  entityType?: string,
  limit: number = 100,
  offset?: string,
): Promise<{ entities: Entity[]; offset: string | null }> {
  const filter = buildFilter([
    entityType ? { key: "entityType", value: entityType } : null,
  ]);

  const { points, nextPageOffset } = await qdrant.scrollPoints(
    COLLECTION,
    filter,
    limit,
    offset,
  );

  return {
    entities: points.map((p) => ({
      id: p.id,
      name: p.payload.name as string,
      entityType: p.payload.entityType as string,
      observations: (p.payload.observations as string[]) ?? [],
      metadata: p.payload.metadata as Record<string, unknown> | undefined,
    })),
    offset: nextPageOffset,
  };
}

export async function initEntityCollection(): Promise<void> {
  await qdrant.ensureCollection(COLLECTION, config.vector.dim, [
    "name",
    "entityType",
  ]);
}

export const entityRepository = {
  create: createEntity,
  get: getEntity,
  search: searchEntities,
  addObservations,
  delete: deleteEntities,
  init: initEntityCollection,
  getById: getEntityById,
  update: updateEntity,
  stats: getEntityStats,
  list: listEntities,
};
