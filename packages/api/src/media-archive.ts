import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { GroveError, type Principal } from "@lib/shared/contracts";
import { MediaAttachments, type MemoryService } from "@lib/memory";
import type { MediaStore } from "./media-store.ts";

function header(name: string, size: number) {
  if (
    !/^(note\.md|manifest\.json|media\/[0-9a-f-]+\.(png|jpeg|webp))$/.test(
      name,
    ) ||
    !Number.isSafeInteger(size) ||
    size < 0
  )
    throw new Error("invalid_archive_entry");
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, "utf8");
  const octal = (value: number, offset: number, length: number) =>
    block.write(
      value.toString(8).padStart(length - 1, "0") + "\0",
      offset,
      length,
      "ascii",
    );
  octal(0o600, 100, 8);
  octal(0, 108, 8);
  octal(0, 116, 8);
  octal(size, 124, 12);
  octal(0, 136, 12);
  block.fill(32, 148, 156);
  block.write("0", 156);
  block.write("ustar\0", 257);
  block.write("00", 263);
  const sum = block.reduce((total, value) => total + value, 0);
  block.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return block;
}
const padding = (size: number) => Buffer.alloc((512 - (size % 512)) % 512);

export async function noteArchive(
  service: MemoryService,
  media: MediaStore,
  principal: Principal,
  id: string,
  expectedVersion: number | undefined,
  signal: AbortSignal,
) {
  const note = await service.get(principal, id);
  if (expectedVersion !== undefined && note.version !== expectedVersion)
    throw new GroveError(
      "version_conflict",
      "The note changed. Refresh before exporting.",
      409,
    );
  const attachments = new MediaAttachments(service);
  const ids = [
    ...new Set(
      [...note.content.matchAll(/grove-media:([0-9a-f-]{36})/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  const objects = [];
  let markdown = note.content;
  for (const mediaId of ids) {
    const object = await attachments.read(principal, id, mediaId, note.version);
    const path = `media/${mediaId}.${object.mime.slice(6)}`;
    objects.push({ ...object, id: mediaId, path });
    markdown = markdown.replaceAll(`grove-media:${mediaId}`, path);
  }
  const recheck = async () => {
    signal.throwIfAborted();
    const fresh = await service.get(principal, id);
    if (
      fresh.version !== note.version ||
      fresh.status !== note.status ||
      (fresh.expiresAt && new Date(fresh.expiresAt) <= new Date())
    )
      throw new GroveError(
        "export_changed",
        "The note changed during export",
        409,
      );
  };
  return Readable.from(
    (async function* () {
      const entries = [
        { name: "note.md", bytes: Buffer.from(markdown) },
        {
          name: "manifest.json",
          bytes: Buffer.from(
            JSON.stringify(
              {
                format: "grove.note",
                version: 1,
                noteId: id,
                noteVersion: note.version,
                media: objects.map(({ id, path, mime, bytes, sha256 }) => ({
                  id,
                  path,
                  mime,
                  bytes,
                  sha256,
                })),
              },
              null,
              2,
            ),
          ),
        },
      ];
      for (const entry of entries) {
        await recheck();
        yield header(entry.name, entry.bytes.length);
        yield entry.bytes;
        yield padding(entry.bytes.length);
      }
      for (const object of objects) {
        await recheck();
        yield header(object.path, object.bytes);
        const stream = await media.read(object.key, signal),
          hash = createHash("sha256");
        let bytes = 0,
          checked = Date.now();
        for await (const chunk of stream) {
          signal.throwIfAborted();
          bytes += chunk.length;
          if (bytes > object.bytes) throw Error("archive_size_mismatch");
          if (Date.now() - checked > 1000) {
            await recheck();
            checked = Date.now();
          }
          hash.update(chunk);
          yield chunk;
        }
        if (bytes !== object.bytes || hash.digest("hex") !== object.sha256)
          throw Error("archive_integrity_mismatch");
        yield padding(bytes);
      }
      await recheck();
      yield Buffer.alloc(1024);
    })(),
  );
}
