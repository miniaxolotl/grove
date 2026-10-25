import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  localArtifacts,
  s3Artifacts,
} from "../../packages/api/src/artifacts.ts";
import { S3Client } from "@aws-sdk/client-s3";
import { createServer } from "node:http";
import { once } from "node:events";

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

test("content-addressed narration uses a separate private MP3 prefix in S3", async () => {
  const requests: { url?: string; type?: string; cache?: string }[] = [];
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {
      /* consume bounded fixture */
    }
    requests.push({
      url: req.url,
      type: req.headers["content-type"],
      cache: req.headers["cache-control"],
    });
    res.end();
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const client = new S3Client({
    endpoint: `http://127.0.0.1:${address.port}`,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
  });
  const store = s3Artifacts(client, "private-artifacts");
  const key = `narration/${randomUUID()}/${randomUUID()}/${randomUUID()}.mp3`;
  try {
    await store.write(
      key,
      Buffer.from("cached narration"),
      AbortSignal.timeout(1000),
    );
    assert.equal(requests.length, 1);
    assert(requests[0].url?.startsWith(`/private-artifacts/${key}`));
    assert.equal(requests[0].type, "audio/mpeg");
    assert.equal(requests[0].cache, "private, no-store");
    await store.remove(key);
  } finally {
    client.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
