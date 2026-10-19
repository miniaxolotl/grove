import { createHash } from "node:crypto";
import { readFile, open } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { ApiClient } from "@lib/integration-core";
import { GroveError, rememberSchema } from "@lib/shared/contracts";

const mappingSchema = z
  .object({
    sourceId: z.string().min(1).max(100),
    collectionPrefix: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    apiOrigin: z.url(),
    owners: z
      .array(
        z
          .object({
            legacyProject: z.string().nullable(),
            accountId: z.uuid(),
            projectId: z.uuid().nullable(),
            keyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

function operationId(value: string) {
  const hash = createHash("sha256").update(value).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
async function main() {
  const { values } = parseArgs({
    options: {
      mapping: { type: "string" },
      snapshot: { type: "string" },
      apply: { type: "boolean" },
    },
  });
  if (!values.mapping || !values.snapshot)
    throw new Error(
      "Use --mapping ownership.json --snapshot new-private-file.ndjson [--apply]",
    );
  const mapping = mappingSchema.parse(
    JSON.parse(await readFile(values.mapping, "utf8")),
  );
  if (
    new Set(mapping.owners.map((owner) => owner.legacyProject)).size !==
    mapping.owners.length
  )
    throw new Error("Each legacy project needs exactly one owner mapping");
  const source = new URL(process.env.LEGACY_QDRANT_URL ?? "");
  if (
    !["http:", "https:"].includes(source.protocol) ||
    source.username ||
    source.password ||
    source.search ||
    source.hash ||
    source.pathname !== "/"
  )
    throw new Error("LEGACY_QDRANT_URL must be an origin without credentials");
  const clients = new Map<string | null, ApiClient>();
  for (const owner of mapping.owners) {
    const key = process.env[owner.keyEnv];
    if (!key)
      throw new Error(`Missing key environment variable ${owner.keyEnv}`);
    const client = new ApiClient(mapping.apiOrigin, async () => key);
    const me = await client.request<{
      accountId: string;
      capabilities: string[];
    }>("/v1/me");
    if (
      me.accountId !== owner.accountId ||
      !me.capabilities.includes("memory:write")
    )
      throw new Error(
        "Target account or capability does not match the explicit ownership mapping",
      );
    clients.set(owner.legacyProject, client);
  }
  const snapshot = await open(values.snapshot, "wx", 0o600);
  const counts = {
    scanned: 0,
    eligible: 0,
    imported: 0,
    unmapped: 0,
    invalid: 0,
    conflicts: 0,
    graphsPreserved: 0,
  };
  try {
    for (const kind of ["memories", "entities", "relations"]) {
      const collection = `${mapping.collectionPrefix}_${kind}`;
      let offset: string | number | undefined;
      do {
        // Qdrant's scroll POST is read-only. This importer has no source-write endpoint.
        const response = await fetch(
          `${source.origin}/collections/${encodeURIComponent(collection)}/points/scroll`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(process.env.LEGACY_QDRANT_API_KEY
                ? { "api-key": process.env.LEGACY_QDRANT_API_KEY }
                : {}),
            },
            body: JSON.stringify({
              limit: 100,
              offset,
              with_payload: true,
              with_vector: true,
            }),
            redirect: "error",
            signal: AbortSignal.timeout(30000),
          },
        );
        if (response.status === 404 && kind !== "memories") break;
        if (!response.ok)
          throw new Error(`Source scan failed (${response.status})`);
        const page = z
          .object({
            result: z.object({
              points: z.array(
                z
                  .object({
                    id: z.union([z.string(), z.number()]),
                    payload: z.record(z.string(), z.unknown()),
                  })
                  .passthrough(),
              ),
              next_page_offset: z
                .union([z.string(), z.number()])
                .nullable()
                .optional(),
            }),
          })
          .parse(await response.json());
        for (const point of page.result.points) {
          await snapshot.write(JSON.stringify({ collection, point }) + "\n");
          if (kind !== "memories") {
            counts.graphsPreserved++;
            continue;
          }
          counts.scanned++;
          const metadata = point.payload.metadata as
            | { project?: string; createdAt?: string }
            | undefined;
          const owner = mapping.owners.find(
            (candidate) =>
              candidate.legacyProject === (metadata?.project ?? null),
          );
          if (!owner) {
            counts.unmapped++;
            continue;
          }
          const id = operationId(
            `${mapping.sourceId}|${collection}|${point.id}|${owner.accountId}`,
          );
          const parsed = rememberSchema.safeParse({
            operationId: id,
            content: point.payload.text,
            projectId: owner.projectId,
            kind: "fact",
            archived: true,
            source: {
              agent: "import",
              verification: `Legacy source ${mapping.sourceId}/${collection}/${point.id}${metadata?.createdAt ? `; created ${metadata.createdAt}` : ""}`,
            },
          });
          if (!parsed.success) {
            counts.invalid++;
            continue;
          }
          counts.eligible++;
          if (!values.apply) continue;
          try {
            const client = clients.get(owner.legacyProject)!;
            // Archive at creation, atomically: imported text must never enter active recall.
            await client.request("/v1/memories", { body: parsed.data });
            counts.imported++;
          } catch (error) {
            if (
              error instanceof GroveError &&
              [409, 410].includes(error.status)
            )
              counts.conflicts++;
            else throw error;
          }
        }
        offset = page.result.next_page_offset ?? undefined;
      } while (offset !== undefined);
    }
    await snapshot.sync();
  } finally {
    await snapshot.close();
  }
  console.log(
    JSON.stringify({ mode: values.apply ? "apply" : "dry-run", ...counts }),
  );
  if (counts.unmapped || counts.invalid || counts.conflicts)
    process.exitCode = 2;
}
main().catch(() => {
  console.error(
    "Legacy import stopped; source data was not changed. Review configuration and retry with a new snapshot path.",
  );
  process.exitCode = 1;
});
