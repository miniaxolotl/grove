import {
  QueryClient,
  QueryObserver,
  infiniteQueryOptions,
  queryOptions,
  type InfiniteData,
  type Query,
  type QueryObserverOptions,
} from "@tanstack/react-query";
import type { Memory, MemoryList, Notebook, Page } from "@lib/shared/contracts";
import type { Conversation } from "@lib/shared/conversations";
import type { AskTools } from "@lib/shared/ask-tools";
import type { AskResult } from "@lib/shared/models";
import type {
  ConnectionPage,
  ConnectionQuery,
} from "@lib/shared/relationships";
import { api, DashboardApiError } from "./dashboard-api";
import { SessionRefreshError } from "./dashboard-session";

type Filters = Omit<MemoryList, "cursor">;
type Change = { ids?: string[]; scopes?: (string | null)[]; resource?: string };
type NotePages = InfiniteData<Page<Memory>, string | null>;
const root = ["workspace"] as const;
export const workspaceKeys = {
  root,
  note: (id: string) => [...root, "note", id] as const,
  notes: (filters: Filters) => [...root, "notes", filters] as const,
  resource: (path: string, body?: unknown) =>
    [...root, "resource", path, body ?? null] as const,
};
export function noteFilters(input: Partial<Filters> = {}): Filters {
  return {
    projectId: input.projectId,
    kind: input.kind || undefined,
    tag: input.tag?.trim() || undefined,
    sourceAgent: input.sourceAgent || undefined,
    updatedAfter: input.updatedAfter || undefined,
    sort: input.sort ?? "updated_desc",
    lifetime: input.lifetime || undefined,
    status: input.status ?? "active",
    query: input.query?.trim() || undefined,
    limit: input.limit ?? 30,
  };
}
const isMemory = (value: unknown): value is Memory =>
  !!value &&
  typeof value === "object" &&
  "content" in value &&
  "indexing" in value &&
  "id" in value;
function belongs(note: Memory, filters: Filters) {
  const expired = !!note.expiresAt && Date.parse(note.expiresAt) <= Date.now();
  return (
    (!note.purgeAt || Date.parse(note.purgeAt) > Date.now()) &&
    (filters.projectId === undefined || note.projectId === filters.projectId) &&
    (!filters.kind || note.kind === filters.kind) &&
    (!filters.tag || !!note.enrichment?.tags.includes(filters.tag)) &&
    (!filters.sourceAgent || note.source.agent === filters.sourceAgent) &&
    (!filters.updatedAfter || note.updatedAt > filters.updatedAfter) &&
    (!filters.lifetime ||
      (filters.lifetime === "ephemeral") === !!note.expiresAt) &&
    (filters.status === "all" ||
      (filters.status === "expired"
        ? expired && note.status === "active"
        : filters.status === "active"
          ? !expired && note.status === "active"
          : note.status === "archived"))
  );
}

/** One instance per authenticated account AND session. Never persisted or shared by SSR. */
export class WorkspaceCache {
  readonly client: QueryClient;
  private generation = 0;
  private active = true;
  private lifetime = new AbortController();
  private settingsWrites: Promise<void> = Promise.resolve();
  private deleted = new Set<string>();
  private pendingSince = new WeakMap<object, number>();
  private channel?: BroadcastChannel;
  private timer?: ReturnType<typeof setInterval>;
  private expiry?: ReturnType<typeof setTimeout>;
  private unsubscribe?: () => void;
  private publish?: (change: Change) => void;

