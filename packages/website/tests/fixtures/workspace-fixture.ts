import type { Page } from "@playwright/test";
import {
  organizeNotebookSchema,
  type NotebookCatalog,
  type NotebookOrganization,
} from "@lib/shared/notebook-organization";
import { conversationHistorySchema } from "@lib/shared/conversation-history";
import {
  listSchema,
  projectSchema,
  rememberSchema,
  versionSchema,
  type Memory,
} from "@lib/shared/contracts";
import { briefRequestSchema } from "@lib/shared/models";
import {
  connectionQuerySchema,
  connectionReviewSchema,
  type NoteConnection,
} from "@lib/shared/relationships";
import {
  conversationCreateSchema,
  conversationTurnSchema,
  askToolsPatchSchema,
  toolSettingsSchema,
  type Conversation,
} from "@lib/shared/conversations";
import { fixturePath, catalogResponse } from "./notebook-catalog";
import {
  applySourceEdits,
  sourceEditsBetween,
} from "@lib/shared/document-edits";

// Shared note-fixture harness for workspace browser specs. `note`, `handoff`
// and `project` are the default records; pass `initial` to override.
export const project = {
  id: "00000000-0000-4000-a000-000000000010",
  name: "Website redesign",
  identity: "git:github.com/example/website",
  parentId: null as string | null,
  version: 1,
  status: "active" as "active" | "archived",
};
export const note: Memory = {
  id: "00000000-0000-4000-a000-000000000011",
  projectId: null,
  content:
    "# Review preferences\n\nKeep feedback **specific** and include a working example.\n\n- [x] Read the change\n- [ ] Try the example\n\n```ts\nconst review = 'ready';\n```",
  kind: "preference",
  autoKind: false,
  status: "active",
  version: 1,
  source: {
    agent: "opencode",
    session: "source-session",
    verification: "Verified in the browser",
  },
  taskId: null,
  expiresAt: null,
  purgeAt: null,
  indexing: "ready",
  createdAt: "2026-10-18T10:00:00Z",
  updatedAt: "2026-10-19T10:00:00Z",
  enrichment: {
    title: "Review preferences",
    status: "ready",
    tags: ["workflow", "testing"],
    relationships: [],
    profiles: ["private-profile"],
  },
};
export const handoff: Memory = {
  ...note,
  id: "00000000-0000-4000-a000-000000000012",
  projectId: project.id,
  content:
    "# Launch checklist\n\n## Done\nNavigation and layout are ready.\n\n## Next\n- [ ] Review keyboard access",
  kind: "handoff",
  taskId: "agent-launch-task",
  expiresAt: "2027-01-01T10:00:00Z",
  purgeAt: "2027-03-01T10:00:00Z",
  enrichment: {
    ...note.enrichment!,
    title: "Launch checklist",
    tags: ["frontend"],
  },
};
export async function fixture(page: Page, initial = [note, handoff]) {
  const revisionGroups = new Map<
    string,
    {
      revision: number;
      firstVersion: number;
      saves: number;
      session?: string;
      open: boolean;
    }
  >();
  const records = new Map(
    initial.map((memory) => [memory.id, structuredClone(memory)]),
  );
  const projects: (typeof project & { position?: number })[] = [
    structuredClone(project),
  ];
  const organizationReceipts = new Map<
    string,
    { input: unknown; result: NotebookOrganization }
  >();
  const noteReceipts = new Map<string, { input: string; id: string }>();
  const catalog = () =>
    catalogResponse(
      "http://fixture/projects/catalog",
      projects,
    ) as NotebookCatalog;
  const revisions = new Map(
    initial.map((memory) => [memory.id, [structuredClone(memory)]]),
  );
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const chats = new Map<string, Conversation>();
  let toolDefaults = { exa: true, tavily: false, organize: true };
  const pairs = new Map<string, NoteConnection>();
  for (const memory of initial)
    for (const ref of memory.enrichment?.relationships ?? []) {
      const other = records.get(ref.id);
      if (
        !other ||
        other.version !== ref.version ||
        other.projectId !== memory.projectId ||
        ref.relationship === "unrelated"
      )
        continue;
      const [left, right] = [memory, other].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      const pair: NoteConnection = {
        id: crypto.randomUUID(),
        level: "note",
        from: {
          id: left.id,
          title: left.enrichment?.title ?? left.content.split("\n")[0],
        },
        to: {
          id: right.id,
          title: right.enrichment?.title ?? right.content.split("\n")[0],
        },
        type: ref.relationship,
        reason:
          ref.relationship === "conflicting"
            ? "These notes give different dates for the same launch review: October 30 and November 2."
            : ref.relationship === "duplicate"
              ? "Both notes record the same launch review requirement."
              : "Both describe launch review; the checklist adds keyboard verification.",
        basis:
          ref.relationship === "conflicting"
            ? "incompatible_claims"
            : ref.relationship === "duplicate"
              ? "same_information"
              : "additional_context",
        direction: "both",
        evidence: [left, right].map((n) => {
          const headingEnd = n.content.indexOf("\n\n");
          const start = headingEnd < 0 ? 0 : headingEnd + 2;
          const end = Math.min(n.content.length, start + 150);
          return {
            id: n.id,
            version: n.version,
            quote: n.content.slice(start, end),
            start,
            end,
            title: n.enrichment?.title ?? "Note",
            projectId: n.projectId,
          };
        }),
        coverage: {
          from: { total: 1, examined: 1, supporting: 1 },
          to: { total: 1, examined: 1, supporting: 1 },
        },
        breadth: "thread",
        revision: "a".repeat(64),
        reviewVersion: 0,
        dismissed: false,
        updatedAt: note.updatedAt,
      };
      pairs.set(pair.id, pair);
    }
  await page.route("**/api/grove/**", async (route) => {
    const request = route.request();
    const path = fixturePath(request.url()).replace("/api/grove", "");
    const body = request.postDataJSON();
    calls.push({ path, body });
    let data: unknown;
    const conflict = async () =>
      route.fulfill({
        status: 409,
        json: {
          success: false,
          error: {
            code: "version_conflict",
            message: "Memory changed; reload before continuing",
          },
        },
      });
    if (path === "/me") data = { plan: null };
    else if (path === "/relationships/search") {
      const input = connectionQuerySchema.parse(body);
      const items = [...pairs.values()].filter(
        (p) =>
          p.level === input.level &&
          (!p.dismissed || input.includeDismissed) &&
          (!input.connectionId || input.connectionId === p.id) &&
          (!input.endpointId ||
            [p.from.id, p.to.id].includes(input.endpointId)) &&
          (!input.endpointIds ||
            [p.from.id, p.to.id].every((id) =>
              input.endpointIds!.includes(id),
            )) &&
          p.evidence.every((e) => records.get(e.id)?.version === e.version),
      );
      const offset = Number(input.cursor ?? 0);
      data = {
        items: items.slice(offset, offset + input.limit),
        nextCursor:
          items.length > offset + input.limit
            ? String(offset + input.limit)
            : null,
        status: "ready",
      };
    } else if (/^\/relationships\/(note|notebook)\/[^/]+\/review$/.test(path)) {
      const input = connectionReviewSchema.parse(body);
      const pair = pairs.get(path.split("/")[3])!;
      if (
        pair.revision !== input.expectedRevision ||
        pair.reviewVersion !== input.expectedReviewVersion
      )
        return conflict();
      pair.dismissed = input.dismissed;
      pair.reviewVersion++;
      data = { reviewVersion: pair.reviewVersion, dismissed: pair.dismissed };
    } else if (path === "/ask-tools") {
      if (request.method() === "PATCH")
        toolDefaults = { ...toolDefaults, ...askToolsPatchSchema.parse(body) };
      data = {
        defaults: toolDefaults,
        available: { exa: true, tavily: true, organize: true },
        dailyCalls: 20,
      };
    } else if (path === "/conversations/search") {
      const input = conversationHistorySchema.parse(body);
      const matching = [...chats.values()]
        .reverse()
        .filter((chat) =>
          `${chat.title} ${chat.turns.map((turn) => turn.question).join(" ")}`
            .toLowerCase()
            .includes(input.query.toLowerCase()),
        );
      const after = Number(input.after ?? 0);
      data = {
        items: matching.slice(after, after + 30).map((chat) => ({
          id: chat.id,
          title: chat.title,
          scope: chat.scope,
          updatedAt: chat.updatedAt,
          version: chat.version,
          preview:
            chat.turns.find((turn) =>
              turn.question.toLowerCase().includes(input.query.toLowerCase()),
            )?.question ?? "",
          turnCount: chat.turns.length,
        })),
        nextCursor: matching.length > after + 30 ? String(after + 30) : null,
      };
    } else if (path === "/conversations") {
      if (request.method() === "POST") {
        const { id, ...scope } = conversationCreateSchema.parse(body);
        if (!chats.has(id))
          chats.set(id, {
            id,
            scope,
            title: "New conversation",
            tools: { ...toolDefaults },
            toolsVersion: 0,
            version: 0,
            updatedAt: new Date().toISOString(),
            turns: [],
          });
        data = chats.get(id);
      } else data = { items: [...chats.values()].reverse(), nextCursor: null };
    } else if (path.startsWith("/conversations/")) {
      const chat = chats.get(path.split("/")[2])!;
      if (path.endsWith("/tools")) {
        const input = toolSettingsSchema.parse(body);
        if (chat.toolsVersion !== input.expectedVersion) return conflict();
        chat.tools = input.tools;
        chat.toolsVersion++;
        if (input.saveDefault)
          toolDefaults = {
            ...toolDefaults,
            ...(input.defaultPatch ?? input.tools),
          };
        data = { ...chat, defaults: toolDefaults };
      } else if (request.method() === "DELETE") {
        chats.delete(chat.id);
        data = { deleted: true };
      } else if (path.endsWith("/turns")) {
        const input = conversationTurnSchema.parse(body);
        const sources = [...records.values()].filter(
          (n) =>
            chat.scope.projectId === undefined ||
            n.projectId === chat.scope.projectId ||
            (chat.scope.includePersonal && n.projectId === null),
        );
        if (!chat.turns.some((t) => t.id === input.id)) {
          chat.version++;
          if (chat.version === 1) chat.title = input.query;
          chat.turns.push({
            id: input.id,
            question: input.query,
            format: input.format,
            expectedVersion: input.expectedVersion,
            status: "ready",
            error: null,
            createdAt: new Date().toISOString(),
            result: {
              message: "",
              webStatements: [],
              statements: sources.length
                ? [
                    {
                      text:
                        input.query === "Wait for this"
                          ? "Stale answer"
                          : "Keep feedback specific and include a working example.",
                      sources: [
                        { id: sources[0].id, version: sources[0].version },
                      ],
                    },
                  ]
                : [],
              sources,
              proposal: /shorten|merge/i.test(input.query)
                ? {
                    kind: /merge/i.test(input.query) ? "merge" : "edit",
                    target: { id: sources[0].id, version: sources[0].version },
                    sources: sources
                      .slice(0, /merge/i.test(input.query) ? 2 : 1)
                      .map(({ id, version }) => ({ id, version })),
                    content:
                      "# Review preferences\n\nBe specific. Show an example.",
                    status: "proposed",
                  }
                : null,
            },
          });
        }
        data = chat;
      } else if (/\/(apply|undo)$/.test(path)) {
        const proposal = chat.turns.find((t) => t.id === path.split("/")[4])!
          .result!.proposal!;
        const source = records.get(proposal.target!.id)!;
        const undo = path.endsWith("/undo");
        if (
          source.version !==
          (undo ? proposal.applied![0].version : proposal.target!.version)
        )
          return conflict();
        records.set(source.id, {
          ...source,
          version: source.version + 1,
          content: undo ? note.content : proposal.content,
        });
        proposal.applied = [{ id: source.id, version: source.version + 1 }];
        proposal.status = undo ? "undone" : "applied";
        data = chat;
      } else data = chat;
    } else if (path === "/projects") {
      if (request.method() === "POST") {
        const input = projectSchema.parse(body);
        const created = {
          id: crypto.randomUUID(),
          ...input,
          parentId: input.parentId ?? null,
          version: 1,
          status: "active" as const,
        };
        projects.push(created);
        data = created;
      } else data = projects;
    } else if (/^\/projects\/[^/]+\/organize$/.test(path)) {
      const input = organizeNotebookSchema.parse(body);
      const receipt = organizationReceipts.get(input.operationId);
      const current = projects.find((p) => p.id === path.split("/")[2])!;
      if (receipt) {
        if (JSON.stringify(receipt.input) !== JSON.stringify(input))
          return conflict();
        data = receipt.result;
      } else {
        const before = catalog();
        if (
          input.expectedState !== before.state ||
          input.expectedVersion !== current.version
        )
          return conflict();
        const ordered = before.items
          .filter((p) => p.parentId === current.parentId)
          .sort((a, b) => a.position! - b.position!);
        const index = ordered.findIndex((p) => p.id === current.id);
        const undo = {
          parentId: current.parentId,
          ...(index > 0
            ? { afterId: ordered[index - 1].id }
            : ordered[index + 1]
              ? { beforeId: ordered[index + 1].id }
              : {}),
        };
        const target = before.items
          .filter((p) => p.id !== current.id && p.parentId === input.parentId)
          .sort((a, b) => a.position! - b.position!);
        const anchor = input.beforeId ?? input.afterId;
        const anchorIndex = anchor
          ? target.findIndex((p) => p.id === anchor)
          : target.length;
        if (anchorIndex < 0) return conflict();
        if (current.parentId !== input.parentId) current.version++;
        current.parentId = input.parentId;
        target.splice(anchorIndex + (input.afterId ? 1 : 0), 0, current);
        target.forEach((p, i) => {
          projects.find((item) => item.id === p.id)!.position = i + 1;
        });
        data = { project: { ...current }, state: catalog().state, undo };
        organizationReceipts.set(input.operationId, {
          input,
          result: structuredClone(data) as NotebookOrganization,
        });
      }
    } else if (path.startsWith("/projects/")) {
      const input = projectSchema.parse(body);
      const current = projects.find((p) => p.id === path.split("/")[2]);
      if (current) {
        if (
          input.expectedVersion !== undefined &&
          input.expectedVersion !== current.version
        )
          return conflict();
        current.name = input.name;
        if (input.parentId !== undefined) current.parentId = input.parentId;
        current.version++;
      }
      data = current;
    } else if (path === "/memories/search") {
      const input = listSchema.parse(body);
      const matching = [...records.values()].filter(
        (m) =>
          (input.projectId === undefined || m.projectId === input.projectId) &&
          (!input.kind || m.kind === input.kind) &&
          (!input.tag || m.enrichment?.tags.includes(input.tag)) &&
          (!input.sourceAgent || m.source.agent === input.sourceAgent) &&
          (!input.updatedAfter || m.updatedAt >= input.updatedAfter) &&
          (!input.lifetime ||
            (input.lifetime === "ephemeral") === !!m.expiresAt) &&
          m.status === input.status &&
          (!input.query ||
            m.content.toLowerCase().includes(input.query.toLowerCase())),
      );
      if (input.sort)
        matching.sort(
          (a, b) =>
            ((input.sort === "created_desc"
              ? a.createdAt.localeCompare(b.createdAt)
              : a.updatedAt.localeCompare(b.updatedAt)) ||
              a.id.localeCompare(b.id)) *
            (input.sort === "updated_asc" ? 1 : -1),
        );
      // Small pages make scope changes and pagination observable in the browser.
      const offset = Number(input.cursor || 0);
      data = {
        items: matching.slice(offset, offset + 2),
        nextCursor: matching.length > offset + 2 ? String(offset + 2) : null,
        searchMode: "hybrid",
      };
    } else if (path === "/memories/delete") {
      const items = body.items as { id: string; expectedVersion: number }[];
      data = {
        results: items.map((item) => {
          if (records.get(item.id)?.version !== item.expectedVersion)
            return { id: item.id, outcome: "conflict" };
          records.delete(item.id);
          revisions.delete(item.id);
          return { id: item.id, outcome: "deleted" };
        }),
      };
    } else if (path === "/memories" || /^\/memories\/[^/]+\/edit$/.test(path)) {
      const replay = noteReceipts.get(body.operationId);
      if (replay) {
        if (replay.input !== JSON.stringify(body)) return conflict();
        return route.fulfill({
          json: { success: true, data: records.get(replay.id) },
        });
      }
      if (body.id && records.get(body.id)?.version !== body.expectedVersion)
        return conflict();
      const editing =
        path.endsWith("/edit") ||
        !!body.edits ||
        (!!body.id && body.content === undefined);
      const payload = { ...body };
      if (editing) {
        const previous = records.get(body.id)!;
        payload.content = body.edits
          ? applySourceEdits(previous.content, body.edits)
          : previous.content;
        delete payload.edits;
        delete payload.editSession;
        delete payload.checkpoint;
        if (payload.taskId === null) delete payload.taskId;
      }
      const input = rememberSchema.parse(payload);
      if (editing) input.content = payload.content;
      const previous = input.id ? records.get(input.id) : undefined;
      if (input.id && previous?.version !== input.expectedVersion)
        return conflict();
      const saved: Memory = {
        ...note,
        ...previous,
        id: input.id ?? crypto.randomUUID(),
        content: input.content,
        kind: input.kind,
        retentionDays: input.retentionDays ?? null,
        expiresAt: input.retentionDays
          ? new Date(Date.now() + input.retentionDays * 86400000).toISOString()
          : null,
        autoKind: input.autoKind,
        taskId: input.taskId ?? null,
        projectId: input.projectId,
        source: input.source,
        version: (previous?.version ?? 0) + 1,
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        enrichment: undefined,
      };
      records.set(saved.id, saved);
      noteReceipts.set(input.operationId, {
        input: JSON.stringify(body),
        id: saved.id,
      });
      const history = revisions.get(saved.id) ?? [];
      const prior = previous
        ? revisionGroups.get(`${saved.id}:${previous.version}`)
        : undefined;
      const splices = previous
        ? sourceEditsBetween(previous.content, saved.content)
        : [];
      const small =
        !!body.edits &&
        splices.reduce((n, s) => n + s.oldText.length + s.text.length, 0) <=
          256 &&
        splices.every((s) => !/[\r\n]/.test(s.oldText + s.text));
      const coalesced =
        small &&
        !body.checkpoint &&
        !!prior?.open &&
        prior.session === body.editSession;
      revisionGroups.set(`${saved.id}:${saved.version}`, {
        revision: coalesced
          ? prior!.revision
          : (prior?.revision ?? previous?.version ?? 0) + 1,
        firstVersion: coalesced ? prior!.firstVersion : saved.version,
        saves: coalesced ? prior!.saves + 1 : 1,
        session: body.editSession,
        open: small && !body.checkpoint,
      });
      if (previous && !history.some((row) => row.version === previous.version))
        history.push(previous);
      history.push(saved);
      revisions.set(saved.id, history);
      data = saved;
    } else if (/\/(archive|restore)$/.test(path)) {
      const input = versionSchema.parse(body);
      const previous = records.get(path.split("/")[2])!;
      if (previous.version !== input.expectedVersion) return conflict();
      const saved: Memory = {
        ...previous,
        version: previous.version + 1,
        status: path.endsWith("/archive") ? "archived" : "active",
        content: input.revision
          ? revisions
              .get(previous.id)!
              .find((row) => row.version === input.revision)!.content
          : previous.content,
      };
      records.set(saved.id, saved);
      revisions.set(saved.id, [...(revisions.get(saved.id) ?? []), saved]);
      data = saved;
    } else if (path.startsWith("/briefs")) {
      const scope = briefRequestSchema.parse(body);
      data = {
        scope,
        status: "ready",
        sourceCount: 1,
        profile: "private-profile",
        truncated: false,
        updatedAt: note.updatedAt,
        content: {
          title: scope.taskId
            ? "Ready for the next session"
            : "A simpler website",
          sections: [
            {
              heading: "Next steps",
              statements: [
                {
                  text: "Review keyboard access before launch.",
                  sources: [{ id: handoff.id, version: 1 }],
                },
              ],
            },
          ],
        },
      };
    } else if (path.endsWith("/revisions")) {
      const id = path.split("/")[2],
        grouped = new Map<
          number,
          Memory & { revision?: number; firstVersion?: number; saves?: number }
        >();
      for (const row of revisions.get(id) ?? []) {
        const group = revisionGroups.get(`${id}:${row.version}`);
        grouped.set(group?.firstVersion ?? row.version, {
          ...row,
          revision: group?.revision ?? row.version,
          firstVersion: group?.firstVersion ?? row.version,
          saves: group?.saves ?? 1,
        });
      }
      data = [...grouped.values()].sort((a, b) => b.version - a.version);
    } else if (path.startsWith("/memories/"))
      data = records.get(path.split("/")[2]);
    else throw new Error(`Unexpected fixture request: ${path}`);
    await route.fulfill({
      json: {
        success: true,
        data: catalogResponse(route.request().url(), data),
      },
    });
  });
  return { records, calls, projects, chats, pairs, revisions };
}
