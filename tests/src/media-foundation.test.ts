import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { Readable } from "node:stream";
import { crc32 } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  GetBucketLifecycleConfigurationCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  PutBucketLifecycleConfigurationCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { readServerEnvironment } from "@lib/environment";
import {
  imageLimits,
  mediaObjectKey,
  mediaReference,
  mediaReferenceId,
  validateMediaKey,
} from "@lib/shared/media";
import { verifyImage } from "../../packages/api/src/media-images.ts";
import {
  createMediaStore,
  localMedia,
  s3Media,
} from "../../packages/api/src/media-store.ts";

const signal = () => new AbortController().signal;
const key = () => mediaObjectKey(randomUUID(), randomUUID(), randomUUID());
const raster = (width = 3, height = 2) =>
  sharp({ create: { width, height, channels: 3, background: "#397451" } });
const png = async () => raster().png().toBuffer();
const image = async () =>
  verifyImage(Readable.from([await png()]), "image/png", signal());
async function bytes(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
const env = (overrides: Record<string, string> = {}) =>
  readServerEnvironment({
    DATABASE_URL: "postgresql://unused",
    API_ORIGIN: "http://localhost",
    SITE_URL: "http://localhost",
    CLERK_PUBLISHABLE_KEY: "pk_test_fixture",
    CLERK_SECRET_KEY: "sk_test_fixture",
    CLERK_ISSUER: "https://clerk.example.test",
    CLERK_WEBHOOK_SIGNING_SECRET: "test",
    CURSOR_SECRET: "x".repeat(32),
    ...overrides,
  });
async function temporary() {
  await mkdir("/tmp/opencode", { recursive: true });
  return mkdtemp("/tmp/opencode/grove-media-test-");
}

test("media references and storage keys accept only canonical opaque identifiers", () => {
  const id = randomUUID();
  assert.equal(mediaReference(id), `grove-media:${id}`);
  assert.equal(mediaReferenceId(mediaReference(id)), id);
  for (const value of [
    id,
    `https://example.test/${id}`,
    `grove-media:${id}?x=1`,
    `grove-media:${id}#fragment`,
    `grove-media:${id.toUpperCase()}`,
    `grove-media:../${id}`,
    `grove-media:${id}/`,
    "grove-media:00000000-0000-0000-0000-000000000000",
  ]) {
    assert.equal(mediaReferenceId(value), null);
  }
  const valid = key();
  assert.equal(validateMediaKey(valid), valid);
  for (const value of [
    "../escape",
    `${valid}/`,
    `${valid}/../x`,
    valid.replace("media/", "exports/"),
    valid.replace("media/", "/media/"),
    valid.replace("media/", "media/%2e%2e/"),
    `${valid}\u0000`,
  ])
    assert.throws(() => validateMediaKey(value), /invalid_media_key/);
  assert.throws(() => mediaObjectKey(randomUUID(), "../escape", randomUUID()));
  assert.throws(() => mediaReference("/path"));
});

test("PNG, JPEG and WebP verification fully decodes and preserves original bytes/checksums", async () => {
  for (const format of ["png", "jpeg", "webp"] as const) {
    const original = await raster().withMetadata().toFormat(format).toBuffer();
    const verified = await verifyImage(
      Readable.from([original.subarray(0, 11), original.subarray(11)]),
      `image/${format}`,
      signal(),
    );
    assert.deepEqual(verified.bytes, original);
    assert.equal(verified.mime, `image/${format}`);
    assert.equal(verified.width, 3);
    assert.equal(verified.height, 2);
    assert.equal(
      verified.sha256,
      createHash("sha256").update(original).digest("hex"),
    );
  }
});

test("image validation rejects active markup, forged MIME, unsupported and truncated bytes", async () => {
  const original = await png();
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/track"/></svg>',
    ),
    Buffer.from("<html>not an image</html>"),
    Buffer.from("\x89PNG\r\n\x1a\nforged"),
    original.subarray(0, original.length - 30),
    await raster().gif().toBuffer(),
    await raster().tiff().toBuffer(),
  ])
    await assert.rejects(
      verifyImage(Readable.from([bytes]), "image/png", signal()),
      { code: "invalid_image" },
    );
  await assert.rejects(
    verifyImage(Readable.from([original]), "image/jpeg", signal()),
    { code: "invalid_image" },
  );
});

