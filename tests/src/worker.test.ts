import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@lib/database";
import { MemoryService, Tasks, sessionPrincipal } from "@lib/memory";

test(
  "worker replicas process imports and exports during broker outage and drain on SIGTERM",
  { timeout: 45000 },
  async () => {
    const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL!;
    assert(new URL(ownerUrl).pathname.endsWith("_test"));
    const authority = createDatabase(ownerUrl),
      name = `grove_worker_${randomUUID().replaceAll("-", "")}_test`;
    const url = (source: string) => {
      const u = new URL(source);
      u.pathname = `/${name}`;
      return u.href;
    };
    await authority.raw("CREATE DATABASE ??", [name]);
    const admin = createDatabase(url(ownerUrl)),
      api = createDatabase(url(process.env.TEST_DATABASE_URL!));
    await mkdir("/tmp/opencode", { recursive: true, mode: 0o700 });
    const root = await mkdtemp("/tmp/opencode/grove-worker-");
    const children: ReturnType<typeof spawn>[] = [],
      exits: Promise<number | null>[] = [];
    let output = "";
    try {
      await admin.migrate.latest();
      const account = (
        await api.raw("SELECT * FROM grove_account(?)", [
          `worker-${randomUUID()}`,
        ])
      ).rows[0];
      const principal = sessionPrincipal(account.id, account.clerk_subject),
        tasks = new Tasks(new MemoryService(api, "worker-tests"), true);
      const imported = await tasks.import(principal, {
        id: randomUUID(),
        source: "worker-test",
        records: Array.from({ length: 25 }, (_, i) => ({
          sourceId: String(i),
          content: `Private worker writing ${i}`,
          projectId: null,
        })),
      });
      for (let i = 0; i < 2; i++) {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "packages/api/src/worker.ts"],
          {
            cwd: fileURLToPath(new URL("../../", import.meta.url)),
            env: {
              PATH: process.env.PATH,
              NODE_ENV: "test",
              DATABASE_URL: url(process.env.TEST_WORKER_DATABASE_URL!),
              API_ORIGIN: "http://localhost",
              SITE_URL: "http://localhost",
              CLERK_ISSUER: "https://clerk.example.test",
              CLERK_PUBLISHABLE_KEY:
                "pk_test_Zml4dHVyZS5jbGVyay5hY2NvdW50cy5kZXYk",
              CLERK_SECRET_KEY: "sk_test_fixture",
              CLERK_WEBHOOK_SIGNING_SECRET: "fixture",
              CURSOR_SECRET: "x".repeat(32),
              EMBEDDING_MODE: "disabled",
              WORKER_LANES: "bulk",
              AMQP_URL: "amqps://127.0.0.1:9",
              EXPORT_STORAGE: "local",
              EXPORT_DIRECTORY: root,
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        children.push(child);
        child.stdout!.on("data", (chunk) => {
          output = (output + chunk).slice(-32000);
        });
        child.stderr!.on("data", (chunk) => {
          output = (output + chunk).slice(-32000);
        });
        exits.push(
          new Promise((resolve, reject) => {
            child.once("exit", resolve);
            child.once("error", reject);
          }),
        );
      }
      const complete = async (id: string) => {
        for (let attempt = 0; attempt < 200; attempt++) {
          const task = await admin("background_tasks").where({ id }).first();
          assert.notEqual(
            task.status,
            "failed",
            `${task.errorCode}\n${output}`,
          );
          assert(
            children.every((child) => child.exitCode === null),
            output,
          );
          if (task.status === "succeeded") return;
          await setTimeout(100);
        }
        assert.fail(`Worker did not complete\n${output}`);
      };
      await complete(imported.id);
      assert.equal(
        (await admin("memories").where({ accountId: account.id })).length,
        25,
      );
      const exported = await tasks.export(principal, {
        id: randomUUID(),
        includeDescendants: false,
      });
      await complete(exported.id);
      const artifact = await tasks.artifact(principal, exported.id);
      const records = (await readFile(`${root}/${artifact.key}`, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(records.filter((row) => row.type === "note").length, 25);
      assert.equal(records.filter((row) => row.type === "revision").length, 25);
      for (const child of children) child.kill("SIGTERM");
      assert.deepEqual(await Promise.all(exits), [0, 0], output);
      assert(!output.includes("Private worker writing"));
      assert(output.includes("dispatch_retry"));
    } finally {
      for (const child of children)
        if (child.exitCode === null) child.kill("SIGKILL");
      await Promise.allSettled(exits);
      await Promise.all([admin.destroy(), api.destroy()]);
      await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
      await authority.destroy();
      await rm(root, { recursive: true, force: true });
    }
  },
);
