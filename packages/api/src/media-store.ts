import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
  GetBucketLifecycleConfigurationCommand,
} from "@aws-sdk/client-s3";
import type { ServerEnvironment } from "@lib/environment";
import {
  imageLimits,
  imageMimeTypes,
  validateMediaKey,
} from "@lib/shared/media";
import type { VerifiedImage } from "./media-images.ts";

/** Private storage, NOT an authorization layer. Use only after tenant/revision checks.
 * Deliberately no remove API: source bytes must never enter export/cache cleanup.
 */
export interface MediaStore {
  ready(): Promise<void>;
  write(key: string, image: VerifiedImage, signal: AbortSignal): Promise<void>;
  read(key: string, signal: AbortSignal): Promise<Readable>;
  close?(): void;
}
function validImage(image: VerifiedImage) {
  if (
    !Buffer.isBuffer(image.bytes) ||
    !image.bytes.length ||
    image.bytes.length > imageLimits.bytes ||
    !imageMimeTypes.includes(image.mime)
  )
    throw new Error("invalid_media_object");
}
const inside = (one: string, two: string) =>
  one === two || one.startsWith(two.endsWith(sep) ? two : two + sep);
async function canonical(path: string): Promise<string> {
  // Resolve existing ancestors too, so an absent child of a symlink cannot bypass
  // the export-directory overlap check. Do not create either configured directory.
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(
      await canonical(parent),
      path.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)),
    );
  }
}

export function localMedia(root: string): MediaStore {
  const directory = resolve(root);
  async function directories(key: string, create: boolean) {
    validateMediaKey(key);
    let current = directory;
    const segments = key.split("/").slice(0, -1);
    for (const segment of ["", ...segments]) {
      if (segment) current = resolve(current, segment);
      if (create)
        await mkdir(current, {
          recursive: current === directory,
          mode: 0o700,
        }).catch((error) => {
          if (error.code !== "EEXIST") throw error;
        });
      const info = await lstat(current);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        (info.mode & 0o077) !== 0
      )
        throw new Error("media_directory_not_private");
    }
    return resolve(directory, key);
  }
  return {
    async ready() {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const info = await lstat(directory);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        (info.mode & 0o077) !== 0
      )
        throw new Error("media_directory_not_private");
    },
    async write(key, image, signal) {
      signal.throwIfAborted();
      validImage(image);
      const target = await directories(key, true);
      const temporary = `${target}.${randomUUID()}.partial`;
      const file = await open(
        temporary,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(image.bytes, { signal });
        await file.sync();
        await file.close();
        signal.throwIfAborted();
        // rename overwrites! link publishes atomically and fails on any collision.
        await link(temporary, target);
      } finally {
        await file.close();
        await unlink(temporary).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    },
    async read(key, signal) {
      signal.throwIfAborted();
      const target = await directories(key, false);
      const file = await open(
        target,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        if (!(await file.stat()).isFile())
          throw new Error("invalid_media_object");
        signal.throwIfAborted();
        return file.createReadStream({ signal, autoClose: true });
      } catch (error) {
        await file.close();
        throw error;
      }
    },
  };
}