test("image limits count actual received bytes and destroy an over-limit source", async () => {
  const source = Readable.from(
    (async function* () {
      for (let i = 0; i <= 20; i++) yield Buffer.alloc(512 * 1024);
    })(),
  );
  await assert.rejects(verifyImage(source, "image/png", signal()), {
    code: "media_too_large",
  });
  assert.equal(source.destroyed, true);
  const wide = await raster(imageLimits.dimension + 1, 1)
    .png()
    .toBuffer();
  await assert.rejects(
    verifyImage(Readable.from([wide]), "image/png", signal()),
    { code: "media_too_large" },
  );
  const bomb = await raster(5000, 5000).png().toBuffer();
  await assert.rejects(
    verifyImage(Readable.from([bomb]), "image/png", signal()),
  );
});

test(
  "one-byte fragmentation cannot turn a bounded image into unbounded chunk-object retention",
  { timeout: 30000 },
  async () => {
    // Isolate GC from the test runner and measure reachable heap, not transient
    // garbage or process-wide RSS/native decoder allocations.
    const implementation = new URL(
      "../../packages/api/src/media-images.ts",
      import.meta.url,
    ).href;
    const code = `
    import assert from 'node:assert/strict';
    import { Readable } from 'node:stream';
    import { verifyImage } from ${JSON.stringify(implementation)};
    const original = Buffer.from(${JSON.stringify((await png()).toString("base64"))}, 'base64');
    globalThis.gc();
    const baseline = process.memoryUsage().heapUsed;
    let retained = baseline;
    const source = Readable.from((async function* () {
      yield original;
      for (let i = 0; i < 1_000_000; i++) yield Buffer.from([0]);
      globalThis.gc();
      retained = process.memoryUsage().heapUsed;
    })());
    const verified = await verifyImage(source, 'image/png', new AbortController().signal);
    assert.equal(verified.bytes.length, original.length + 1_000_000);
    assert(retained - baseline < 64 * 1024 * 1024, 'retained chunk heap exceeds 64 MiB');
    console.log('bounded');
  `;
    const result = await promisify(execFile)(
      process.execPath,
      ["--expose-gc", "--import", "tsx", "--input-type=module", "--eval", code],
      { timeout: 25000 },
    );
    assert.equal(result.stdout.trim(), "bounded");
  },
);

test("animated WebP is rejected even when its first frame is a valid raster", async () => {
  const animation = await sharp(
    Buffer.concat([Buffer.alloc(18, 0), Buffer.alloc(18, 255)]),
    { raw: { width: 3, height: 4, pageHeight: 2, channels: 3 } },
  )
    .webp({ lossless: true, loop: 0, delay: [100, 100] })
    .toBuffer();
  assert.equal((await sharp(animation).metadata()).pages, 2);
  await assert.rejects(
    verifyImage(Readable.from([animation]), "image/webp", signal()),
    { code: "invalid_image" },
  );
});

test("PNG with APNG control is rejected rather than decoded as a static first frame", async () => {
  const original = await png();
  const control = Buffer.alloc(20);
  control.writeUInt32BE(8, 0);
  control.write("acTL", 4, "ascii");
  control.writeUInt32BE(2, 8);
  control.writeUInt32BE(crc32(control.subarray(4, 16)), 16);
  // Insert a valid ancillary control chunk after IHDR. Static-only decoders
  // otherwise ignore it and accept the first frame, losing the animation signal.
  const animated = Buffer.concat([
    original.subarray(0, 33),
    control,
    original.subarray(33),
  ]);
  await assert.rejects(
    verifyImage(Readable.from([animated]), "image/png", signal()),
    { code: "invalid_image" },
  );
});

test("upload validation propagates cancellation and stream failures without waiting for EOF", async () => {
  const controller = new AbortController();
  const source = new Readable({ read() {} });
  const pending = verifyImage(source, "image/png", controller.signal);
  controller.abort(new Error("fixture cancelled"));
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(source.destroyed, true);
  const broken = Readable.from(
    (async function* () {
      yield Buffer.from("prefix");
      throw new Error("fixture stream failed");
    })(),
  );
  await assert.rejects(
    verifyImage(broken, "image/png", signal()),
    /fixture stream failed/,
  );
  await assert.rejects(
    verifyImage(Readable.from([await png()]), "image/png", controller.signal),
    /fixture cancelled/,
  );
});

