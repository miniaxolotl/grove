import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { MemoryModel, tenant, camelRows, type Knex } from "@lib/database";
import { policy } from "@lib/config";
import {
  GroveError,
  capabilities,
  type Capability,
  type Grant,
  type Memory,
  type MemoryList,
  type Principal,
  type Recall,
  type RecallResult,
  type Remember,
  type Page,
} from "@lib/shared/contracts";

export type Embedder = {
  profile: string;
  embed(text: string): Promise<number[]>;
};
type Connection = Omit<Grant, "expiresAt"> & {
  id: string;
  accountId: string;
  revokedAt: Date | null;
  expiresAt: string | null;
  clientId: string | null;
  authorizedAfter: Date;
};
type Account = {
  id: string;
  clerkSubject: string;
  status: string;
  contentVersion: number;
  captureEnabled: boolean;
  recallEnabled: boolean;
};
type Access = { trx: Knex.Transaction; account: Account; grant?: Connection };
type Job = {
  id: string;
  accountId: string;
  memoryId: string;
  version: number;
  leaseId: string;
  attempts: number;
};
const missing = () => new GroveError("not_found", "Memory not found", 404);
const forbidden = () =>
  new GroveError(
    "forbidden",
    "This connection does not grant that access",
    403,
  );
const iso = (value: Date | string | null) =>
  value === null ? null : new Date(value).toISOString();
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)),
        )
      : entry,
  );
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class MemoryService {
  constructor(
    readonly db: Knex,
    readonly cursorSecret: string,
    readonly embedder?: Embedder,
  ) {}

  async access<T>(
    principal: Principal,
    capability: Capability | "admin" | "self" | null,
    run: (access: Access) => Promise<T>,
  ): Promise<T> {
    return tenant(this.db, principal.accountId, async (trx) => {
      const accountQuery = trx<Account>("accounts").where({
        id: principal.accountId,
      });
      const account = await (
        capability === null || capability === "memory:read"
          ? accountQuery.forShare()
          : accountQuery.forUpdate()
      ).first();
      if (!account || account.status !== "active")
        throw new GroveError(
          "account_unavailable",
          "This account is unavailable",
          403,
        );
      if (principal.sessionId) {
        const result = await trx.raw(
          "SELECT grove_session_revoked(?) AS revoked",
          [principal.sessionId],
        );
        if (result.rows[0].revoked)
          throw new GroveError("unauthorized", "Session revoked", 401);
      }
      let grant: Connection | undefined;
      if (principal.type !== "session") {
        if (!principal.connectionId)
          throw new GroveError(
            "connection_required",
            "Approve this connection in Grove Connections",
            403,
          );
        const connectionQuery = trx<Connection>("connections").where({
          id: principal.connectionId,
        });
        grant = await (
          principal.type === "key"
            ? connectionQuery.forUpdate()
            : connectionQuery.forShare()
        ).first();
        if (
          !grant ||
          grant.revokedAt ||
          (grant.expiresAt && new Date(grant.expiresAt) <= new Date())
        )
          throw forbidden();
        if (
          principal.type === "oauth" &&
          (principal.clientId !== grant.clientId ||
            !Number.isFinite(principal.issuedAt) ||
            principal.issuedAt! < new Date(grant.authorizedAfter).getTime())
        )
          throw new GroveError(
            "connection_revoked",
            "Reconnect and approve this client in Grove Connections",
            403,
          );
        if (principal.type === "key")
          await trx("connections")
            .where({ id: grant.id })
            .update({ lastUsedAt: trx.fn.now() });
      }
      if (capability === "admin" && principal.type !== "session")
        throw forbidden();
      if (
        capability &&
        capability !== "admin" &&
        capability !== "self" &&
        (!principal.capabilities.includes(capability) ||
          (grant && !grant.capabilities.includes(capability)))
      )
        throw forbidden();
      const { rows } = await trx.raw(
        `INSERT INTO rate_buckets(account_id, minute, count) VALUES (?, date_trunc('minute', now()), 1)
        ON CONFLICT (account_id, minute) DO UPDATE SET count = rate_buckets.count + 1 RETURNING count`,
        [account.id],
      );
      // Commit the rate counter even when over limit by returning the error after the transaction.
      if (rows[0].count > policy.requestsPerMinute)
        return new GroveError(
          "rate_limited",
          "Too many requests; retry in one minute",
          429,
        ) as T;
      return run({ trx, account, grant });
    }).then((result) => {
      if (result instanceof GroveError) throw result;
      return result;
    });
  }

  private scope(grant: Connection | undefined, projectId: string | null) {
    if (
      grant &&
      (projectId === null
        ? !grant.personal
        : !(grant.allProjects || grant.projectIds.includes(projectId)))
    )
      throw forbidden();
  }

  private query(trx: Knex.Transaction, grant?: Connection) {
    const q = MemoryModel.query(trx);
    if (grant)
      q.where((scope) => {
        scope.whereRaw("false");
        if (grant.personal) scope.orWhereNull("projectId");
        if (grant.allProjects) scope.orWhereNotNull("projectId");
        else if (grant.projectIds.length)
          scope.orWhereIn("projectId", grant.projectIds);
      });
    return q;
  }

  private async present(
    trx: Knex.Transaction,
    row: MemoryModel,
  ): Promise<Memory> {
    const ready = await trx("memory_embeddings")
      .where({
        memoryId: row.id,
        version: row.version,
        profile: this.embedder?.profile ?? policy.embeddingProfile,
      })
      .first("memoryId");
    const failed =
      !ready &&
      (await trx("jobs")
        .where({ memoryId: row.id, version: row.version })
        .whereNotNull("failedAt")
        .first("id"));
    return {
      id: row.id,
      projectId: row.projectId,
      content: row.content,
      kind: row.kind,
      status: row.status,
      version: row.version,
      source: row.source,
      taskId: row.taskId,
      expiresAt: iso(row.expiresAt),
      purgeAt: iso(row.purgeAt),
      createdAt: iso(row.createdAt)!,
      updatedAt: iso(row.updatedAt)!,
      indexing: ready ? "ready" : failed ? "failed" : "pending",
    };
  }

  private async operation<T>(
    trx: Knex.Transaction,
    accountId: string,
    id: string,
    input: unknown,
    run: () => Promise<T>,
  ): Promise<T> {
    const fingerprint = digest(stable(input));
    await trx.raw("SELECT pg_advisory_xact_lock(hashtextextended(?, 2))", [
      `${accountId}:${id}`,
    ]);
    const previous = await trx("memory_operations").where({ id }).first();
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new GroveError(
          "operation_conflict",
          "Operation ID was already used for a different request",
          409,
        );
      return previous.result as T;
    }
    const result = await run();
    await trx("memory_operations").insert({
      accountId,
      id,
      fingerprint,
      result: JSON.stringify(result),
    });
    return result;
  }

  private async changed(trx: Knex.Transaction, accountId: string) {
    await trx("accounts")
      .where({ id: accountId })
      .increment("contentVersion", 1);
  }

  private async revise(trx: Knex.Transaction, row: MemoryModel) {
    await trx("memory_revisions").insert({
      accountId: row.accountId,
      memoryId: row.id,
      version: row.version,
      content: row.content,
      source: JSON.stringify(row.source),
    });
    await trx("jobs").where({ memoryId: row.id }).delete();
    await trx("memory_embeddings").where({ memoryId: row.id }).delete();
    await trx("jobs").insert({
      accountId: row.accountId,
      memoryId: row.id,
      version: row.version,
    });
    await this.changed(trx, row.accountId);
  }

  async me(principal: Principal) {
    return this.access(principal, null, async ({ account, grant }) => ({
      accountId: account.id,
      type: principal.type,
      connectionId: grant?.id ?? null,
      capabilities: principal.capabilities.filter(
        (c) => !grant || grant.capabilities.includes(c),
      ),
      contentVersion: account.contentVersion,
      captureEnabled: account.captureEnabled,
      recallEnabled: account.recallEnabled,
      grant: grant
        ? {
            personal: grant.personal,
            allProjects: grant.allProjects,
            projectIds: grant.projectIds,
          }
        : null,
      apiVersion: 1,
    }));
  }

  async remember(principal: Principal, input: Remember) {
    return this.access(
      principal,
      "memory:write",
      async ({ trx, account, grant }) => {
        if (input.capture === "automatic" && !account.captureEnabled)
          throw new GroveError(
            "capture_paused",
            "Automatic capture is paused for this account",
            403,
          );
        this.scope(grant, input.projectId);
        if (
          input.projectId &&
          !(await trx("projects").where({ id: input.projectId }).first("id"))
        )
          throw new GroveError("not_found", "Project not found", 404);
        const result = await this.operation(
          trx,
          account.id,
          input.operationId,
          { action: "remember", ...input },
          async () => {
            if (input.id) {
              const old = await this.query(trx, grant)
                .findById(input.id)
                .forUpdate();
              if (!old) throw missing();
              if (old.version !== input.expectedVersion)
                throw new GroveError(
                  "version_conflict",
                  "Memory changed; read it again before correcting",
                  409,
                );
            } else if (input.taskId) {
              const existing = await this.query(trx, grant)
                .where({ projectId: input.projectId, taskId: input.taskId })
                .first();
              if (existing)
                throw new GroveError(
                  "version_conflict",
                  `Handoff already exists; correct memory ${existing.id} with its current version`,
                  409,
                );
            }
            if (!input.id) {
              const total = await trx("memories").count("id as count").first();
              if (Number(total?.count) >= policy.maxMemories)
                throw new GroveError(
                  "storage_limit",
                  "Memory limit reached",
                  429,
                );
            }
            const handoff = input.kind === "handoff";
            const values = {
              accountId: account.id,
              projectId: input.projectId,
              content: input.content,
              kind: input.kind,
              source: input.source,
              taskId: input.taskId ?? null,
              expiresAt: handoff ? trx.raw("now() + interval '30 days'") : null,
              purgeAt: handoff ? trx.raw("now() + interval '90 days'") : null,
              updatedAt: trx.fn.now(),
            };
            const row = input.id
              ? await MemoryModel.query(trx).patchAndFetchById(input.id, {
                  ...values,
                  version: input.expectedVersion! + 1,
                })
              : await MemoryModel.query(trx).insertAndFetch({
                  ...values,
                  id: randomUUID(),
                  status: input.archived ? "archived" : "active",
                });
            await this.revise(trx, row);
            return { id: row.id, version: row.version };
          },
        );
        const row = await this.query(trx, grant).findById(result.id);
        if (!row)
          throw new GroveError(
            "gone",
            "This saved memory has since been deleted",
            410,
          );
        return this.present(trx, row);
      },
    );
  }

  async get(principal: Principal, id: string) {
    return this.access(principal, "memory:read", async ({ trx, grant }) => {
      const row = await this.query(trx, grant).findById(id);
      if (!row) throw missing();
      return this.present(trx, row);
    });
  }

  async revisions(principal: Principal, id: string) {
    return this.access(principal, "memory:read", async ({ trx, grant }) => {
      if (!(await this.query(trx, grant).findById(id))) throw missing();
      return trx("memory_revisions")
        .where({ memoryId: id })
        .select("version", "content", "source", "createdAt")
        .orderBy("version", "desc")
        .limit(100);
    });
  }

  private encodeCursor(value: unknown) {
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${payload}.${createHmac("sha256", this.cursorSecret).update(payload).digest("base64url")}`;
  }
  private decodeCursor(
    cursor: string,
    binding: string,
  ): { after: string; ceiling: string } {
    try {
      const [payload, signature] = cursor.split(".");
      const expected = createHmac("sha256", this.cursorSecret)
        .update(payload)
        .digest();
      const actual = Buffer.from(signature, "base64url");
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new Error();
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
      if (
        decoded.binding !== binding ||
        typeof decoded.after !== "string" ||
        !Number.isFinite(Date.parse(decoded.ceiling))
      )
        throw new Error();
      return decoded;
    } catch {
      throw new GroveError(
        "invalid_cursor",
        "Cursor does not match this account or search",
        400,
      );
    }
  }

  async list(principal: Principal, input: MemoryList): Promise<Page<Memory>> {
    return this.access(principal, "memory:read", async ({ trx, grant }) => {
      const { cursor, limit, ...filters } = input;
      const binding = digest(
        stable({
          account: principal.accountId,
          connection: principal.connectionId,
          filters,
        }),
      );
      const page = cursor
        ? this.decodeCursor(cursor, binding)
        : { after: "", ceiling: new Date().toISOString() };
      const q = this.query(trx, grant)
        .where("createdAt", "<=", page.ceiling)
        .orderBy("id");
      if (page.after) q.where("id", ">", page.after);
      if (input.projectId !== undefined) {
        this.scope(grant, input.projectId);
        q.where({ projectId: input.projectId });
      }
      if (input.kind) q.where({ kind: input.kind });
      if (input.status === "active")
        q.where({ status: "active" }).where((b) =>
          b.whereNull("expiresAt").orWhere("expiresAt", ">", trx.fn.now()),
        );
      if (input.status === "archived") q.where({ status: "archived" });
      if (input.status === "expired")
        q.where({ status: "active" }).where("expiresAt", "<=", trx.fn.now());
      if (input.query)
        q.whereRaw("search @@ websearch_to_tsquery('english', ?)", [
          input.query,
        ]);
      const rows = await q.limit(limit + 1);
      const items = await Promise.all(
        rows.slice(0, limit).map((row) => this.present(trx, row)),
      );
      return {
        items,
        nextCursor:
          rows.length > limit
            ? this.encodeCursor({
                binding,
                ceiling: page.ceiling,
                after: items.at(-1)!.id,
              })
            : null,
      };
    });
  }

  async recall(principal: Principal, input: Recall): Promise<RecallResult> {
    // Authorize before sending text to inference. Reauthorize after asynchronous work.
    await this.access(principal, "memory:read", async ({ grant }) => {
      if (input.projectId) this.scope(grant, input.projectId);
    });
    let vector: number[] | undefined;
    if (input.query && this.embedder) {
      try {
        vector = await this.embedder.embed(input.query);
      } catch {
        /* explicit lexical degradation */
      }
    }
    return this.access(
      principal,
      "memory:read",
      async ({ trx, grant, account }) => {
        const base = () =>
          this.query(trx, grant)
            .where({ status: "active" })
            .where((b) =>
              b.whereNull("expiresAt").orWhere("expiresAt", ">", trx.fn.now()),
            )
            .where((b) => {
              b.whereRaw("false");
              if (input.projectId) b.orWhere("projectId", input.projectId);
              if (input.includePersonal && (!grant || grant.personal))
                b.orWhereNull("projectId");
            });
        let rows: MemoryModel[];
        if (!input.query) {
          rows = await base()
            .where((b) => {
              b.whereIn("kind", ["preference", "fact", "decision"]);
              if (input.taskId)
                b.orWhere({ kind: "handoff", taskId: input.taskId });
            })
            .orderBy("updatedAt", "desc")
            .limit(input.limit);
        } else {
          const lexical = await base()
            .whereRaw("search @@ websearch_to_tsquery('english', ?)", [
              input.query,
            ])
            .orderByRaw(
              "ts_rank_cd(search, websearch_to_tsquery('english', ?)) DESC",
              [input.query],
            )
            .limit(40);
          const semantic = vector
            ? await base()
                .whereRaw(
                  `EXISTS (SELECT 1 FROM memory_embeddings e WHERE e.account_id = memories.account_id
          AND e.memory_id = memories.id AND e.version = memories.version AND e.profile = ? AND (e.embedding <=> ?::vector) < 0.45)`,
                  [this.embedder!.profile, JSON.stringify(vector)],
                )
                .orderByRaw(
                  `(SELECT e.embedding <=> ?::vector FROM memory_embeddings e WHERE e.account_id = memories.account_id AND e.memory_id = memories.id AND e.version = memories.version AND e.profile = ?)`,
                  [JSON.stringify(vector), this.embedder!.profile],
                )
                .limit(40)
            : [];
          const candidates = new Map<
            string,
            { row: MemoryModel; score: number }
          >();
          for (const branch of [lexical, semantic])
            branch.forEach((row, i) => {
              candidates.set(row.id, {
                row,
                score: (candidates.get(row.id)?.score ?? 0) + 1 / (60 + i),
              });
            });
          rows = [...candidates.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, input.limit)
            .map((c) => c.row);
        }
        const seen = new Set<string>();
        let remaining = input.maxCharacters;
        const items: Memory[] = [];
        for (const row of rows) {
          const fingerprint = digest(row.content.trim().toLowerCase());
          const item = await this.present(trx, row);
          const cost = JSON.stringify(item).length;
          if (seen.has(fingerprint) || cost > remaining) continue;
          seen.add(fingerprint);
          remaining -= cost;
          items.push(item);
        }
        return {
          items,
          mode: !input.query ? "profile" : vector ? "hybrid" : "lexical",
          contentVersion: account.contentVersion,
        };
      },
    );
  }

  async lifecycle(
    principal: Principal,
    id: string,
    action: "archive" | "restore",
    input: {
      operationId: string;
      expectedVersion: number;
      revision?: number;
      durable?: boolean;
    },
  ) {
    return this.access(
      principal,
      "memory:write",
      async ({ trx, account, grant }) => {
        const result = await this.operation(
          trx,
          account.id,
          input.operationId,
          { action, id, ...input },
          async () => {
            const old = await this.query(trx, grant).findById(id).forUpdate();
            if (!old) throw missing();
            if (old.version !== input.expectedVersion)
              throw new GroveError(
                "version_conflict",
                "Memory changed; reload before continuing",
                409,
              );
            const historical = input.revision
              ? await trx("memory_revisions")
                  .where({ memoryId: id, version: input.revision })
                  .first()
              : undefined;
            if (input.revision && !historical) throw missing();
            const durable = old.kind === "handoff" && input.durable;
            const row = await MemoryModel.query(trx).patchAndFetchById(id, {
              version: old.version + 1,
              status: action === "archive" ? "archived" : "active",
              updatedAt: trx.fn.now(),
              content: historical?.content ?? old.content,
              source: historical?.source ?? old.source,
              ...(durable
                ? { kind: "fact", taskId: null, expiresAt: null, purgeAt: null }
                : old.kind === "handoff" && action === "restore"
                  ? {
                      expiresAt: trx.raw("now() + interval '30 days'"),
                      purgeAt: trx.raw("now() + interval '90 days'"),
                    }
                  : {}),
            });
            await this.revise(trx, row);
            return { id, version: row.version };
          },
        );
        const row = await this.query(trx, grant).findById(result.id);
        if (!row)
          throw new GroveError("gone", "Memory has since been deleted", 410);
        return this.present(trx, row);
      },
    );
  }

  async forget(
    principal: Principal,
    input: {
      operationId: string;
      items: { id: string; expectedVersion: number }[];
    },
  ) {
    return this.access(
      principal,
      "memory:delete",
      async ({ trx, account, grant }) =>
        this.operation(
          trx,
          account.id,
          input.operationId,
          { action: "forget", ...input },
          async () => {
            const results: {
              id: string;
              outcome: "deleted" | "not_found" | "version_conflict";
            }[] = [];
            for (const item of [...input.items].sort((a, b) =>
              a.id.localeCompare(b.id),
            )) {
              const row = await this.query(trx, grant)
                .findById(item.id)
                .forUpdate();
              if (!row) {
                results.push({ id: item.id, outcome: "not_found" });
                continue;
              }
              if (row.version !== item.expectedVersion) {
                results.push({ id: item.id, outcome: "version_conflict" });
                continue;
              }
              await trx("deleted_memories")
                .insert({ accountId: account.id, id: row.id })
                .onConflict(["accountId", "id"])
                .ignore();
              await MemoryModel.query(trx).deleteById(row.id);
              results.push({ id: row.id, outcome: "deleted" });
            }
            await this.changed(trx, account.id);
            return { results };
          },
        ),
    );
  }

  async projects(principal: Principal) {
    return this.access(principal, "memory:read", async ({ trx, grant }) => {
      const q = trx("projects")
        .select("id", "name", "identity", "createdAt")
        .orderBy("name")
        .limit(100);
      if (grant && !grant.allProjects) q.whereIn("id", grant.projectIds);
      return q;
    });
  }
  async project(
    principal: Principal,
    input: { name: string; identity: string },
    id?: string,
  ) {
    return this.access(
      principal,
      "memory:write",
      async ({ trx, account, grant }) => {
        if (id) {
          this.scope(grant, id);
          const [row] = await trx("projects")
            .where({ id })
            .update({ name: input.name })
            .returning(["id", "name", "identity"]);
          if (!row) throw new GroveError("not_found", "Project not found", 404);
          return row;
        }
        const existing = await trx("projects")
          .where({ identity: input.identity })
          .first();
        if (existing) {
          this.scope(grant, existing.id);
          return existing;
        }
        if (grant && !grant.allProjects) throw forbidden();
        const total = await trx("projects").count("id as count").first();
        if (Number(total?.count) >= policy.maxProjects)
          throw new GroveError("project_limit", "Project limit reached", 429);
        const [row] = await trx("projects")
          .insert({ ...input, accountId: account.id })
          .onConflict(["accountId", "identity"])
          .merge({ name: input.name })
          .returning(["id", "name", "identity"]);
        return row;
      },
    );
  }

  async connections(principal: Principal) {
    return this.access(principal, "admin", async ({ trx }) =>
      trx("connections").orderBy("createdAt", "desc").limit(100),
    );
  }
  async grant(
    principal: Principal,
    input: Grant,
    options: { id?: string; clientId?: string; key?: boolean } = {},
  ) {
    return this.access(principal, "admin", async ({ trx, account }) => {
      for (const id of input.projectIds)
        if (!(await trx("projects").where({ id }).first()))
          throw new GroveError("not_found", "Project not found", 404);
      if (input.expiresAt && new Date(input.expiresAt) <= new Date())
        throw new GroveError("invalid_request", "Expiry must be in the future");
      const values = {
        ...input,
        accountId: account.id,
        expiresAt: input.expiresAt ?? null,
      };
      let connection: Connection;
      if (options.id) {
        const old = await trx<Connection>("connections")
          .where({ id: options.id })
          .forUpdate()
          .first();
        if (!old)
          throw new GroveError("not_found", "Connection not found", 404);
        if (old.revokedAt && !old.clientId)
          throw new GroveError(
            "connection_revoked",
            "Revoked keys cannot be reactivated; create a new key",
            409,
          );
        [connection] = await trx<Connection>("connections")
          .where({ id: options.id })
          .update({
            ...values,
            revokedAt: null,
            ...(old.revokedAt
              ? {
                  authorizedAfter: trx.raw(
                    "date_trunc('second', now()) + interval '1 second'",
                  ),
                }
              : {}),
          })
          .returning("*");
      } else {
        [connection] = await trx<Connection>("connections")
          .insert({
            ...values,
            clientId: options.clientId ?? null,
            authorizedAfter: new Date(0),
          })
          .returning("*");
      }
      if (!options.key) return { connection };
      const id = randomUUID();
      const secret = `grv_${id}_${randomBytes(32).toString("base64url")}`;
      await trx("api_keys").insert({
        id,
        accountId: account.id,
        connectionId: connection.id,
        digest: digest(secret),
        prefix: secret.slice(0, 12),
      });
      return { connection, secret };
    });
  }
  async revoke(principal: Principal, id: string) {
    return this.access(principal, "admin", async ({ trx }) => {
      const count = await trx("connections")
        .where({ id })
        .update({ revokedAt: trx.fn.now() });
      if (!count)
        throw new GroveError("not_found", "Connection not found", 404);
      return { revoked: true };
    });
  }
  async revokeSelf(principal: Principal) {
    if (!principal.connectionId) throw forbidden();
    return this.access(principal, "self", async ({ trx }) => {
      await trx("connections")
        .where({ id: principal.connectionId })
        .update({ revokedAt: trx.fn.now() });
      return { revoked: true };
    });
  }
  async settings(
    principal: Principal,
    input: { captureEnabled: boolean; recallEnabled: boolean },
  ) {
    return this.access(principal, "admin", async ({ trx, account }) => {
      await trx("accounts").where({ id: account.id }).update(input);
      return input;
    });
  }
  async deleteAccount(principal: Principal) {
    return this.access(principal, "admin", async ({ trx, account }) => {
      await trx("accounts")
        .where({ id: account.id })
        .update({ status: "deleting", deletedAt: trx.fn.now() });
      await trx("connections").update({ revokedAt: trx.fn.now() });
      return { status: "deleting" };
    });
  }
  async exportPage(principal: Principal, after?: string) {
    return this.access(principal, "admin", async ({ trx }) => {
      const q = this.query(trx).orderBy("id").limit(50);
      if (after) q.where("id", ">", after);
      const rows = await q;
      return Promise.all(
        rows.map(async (row) => ({
          ...(await this.present(trx, row)),
          revisions: await trx("memory_revisions")
            .where({ memoryId: row.id })
            .select("version", "content", "source", "createdAt")
            .orderBy("version"),
        })),
      );
    });
  }

  async runJob(): Promise<boolean> {
    if (!this.embedder) return false;
    const job = camelRows<Job>(
      await this.db.raw("SELECT * FROM grove_claim_job()"),
    )[0];
    if (!job) return false;
    try {
      const content = await tenant(this.db, job.accountId, async (trx) => {
        const row = await MemoryModel.query(trx)
          .findById(job.memoryId)
          .where({ version: job.version });
        return row?.content;
      });
      if (!content) return true;
      const embedding = await this.embedder.embed(content);
      if (
        embedding.length !== policy.embeddingDimensions ||
        embedding.some((n) => !Number.isFinite(n))
      )
        throw new Error("invalid_embedding");
      await tenant(this.db, job.accountId, async (trx) => {
        const account = await trx("accounts")
          .where({ id: job.accountId, status: "active" })
          .forShare()
          .first();
        if (!account) return;
        const row = await MemoryModel.query(trx)
          .findById(job.memoryId)
          .where({ version: job.version })
          .forShare();
        const lease = await trx("jobs")
          .where({ id: job.id, leaseId: job.leaseId })
          .where("leaseUntil", ">", trx.fn.now())
          .forUpdate()
          .first();
        if (!row || !lease) return;
        await trx("memory_embeddings")
          .insert({
            accountId: job.accountId,
            memoryId: job.memoryId,
            version: job.version,
            profile: this.embedder!.profile,
            embedding: JSON.stringify(embedding),
          })
          .onConflict(["accountId", "memoryId", "version", "profile"])
          .merge(["embedding"]);
        await trx("jobs").where({ id: job.id, leaseId: job.leaseId }).delete();
      });
    } catch {
      await tenant(this.db, job.accountId, async (trx) => {
        await trx("jobs")
          .where({ id: job.id, leaseId: job.leaseId })
          .update({
            leaseId: null,
            leaseUntil: null,
            dueAt: trx.raw("now() + (? * interval '1 second')", [
              Math.min(3600, 2 ** job.attempts * 10),
            ]),
            errorCode: "embedding_unavailable",
            failedAt:
              job.attempts >= policy.jobMaxAttempts ? trx.fn.now() : null,
          });
      });
    }
    return true;
  }

  async maintenance(deleteIdentity: (subject: string) => Promise<void>) {
    const rows = camelRows<{
      id: string;
      status: string;
      clerkSubject: string;
      providerDeletedAt: Date | null;
    }>(await this.db.raw("SELECT * FROM grove_maintenance_accounts()"));
    for (const account of rows) {
      let identityDeleted = !!account.providerDeletedAt;
      if (account.status === "deleting" && !identityDeleted) {
        try {
          await deleteIdentity(account.clerkSubject);
          identityDeleted = true;
        } catch {
          /* Purge content while identity deletion retries. */
        }
      }
      await tenant(this.db, account.id, async (trx) => {
        const current = await trx("accounts")
          .where({ id: account.id })
          .forUpdate()
          .first();
        if (current.status === "deleting" || current.status === "deleted") {
          await trx("memories").delete();
          await trx("connections").delete();
          await trx("projects").delete();
          await trx("memory_operations").delete();
          await trx("rate_buckets").delete();
          const providerGone = identityDeleted || !!current.providerDeletedAt;
          await trx("accounts")
            .where({ id: account.id })
            .update({
              status: providerGone ? "deleted" : "deleting",
              ...(providerGone ? { providerDeletedAt: trx.fn.now() } : {}),
            });
        } else {
          const expired = await trx("memories")
            .where("purgeAt", "<=", trx.fn.now())
            .forUpdate()
            .select("id");
          for (const row of expired)
            await trx("deleted_memories")
              .insert({ accountId: account.id, id: row.id })
              .onConflict(["accountId", "id"])
              .ignore();
          await trx("memories")
            .whereIn(
              "id",
              expired.map((r) => r.id),
            )
            .delete();
          if (expired.length) await this.changed(trx, account.id);
        }
        await trx("rate_buckets")
          .where("minute", "<", trx.raw("now() - interval '1 day'"))
          .delete();
      });
    }
  }
}

export const sessionPrincipal = (
  accountId: string,
  subject: string,
): Principal => ({
  accountId,
  subject,
  type: "session",
  capabilities: [...capabilities],
});
