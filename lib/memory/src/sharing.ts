import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Knex } from "@lib/database";
import { GroveError, uuidSchema, type Principal } from "@lib/shared/contracts";
import {
  publicShareSchema,
  publicShareQuerySchema,
  shareTokenSchema,
  shareDurations,
  sharedNoteTitle,
  type PublicShare,
  type ShareEnable,
  type ShareDuration,
  type ShareMutation,
  type ShareState,
  type ShareTarget,
} from "@lib/shared/sharing";
import type { MemoryService } from "./index.ts";

type ShareRow = {
  id: string;
  accountId: string;
  memoryId: string | null;
  projectId: string | null;
  includeDescendants: boolean;
  tokenDigest: string | null;
  tokenCiphertext: string | null;
  version: number;
  revokedAt: Date | null;
  duration: ShareDuration | null;
  expiresAt: Date | null;
  updatedAt: Date;
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const missing = () =>
  new GroveError("not_found", "This shared content is unavailable", 404);
const conflict = () =>
  new GroveError(
    "version_conflict",
    "Sharing changed. Review the current settings and try again.",
    409,
  );
const limited = () =>
  new GroveError("rate_limited", "Too many requests; retry in one minute", 429);
const targetFor = (row: ShareRow): ShareTarget =>
  row.memoryId
    ? { kind: "note", id: row.memoryId }
    : { kind: "notebook", id: row.projectId! };
const active = async (trx: Knex.Transaction, row: ShareRow): Promise<boolean> =>
  !row.revokedAt &&
  (!row.expiresAt ||
    (
      await trx.raw("SELECT clock_timestamp() < ?::timestamptz AS active", [
        row.expiresAt,
      ])
    ).rows[0].active);
const expiration = (trx: Knex.Transaction, duration: ShareDuration | null) =>
  duration
    ? trx.raw("clock_timestamp() + (? * interval '1 second')", [
        shareDurations[duration].seconds,
      ])
    : null;

export class Sharing {
  constructor(
    private service: MemoryService,
    private options: { key?: string; siteUrl: string },
  ) {}

  private key() {
    if (!this.options.key)
      throw new GroveError(
        "sharing_unavailable",
        "Public sharing is not configured on this server",
        503,
      );
    return Buffer.from(this.options.key, "hex");
  }
  private token(row: Pick<ShareRow, "id" | "accountId">) {
    const token = `gsh_${randomBytes(32).toString("base64url")}`;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(Buffer.from(`${row.accountId}:${row.id}`));
    const encrypted = Buffer.concat([
      cipher.update(token, "utf8"),
      cipher.final(),
    ]);
    return {
      tokenDigest: hash(token),
      tokenCiphertext: Buffer.concat([
        iv,
        cipher.getAuthTag(),
        encrypted,
      ]).toString("base64"),
    };
  }
  private url(row: ShareRow) {
    if (row.revokedAt || !row.tokenCiphertext || !this.options.key) return null;
    try {
      const bytes = Buffer.from(row.tokenCiphertext, "base64");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key(),
        bytes.subarray(0, 12),
      );
      decipher.setAuthTag(bytes.subarray(12, 28));
      decipher.setAAD(Buffer.from(`${row.accountId}:${row.id}`));
      const token = Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
      if (
        hash(token) !== row.tokenDigest ||
        !shareTokenSchema.safeParse(token).success
      )
        return null;
      return new URL(`/s/${token}`, this.options.siteUrl).href;
    } catch {
      // Key replacement permits revocation/rotation, never a plaintext fallback.
      return null;
    }
  }
  private async target(trx: Knex.Transaction, target: ShareTarget) {
    const row = await trx(target.kind === "note" ? "memories" : "projects")
      .where({ id: target.id })
      .first();
    if (!row) throw missing();
    return {
      ...target,
      name:
        target.kind === "note"
          ? sharedNoteTitle(row.content)
          : (row.name as string),
      version: row.version as number,
      projectId:
        target.kind === "note" ? (row.projectId as string | null) : target.id,
      eligible:
        target.kind === "notebook" ||
        (row.status === "active" &&
          (!row.expiresAt || new Date(row.expiresAt) > new Date())),
    };
  }
  private direct(trx: Knex.Transaction, target: ShareTarget) {
    return trx<ShareRow>("public_shares")
      .where(
        target.kind === "note"
          ? { memoryId: target.id }
          : { projectId: target.id },
      )
      .first();
  }
  private async state(
    trx: Knex.Transaction,
    target: ShareTarget,
  ): Promise<ShareState> {
    const current = await this.target(trx, target);
    const direct = await this.direct(trx, target);
    const live = direct ? await active(trx, direct) : false;
    const notebooks = await trx("projects").select("id", "parentId", "name");
    const ancestors = new Set<string>();
    let parent: string | null = current.projectId;
    while (parent && !ancestors.has(parent)) {
      ancestors.add(parent);
      parent = notebooks.find((p) => p.id === parent)?.parentId ?? null;
    }
    const inherited = ancestors.size
      ? await trx<ShareRow>("public_shares")
          .whereIn("projectId", [...ancestors])
          .whereNull("revokedAt")
          .where((query) =>
            query
              .whereNull("expiresAt")
              .orWhere("expiresAt", ">", trx.raw("clock_timestamp()")),
          )
      : [];
    return {
      available: !!this.options.key,
      canShare: current.eligible,
      target: { ...target, name: current.name, version: current.version },
      direct: direct
        ? {
            id: direct.id,
            version: direct.version,
            active: live,
            includeDescendants: direct.includeDescendants,
            duration: direct.duration,
            expiresAt: direct.expiresAt?.toISOString() ?? null,
            url: live ? this.url(direct) : null,
          }
        : null,
      inherited: inherited
        .filter(
          (s) =>
            s.id !== direct?.id &&
            (s.includeDescendants ||
              (target.kind === "note" && s.projectId === current.projectId)),
        )
        .map((s) => ({
          id: s.id,
          projectId: s.projectId!,
          name: notebooks.find((p) => p.id === s.projectId)!.name as string,
        })),
    };
  }
  get(principal: Principal, target: ShareTarget) {
    return this.service.access(principal, "admin", ({ trx }) =>
      this.state(trx, target),
    );
  }
  private async operation(
    trx: Knex.Transaction,
    accountId: string,
    input: ShareMutation | ShareEnable,
    identity: object,
    run: () => Promise<ShareRow>,
  ) {
    // access(admin) already holds the account lock, including across retries.
    const fingerprint = hash(JSON.stringify({ ...identity, ...input }));
    const previous = await trx("public_share_operations")
      .where({ id: input.operationId })
      .first();
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new GroveError(
          "operation_conflict",
          "Operation ID was already used for a different request",
          409,
        );
      const row = await trx<ShareRow>("public_shares")
        .where({ id: previous.shareId })
        .first();
      if (!row || row.version !== previous.version) throw conflict();
      return row;
    }
    const row = await run();
    await trx("public_share_operations").insert({
      accountId,
      id: input.operationId,
      fingerprint,
      shareId: row.id,
      version: row.version,
    });
    return row;
  }
  enable(principal: Principal, target: ShareTarget, input: ShareEnable) {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      this.key();
      const duration = input.duration ?? null;
      const current = await this.target(trx, target);
      if (!current.eligible)
        throw new GroveError(
          "inactive_note",
          "Restore this note before sharing it",
          409,
        );
      if (target.kind === "note" && input.includeDescendants)
        throw new GroveError(
          "invalid_request",
          "Sub-notebook sharing applies only to notebooks",
        );
      const row = await this.operation(
        trx,
        account.id,
        input,
        { action: "enable", ...target },
        async () => {
          const existing = await this.direct(trx, target);
          const live = existing ? await active(trx, existing) : false;
          if (current.version !== input.expectedTargetVersion) throw conflict();
          // Simultaneous first enables converge without changing another tab's scope.
          if (
            existing &&
            live &&
            input.expectedVersion === 0 &&
            existing.includeDescendants === input.includeDescendants &&
            existing.duration === duration
          )
            return existing;
          if ((existing?.version ?? 0) !== input.expectedVersion)
            throw conflict();
          if (existing && live) {
            if (
              existing.includeDescendants !== input.includeDescendants ||
              existing.duration !== duration
            )
              throw conflict();
            return existing;
          }
          const identity = {
            id: existing?.id ?? randomUUID(),
            accountId: account.id,
          };
          const fields = {
            ...this.token(identity),
            revokedAt: null,
            includeDescendants: input.includeDescendants,
            duration,
            expiresAt: expiration(trx, duration),
            updatedAt: trx.fn.now(),
          };
          if (existing)
            return (
              await trx<ShareRow>("public_shares")
                .where({ id: existing.id })
                .update({ ...fields, version: existing.version + 1 })
                .returning("*")
            )[0]!;
          return (
            await trx<ShareRow>("public_shares")
              .insert({
                ...identity,
                ...fields,
                memoryId: target.kind === "note" ? target.id : null,
                projectId: target.kind === "notebook" ? target.id : null,
              })
              .returning("*")
          )[0]!;
        },
      );
      return this.state(trx, targetFor(row));
    });
  }
  change(
    principal: Principal,
    id: string,
    action: "scope" | "rotate" | "revoke",
    input: ShareMutation & {
      includeDescendants?: boolean;
      duration?: ShareDuration | null;
    },
  ) {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const row = await this.operation(
        trx,
        account.id,
        input,
        { action, id },
        async () => {
          const old = await trx<ShareRow>("public_shares")
            .where({ id })
            .first();
          if (!old) throw missing();
          if (old.version !== input.expectedVersion) throw conflict();
          if (action !== "revoke") {
            this.key();
            if (!(await active(trx, old))) throw conflict();
            const current = await this.target(trx, targetFor(old));
            if (!current.eligible)
              throw new GroveError(
                "inactive_note",
                "Restore this note before sharing it",
                409,
              );
          }
          if (
            action === "scope" &&
            ((old.memoryId && input.includeDescendants === true) ||
              (input.includeDescendants === undefined &&
                input.duration === undefined))
          )
            throw new GroveError(
              "invalid_request",
              "Choose valid sharing settings",
            );
          if (action === "revoke" && old.revokedAt) return old;
          const changes =
            action === "revoke"
              ? {
                  revokedAt: trx.fn.now(),
                  tokenDigest: null,
                  tokenCiphertext: null,
                }
              : action === "rotate"
                ? this.token(old)
                : {
                    ...(input.includeDescendants === undefined
                      ? {}
                      : { includeDescendants: input.includeDescendants }),
                    ...(input.duration === undefined ||
                    input.duration === old.duration
                      ? {}
                      : {
                          duration: input.duration,
                          expiresAt: expiration(trx, input.duration),
                        }),
                  };
          const update = trx<ShareRow>("public_shares").where({ id });
          if (action !== "revoke")
            update.where((query) =>
              query
                .whereNull("expiresAt")
                .orWhere("expiresAt", ">", trx.raw("clock_timestamp()")),
            );
          const [updated] = await update
            .update({
              ...changes,
              version: old.version + 1,
              updatedAt: trx.fn.now(),
            })
            .returning("*");
          if (!updated) throw conflict();
          return updated;
        },
      );
      return this.state(trx, targetFor(row));
    });
  }
  private sign(value: string) {
    return createHmac("sha256", this.service.cursorSecret)
      .update(`public-sharing-v1:${value}`)
      .digest();
  }
  async read(
    token: string,
    kind: "root" | "note" | "notebook" = "root",
    id?: string,
    query: { cursor?: string; limit?: number } = {},
  ): Promise<PublicShare> {
    this.key();
    // A database-wide admission bucket also bounds invalid-token requests across
    // replicas, without accepting spoofable forwarded IPs or using owner quotas.
    const admitted = await this.service.db.raw(
      "SELECT grove_share_admit('global') AS allowed",
    );
    if (!admitted.rows[0].allowed) throw limited();
    if (
      !shareTokenSchema.safeParse(token).success ||
      (kind !== "root" && !uuidSchema.safeParse(id).success)
    )
      throw missing();
    const { cursor, limit } = publicShareQuerySchema.parse(query);
    const tokenDigest = hash(token);
    const scope = `${kind}:${id ?? ""}:${limit}`;
    let after: string | null = null,
      shareId: string | null = null,
      version: number | null = null;
    if (cursor) {
      try {
        const [payload, signature, extra] = cursor.split(".");
        if (!payload || !signature || extra) throw new Error();
        const bytes = Buffer.from(signature, "base64url");
        if (bytes.length !== 32 || !timingSafeEqual(bytes, this.sign(payload)))
          throw new Error();
        const value = JSON.parse(
          Buffer.from(payload, "base64url").toString("utf8"),
        );
        if (
          value.tokenDigest !== tokenDigest ||
          value.scope !== scope ||
          !Number.isSafeInteger(value.version) ||
          value.version < 1
        )
          throw new Error();
        after = uuidSchema.parse(value.after);
        shareId = uuidSchema.parse(value.shareId);
        version = value.version;
      } catch {
        throw new GroveError(
          "invalid_cursor",
          "Reload this shared notebook to continue",
          400,
        );
      }
    }
    const result = await this.service.db.transaction(async (trx) => {
      await trx.raw("SET LOCAL statement_timeout = '5000ms'");
      const { rows } = await trx.raw(
        "SELECT grove_public_share(?, ?, ?::uuid, ?::uuid, ?::uuid, ?, ?) AS value",
        [tokenDigest, kind, id ?? null, after, shareId, version, limit],
      );
      return rows[0].value;
    });
    if (!result) throw missing();
    if (result.limited) throw limited();
    if (result.stale)
      throw new GroveError(
        "invalid_cursor",
        "Sharing changed. Reload this notebook to continue",
        400,
      );
    let nextCursor: string | null = null;
    if (result.notes.length > limit) {
      result.notes = result.notes.slice(0, limit);
      const payload = Buffer.from(
        JSON.stringify({
          tokenDigest,
          scope,
          shareId: result.shareId,
          version: result.shareVersion,
          after: result.notes.at(-1).id,
        }),
      ).toString("base64url");
      nextCursor = `${payload}.${this.sign(payload).toString("base64url")}`;
    }
    const { shareId: _shareId, shareVersion: _shareVersion, ...data } = result;
    return publicShareSchema.parse({ ...data, nextCursor });
  }
}