test("local source media is private and immutable, including concurrent publication collisions", async () => {
  const root = await temporary(),
    object = key(),
    store = localMedia(root);
  const verified = await image();
  try {
    await store.ready();
    const written = await Promise.allSettled([
      store.write(object, verified, signal()),
      store.write(object, verified, signal()),
    ]);
    assert.equal(
      written.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal((await lstat(`${root}/${object}`)).mode & 0o777, 0o600);
    assert.deepEqual(await readFile(`${root}/${object}`), verified.bytes);
    assert.deepEqual(
      await bytes(await store.read(object, signal())),
      verified.bytes,
    );
    await assert.rejects(store.write(object, verified, signal()), {
      code: "EEXIST",
    });
    assert(
      !(await readdir(root, { recursive: true })).some((name) =>
        name.endsWith(".partial"),
      ),
    );
    assert(!("remove" in store));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local media refuses traversal, symlink paths, permissive directories and cancelled writes", async () => {
  const root = await temporary(),
    outside = await temporary();
  try {
    const store = localMedia(`${root}/source`),
      verified = await image();
    await store.ready();
    for (const bad of [
      "../escape",
      `exports/${randomUUID()}`,
      `${key()}/extra`,
    ]) {
      await assert.rejects(store.write(bad, verified, signal()));
      await assert.rejects(store.read(bad, signal()));
    }
    await symlink(outside, `${root}/source/media`);
    await assert.rejects(
      store.write(key(), verified, signal()),
      /media_directory_not_private/,
    );
    assert.deepEqual(await readdir(outside), []);
    await assert.rejects(
      localMedia(`${root}/source/media`).ready(),
      /media_directory_not_private/,
    );
    const controller = new AbortController();
    controller.abort(new Error("fixture cancel"));
    await assert.rejects(
      store.write(key(), verified, controller.signal),
      /fixture cancel/,
    );
    await chmod(outside, 0o755);
    await assert.rejects(
      localMedia(outside).ready(),
      /media_directory_not_private/,
    );
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  }
});

test("cloud media requires Spaces/S3 and cannot fall back to local files", async () => {
  await assert.rejects(
    createMediaStore(env({ GROVE_EDITION: "cloud", MEDIA_STORAGE: "local" })),
    /cloud_media_requires_s3/,
  );
  assert.equal(await createMediaStore(env({ GROVE_EDITION: "cloud" })), null);
  await assert.rejects(
    createMediaStore(env({ GROVE_EDITION: "cloud", MEDIA_STORAGE: "s3" })),
    /media_storage_configuration_required/,
  );
  const store = await createMediaStore(
    env({
      GROVE_EDITION: "cloud",
      MEDIA_STORAGE: "s3",
      MEDIA_S3_ENDPOINT: "https://nyc3.digitaloceanspaces.com",
      MEDIA_S3_REGION: "us-east-1",
      MEDIA_S3_BUCKET: "fixture-source-media",
      MEDIA_S3_ACCESS_KEY_ID: "fixture-source-key",
      MEDIA_S3_SECRET_ACCESS_KEY: "fixture-only",
    }),
  );
  assert(store);
  store.close!(); // Configuration only; no live provider request is made.
});

test("media configuration is explicitly disabled and cannot overlap expiring exports", async () => {
  assert.equal(await createMediaStore(env()), null);
  for (const [media, exports] of [
    ["/", "/owned/exports"],
    ["/owned/media", "/"],
    ["/owned/media", "/owned/media"],
    ["/owned", "/owned/exports"],
    ["/owned/exports/source", "/owned/exports"],
  ])
    await assert.rejects(
      createMediaStore(
        env({
          MEDIA_STORAGE: "local",
          MEDIA_DIRECTORY: media,
          EXPORT_DIRECTORY: exports,
        }),
      ),
      /media_export_directories_must_be_separate/,
    );
  const root = await temporary();
  try {
    await mkdir(`${root}/exports`, { mode: 0o700 });
    await symlink(`${root}/exports`, `${root}/alias`);
    await assert.rejects(
      createMediaStore(
        env({
          MEDIA_STORAGE: "local",
          MEDIA_DIRECTORY: `${root}/alias/source`,
          EXPORT_DIRECTORY: `${root}/exports`,
        }),
      ),
      /media_export_directories_must_be_separate/,
    );
    const store = await createMediaStore(
      env({
        MEDIA_STORAGE: "local",
        MEDIA_DIRECTORY: `${root}/source`,
        EXPORT_DIRECTORY: `${root}/exports`,
      }),
    );
    await store!.ready();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  await assert.rejects(
    createMediaStore(env({ MEDIA_STORAGE: "s3" })),
    /media_storage_configuration_required/,
  );
  const configuration = {
    MEDIA_STORAGE: "s3",
    MEDIA_S3_BUCKET: "source",
    MEDIA_S3_ACCESS_KEY_ID: "source-key",
    MEDIA_S3_SECRET_ACCESS_KEY: "fixture-only",
  };
  await assert.rejects(
    createMediaStore(
      env({
        ...configuration,
        MEDIA_S3_ENDPOINT: "http://storage.example.test",
      }),
    ),
    /media_storage_https_required/,
  );
  await assert.rejects(
    createMediaStore(
      env({
        ...configuration,
        MEDIA_S3_ENDPOINT: "https://key:secret@storage.example.test",
      }),
    ),
    /media_storage_https_required/,
  );
  await assert.rejects(
    createMediaStore(
      env({ ...configuration, EXPORT_S3_ACCESS_KEY_ID: "source-key" }),
    ),
    /media_export_credentials_must_be_separate/,
  );
  await assert.rejects(
    createMediaStore(env({ ...configuration, EXPORT_S3_BUCKET: "source" })),
    /media_export_buckets_must_be_separate/,
  );
  await assert.rejects(
    createMediaStore(
      env({
        ...configuration,
        EXPORT_S3_BUCKET: "source",
        MEDIA_S3_ENDPOINT: "https://s3.us-east-1.amazonaws.com",
      }),
    ),
    /media_export_buckets_must_be_separate/,
  );
});

test("S3 source writes are conditional/private and validate keys before issuing requests", async (t) => {
  const client = new S3Client({
    region: "us-east-1",
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
  });
  const sent: unknown[] = [];
  const probes = new Set<string>();
  t.mock.method(client, "send", async (command: unknown) => {
    sent.push(command);
    if (
      command instanceof PutObjectCommand &&
      command.input.Key?.startsWith("media-probes/")
    ) {
      if (probes.has(command.input.Key))
        throw Object.assign(new Error("fixture collision"), {
          $metadata: { httpStatusCode: 412 },
        });
      probes.add(command.input.Key);
    }
    return command instanceof GetObjectCommand
      ? { Body: Readable.from(["fixture"]) }
      : {};
  });
  const store = s3Media(client, "source"),
    object = key(),
    verified = await image();
  try {
    await store.ready();
    assert(sent[0] instanceof HeadBucketCommand);
    assert(sent[1] instanceof GetBucketLifecycleConfigurationCommand);
    await store.write(object, verified, signal());
    const put = sent.at(-1);
    assert(put instanceof PutObjectCommand);
    assert.equal(put.input.IfNoneMatch, "*");
    assert.equal(put.input.CacheControl, "private, no-store");
    assert.equal(put.input.ContentType, "image/png");
    assert.equal(put.input.ContentLength, verified.bytes.length);
    assert.deepEqual(put.input.Body, verified.bytes);
    await store.read(object, signal());
    const count = sent.length;
    await assert.rejects(store.read("../escape", signal()));
    await assert.rejects(store.write("exports/forged", verified, signal()));
    assert.equal(sent.length, count);
  } finally {
    store.close!();
  }
});

test("S3 readiness fails closed on source expiry, denied or unsupported lifecycle inspection", async (t) => {
  for (const outcome of [
    { Rules: [{ Status: "Enabled", Expiration: { Days: 1 } }] },
    {
      Rules: [
        {
          Status: "Enabled",
          NoncurrentVersionExpiration: { NoncurrentDays: 1 },
        },
      ],
    },
    Object.assign(new Error("denied"), { name: "AccessDenied" }),
    Object.assign(new Error("unsupported"), { name: "NotImplemented" }),
  ]) {
    const client = new S3Client({ region: "us-east-1" });
    t.mock.method(client, "send", async (command: unknown) => {
      if (command instanceof HeadBucketCommand) return {};
      if (outcome instanceof Error) throw outcome;
      return outcome;
    });
    try {
      await assert.rejects(s3Media(client, "source").ready());
    } finally {
      client.destroy();
    }
  }
});

test("S3 readiness detects providers that silently ignore conditional writes and cleans only its scratch probe", async (t) => {
  const client = new S3Client({ region: "us-east-1" });
  const commands: unknown[] = [];
  t.mock.method(client, "send", async (command: unknown) => {
    commands.push(command);
    return {};
  });
  try {
    await assert.rejects(
      s3Media(client, "source").ready(),
      /media_storage_conditional_writes_required/,
    );
    const removed = commands.filter(
      (command) => command instanceof DeleteObjectCommand,
    );
    assert.equal(removed.length, 1);
    assert(removed[0] instanceof DeleteObjectCommand);
    assert.match(removed[0].input.Key!, /^media-probes\/[0-9a-f-]+$/);
  } finally {
    client.destroy();
  }
});

test(
  "real disposable S3 media stays private, byte-identical and immutable; lifecycle expiry is refused",
  {
    skip: !process.env.TEST_MEDIA_S3_ENDPOINT,
    timeout: 60000,
  },
  async () => {
    const endpoint = process.env.TEST_MEDIA_S3_ENDPOINT!;
    assert(
      ["localhost", "127.0.0.1", "[::1]"].includes(new URL(endpoint).hostname),
      "Use owned loopback disposable storage only",
    );
    const client = new S3Client({
      endpoint,
      region: process.env.TEST_MEDIA_S3_REGION ?? "garage",
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: process.env.TEST_MEDIA_S3_KEY!,
        secretAccessKey: process.env.TEST_MEDIA_S3_SECRET!,
      },
    });
    const bucket = `grove-media-test-${randomUUID()}`,
      object = key(),
      raced = key(),
      verified = await image();
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    try {
      const store = s3Media(client, bucket);
      await store.ready();
      await store.write(object, verified, signal());
      assert.deepEqual(
        await bytes(await store.read(object, signal())),
        verified.bytes,
      );
      await assert.rejects(
        store.write(object, verified, signal()),
        (error: unknown) =>
          (error as { $metadata: { httpStatusCode: number } }).$metadata
            .httpStatusCode === 412,
      );
      const concurrent = await Promise.allSettled([
        store.write(raced, verified, signal()),
        store.write(raced, verified, signal()),
      ]);
      assert.equal(
        concurrent.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.deepEqual(
        await bytes(await store.read(raced, signal())),
        verified.bytes,
      );
      const anonymous = await fetch(`${endpoint}/${bucket}/${object}`);
      assert.equal(anonymous.status, 403);
      await anonymous.body?.cancel();
      await client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: bucket,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: "fixture-expiry",
                Filter: { Prefix: "media/" },
                Status: "Enabled",
                Expiration: { Days: 1 },
              },
            ],
          },
        }),
      );
      await assert.rejects(
        store.ready(),
        /media_bucket_must_not_expire_source/,
      );
    } finally {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: object }),
      );
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: raced }),
      );
      await client.send(new DeleteBucketCommand({ Bucket: bucket }));
      client.destroy();
    }
  },
);