export function s3Media(
  client: S3Client,
  bucket: string,
  spacesLifecycleVerified = false,
): MediaStore {
  return {
    async ready() {
      const signal = AbortSignal.timeout(5000);
      await client.send(new HeadBucketCommand({ Bucket: bucket }), {
        abortSignal: signal,
      });
      try {
        const lifecycle = await client.send(
          new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
          { abortSignal: signal },
        );
        if (
          lifecycle.Rules?.some(
            (rule) =>
              rule.Status === "Enabled" &&
              (rule.Expiration || rule.NoncurrentVersionExpiration),
          )
        )
          throw new Error("media_bucket_must_not_expire_source");
      } catch (error) {
        // AccessDenied/unsupported/provider failures must not masquerade as safe.
        const name = (error as { name?: string }).name;
        if (
          name !== "NoSuchLifecycleConfiguration" &&
          !(name === "AccessDenied" && spacesLifecycleVerified)
        )
          throw error;
      }
      // Some "compatible" providers silently ignore If-None-Match. Test only a
      // unique operational probe, never an authored media key. IAM can allow
      // DELETE under media-probes/ while denying every delete under media/.
      const probe = `media-probes/${randomUUID()}`;
      try {
        const put = (body: string) =>
          client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: probe,
              Body: body,
              IfNoneMatch: "*",
              CacheControl: "private, no-store",
              ContentType: "application/octet-stream",
            }),
            { abortSignal: signal },
          );
        await put("grove immutable storage probe");
        let rejected = false;
        try {
          await put("must not replace the probe");
        } catch (error) {
          if (
            (error as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode !== 412
          )
            throw error;
          rejected = true;
        }
        if (!rejected)
          throw new Error("media_storage_conditional_writes_required");
      } finally {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: probe }),
          { abortSignal: AbortSignal.timeout(5000) },
        );
      }
    },
    async write(key, image, signal) {
      signal.throwIfAborted();
      validImage(image);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: validateMediaKey(key),
          Body: image.bytes,
          ContentLength: image.bytes.length,
          ContentType: image.mime,
          CacheControl: "private, no-store",
          IfNoneMatch: "*",
          Metadata: { sha256: image.sha256 },
        }),
        { abortSignal: signal },
      );
    },
    async read(key, signal) {
      signal.throwIfAborted();
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: validateMediaKey(key) }),
        { abortSignal: signal },
      );
      if (!(result.Body instanceof Readable))
        throw new Error("media_unavailable");
      return result.Body;
    },
    close() {
      client.destroy();
    },
  };
}

export async function createMediaStore(
  env: ServerEnvironment,
): Promise<MediaStore | null> {
  if (env.MEDIA_STORAGE === "disabled") return null;
  if (env.GROVE_EDITION === "cloud" && env.MEDIA_STORAGE !== "s3")
    throw new Error("cloud_media_requires_s3");
  const mediaDirectory = await canonical(resolve(env.MEDIA_DIRECTORY));
  const exportDirectory = await canonical(resolve(env.EXPORT_DIRECTORY));
  if (
    inside(mediaDirectory, exportDirectory) ||
    inside(exportDirectory, mediaDirectory)
  )
    throw new Error("media_export_directories_must_be_separate");
  if (env.MEDIA_STORAGE === "local") return localMedia(env.MEDIA_DIRECTORY);
  if (
    !env.MEDIA_S3_BUCKET ||
    !env.MEDIA_S3_ACCESS_KEY_ID ||
    !env.MEDIA_S3_SECRET_ACCESS_KEY
  )
    throw new Error("media_storage_configuration_required");
  if (env.MEDIA_S3_ENDPOINT) {
    const url = new URL(env.MEDIA_S3_ENDPOINT);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      throw new Error("media_storage_https_required");
  }
  // Distinct credentials make an accidental export-lifecycle change non-authorizing.
  if (env.MEDIA_S3_ACCESS_KEY_ID === env.EXPORT_S3_ACCESS_KEY_ID)
    throw new Error("media_export_credentials_must_be_separate");
  // Fail conservatively even for endpoint aliases to the same physical bucket.
  if (env.MEDIA_S3_BUCKET === env.EXPORT_S3_BUCKET)
    throw new Error("media_export_buckets_must_be_separate");
  return s3Media(
    new S3Client({
      region: env.MEDIA_S3_REGION,
      endpoint: env.MEDIA_S3_ENDPOINT,
      forcePathStyle: env.MEDIA_S3_PATH_STYLE,
      ...(env.MEDIA_S3_ENDPOINT
        ? {
            requestChecksumCalculation: "WHEN_REQUIRED" as const,
            responseChecksumValidation: "WHEN_REQUIRED" as const,
          }
        : {}),
      credentials: {
        accessKeyId: env.MEDIA_S3_ACCESS_KEY_ID,
        secretAccessKey: env.MEDIA_S3_SECRET_ACCESS_KEY,
      },
    }),
    env.MEDIA_S3_BUCKET,
    !!env.MEDIA_S3_ENDPOINT &&
      /^https:\/\/[a-z]{3}\d\.digitaloceanspaces\.com\/?$/.test(
        env.MEDIA_S3_ENDPOINT,
      ) &&
      env.MEDIA_S3_LIFECYCLE_VERIFIED_FOR ===
        `${env.MEDIA_S3_ENDPOINT.replace(/\/$/, "")}/${env.MEDIA_S3_BUCKET}`,
  );
}
