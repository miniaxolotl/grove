import { createClerkClient } from "@clerk/backend";
import { setTimeout } from "node:timers/promises";
import { createRuntime } from "./runtime.ts";

const runtime = await createRuntime();
const clerk = createClerkClient({ secretKey: runtime.env.CLERK_SECRET_KEY });
const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
let maintenanceAt = 0;
try {
  while (!controller.signal.aborted) {
    try {
      await runtime.models.refresh();
      if (Date.now() > maintenanceAt) {
        await runtime.memories.maintenance(async (subject) => {
          try {
            await clerk.users.deleteUser(subject);
          } catch (error) {
            if ((error as { status?: number }).status !== 404) throw error;
          }
        });
        maintenanceAt = Date.now() + 60000;
      }
      const work = await Promise.all(
        Array.from({ length: runtime.env.AI_CONCURRENCY }, () =>
          runtime.memories.runJob(),
        ),
      );
      if (!work.some(Boolean))
        await setTimeout(1000, undefined, { signal: controller.signal });
    } catch {
      if (!controller.signal.aborted) {
        console.error(JSON.stringify({ code: "worker_retry" }));
        await setTimeout(5000, undefined, { signal: controller.signal }).catch(
          () => {},
        );
      }
    }
  }
} finally {
  await runtime.close();
}