test(
  "real nonconforming S3 is refused without changing retained source bytes or leaving probes",
  {
    skip: !process.env.TEST_MEDIA_UNSAFE_S3_ENDPOINT,
    timeout: 60000,
  },
  async () => {
    const endpoint = process.env.TEST_MEDIA_UNSAFE_S3_ENDPOINT!;
    assert(
      ["localhost", "127.0.0.1", "[::1]"].includes(new URL(endpoint).hostname),
    );
    const client = new S3Client({
      endpoint,
      region: "garage",
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: process.env.TEST_MEDIA_UNSAFE_S3_KEY!,
        secretAccessKey: process.env.TEST_MEDIA_UNSAFE_S3_SECRET!,
      },
    });
    const bucket = `grove-media-test-${randomUUID()}`,
      object = key(),
      verified = await image();
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: object,
          Body: verified.bytes,
        }),
      );
      await assert.rejects(
        s3Media(client, bucket).ready(),
        /media_storage_conditional_writes_required/,
      );
      const listed = await client.send(
        new ListObjectsV2Command({ Bucket: bucket }),
      );
      assert.deepEqual(
        listed.Contents?.map((entry) => entry.Key),
        [object],
      );
      assert.deepEqual(
        await bytes(await s3Media(client, bucket).read(object, signal())),
        verified.bytes,
      );
    } finally {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: object }),
      );
      await client.send(new DeleteBucketCommand({ Bucket: bucket }));
      client.destroy();
    }
  },
);
