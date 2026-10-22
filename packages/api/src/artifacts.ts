import { mkdir, rename, unlink } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { ArtifactStore } from "@lib/memory";
import type { ServerEnvironment } from "@lib/environment";

const validateKey = (key: string) => {
  if (!/^exports\/[a-f0-9-]+\/[a-f0-9-]+\/[a-f0-9-]+\.ndjson$/.test(key))
    throw new Error("invalid_artifact_key");
  return key;
};
export function localArtifacts(root: string): ArtifactStore {
  const path = (key: string) => resolve(root, validateKey(key));
  return {
    async write(key, data, signal) {
      const target = path(key),
        temporary = `${target}.${randomUUID()}.partial`;
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      try {
        await pipeline(
          Buffer.isBuffer(data) ? Readable.from([data]) : data,
          createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
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
    async remove(key) {
      await unlink(path(key)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    },
  };
}
export function s3Artifacts(client: S3Client, bucket: string): ArtifactStore {
  return {
    async write(key, data, signal) {
      const params = {
        Bucket: bucket,
        Key: validateKey(key),
        Body: data,
        ContentType: "application/x-ndjson",
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
    async remove(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: validateKey(key) }),
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
      forcePathStyle: env.EXPORT_S3_PATH_STYLE,
      credentials: {
        accessKeyId: env.EXPORT_S3_ACCESS_KEY_ID,
        secretAccessKey: env.EXPORT_S3_SECRET_ACCESS_KEY,
      },
    }),
    env.EXPORT_S3_BUCKET,
  );
}
