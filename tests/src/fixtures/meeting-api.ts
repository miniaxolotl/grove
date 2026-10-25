/** Disposable real API/worker fixture. Synthetic inference only, never paid calls. */
import { serve } from "@hono/node-server";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createDatabase } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import { rememberSchema } from "@lib/shared/contracts";
import { meetingBriefSchema } from "@lib/shared/assistance";
import type { Providers } from "@lib/ai";
import { createApp } from "../../../packages/api/src/app.ts";
import { Authentication } from "../../../packages/api/src/auth.ts";

const url = process.env.TEST_DATABASE_URL;
const workerUrl = process.env.TEST_WORKER_DATABASE_URL;
if (
  !url ||
  !workerUrl ||
  !new URL(url).pathname.endsWith("_test") ||
  !new URL(workerUrl).pathname.endsWith("_test") ||
  new URL(url).pathname !== new URL(workerUrl).pathname ||
  new URL(url).hostname !== "127.0.0.1" ||
  new URL(workerUrl).hostname !== "127.0.0.1"
)
  throw new Error(
    "Use disposable loopback TEST_DATABASE_URL and TEST_WORKER_DATABASE_URL",
  );
const db = createDatabase(url),
  workerDb = createDatabase(workerUrl);
const subject = `meeting_browser_${randomUUID()}`;
const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
const principal = sessionPrincipal(rows[0].id, subject);
const providers: Providers = {
  generation: {
    profile: `meeting-browser-${randomUUID()}`,
    async generate(schema, _prompt, sources) {
      if (!Object.is(schema, meetingBriefSchema))
        throw new Error("Unexpected fixture generation");
      return schema.parse({
        decisions: sources
          .filter((source) => source.content.includes("staged launch"))
          .map((source) => ({
            text: "Use a staged launch after the migration rehearsal.",
            sources: [
              { id: source.id, version: source.version, quote: source.content },
            ],
          })),
        discussions: [],
        questions: sources
          .filter((source) => source.content.includes("Who will"))
          .map((source) => ({
            text: "Who will review the rollback rehearsal?",
            sources: [
              { id: source.id, version: source.version, quote: source.content },
            ],
          })),
      });
    },
  },
};
const service = new MemoryService(
  db,
  "meeting-browser-fixture-only-32-characters",
  undefined,
  providers,
);
const worker = new MemoryService(
  workerDb,
  service.cursorSecret,
  undefined,
  providers,
);
await service.settings(principal, {
  titlesTagsEnabled: false,
  classificationEnabled: false,
  notebookConnectionsEnabled: false,
  noteConnectionsEnabled: false,
  notebookSummariesEnabled: false,
  personalSummaryEnabled: false,
  progressSummariesEnabled: false,
  meetingPreparationEnabled: true,
});
const project = await service.project(principal, {
  name: "Launch planning",
  identity: randomUUID(),
});
const sources = [];
for (const content of [
  "Decision: use a staged launch after the migration rehearsal.",
  "Open question: Who will review the rollback rehearsal?",
])
  sources.push(
    await service.remember(
      principal,
      rememberSchema.parse({
        operationId: randomUUID(),
        projectId: project.id,
        content,
      }),
    ),
  );
const auth = new Authentication(db, {
  verify: async () => ({
    subject,
    type: "session",
    sessionId: "meeting-browser-fixture",
  }),
});
const app = createApp({
  memories: service,
  auth,
  origin: `http://127.0.0.1:${process.env.MEETING_API_PORT || 3198}`,
  siteUrl: process.env.MEETING_SITE_URL || "http://127.0.0.1:3199",
  issuer: "https://clerk.example.test",
  webhookSecret: "whsec_dGVzdA==",
  ready: async () => {},
});
const port = Number(process.env.MEETING_API_PORT || 3198);
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
await writeFile(
  process.env.MEETING_FIXTURE_FILE ||
    "/tmp/opencode/grove-meeting-fixture.json",
  JSON.stringify({ project, sources, accountId: principal.accountId, port }),
);
let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try {
    await worker.runJob();
  } finally {
    running = false;
  }
}, 100);
async function stop() {
  clearInterval(timer);
  server.close();
  await Promise.all([db.destroy(), workerDb.destroy()]);
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
console.log(`Synthetic meeting API ready on loopback ${port}`);
