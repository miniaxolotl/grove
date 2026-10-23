import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { localArtifacts } from "../../packages/api/src/artifacts.ts";

test("temporary speech shares artifact cleanup but cannot address authored media or arbitrary paths", async () => {
  const root = await mkdtemp("/tmp/opencode/grove-speech-cache-");
  const store = localArtifacts(root),
    key = `speech/${randomUUID()}/${randomUUID()}/${randomUUID()}.mp3`;
  try {
    await store.ready!();
    await store.write(
      key,
      Buffer.from("audio bytes"),
      AbortSignal.timeout(1000),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of await store.read(key)) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), "audio bytes");
    await store.remove(key);
    for (const invalid of [
      "speech/../source",
      `media/${randomUUID()}/${randomUUID()}`,
      key.replace(".mp3", ".ndjson"),
    ])
      await assert.rejects(
        store.write(invalid, Buffer.from("no"), AbortSignal.timeout(1000)),
        /invalid_artifact_key/,
      );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
