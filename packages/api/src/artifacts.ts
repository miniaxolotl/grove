import { access, mkdir, open, rename, unlink } from "node:fs/promises";
import { constants, createReadStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { ArtifactStore } from "@lib/memory";
import type { ServerEnvironment } from "@lib/environment";

const validateKey = (key: string) => {
  const uuid =
    "[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
  if (
    !/^exports\/[a-f0-9-]+\/[a-f0-9-]+\/[a-f0-9-]+\.ndjson$/.test(key) &&
    !new RegExp(`^(speech|narration)/${uuid}/${uuid}/${uuid}\\.mp3$`).test(key)
  )
    throw new Error("invalid_artifact_key");
  return key;
};
export function localArtifacts(root: string): ArtifactStore {
  const path = (key: string) => resolve(root, validateKey(key));
  return {
    async ready() {
      await mkdir(root, { recursive: true, mode: 0o700 });
      await access(root, constants.R_OK | constants.W_OK);
    },
    async write(key, data, signal) {
      const target = path(key),
        temporary = `${target}.partial`;
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      // Each upload owns a fresh tracked key. A deterministic scratch name lets
      // expiry cleanup remove files left by process termination as well.
      const file = await open(temporary, "wx", 0o600);
      try {
        await pipeline(
          Buffer.isBuffer(data) ? Readable.from([data]) : data,
          file.createWriteStream(),
          { signal },
        );
        signal.throwIfAborted();
        await rename(temporary, target);
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    },
    async read(key, signal) {
      return createReadStream(path(key), { signal });
    },
    async remove(key, signal) {
      signal?.throwIfAborted();
      for (const file of [path(key), `${path(key)}.partial`])
        await unlink(file).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
    },
  };
}
export function s3Artifacts(client: S3Client, bucket: string): ArtifactStore {
  return {
    async ready() {
      await client.send(new HeadBucketCommand({ Bucket: bucket }), {
        abortSignal: AbortSignal.timeout(5000),
      });
    },
    close() {
      client.destroy();
    },
    async write(key, data, signal) {
      const params = {
        Bucket: bucket,
        Key: validateKey(key),
        Body: data,
        ContentType: key.endsWith(".mp3")
          ? "audio/mpeg"
          : "application/x-ndjson",
        CacheControl: "private, no-store",
      };
      if (Buffer.isBuffer(data)) {
        await client.send(new PutObjectCommand(params), {
          abortSignal: signal,
        });
        return;
      }
      const upload = new Upload({
        client,
        params,
        queueSize: 2,
        partSize: 5 * 1024 * 1024,
        leavePartsOnError: false,
      });
      const abort = () => {
        void upload.abort();
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        signal.throwIfAborted();
        await upload.done();
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
    async read(key, signal) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: validateKey(key) }),
        { abortSignal: signal },
      );
      if (!(result.Body instanceof Readable))
        throw new Error("artifact_unavailable");
      return result.Body;
    },
    async remove(key, signal) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: validateKey(key) }),
        { abortSignal: signal ?? AbortSignal.timeout(10000) },
      );
    },
  };
}
export function createArtifacts(env: ServerEnvironment): ArtifactStore | null {
  const mode =
    env.EXPORT_STORAGE ??
    (env.GROVE_EDITION === "cloud" ? "disabled" : "local");
  if (mode === "disabled") return null;
  if (mode === "local") return localArtifacts(env.EXPORT_DIRECTORY);
  if (
    !env.EXPORT_S3_BUCKET ||
    !env.EXPORT_S3_ACCESS_KEY_ID ||
    !env.EXPORT_S3_SECRET_ACCESS_KEY
  )
    throw new Error("export_storage_configuration_required");
  return s3Artifacts(
    new S3Client({
      region: env.EXPORT_S3_REGION,
      endpoint: env.EXPORT_S3_ENDPOINT,
      // Compatible stores may return composite multipart checksums. Request
      // optional AWS checksum extensions only on the native AWS endpoint.
      ...(env.EXPORT_S3_ENDPOINT
        ? {
            requestChecksumCalculation: "WHEN_REQUIRED" as const,
            responseChecksumValidation: "WHEN_REQUIRED" as const,
          }
        : {}),
      forcePathStyle: env.EXPORT_S3_PATH_STYLE,
      credentials: {
        accessKeyId: env.EXPORT_S3_ACCESS_KEY_ID,
        secretAccessKey: env.EXPORT_S3_SECRET_ACCESS_KEY,
      },
    }),
    env.EXPORT_S3_BUCKET,
  );
}
