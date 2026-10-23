import { createHash, randomUUID } from "node:crypto";
import type { Knex } from "@lib/database";
import { GroveError, type Principal } from "@lib/shared/contracts";
import { mediaObjectKey, mediaReference } from "@lib/shared/media";
import { shareTokenSchema } from "@lib/shared/sharing";
import type { MemoryService } from "./index.ts";

type ObjectRow = {
  id: string;
  memoryId: string;
  mime: string;
  bytes: number;
  sha256: string;
  status: string;
  objectKey: string;
  leaseId: string;
  leaseUntil: Date;
  width: number;
  height: number;
  durationMs?: number;
};
export type MediaUpload = {
  id: string;
  memoryId: string;
  version: number;
  bytes: number;
  mime: string;
  sha256: string;
};
const missing = () => new GroveError("not_found", "Media is unavailable", 404);
const conflict = () =>
  new GroveError(
    "media_changed",
    "The note or upload changed. Reload and retry.",
    409,
  );
export const mediaDescriptor = (row: ObjectRow) => ({
  id: row.id,
  reference: mediaReference(row.id),
  mime: row.mime,
  bytes: row.bytes,
  width: row.width,
  height: row.height,
  durationMs: row.durationMs ?? null,
});

export class MediaAttachments {
  constructor(private service: MemoryService) {}
  private async note(
    trx: Knex.Transaction,
    id: string,
    grant?: { personal: boolean; allProjects: boolean; projectIds: string[] },
  ) {
    const note = await trx("memories")
      .where({ id })
      .where((q) =>
        q.whereNull("expiresAt").orWhere("expiresAt", ">", trx.fn.now()),
      )
      .first();
    if (
      !note ||
      (grant &&
        (note.projectId === null
          ? !grant.personal
          : !(grant.allProjects || grant.projectIds.includes(note.projectId))))
    )
      throw missing();
    return note;
  }
  async claim(principal: Principal, input: MediaUpload) {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const note = await this.note(trx, input.memoryId);
      if (note.status !== "active") throw missing();
      const existing: ObjectRow | undefined = await trx("media_objects")
        .where({ id: input.id })
        .first();
      if (
        existing &&
        (existing.memoryId !== input.memoryId ||
          existing.mime !== input.mime ||
          existing.bytes !== input.bytes ||
          existing.sha256 !== input.sha256)
      )
        throw conflict();
      if (existing?.status === "ready") return { row: existing, replay: true };
      if (note.version !== input.version) throw conflict();
      if (
        existing?.status === "pending" &&
        new Date(existing.leaseUntil) > new Date()
      )
        throw conflict();
      // Account lock from access() serializes quota across replicas. Count every
      // write attempt including uncertain objects; deletion never refunds retained bytes.
      const quota = await trx("accounts")
        .where({ id: account.id })
        .first("mediaBytes", "mediaAttempts");
      if (
        Number(quota.mediaBytes) + input.bytes > 1024 * 1024 * 1024 ||
        quota.mediaAttempts >= 1000
      )
        throw new GroveError("media_quota", "Media storage limit reached", 429);
      const leaseId = randomUUID(),
        objectKey = mediaObjectKey(account.id, input.id, leaseId);
      const values = {
        memoryId: input.memoryId,
        bytes: input.bytes,
        mime: input.mime,
        sha256: input.sha256,
        status: "pending",
        leaseId,
        objectKey,
        leaseUntil: trx.raw("clock_timestamp()+interval '120 seconds'"),
      };
      const [row] = existing
        ? await trx("media_objects")
            .where({ id: input.id })
            .update(values)
            .returning("*")
        : await trx("media_objects")
            .insert({ accountId: account.id, id: input.id, ...values })
            .returning("*");
      await trx("media_upload_attempts").insert({
        accountId: account.id,
        mediaId: input.id,
        id: leaseId,
        objectKey,
      });
      await trx("accounts")
        .where({ id: account.id })
        .increment({ mediaBytes: input.bytes, mediaAttempts: 1 });
      return { row: row as ObjectRow, replay: false };
    });
  }
  async finish(
    principal: Principal,
    input: MediaUpload,
    leaseId: string,
    dimensions: { width: number; height: number; durationMs?: number },
  ) {
    return this.service.access(principal, "admin", async ({ trx }) => {
      const note = await this.note(trx, input.memoryId);
      if (note.status !== "active" || note.version !== input.version)
        throw conflict();
      const [row] = await trx("media_objects")
        .where({
          id: input.id,
          memoryId: input.memoryId,
          leaseId,
          status: "pending",
        })
        .where("leaseUntil", ">", trx.raw("clock_timestamp()"))
        .update({
          width: dimensions.width,
          height: dimensions.height,
          durationMs: dimensions.durationMs ?? null,
          status: "ready",
        })
        .returning("*");
      if (!row) throw conflict();
      await trx("accounts")
        .where({ id: principal.accountId })
        .increment("exportVersion", 1);
      return mediaDescriptor(row);
    });
  }
  async fail(principal: Principal, id: string, leaseId: string) {
    return this.service.access(principal, "admin", async ({ trx }) => {
      await trx("media_objects")
        .where({ id, leaseId, status: "pending" })
        .update({ status: "failed" });
    });
  }
  async read(
    principal: Principal,
    memoryId: string,
    id: string,
    version?: number,
  ) {
    return this.service.access(
      principal,
      "memory:read",
      async ({ trx, grant }) => {
        const note = await this.note(trx, memoryId, grant);
        const row = await trx("media_objects as o")
          .join("media_revision_bindings as b", function () {
            this.on("b.accountId", "=", "o.accountId").andOn(
              "b.mediaId",
              "=",
              "o.id",
            );
          })
          .where({
            "o.id": id,
            "o.memoryId": memoryId,
            "o.status": "ready",
            "b.memoryId": memoryId,
            "b.version": version ?? note.version,
          })
          .select("o.*")
          .first();
        if (!row) throw missing();
        return {
          key: row.objectKey as string,
          mime: row.mime as string,
          bytes: row.bytes as number,
          sha256: row.sha256 as string,
        };
      },
    );
  }
  async publicRead(token: string, memoryId: string, id: string) {
    if (!shareTokenSchema.safeParse(token).success) throw missing();
    const admitted = await this.service.db.raw(
      "SELECT grove_share_admit('global') AS allowed",
    );
    if (!admitted.rows[0].allowed)
      throw new GroveError("rate_limited", "Retry later", 429);
    const { rows } = await this.service.db.raw(
      "SELECT grove_public_media(?,?::uuid,?::uuid) AS value",
      [createHash("sha256").update(token).digest("hex"), memoryId, id],
    );
    const value = rows[0].value;
    if (value?.limited)
      throw new GroveError("rate_limited", "Retry later", 429);
    if (!value) throw missing();
    return value as {
      key: string;
      mime: string;
      bytes: number;
      sha256: string;
    };
  }
  async transcript(principal: Principal, memoryId: string, id: string) {
    const object = await this.read(principal, memoryId, id);
    if (object.mime !== "audio/wav") throw missing();
    return this.service.access(
      principal,
      "memory:read",
      async ({ trx, grant }) => {
        await this.note(trx, memoryId, grant);
        const row = await trx("media_transcripts")
          .where({ mediaId: id })
          .select("text", "version")
          .first();
        return row ?? { text: "", version: 0 };
      },
    );
  }
  async saveTranscript(
    principal: Principal,
    memoryId: string,
    id: string,
    input: { operationId: string; expectedVersion: number; text: string },
  ) {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const note = await this.note(trx, memoryId);
      const object = await trx("media_objects")
        .where({ id, memoryId, mime: "audio/wav", status: "ready" })
        .first();
      if (
        !object ||
        !(await trx("media_revision_bindings")
          .where({ mediaId: id, memoryId, version: note.version })
          .first())
      )
        throw missing();
      const old = await trx("media_transcripts").where({ mediaId: id }).first(),
        fingerprint = createHash("sha256")
          .update(JSON.stringify(input))
          .digest("hex");
      if (old?.operationId === input.operationId) {
        if (old.fingerprint !== fingerprint) throw conflict();
        return { text: old.text, version: old.version };
      }
      if ((old?.version ?? 0) !== input.expectedVersion) throw conflict();
      const version = input.expectedVersion + 1;
      await trx("media_transcripts")
        .insert({
          accountId: account.id,
          mediaId: id,
          text: input.text,
          version,
          operationId: input.operationId,
          fingerprint,
        })
        .onConflict(["accountId", "mediaId"])
        .merge({
          text: input.text,
          version,
          operationId: input.operationId,
          fingerprint,
          updatedAt: trx.fn.now(),
        });
      await trx("media_transcript_revisions").insert({
        accountId: account.id,
        mediaId: id,
        version,
        text: input.text,
      });
      await trx("accounts")
        .where({ id: account.id })
        .increment("exportVersion", 1);
      return { text: input.text, version };
    });
  }
}
