import { randomUUID } from "node:crypto";
import { reserveAction, settleNamedAction } from "./billing-quotas.ts";
import type { Knex } from "@lib/database";
import { GroveError, type Principal } from "@lib/shared/contracts";
import {
  assistancePreferences,
  type AssistanceRequest,
  type AssistanceApply,
  type AssistanceReview,
} from "@lib/shared/assistance";
import type { MemoryService } from "./index.ts";
import { activeNotes, relationHash } from "./relationship-data.ts";
import {
  applyNoteChanges,
  changedSources,
  type NoteWrite,
} from "./note-changes.ts";
import {
  assistanceProfile,
  presentAssistance,
  validAssistance,
  type AssistanceRow,
  type ScopeDependency,
} from "./assistance-data.ts";
import { redactDigest } from "./notebook-digests.ts";
import { workflowEvidence } from "./workflow-evidence.ts";
import { meetingHeadings, meetingItems } from "./assistance-meeting.ts";
import { workflowQuery } from "@lib/shared/notebook-workflows";

const missing = () => new GroveError("not_found", "Preview unavailable", 404);
const conflict = () =>
  new GroveError("preview_changed", "This preview changed. Reopen it.", 409);

export class NotebookAssistance {
  constructor(private service: MemoryService) {}
  async request(principal: Principal, input: AssistanceRequest) {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const fingerprint = relationHash(input);
      const old = await trx<AssistanceRow>("assistance_requests")
        .where({ id: input.id })
        .first();
      if (old) {
        if (old.fingerprint !== fingerprint) throw conflict();
        return this.read(trx, old);
      }
      const generation = this.service.providers.generation;
      if (!account[assistancePreferences[input.kind]] || !generation)
        throw new GroveError(
          "feature_disabled",
          "Enable this feature and a generation provider in Settings.",
          409,
        );
      const profiles = await this.service.jobProfiles?.(trx);
      if (
        profiles &&
        (profiles.generation !== generation.profile ||
          profiles.embedding !==
            (this.service.providers.embedding?.profile ?? null))
      )
        throw conflict();
      const refs = "sources" in input ? (input.sources ?? []) : [];
      const workflow =
        input.kind === "meeting"
          ? await workflowEvidence(trx, {
              ...input,
              query: workflowQuery(input),
            })
          : null;
      const sources =
        workflow?.sources ??
        (await activeNotes(trx).whereIn(
          "id",
          refs.map((r) => r.id),
        ));
      if (
        refs.some(
          (r) => !sources.some((n) => n.id === r.id && n.version === r.version),
        ) ||
        (input.kind === "filing" && sources[0].projectId !== null)
      )
        throw changedSources();
      const dependencies = sources.map(({ id, version, projectId }) => ({
        id,
        version,
        projectId,
      }));
      const scopes: ScopeDependency[] = [];
      if ("projectId" in input && input.projectId) {
        const project = await trx("projects")
          .where({ id: input.projectId })
          .first();
        if (!project) throw missing();
        scopes.push({
          id: project.id,
          version: project.version,
          ...(input.kind === "cleanup" || input.kind === "meeting"
            ? { contentVersion: project.contentVersion }
            : {}),
        });
      }
      if (input.kind === "digest") {
        const visit = await trx("notebook_visits")
          .where({ id: input.visitId })
          .first();
        if (
          !visit ||
          !(await trx("projects").where({ id: visit.projectId }).first("id"))
        )
          throw missing();
        scopes.push({ id: visit.projectId });
      }
      const expiry =
        input.kind === "filing" || input.kind === "cleanup"
          ? ((await activeNotes(trx)
              .modify((q) => {
                if (input.kind === "cleanup")
                  q.where({ projectId: input.projectId });
              })
              .min("expiresAt as expiresAt")
              .first()) as unknown as { expiresAt: Date | null })
          : {
              expiresAt:
                sources
                  .map((note) => note.expiresAt)
                  .filter((at): at is Date => !!at)
                  .sort(
                    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
                  )[0] ?? null,
            };
      const state = {
        ...(workflow ? { coverage: workflow.coverage } : {}),
        ...(input.kind === "filing"
          ? {
              accountVersion: account.contentVersion,
              catalogVersion: (
                await trx("accounts").where({ id: account.id }).first()
              ).notebookCatalogVersion,
            }
          : {}),
        ...(expiry?.expiresAt ? { expiresAt: expiry.expiresAt } : {}),
      };
      let expiresAt: Date | undefined;
      if (input.kind === "meeting") {
        const {
          rows: [clock],
        } = await trx.raw("SELECT now()+interval '30 days' AS deadline");
        expiresAt = new Date(
          Math.min(
            new Date(clock.deadline).getTime(),
            expiry?.expiresAt ? new Date(expiry.expiresAt).getTime() : Infinity,
          ),
        );
        state.expiresAt = expiresAt;
      }
      const profile = assistanceProfile(
        generation.profile,
        this.service.providers.embedding?.profile,
        input.kind,
      );
      await reserveAction(
        this.service.db,
        trx,
        account.id,
        "assistance",
        `assistance:${input.id}`,
      );
      await trx("assistance_requests").insert({
        accountId: account.id,
        id: input.id,
        kind: input.kind,
        input: JSON.stringify(input),
        fingerprint,
        profile,
        dependencies: JSON.stringify(dependencies),
        scopes: JSON.stringify(scopes),
        state: JSON.stringify(state),
        ...(expiresAt ? { expiresAt } : {}),
      });
      await trx("jobs").insert({
        id: randomUUID(),
        accountId: account.id,
        kind: "assistance",
        target: input.id,
        profile,
        scope: JSON.stringify({ feature: input.kind }),
        dueAt: trx.fn.now(),
      });
      return this.read(
        trx,
        (await trx<AssistanceRow>("assistance_requests")
          .where({ id: input.id })
          .first())!,
      );
    });
  }
  async get(principal: Principal, id: string) {
    return this.service.access(principal, "admin", async ({ trx }) => {
      const row = await trx<AssistanceRow>("assistance_requests")
        .where({ id })
        .first();
      if (!row) throw missing();
      return this.read(trx, row);
    });
  }
  async cancel(principal: Principal, id: string, expectedVersion: number) {
    return this.service.access(principal, "admin", async ({ trx }) => {
      const row = await trx<AssistanceRow>("assistance_requests")
        .where({ id })
        .first();
      if (!row || row.kind !== "meeting") throw missing();
      if (row.status === "cancelled" && row.version === expectedVersion + 1)
        return this.read(trx, row);
      if (row.status !== "pending" || row.version !== expectedVersion)
        throw conflict();
      await trx("jobs").where({ kind: "assistance", target: id }).delete();
      await settleNamedAction(
        trx,
        principal.accountId,
        "assistance",
        `assistance:${id}`,
        "released",
      );
      row.status = "cancelled";
      row.version++;
      row.result = null;
      row.state = {};
      row.error = "Brief cancelled. Start a new brief to try again.";
      await trx("assistance_requests").where({ id }).update({
        status: row.status,
        version: row.version,
        result: null,
        state: "{}",
        error: row.error,
      });
      return this.read(trx, row);
    });
  }
  private async read(trx: Knex.Transaction, row: AssistanceRow) {
    if (["ready", "pending"].includes(row.status)) {
      try {
        await this.checkProfile(trx, row);
        await validAssistance(trx, row);
        const job =
          row.status === "pending"
            ? await trx("jobs")
                .where({ kind: "assistance", target: row.id })
                .first()
            : undefined;
        if (row.status === "pending" && (!job || job.failedAt)) {
          row.status = "failed";
          row.error = "Preview interrupted. Try again.";
          await trx("assistance_requests")
            .where({ id: row.id })
            .update({ status: row.status, error: row.error });
        }
      } catch (error) {
        if (!(error instanceof GroveError) || error.code !== "sources_changed")
          throw error;
        row.status = "stale";
        row.result = null;
        row.error = "These notes changed. Refresh the preview.";
        await trx("assistance_requests").where({ id: row.id }).update({
          status: row.status,
          result: null,
          state: "{}",
          error: row.error,
        });
        await trx("jobs")
          .where({ kind: "assistance", target: row.id })
          .delete();
      }
    }
    if (row.result?.candidates) {
      const reviews = await trx("assistance_reviews").whereIn(
        "key",
        row.result.candidates.map((c) => c.key),
      );
      row.result.candidates = row.result.candidates.map((candidate) => {
        const review = reviews.find((r) => r.key === candidate.key);
        return {
          ...candidate,
          dismissed: review?.dismissed ?? false,
          reviewVersion: review?.version ?? 0,
        };
      });
    }
    if (row.kind === "digest") await redactDigest(trx, row);
    return presentAssistance(row);
  }
  private async checkProfile(trx: Knex.Transaction, row: AssistanceRow) {
    const { generation, embedding } = this.service.providers;
    const committed = await this.service.jobProfiles?.(trx);
    if (
      !generation ||
      row.profile !==
        assistanceProfile(generation.profile, embedding?.profile, row.kind) ||
      (committed &&
        (committed.generation !== generation.profile ||
          committed.embedding !== (embedding?.profile ?? null)))
    )
      throw changedSources();
  }
  async apply(
    principal: Principal,
    id: string,
    input: AssistanceApply,
    undo = false,
  ) {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const row = await trx<AssistanceRow>("assistance_requests")
        .where({ id })
        .first();
      if (!row) throw missing();
      const application = relationHash(input);
      if (undo ? row.status === "undone" : row.status === "applied") {
        if (!undo && row.application !== application) throw conflict();
        return this.read(trx, row);
      }
      if (
        row.version !== input.expectedVersion ||
        (undo
          ? row.status !== "applied" || !row.undo
          : row.status !== "ready" || !row.result)
      )
        throw conflict();
      if (!undo && !account[assistancePreferences[row.kind]])
        throw new GroveError(
          "feature_disabled",
          "This feature is turned off.",
          409,
        );
      let dependencies = row.dependencies;
      let writes: NoteWrite[];
      if (undo) {
        dependencies = row.applied;
        writes = row.undo!.map((before) => ({
          ...before,
          version: row.applied.find((r) => r.id === before.id)!.version,
        }));
      } else {
        await this.checkProfile(trx, row);
        await validAssistance(trx, row);
        if (
          row.input.kind !== "meeting" &&
          input.destinationProjectId !== undefined
        )
          throw conflict();
        if (row.input.kind === "meeting") {
          const brief = row.result?.meeting;
          if (
            !brief ||
            !meetingItems(brief).length ||
            input.action ||
            input.candidate ||
            input.edits
          )
            throw conflict();
          const content =
            `# ${row.input.title.replaceAll("\n", " ")}\n\n` +
            (row.input.meetingDate
              ? `Meeting date: ${row.input.meetingDate}\n\n`
              : "") +
            `Based on ${row.result!.coverage.examined} of ${row.result!.coverage.total} notes supplied as evidence. ` +
            (row.result!.coverage.partial
              ? "Partial coverage; other notes may contain relevant evidence.\n\n"
              : "\n\n") +
            (Object.keys(meetingHeadings) as (keyof typeof meetingHeadings)[])
              .map(
                (key) =>
                  `## ${meetingHeadings[key]}\n\n` +
                  (brief[key].length
                    ? brief[key]
                        .map(
                          (item) =>
                            `- ${item.text.replaceAll("\n", " ")} — ${item.sources.map((ref) => `[source](/app/memories/${ref.id}?revision=${ref.version})`).join(" · ")}`,
                        )
                        .join("\n")
                    : "No relevant recorded evidence found."),
              )
              .join("\n\n");
          if (content.length > 6000)
            throw new GroveError(
              "preview_too_long",
              "This brief is too long to save as one note.",
              400,
            );
          writes = [
            {
              content,
              projectId:
                input.destinationProjectId === undefined
                  ? row.input.projectId
                  : input.destinationProjectId,
            },
          ];
        } else if (row.input.kind === "actions") {
          const items = row.result!.items!;
          if (
            !items.length ||
            input.edits?.some(
              (edit, index, all) =>
                edit.index >= items.length ||
                all.findIndex((e) => e.index === edit.index) !== index,
            )
          )
            throw conflict();
          const content =
            "# Action list\n\n" +
            items
              .map((item, index) => {
                const edit = input.edits?.find((e) => e.index === index);
                const text = edit?.text ?? item.text;
                const changed = text !== item.text;
                const links = item.sources
                  .map(
                    (ref) =>
                      `[source](/app/memories/${ref.id}?revision=${ref.version})`,
                  )
                  .join(" · ");
                return `- [ ] ${text.replaceAll("\n", " ")}${changed ? " _(edited)_" : ` — ${links}`}`;
              })
              .join("\n");
          if (content.length > 6000)
            throw new GroveError(
              "preview_too_long",
              "Shorten the action list before saving.",
              400,
            );
          writes = [{ content, projectId: row.input.projectId }];
        } else if (row.kind === "filing") {
          const destination = row.result!.filing?.destination[0];
          if (!destination) throw conflict();
          writes = [{ ...row.dependencies[0], projectId: destination }];
        } else if (row.kind === "cleanup") {
          const candidate = row.result!.candidates?.find(
            (c) => c.key === input.candidate,
          );
          if (
            !candidate ||
            !input.action ||
            (candidate.kind === "superseded" && input.action !== "update")
          )
            throw conflict();
          dependencies = candidate.sources;
          writes = [
            { ...candidate.target, content: candidate.content },
            ...(input.action === "combine"
              ? candidate.sources
                  .filter((ref) => ref.id !== candidate.target.id)
                  .map((ref) => ({ ...ref, status: "archived" as const }))
              : []),
          ];
        } else throw conflict();
      }
      const applied = await applyNoteChanges(
        trx,
        account.id,
        dependencies,
        writes,
        this.service.revise.bind(this.service),
        { undo },
      );
      row.status = undo ? "undone" : "applied";
      row.version++;
      row.applied = applied.applied;
      row.result = null;
      row.state = {};
      await trx("assistance_requests")
        .where({ id })
        .update({
          status: row.status,
          version: row.version,
          applied: JSON.stringify(row.applied),
          result: null,
          state: "{}",
          application: undo ? row.application : application,
          undo: undo ? null : JSON.stringify(applied.originals),
          updatedAt: trx.fn.now(),
        });
      return this.read(trx, row);
    });
  }
  async review(principal: Principal, id: string, input: AssistanceReview) {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const row = await trx<AssistanceRow>("assistance_requests")
        .where({ id })
        .first();
      if (
        !row ||
        !row.result?.candidates?.some((c) => c.key === input.candidate)
      )
        throw missing();
      await validAssistance(trx, row);
      const old = await trx("assistance_reviews")
        .where({ key: input.candidate })
        .first();
      if (
        old?.version === input.expectedVersion + 1 &&
        old.dismissed === input.dismissed
      )
        return this.read(trx, row);
      if ((old?.version ?? 0) !== input.expectedVersion) throw conflict();
      await trx("assistance_reviews")
        .insert({
          accountId: account.id,
          key: input.candidate,
          version: input.expectedVersion + 1,
          dismissed: input.dismissed,
        })
        .onConflict(["accountId", "key"])
        .merge(["version", "dismissed"]);
      return this.read(trx, row);
    });
  }
}
