/**
 * Setup script: creates Qdrant collections and indexes.
* Run with: pnpm --filter @script/setup run setup

import { config } from "@miniaxolotl/grove/config";
import { qdrant } from "@miniaxolotl/grove/services/qdrant";

const PREFIX = config.collection.prefix;
const COLLECTIONS = [
  `${PREFIX}_memories`,
  `${PREFIX}_entities`,
  `${PREFIX}_relations`,
];

const indexes = [
  {
    collection: `${PREFIX}_memories`,
    field: "metadata.project",
    schema: "keyword",
  },
  {
    collection: `${PREFIX}_memories`,
    field: "metadata.tags",
    schema: "keyword",
  },
  { collection: `${PREFIX}_entities`, field: "name", schema: "keyword" },
  { collection: `${PREFIX}_entities`, field: "entityType", schema: "keyword" },
  { collection: `${PREFIX}_relations`, field: "from", schema: "keyword" },
  { collection: `${PREFIX}_relations`, field: "to", schema: "keyword" },
  {
    collection: `${PREFIX}_relations`,
    field: "relationType",
    schema: "keyword",
  },
];

async function setup() {
  console.log(`Setting up Qdrant collections at ${config.qdrant.url}`);
  console.log(`Collection prefix: "${PREFIX}"`);
  console.log(`Vector dimension: ${config.vector.dim}`);

  for (const name of COLLECTIONS) {
    try {
      try {
        await qdrant.deleteCollection(name);
        console.log(`  (deleted existing "${name}")`);
      } catch {
        // Collection might not exist — that's fine
      }
      await qdrant.ensureCollection(name, config.vector.dim);
      console.log(`✓ Collection "${name}" ready`);
    } catch (err) {
      console.error(`✗ Failed to create collection "${name}":`, err);
    }
  }

  for (const idx of indexes) {
    try {
      await qdrant.createIndex(idx.collection, idx.field, idx.schema);
      console.log(`✓ Index "${idx.field}" on "${idx.collection}"`);
    } catch {
      // Index might already exist — skip
      console.log(`○ Index "${idx.field}" (may already exist)`);
    }
  }

  console.log("\nSetup complete!");
}

setup().catch(console.error);
