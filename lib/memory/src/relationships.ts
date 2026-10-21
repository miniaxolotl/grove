import { createHmac, timingSafeEqual } from "node:crypto";
import type { MemoryService } from "./index.ts";
import { GroveError, type Principal } from "@lib/shared/contracts";
import type {
  ConnectionLevel,
  ConnectionPage,
  ConnectionQuery,
  ConnectionReview,
} from "@lib/shared/relationships";
import {
  activeNotes,
  currentRelationshipProfile,
  presentRelationships,
  relationHash,
  relationshipTable,
  type RelationshipRow,
} from "./relationship-data.ts";

const unavailable = () =>
  new GroveError("not_found", "Connection unavailable", 404);
export class Relationships {
  constructor(private service: MemoryService) {}
  async list(
    principal: Principal,
    input: ConnectionQuery,
  ): Promise<ConnectionPage> {
    return this.service.access(
      principal,
      "memory:read",
      async ({ trx, grant, account }) => {
        const profile = currentRelationshipProfile(this.service.providers);
        if (!account.organizeEnabled || !profile)
          return { items: [], nextCursor: null, status: "disabled" };
        const allowed = (id: string | null) =>
          !grant ||
          (id === null
            ? grant.personal
            : grant.allProjects || grant.projectIds.includes(id));
        if (input.endpointId) {
          const endpoint =
            input.level === "note"
              ? await activeNotes(trx).findById(input.endpointId)
              : await trx("projects").where({ id: input.endpointId }).first();
          if (
            !endpoint ||
            !allowed(input.level === "note" ? endpoint.projectId : endpoint.id)
          )
            throw unavailable();
        }
        const { cursor, ...filters } = input;
        const binding = relationHash([
          principal.accountId,
          principal.connectionId,
          filters,
        ]);
        let after = "";
        if (cursor) {
          try {
            const [encoded, signature] = cursor.split(".");
            const expected = createHmac("sha256", this.service.cursorSecret)
              .update(encoded)
              .digest("hex");
            if (
              signature?.length !== expected.length ||
              !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
            )
              throw new Error();
            const value = JSON.parse(
              Buffer.from(encoded, "base64url").toString(),
            );
            if (value.binding !== binding || typeof value.after !== "string")
              throw new Error();
            after = value.after;
          } catch {
            throw new GroveError(
              "invalid_cursor",
              "Reopen connections to continue",
              400,
            );
          }
        }
        const q = trx<RelationshipRow>(relationshipTable(input.level))
          .where({ profile })
          .orderBy("id");
        if (grant)
          for (const column of ["left_id", "right_id"]) {
            const endpoint = trx(
              input.level === "note" ? "memories as e" : "projects as e",
            )
              .select(trx.raw("1"))
              .whereRaw(
                `e.id = ${relationshipTable(input.level)}.${column} AND e.account_id = ${relationshipTable(input.level)}.account_id`,
              );
            if (input.level === "notebook") {
              if (!grant.allProjects)
                endpoint.whereIn("e.id", grant.projectIds);
            } else
              endpoint.where((scope) => {
                scope.whereRaw("false");
                if (grant.personal) scope.orWhereNull("e.projectId");
                if (grant.allProjects) scope.orWhereNotNull("e.projectId");
                else if (grant.projectIds.length)
                  scope.orWhereIn("e.projectId", grant.projectIds);
              });
            q.whereExists(endpoint);
          }
        if (after) q.where("id", ">", after);
        if (input.endpointId)
          q.where((b) =>
            b
              .where("leftId", input.endpointId!)
              .orWhere("rightId", input.endpointId!),
          );
        if (input.endpointIds)
          q.whereIn("leftId", input.endpointIds).whereIn(
            "rightId",
            input.endpointIds,
          );
        if (!input.includeDismissed)
          q.whereRaw("dismissed_revision IS DISTINCT FROM revision");
        // Scan a bounded window; the cursor advances over filtered stale rows too.
        const rows = await q.limit(200);
        const current = await presentRelationships(
          trx,
          input.level,
          rows,
          allowed,
        );
        const items = current.slice(0, input.limit);
        const last =
          current.length > input.limit ? items.at(-1)!.id : rows.at(-1)?.id;
        const more = current.length > input.limit || rows.length === 200;
        const encoded = Buffer.from(
          JSON.stringify({ binding, after: last }),
        ).toString("base64url");
        const jobs = trx("jobs")
          .where({ profile })
          .whereIn(
            "kind",
            input.level === "note"
              ? ["relationship_scan", "note_relationship"]
              : ["notebook_profile", "notebook_relationship"],
          );
        if (input.endpointId)
          jobs.where((b) =>
            b
              .where("target", input.endpointId!)
              .orWhereRaw("scope->>'leftId' = ? OR scope->>'rightId' = ?", [
                input.endpointId!,
                input.endpointId!,
              ]),
          );
        const pending = grant ? [] : await jobs.select("failedAt");
        return {
          items,
          nextCursor: more
            ? `${encoded}.${createHmac("sha256", this.service.cursorSecret).update(encoded).digest("hex")}`
            : null,
          status: pending.some((j) => j.failedAt)
            ? "failed"
            : pending.length
              ? "pending"
              : "ready",
        };
      },
    );
  }
  async review(
    principal: Principal,
    level: ConnectionLevel,
    id: string,
    input: ConnectionReview,
  ) {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const table = relationshipTable(level);
      const row = await trx<RelationshipRow>(table)
        .where({ id })
        .forUpdate()
        .first();
      if (
        !row ||
        !account.organizeEnabled ||
        row.profile !== currentRelationshipProfile(this.service.providers)
      )
        throw unavailable();
      const current = (await presentRelationships(trx, level, [row]))[0];
      if (!current || current.revision !== input.expectedRevision)
        throw new GroveError(
          "relationship_changed",
          "These notes changed. Refresh the connection before reviewing it.",
          409,
        );
      const fingerprint = relationHash([level, id, input]);
      const previous = await trx("memory_operations")
        .where({ id: input.operationId })
        .first();
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new GroveError(
            "operation_conflict",
            "Operation already used",
            409,
          );
        return previous.result as { reviewVersion: number; dismissed: boolean };
      }
      if (row.reviewVersion !== input.expectedReviewVersion)
        throw new GroveError(
          "relationship_changed",
          "This connection was reviewed elsewhere. Refresh it.",
          409,
        );
      const result = {
        reviewVersion: row.reviewVersion + 1,
        dismissed: input.dismissed,
      };
      await trx(table)
        .where({ id })
        .update({
          dismissedRevision: input.dismissed ? row.revision : null,
          reviewVersion: result.reviewVersion,
        });
      await trx("memory_operations").insert({
        accountId: account.id,
        id: input.operationId,
        fingerprint,
        result: JSON.stringify(result),
      });
      return result;
    });
  }
}