  constructor(
    private transport: typeof api = api,
    private accessLost: () => void = () => {},
  ) {
    this.client = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          gcTime: 300_000,
          retry: (count, error) =>
            count < 1 &&
            !(error instanceof SessionRefreshError) &&
            !(error instanceof DashboardApiError && error.status < 500),
          refetchOnWindowFocus: true,
          refetchOnReconnect: true,
        },
        mutations: { retry: false },
      },
    });
  }

  start(account: string) {
    this.active = true;
    if (this.lifetime.signal.aborted) this.lifetime = new AbortController();
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(`grove-workspace:${account}`);
      this.publish = (change) => this.channel?.postMessage(change);
      this.channel.onmessage = (event) => {
        const value = event.data as Change;
        if (
          !value ||
          typeof value !== "object" ||
          (value.ids &&
            (!Array.isArray(value.ids) ||
              value.ids.length > 100 ||
              value.ids.some((id) => typeof id !== "string"))) ||
          (value.scopes &&
            (!Array.isArray(value.scopes) ||
              value.scopes.length > 100 ||
              value.scopes.some(
                (id) => id !== null && typeof id !== "string",
              ))) ||
          (value.resource !== undefined && typeof value.resource !== "string")
        )
          return;
        if (
          value.resource?.startsWith("/projects/lifecycle/") &&
          value.scopes
        ) {
          this.notebookLifecycle(
            value.resource.split("/").at(-1)!,
            value.scopes,
          );
        } else if (
          value.resource?.startsWith("/memories/lifecycle/") &&
          value.ids
        ) {
          this.noteLifecycle(value.resource.split("/").at(-1)!, value.ids);
        } else this.invalidate(value);
      };
    }
    this.timer = setInterval(() => {
      if (!document.hidden)
        void this.client.invalidateQueries({ type: "active" });
    }, 60_000);
    this.unsubscribe = this.client.getQueryCache().subscribe(() => {
      // Protect active observers/pagination. Cap inactive snapshots as well as their TTL.
      const inactive = this.client
        .getQueryCache()
        .getAll()
        .filter(
          (query) =>
            !query.getObserversCount() && query.state.fetchStatus === "idle",
        )
        .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
      for (const query of inactive.slice(200))
        this.client.removeQueries({ queryKey: query.queryKey, exact: true });
    });
  }
  dispose() {
    this.active = false;
    this.generation++;
    this.lifetime.abort();
    clearInterval(this.timer);
    clearTimeout(this.expiry);
    this.unsubscribe?.();
    this.channel?.close();
    this.publish = undefined;
    this.client.clear();
    this.deleted.clear();
  }
  private assertActive(generation: number, signal?: AbortSignal) {
    if (!this.active || generation !== this.generation || signal?.aborted)
      throw new DOMException("Workspace request cancelled", "AbortError");
  }
  private async read<T>(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const generation = this.generation;
    this.assertActive(generation, signal);
    try {
      const result = await this.transport<T>(path, body, undefined, signal);
      this.assertActive(generation, signal);
      return result;
    } catch (error) {
      this.assertActive(generation, signal);
      if (error instanceof DashboardApiError) {
        if (error.status === 401) {
          this.dispose();
          this.accessLost();
        } else if (
          [403, 404].includes(error.status) &&
          path !== "/memories/search" &&
          /^\/memories\/[^/]+$/.test(path)
        ) {
          void this.client.cancelQueries({
            predicate: (query) => query.queryKey[1] === "notes",
          });
          this.forget(path.split("/")[2]);
        } else if ([403, 404].includes(error.status)) {
          this.client.setQueryData(workspaceKeys.resource(path, body), null);
        }
      }
      throw error;
    }
  }
  private seed(note: Memory, at: number): Memory | null {
    if (
      this.deleted.has(note.id) ||
      (note.purgeAt && Date.parse(note.purgeAt) <= Date.now())
    )
      return null;
    const key = workspaceKeys.note(note.id);
    const previous = this.client.getQueryData<Memory | null>(key);
    const state = this.client.getQueryState(key);
    // Same-version worker enrichment is legitimate; older requests must not undo it.
    if (
      previous &&
      (previous.version > note.version ||
        (previous.version === note.version && (state?.dataUpdatedAt ?? 0) > at))
    )
      return previous;
    this.client.setQueryData(key, note, { updatedAt: at });
    this.scheduleExpiry();
    return note;
  }
  note(id: string) {
    return queryOptions({
      queryKey: workspaceKeys.note(id),
      queryFn: async ({ signal }) => {
        const at = Date.now();
        if (this.deleted.has(id)) return null;
        return this.seed(
          await this.read<Memory>(`/memories/${id}`, undefined, signal),
          at,
        );
      },
      refetchInterval: (query) => {
        const note = query.state.data;
        if (
          !note ||
          (note.indexing !== "pending" && note.enrichment?.status !== "pending")
        ) {
          this.pendingSince.delete(query);
          return false;
        }
        const started = this.pendingSince.get(query) ?? Date.now();
        this.pendingSince.set(query, started);
        return Date.now() - started < 120_000 ? 5000 : false;
      },
    });
  }
  notes(input: Partial<Filters> = {}) {
    const filters = noteFilters(input);
    return infiniteQueryOptions({
      queryKey: workspaceKeys.notes(filters),
      initialPageParam: null as string | null,
      queryFn: async ({ pageParam, signal }) => {
        const at = Date.now();
        const page = await this.read<Page<Memory>>(
          "/memories/search",
          {
            ...filters,
            limit: filters.limit === 30 ? undefined : filters.limit,
            cursor: pageParam ?? undefined,
          },
          signal,
        );
        return {
          ...page,
          items: page.items
            .map((note) => this.seed(note, at))
            .filter((note): note is Memory => !!note && belongs(note, filters)),
        };
      },
      getNextPageParam: (page: Page<Memory>) => page.nextCursor,
      staleTime: filters.query ? 15_000 : 30_000,
      gcTime: filters.query ? 60_000 : 300_000,
    });
  }
  resource<T>(path: string, body?: unknown) {
    return queryOptions({
      queryKey: workspaceKeys.resource(path, body),
      queryFn: ({ signal }) => this.read<T>(path, body, signal),
      // Brief reads validate expiry and schedule jobs on the server, even on revisits.
      staleTime:
        path === "/briefs"
          ? 0
          : path === "/projects"
            ? 120_000
            : ["/me", "/models", "/connections"].includes(path)
              ? 60_000
              : 15_000,
      gcTime: path === "/ask" ? 60_000 : 300_000,
    });
  }
  relationships(
    input: Omit<ConnectionQuery, "limit" | "includeDismissed" | "cursor"> &
      Partial<Pick<ConnectionQuery, "limit" | "includeDismissed">>,
  ) {
    const filters = {
      ...input,
      endpointIds: input.endpointIds
        ? [...new Set(input.endpointIds)].sort()
        : undefined,
      limit: input.limit ?? 30,
      includeDismissed: input.includeDismissed ?? false,
    };
    return infiniteQueryOptions({
      queryKey: workspaceKeys.resource("/relationships/search", filters),
      initialPageParam: null as string | null,
      queryFn: ({ pageParam, signal }) =>
        this.read<ConnectionPage>(
          "/relationships/search",
          { ...filters, cursor: pageParam ?? undefined },
          signal,
        ),
      getNextPageParam: (page: ConnectionPage) => page.nextCursor,
      staleTime: 15_000,
      refetchInterval: (query) => {
        if (query.state.data?.pages[0]?.status !== "pending") {
          this.pendingSince.delete(query);
          return false;
        }
        const started = this.pendingSince.get(query) ?? Date.now();
        this.pendingSince.set(query, started);
        return Date.now() - started < 120_000 ? 15_000 : false;
      },
    });
  }
  /** Subscribe while an imperative consumer waits; only the final departure cancels a shared read. */
  fetch<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return this.observe(this.resource<T>(path, body), signal);
  }
  fetchNote(id: string, signal?: AbortSignal) {
    return this.observe(this.note(id), signal);
  }
  private observe<T, Key extends readonly unknown[]>(
    options: QueryObserverOptions<T, Error, T, T, Key>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Cancelled", "AbortError"));
        return;
      }
      const observer = new QueryObserver(this.client, options);
      let unsubscribe = () => {};
      const stop = () => {
        unsubscribe();
        signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        stop();
        reject(new DOMException("Cancelled", "AbortError"));
      };
      const check = () => {
        const result = observer.getCurrentResult();
        if (result.isSuccess && !result.isFetching) {
          stop();
          resolve(result.data);
        } else if (result.isError && !result.isFetching) {
          stop();
          reject(result.error);
        }
      };
      unsubscribe = observer.subscribe(check);
      signal?.addEventListener("abort", abort, { once: true });
      check();
    });
  }

  private affected(query: Query, change: Change) {
    const [, kind, key, body] = query.queryKey;
    if (
      kind === "resource" &&
      typeof key === "string" &&
      key.startsWith("/tasks") &&
      (!change.resource ||
        ["/tasks", "/projects", "/conversations"].includes(change.resource))
    )
      return true;
    if (change.resource)
      return (
        kind === "resource" &&
        (key === change.resource ||
          (change.resource === "/conversations" &&
            typeof key === "string" &&
            key.startsWith("/conversations")) ||
          (change.resource === "/assistance" &&
            typeof key === "string" &&
            key.startsWith("/assistance")))
      );
    if (kind === "note")
      return !change.ids || change.ids.includes(key as string);
    if (kind === "notes")
      return (
        !change.scopes ||
        (key as Filters).projectId === undefined ||
        change.scopes.includes((key as Filters).projectId!)
      );
    if (kind === "resource" && typeof key === "string") {
      if (key.startsWith("/assistance/")) return true;
      // Any source can add/remove a pair, including notebook coverage outside its excerpts.
      if (key === "/relationships/search") return true;
      if (/^\/memories\/[^/]+\/revisions(?:\/\d+)?$/.test(key))
        return !change.ids || change.ids.includes(key.split("/")[2]);
      if (["/ask", "/briefs"].includes(key)) {
        const scope = body as {
          projectId?: string | null;
          includePersonal?: boolean;
        } | null;
        return (
          !change.scopes ||
          scope?.projectId === undefined ||
          change.scopes.includes(scope.projectId) ||
          (!!scope.includePersonal && change.scopes.includes(null))
        );
      }
    }
    return false;
  }
  private invalidate(
    change: Change,
    exceptDetails: ReadonlySet<string> = new Set(),
  ) {
    const predicate = (query: Query) =>
      this.affected(query, change) &&
      !(
        query.queryKey[1] === "note" &&
        exceptDetails.has(query.queryKey[2] as string)
      );
    void this.client.cancelQueries({ predicate });
    for (const query of this.client.getQueryCache().getAll()) {
      if (
        !predicate(query) ||
        query.queryKey[1] !== "resource" ||
        typeof query.queryKey[2] !== "string" ||
        !query.queryKey[2].startsWith("/assistance/")
      )
        continue;
      const old = query.state.data as { status: string } | undefined;
      if (old?.status === "ready")
        this.client.setQueryData(query.queryKey, {
          ...old,
          result: null,
          status: "stale",
          error: "Checking the latest sources…",
        });
    }
    void this.client.invalidateQueries({ predicate });
  }
  private forget(id: string) {
    this.client.setQueriesData(
      {
        predicate: (query) =>
          query.queryKey[1] === "resource" &&
          typeof query.queryKey[2] === "string" &&
          query.queryKey[2].startsWith("/assistance/"),
      },
      (old: Record<string, unknown> | undefined) =>
        old
          ? {
              ...old,
              result: null,
              status: "stale",
              error: "Source removed. Refresh the preview.",
            }
          : old,
    );
    this.deleted.add(id);
    this.client.setQueryData(workspaceKeys.note(id), null);
    this.patchPages(new Map([[id, null]]));
    const revisions = (query: Query) =>
      query.queryKey[1] === "resource" &&
      typeof query.queryKey[2] === "string" &&
      (query.queryKey[2] === `/memories/${id}/revisions` ||
        query.queryKey[2].startsWith(`/memories/${id}/revisions/`));
    this.client.setQueriesData({ predicate: revisions }, null);
    this.client.removeQueries({ predicate: revisions });
  }
  private notebookLifecycle(action: string, scopes: (string | null)[]) {
    void this.client.cancelQueries({ queryKey: root });
    const notes = new Map<string, Memory | null>();
    for (const query of this.client.getQueryCache().getAll()) {
      const data = query.state.data;
      const candidates =
        query.queryKey[1] === "note"
          ? [data as Memory | null]
          : query.queryKey[1] === "notes"
            ? ((data as NotePages | undefined)?.pages.flatMap(
                (page) => page.items,
              ) ?? [])
            : query.queryKey[2] === "/ask"
              ? ((data as AskResult | undefined)?.sources ?? [])
              : [];
      for (const note of candidates)
        if (note && scopes.includes(note.projectId)) notes.set(note.id, null);
    }
    for (const [id] of notes) {
      if (action === "delete") this.forget(id);
      else this.client.setQueryData(workspaceKeys.note(id), null);
    }
    this.patchPages(notes);
    for (const path of ["/projects", "/projects?status=archived"]) {
      this.client.setQueryData<Notebook[]>(
        workspaceKeys.resource(path),
        (old) => old?.filter((project) => !scopes.includes(project.id)),
      );
      void this.client.invalidateQueries({
        queryKey: workspaceKeys.resource(path),
      });
    }
    this.invalidate({});
  }
  private noteLifecycle(action: string, ids: string[]) {
    const change = { ids };
    void this.client.cancelQueries({
      predicate: (query) => this.affected(query, change),
    });
    const notes = new Map<string, Memory | null>();
    for (const id of ids) {
      if (action === "delete") this.forget(id);
      else this.client.setQueryData(workspaceKeys.note(id), null);
      notes.set(id, null);
    }
    this.patchPages(notes);
    this.invalidate(change);
  }
  private patchPages(notes: Map<string, Memory | null>) {
    for (const query of this.client
      .getQueryCache()
      .findAll({ queryKey: [...root, "notes"] })) {
      const data = query.state.data as NotePages | undefined;
      if (!data) continue;
      const filters = query.queryKey[2] as Filters;
      this.client.setQueryData(
        query.queryKey,
        {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.flatMap((old) => {
              const note = notes.has(old.id) ? notes.get(old.id) : old;
              return note && belongs(note, filters) ? [note] : [];
            }),
          })),
        },
        { updatedAt: query.state.dataUpdatedAt },
      );
    }
    for (const query of this.client
      .getQueryCache()
      .findAll({ queryKey: [...root, "resource"] })) {
      if (query.queryKey[2] === "/relationships/search") {
        const data = query.state.data as
          | InfiniteData<ConnectionPage>
          | undefined;
        if (data)
          this.client.setQueryData(
            query.queryKey,
            {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                items: page.items.filter(
                  (item) =>
                    item.level !== "notebook" &&
                    !notes.has(item.from.id) &&
                    !notes.has(item.to.id),
                ),
              })),
            },
            { updatedAt: query.state.dataUpdatedAt },
          );
      }
      if (query.queryKey[2] === "/ask") {
        const data = query.state.data as AskResult | undefined;
        if (data)
          this.client.setQueryData(
            query.queryKey,
            {
              ...data,
              sources: data.sources.flatMap((old) => {
                const note = notes.has(old.id) ? notes.get(old.id) : old;
                return note && belongs(note, noteFilters()) ? [note] : [];
              }),
            },
            { updatedAt: query.state.dataUpdatedAt },
          );
      }
      if (
        query.queryKey[2] === "/briefs" &&
        this.affected(query, {
          scopes: [...notes.values()].some((note) => note === null)
            ? undefined
            : [
                ...new Set(
                  [...notes.values()]
                    .filter(isMemory)
                    .map((note) => note.projectId),
                ),
              ],
        })
      )
        this.client.setQueryData(query.queryKey, null, {
          updatedAt: query.state.dataUpdatedAt,
        });
    }
  }
  private scheduleExpiry() {
    clearTimeout(this.expiry);
    const now = Date.now();
    // Active paginated lists can outlive the inactive detail-entry cap.
    const boundaries = this.client
      .getQueryCache()
      .getAll()
      .flatMap((query) => {
        const kind = query.queryKey[1];
        const notes =
          kind === "note"
            ? [query.state.data as Memory | null]
            : kind === "notes"
              ? ((query.state.data as NotePages | undefined)?.pages.flatMap(
                  (page) => page.items,
                ) ?? [])
              : [];
        return notes.flatMap((note) =>
          note
            ? [note.expiresAt, note.purgeAt].flatMap((value) =>
                value && Date.parse(value) > now ? [Date.parse(value)] : [],
              )
            : [],
        );
      });
    if (!boundaries.length) return;
    this.expiry = setTimeout(
      () => {
        const updates = new Map<string, Memory | null>();
        for (const query of this.client
          .getQueryCache()
          .findAll({ queryKey: [...root, "note"] })) {
          const note = query.state.data as Memory | null;
          if (note?.purgeAt && Date.parse(note.purgeAt) <= Date.now())
            this.forget(note.id);
          else if (note) updates.set(note.id, note);
        }
        this.patchPages(updates);
        this.invalidate({});
        this.scheduleExpiry();
      },
      Math.min(2_147_483_647, Math.max(1, Math.min(...boundaries) - now + 1)),
    );
  }

  /** Durable effects are published before UI callbacks/routing, even after their editor unmounts. */
  api: typeof api = async <T>(
    path: string,
    body?: unknown,
    method?: string,
    signal?: AbortSignal,
  ) => {
    signal = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    const generation = this.generation;
    this.assertActive(generation, signal);
    const verb = method ?? (body === undefined ? "GET" : "POST");
    const read =
      verb === "GET" ||
      path === "/memories/search" ||
      path === "/conversations/search" ||
      path === "/briefs" ||
      path === "/relationships/search" ||
      path === "/ask";
    if (read)
      return verb === "GET" && !path.startsWith("/memories/")
        ? this.fetch<T>(path, body, signal)
        : this.read<T>(path, body, signal);
    try {
      // Keep preference writes ordered across panels and in-app navigation. A
      // superseded account/session must never start a queued write.
      const send = () => {
        this.assertActive(generation, signal);
        return this.transport<T>(path, body, method, signal);
      };
      const settingsWrite =
        path === "/account/settings" ||
        path === "/ask-tools" ||
        path.endsWith("/tools");
      const request =
        settingsWrite || path.startsWith("/conversations")
          ? this.settingsWrites.then(send)
          : send();
      if (settingsWrite)
        this.settingsWrites = request.then(
          () => {},
          () => {},
        );
      const result = await request;
      this.assertActive(generation, signal);
      if (path === "/account/delete") {
        this.dispose();
        this.accessLost();
        return result;
      }
      if (path.startsWith("/memories")) {
        const records = new Map<string, Memory | null>();
        if (isMemory(result)) records.set(result.id, result);
        if (path === "/memories/delete") {
          const input = body as { items: { id: string }[] };
          const deleted = result as {
            results: { id?: string; outcome: string }[];
          };
          deleted.results.forEach((item, index) => {
            if (["deleted", "not_found"].includes(item.outcome))
              records.set(item.id ?? input.items[index].id, null);
          });
        }
        const id = path.split("/")[2];
        const ids =
          path === "/memories/delete"
            ? (body as { items: { id: string }[] }).items.map((item) => item.id)
            : records.size
              ? [...records.keys()]
              : id
                ? [id]
                : undefined;
        const scopes = new Set<string | null>();
        let known = true;
        for (const noteId of ids ?? []) {
          const before = this.client.getQueryData<Memory>(
            workspaceKeys.note(noteId),
          );
          if (before) scopes.add(before.projectId);
          else if (!(path === "/memories" && !(body as { id?: string })?.id))
            known = false;
          const after = records.get(noteId);
          if (after) scopes.add(after.projectId);
        }
        const change = { ids, scopes: known ? [...scopes] : undefined };
        void this.client.cancelQueries({
          predicate: (query) => this.affected(query, change),
        });
        for (const [noteId, note] of records) {
          if (note) records.set(noteId, this.seed(note, Date.now()));
          else this.forget(noteId);
        }
        this.patchPages(records);
        this.invalidate(change, new Set(records.keys()));
        this.publish?.(change);
      } else if (path.startsWith("/assistance")) {
        if (/\/(apply|undo)$/.test(path)) {
          this.invalidate({});
          this.publish?.({});
        } else if (path.endsWith("/review") || path.endsWith("/cancel")) {
          this.invalidate({ resource: "/assistance" });
          this.publish?.({ resource: "/assistance" });
        }
      } else if (/^\/projects\/[^/]+\/(archive|restore|delete)$/.test(path)) {
        const resultChange = result as { action: string; projectIds: string[] };
        this.notebookLifecycle(resultChange.action, resultChange.projectIds);
        this.publish?.({
          resource: `/projects/lifecycle/${resultChange.action}`,
          scopes: resultChange.projectIds,
        });
      } else if (path.startsWith("/projects")) {
        const project = result as Notebook;
        const key = workspaceKeys.resource("/projects");
        const previous = this.client.getQueryState(key);
        void this.client.cancelQueries({ queryKey: key });
        if (project?.id && previous?.data)
          this.client.setQueryData<Notebook[]>(
            key,
            (old) => {
              const current = old?.find((item) => item.id === project.id);
              return current && (current.version ?? 0) > (project.version ?? 0)
                ? old
                : [
                    ...(old ?? []).filter((item) => item.id !== project.id),
                    project,
                  ];
            },
            { updatedAt: previous.dataUpdatedAt },
          );
        else this.invalidate({ resource: "/projects" });
        this.publish?.({ resource: "/projects" });
        this.invalidate({ resource: "/assistance" });
        this.publish?.({ resource: "/assistance" });
        this.invalidate({ resource: "/relationships/search" });
        this.publish?.({ resource: "/relationships/search" });
      } else if (path.startsWith("/relationships/")) {
        this.invalidate({ resource: "/relationships/search" });
        this.publish?.({ resource: "/relationships/search" });
      } else if (path === "/ask-tools") {
        this.adoptToolDefaults(result);
      } else if (path.startsWith("/conversations")) {
        const change = { resource: "/conversations" };
        void this.client.cancelQueries({
          predicate: (query) => this.affected(query, change),
        });
        const chat = result as Conversation;
        if (chat?.id && chat.turns)
          this.client.setQueryData(
            workspaceKeys.resource(`/conversations/${chat.id}`),
            chat,
          );
        if (verb === "DELETE") {
          this.client.setQueryData(workspaceKeys.resource(path), null);
          const id = path.split("/")[2];
          this.client.setQueriesData<{
            items?: { id: string }[];
            pages?: { items: { id: string }[] }[];
          }>(
            {
              predicate: (query) =>
                query.queryKey[1] === "resource" &&
                ["/conversations", "/conversations/search"].includes(
                  query.queryKey[2] as string,
                ),
            },
            (old) =>
              old
                ? {
                    ...old,
                    ...(old.items
                      ? { items: old.items.filter((item) => item.id !== id) }
                      : {}),
                    ...(old.pages
                      ? {
                          pages: old.pages.map((page) => ({
                            ...page,
                            items: page.items.filter((item) => item.id !== id),
                          })),
                        }
                      : {}),
                  }
                : old,
          );
        }
        this.invalidate(change);
        if (/\/(apply|undo)$/.test(path)) {
          const action = chat.turns?.find(
            (turn) => turn.id === path.split("/")[4],
          )?.result?.lifecycle;
          if (action && ["applied", "undone"].includes(action.status)) {
            const removing =
              action.status === "applied" && action.action === "delete";
            const ids = action.notes.map((note) => note.id);
            this.noteLifecycle(removing ? "delete" : "refresh", ids);
            this.publish?.({
              resource: `/memories/lifecycle/${removing ? "delete" : "refresh"}`,
              ids,
            });
            if (action.notebookPreviews.length) {
              const scopes = action.notebookPreviews.flatMap(
                (preview) => preview.projectIds,
              );
              this.notebookLifecycle(removing ? "delete" : "archive", scopes);
              this.publish?.({
                resource: `/projects/lifecycle/${removing ? "delete" : "archive"}`,
                scopes,
              });
            }
          }
          // Merge/undo may affect archived source notes absent from the reply. Revalidate all note dependencies.
          this.invalidate({});
          this.publish?.({});
          if (
            chat.turns?.some(
              (turn) =>
                turn.id === path.split("/")[4] &&
                (turn.result?.organization || turn.result?.lifecycle),
            )
          ) {
            for (const resource of ["/projects", "/projects?status=archived"]) {
              this.invalidate({ resource });
              this.publish?.({ resource });
            }
          }
        }
        if (path.endsWith("/tools")) {
          this.adoptToolDefaults(result);
        }
        this.publish?.(change);
      } else if (
        path.startsWith("/tasks/") ||
        path === "/exports" ||
        path === "/imports"
      ) {
        this.invalidate({ resource: "/tasks" });
        this.publish?.({ resource: "/tasks" });
      } else if (path === "/account/settings") {
        const key = workspaceKeys.resource("/me");
        void this.client.cancelQueries({ queryKey: key });
        this.client.setQueryData(
          key,
          (old: Record<string, unknown> | undefined) =>
            old ? { ...old, ...result } : undefined,
        );
        // Cancel held reads of derived data before refreshing changed preferences.
        for (const change of [
          {},
          { resource: "/me" },
          { resource: "/conversations" },
        ]) {
          this.invalidate(change);
          this.publish?.(change);
        }
      } else {
        const resource =
          path === "/briefs/refresh"
            ? "/briefs"
            : path.startsWith("/connections") || path === "/keys"
              ? "/connections"
              : path === "/models"
                ? "/models"
                : undefined;
        if (resource) {
          if (resource === "/models" && path === "/models") {
            void this.client.cancelQueries({
              queryKey: workspaceKeys.resource(resource),
            });
            this.client.setQueryData(workspaceKeys.resource(resource), result);
          }
          this.invalidate({ resource });
          this.publish?.({ resource });
        }
      }
      return result;
    } catch (error) {
      if (this.active && generation === this.generation) {
        if (error instanceof DashboardApiError && error.status === 401) {
          this.dispose();
          this.accessLost();
        } else if (
          path.startsWith("/memories") ||
          /\/(apply|undo)$/.test(path)
        ) {
          // The server may have committed despite a lost response. Retain the caller's operation identity.
          this.invalidate({});
          this.publish?.({});
        } else if (path === "/ask-tools" || path.endsWith("/tools")) {
          for (const resource of ["/ask-tools", "/conversations"]) {
            void this.client.cancelQueries({
              predicate: (query) => this.affected(query, { resource }),
            });
            this.invalidate({ resource });
            this.publish?.({ resource });
          }
        } else if (path.startsWith("/projects")) {
          if (/\/(archive|restore|delete)$/.test(path)) {
            this.invalidate({});
            this.publish?.({});
          }
          this.invalidate({ resource: "/projects" });
          this.invalidate({ resource: "/projects?status=archived" });
          this.publish?.({ resource: "/projects" });
        } else if (path.startsWith("/relationships/")) {
          this.invalidate({ resource: "/relationships/search" });
          this.publish?.({ resource: "/relationships/search" });
        }
      }
      throw error;
    }
  };

  private adoptToolDefaults(result: unknown) {
    const change = { resource: "/ask-tools" };
    const key = workspaceKeys.resource(change.resource);
    void this.client.cancelQueries({ queryKey: key });
    const defaults = (result as { defaults?: AskTools }).defaults;
    if (defaults)
      this.client.setQueryData(
        key,
        (old: Record<string, unknown> | undefined) =>
          old ? { ...old, defaults } : undefined,
      );
    this.invalidate(change);
    this.publish?.(change);
  }
}
