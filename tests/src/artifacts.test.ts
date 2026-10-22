import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  createArtifacts,
  localArtifacts,
} from "../../packages/api/src/artifacts.ts";
import { readServerEnvironment } from "@lib/environment";

const key = () =>
  `exports/${randomUUID()}/${randomUUID()}/${randomUUID()}.ndjson`;
const digest = async (stream: Readable) => {
  const hash = createHash("sha256");
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
};
test("local artifacts publish atomically, stay private and remove interrupted scratch files", async () => {
  await mkdir("/tmp/opencode", { recursive: true, mode: 0o700 });
  const root = await mkdtemp("/tmp/opencode/grove-artifacts-");
  const store = localArtifacts(root),
    object = key();
  try {
    await store.ready!();
    await store.write(
      object,
      Buffer.from("written"),
      new AbortController().signal,
    );
    assert.equal((await stat(`${root}/${object}`)).mode & 0o777, 0o600);
    assert.equal(
      await digest(await store.read(object)),
      createHash("sha256").update("written").digest("hex"),
    );
    await assert.rejects(
      store.write("../escape", Buffer.from("no"), new AbortController().signal),
    );
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(
      store.write(key(), Buffer.alloc(1000), aborted.signal),
    );
    assert(
      !(await readdir(root, { recursive: true })).some((path) =>
        path.endsWith(".partial"),
      ),
    );
    await store.remove(object);
    await store.remove(object);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "S3 multipart exports stream, require authorization and delete idempotently",
  { skip: !process.env.TEST_STORAGE_ENDPOINT, timeout: 60000 },
  async () => {
    const env = readServerEnvironment({
      DATABASE_URL: "postgresql://unused",
      API_ORIGIN: "http://localhost",
      SITE_URL: "http://localhost",
      CLERK_PUBLISHABLE_KEY: "pk_test_fixture",
      CLERK_SECRET_KEY: "sk_test_fixture",
      CLERK_ISSUER: "https://clerk.example.test",
      CLERK_WEBHOOK_SIGNING_SECRET: "test",
      CURSOR_SECRET: "x".repeat(32),
      EXPORT_STORAGE: "s3",
      EXPORT_S3_ENDPOINT: process.env.TEST_STORAGE_ENDPOINT,
      EXPORT_S3_BUCKET: process.env.TEST_STORAGE_BUCKET,
      EXPORT_S3_ACCESS_KEY_ID: process.env.TEST_STORAGE_KEY,
      EXPORT_S3_SECRET_ACCESS_KEY: process.env.TEST_STORAGE_SECRET,
      EXPORT_S3_REGION: "garage",
      EXPORT_S3_PATH_STYLE: "true",
    });
    const store = createArtifacts(env)!,
      object = key();
    try {
      await store.ready!();
      const chunk = Buffer.alloc(1024 * 1024, "queue export\n"),
        hash = createHash("sha256");
      const source = Readable.from(
        (async function* () {
          for (let i = 0; i < 12; i++) {
            hash.update(chunk);
            yield chunk;
          }
        })(),
      );
      await store.write(object, source, new AbortController().signal);
      assert.equal(await digest(await store.read(object)), hash.digest("hex"));
      const anonymous = await fetch(
        `${env.EXPORT_S3_ENDPOINT}/${env.EXPORT_S3_BUCKET}/${object}`,
      );
      assert.equal(anonymous.status, 403);
      await anonymous.body?.cancel();
      await store.remove(object);
      await store.remove(object);
      await assert.rejects(store.read(object));
      const cancelled = new AbortController();
      cancelled.abort();
      await assert.rejects(
        store.write(key(), Readable.from([chunk]), cancelled.signal),
      );
    } finally {
      await store.remove(object);
      store.close?.();
    }
  },
);
