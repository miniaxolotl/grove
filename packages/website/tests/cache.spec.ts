import { test, expect } from "@playwright/test";
import { InfiniteQueryObserver } from "@tanstack/react-query";
import type { Memory, MemoryList } from "@lib/shared/contracts";
import { WorkspaceCache, workspaceKeys } from "../src/lib/workspace-cache";
import { DashboardApiError, type api } from "../src/lib/dashboard-api";
import { operationForRequest } from "../src/lib/analytics-policy";

const note: Memory = {
  id: "00000000-0000-4000-a000-000000000001",
  projectId: null,
  content: "Original note",
  kind: "fact",
  status: "active",
  version: 1,
  source: { agent: "website" },
  taskId: null,
  expiresAt: null,
  purgeAt: null,
  createdAt: "2026-10-21T10:00:00Z",
  updatedAt: "2026-10-21T10:00:00Z",
  indexing: "ready",
};
const caches: WorkspaceCache[] = [];
function cacheWith(
  handler: (...args: Parameters<typeof api>) => Promise<unknown>,
  denied?: () => void,
) {
  const cache = new WorkspaceCache(handler as typeof api, denied);
  caches.push(cache);
  return cache;
}
test.afterEach(() => caches.splice(0).forEach((cache) => cache.dispose()));

test("shared misses survive one subscriber leaving, and the final departure cancels transport", async () => {
  let reads = 0;
  let signal: AbortSignal | undefined;
  const response = Promise.withResolvers<unknown>();
  const cache = cacheWith(async (_path, _body, _method, abort) => {
    reads++;
    signal = abort;
    return response.promise;
  });
  const first = new AbortController(),
    second = new AbortController();
  const a = cache
    .fetch("/projects", undefined, first.signal)
    .catch((error) => error.name);
  const b = cache.fetch("/projects", undefined, second.signal);
  first.abort();
  expect(await a).toBe("AbortError");
  expect(signal?.aborted).toBe(false);
  response.resolve([{ id: "shared" }]);
  expect(await b).toEqual([{ id: "shared" }]);
  expect(reads).toBe(1);
  await cache.fetch("/projects");
  expect(reads).toBe(1);

  const final = new AbortController();
  const held = cacheWith(async (_path, _body, _method, abort) => {
    signal = abort;
    return new Promise(() => {});
  });
  const pending = held
    .fetch("/projects", undefined, final.signal)
    .catch((error) => error.name);
  final.abort();
  expect(await pending).toBe("AbortError");
  expect(signal?.aborted).toBe(true);
});

test("list snapshots seed details without duplicate reads; scope and pagination keys remain distinct", async () => {
  const requests: unknown[] = [];
  const cache = cacheWith(async (_path, body) => {
    requests.push(body);
    return { items: [note], nextCursor: null };
  });
  await cache.client.fetchInfiniteQuery(cache.notes());
  expect(await cache.client.fetchQuery(cache.note(note.id))).toEqual(note);
  await cache.client.fetchInfiniteQuery(
    cache.notes({ status: "active", limit: 30, query: "  " }),
  );
  expect(requests).toHaveLength(1);
  await cache.client.fetchInfiniteQuery(cache.notes({ projectId: null }));
  await cache.client.fetchInfiniteQuery(cache.notes({ limit: 8 }));
  expect(requests).toHaveLength(3);
  expect(requests[0]).not.toHaveProperty("projectId", null);
  expect(requests[1]).toHaveProperty("projectId", null);
});

test("account teardown rejects a late successful save and clears every snapshot", async () => {
  const response = Promise.withResolvers<Memory>();
  const old = cacheWith(async () => response.promise);
  const save = old
    .api("/memories", { content: "Private account A" })
    .catch((error) => error.name);
  old.dispose();
  const next = cacheWith(async () => ({ ...note, content: "Account B" }));
  response.resolve(note);
  expect(await save).toBe("AbortError");
  expect(old.client.getQueryCache().getAll()).toHaveLength(0);
  expect((await next.client.fetchQuery(next.note(note.id)))?.content).toBe(
    "Account B",
  );
});

test("teardown also releases imperative readers and inactive snapshots have a bounded cap", async () => {
  const cache = cacheWith(async () => new Promise(() => {}));
  const read = cache.fetch("/projects").catch((error) => error.name);
  cache.dispose();
  expect(await read).toBe("AbortError");
  cache.start("cache-bounds-test");
  for (let index = 0; index < 240; index++)
    cache.client.setQueryData(
      workspaceKeys.resource("/ask", { query: `search ${index}` }),
      { sources: [] },
    );
  expect(cache.client.getQueryCache().getAll()).toHaveLength(200);
});

test("committed edits fence held reads and only refresh old/new notebook dependencies", async () => {
  const unrelated = "00000000-0000-4000-a000-000000000002";
  const destination = "00000000-0000-4000-a000-000000000003";
  let current = note;
  const calls: (string | null | undefined)[] = [];
  const cache = cacheWith(async (path, body) => {
    if (path === "/memories") {
      current = {
        ...note,
        version: 2,
        projectId: destination,
        content: "Moved",
      };
      return current;
    }
    const filters = body as Partial<MemoryList>;
    calls.push(filters.projectId);
    return {
      items:
        filters.projectId === undefined ||
        filters.projectId === current.projectId
          ? [current]
          : [],
      nextCursor: null,
    };
  });
  const unsubscribe = [undefined, null, destination, unrelated].map(
    (projectId) => {
      const observer = new InfiniteQueryObserver(
        cache.client,
        cache.notes({ projectId }),
      );
      return observer.subscribe(() => {});
    },
  );
  await expect.poll(() => calls.length).toBe(4);
  await expect
    .poll(() => cache.client.getQueryData(workspaceKeys.note(note.id)))
    .toEqual(note);
  calls.length = 0;
  await cache.api("/memories", {
    id: note.id,
    expectedVersion: 1,
    projectId: destination,
  });
  await expect.poll(() => calls.length).toBe(3);
  expect(calls).not.toContain(unrelated);
  expect(
    cache.client.getQueryData<Memory>(workspaceKeys.note(note.id))?.version,
  ).toBe(2);
  unsubscribe.forEach((stop) => stop());
});

test("deleted notes cannot return through a held list response or a later stale detail", async () => {
  const held = Promise.withResolvers<{ items: Memory[]; nextCursor: null }>();
  let hold = false;
  const cache = cacheWith(async (path) =>
    path === "/memories/delete"
      ? { results: [{ id: note.id, outcome: "deleted" }] }
      : path === "/memories/search"
        ? hold
          ? held.promise
          : { items: [note], nextCursor: null }
        : note,
  );
  const options = cache.notes();
  await cache.client.fetchInfiniteQuery(options);
  hold = true;
  const read = cache.client
    .fetchInfiniteQuery({ ...options, staleTime: 0 })
    .catch(() => null);
  await cache.api("/memories/delete", {
    items: [{ id: note.id, expectedVersion: 1 }],
  });
  held.resolve({ items: [note], nextCursor: null });
  await read;
  expect(cache.client.getQueryData(options.queryKey)?.pages[0].items).toEqual(
    [],
  );
  expect(
    await cache.client.fetchQuery({ ...cache.note(note.id), staleTime: 0 }),
  ).toBeNull();
});

test("content versions never roll back, while equal-version worker enrichment can refresh", async () => {
  let current = { ...note, version: 3 };
  const cache = cacheWith(async () => current);
  await cache.client.fetchQuery(cache.note(note.id));
  current = { ...note, version: 2 };
  await cache.api("/memories", { id: note.id });
  expect(
    cache.client.getQueryData<Memory>(workspaceKeys.note(note.id))?.version,
  ).toBe(3);
  current = { ...note, version: 3, indexing: "failed" };
  await cache.client.fetchQuery({ ...cache.note(note.id), staleTime: 0 });
  expect(
    cache.client.getQueryData<Memory>(workspaceKeys.note(note.id))?.indexing,
  ).toBe("failed");
});

test("a delayed notebook mutation cannot roll back a newer cached notebook version", async () => {
  const project = {
    id: "00000000-0000-4000-a000-000000000010",
    name: "New name",
    identity: "test:cache",
    parentId: null,
    version: 3,
  };
  const cache = cacheWith(async (_path, _body, method) =>
    method === "PATCH"
      ? { ...project, name: "Old name", version: 2 }
      : [project],
  );
  await cache.client.fetchQuery(cache.resource("/projects"));
  await cache.api(
    `/projects/${project.id}`,
    { name: "Old name", expectedVersion: 1 },
    "PATCH",
  );
  expect(
    cache.client.getQueryData(workspaceKeys.resource("/projects")),
  ).toEqual([project]);
});

test("a notebook creation cannot masquerade as the complete directory or renew unrelated entries", async () => {
  const project = {
    id: "00000000-0000-4000-a000-000000000010",
    name: "Created",
    version: 1,
  };
  const cache = cacheWith(async () => project);
  const key = workspaceKeys.resource("/projects");
  await cache.api("/projects", { name: project.name });
  expect(cache.client.getQueryData(key)).toBeUndefined();
  cache.client.setQueryData(key, [], { updatedAt: 1000 });
  await cache.api("/projects", { name: project.name });
  expect(cache.client.getQueryData(key)).toEqual([project]);
  expect(cache.client.getQueryState(key)?.dataUpdatedAt).toBe(1000);
});

test("authentication loss clears cached content and not-found details remove list copies", async () => {
  let status = 200,
    denied = 0;
  const cache = cacheWith(
    async (path) => {
      if (status !== 200)
        throw new DashboardApiError("denied", "Unavailable", status);
      return path === "/memories/search"
        ? { items: [note], nextCursor: null }
        : note;
    },
    () => {
      denied++;
    },
  );
  const list = cache.notes();
  await cache.client.fetchInfiniteQuery(list);
  status = 404;
  await expect(
    cache.client.fetchQuery({ ...cache.note(note.id), staleTime: 0 }),
  ).rejects.toThrow("Unavailable");
  expect(cache.client.getQueryData(list.queryKey)?.pages[0].items).toEqual([]);
  status = 401;
  await expect(
    cache.client.fetchQuery(cache.resource("/me")),
  ).rejects.toBeDefined();
  expect(denied).toBe(1);
  expect(cache.client.getQueryCache().getAll()).toHaveLength(0);
});

test("expiry removes active-list membership at the deadline and purge hides the detail", async () => {
  const now = Date.now();
  const expiring = {
    ...note,
    expiresAt: new Date(now + 150).toISOString(),
    purgeAt: new Date(now + 350).toISOString(),
  };
  const cache = cacheWith(async () => ({
    items: [expiring],
    nextCursor: null,
  }));
  const list = cache.notes();
  await cache.client.fetchInfiniteQuery(list);
  expect(cache.client.getQueryData(list.queryKey)?.pages[0].items).toHaveLength(
    1,
  );
  await expect
    .poll(() => cache.client.getQueryData(list.queryKey)?.pages[0].items)
    .toEqual([]);
  await expect
    .poll(() => cache.client.getQueryData(workspaceKeys.note(note.id)))
    .toBeNull();
});

test("transient read failures retain useful snapshots, bounded retries exclude denied responses", async () => {
  let fail = false,
    calls = 0;
  const cache = cacheWith(async () => {
    calls++;
    if (fail) throw new DashboardApiError("offline", "Offline", 503);
    return note;
  });
  await cache.client.fetchQuery(cache.note(note.id));
  fail = true;
  await expect(
    cache.client.fetchQuery({
      ...cache.note(note.id),
      staleTime: 0,
      retryDelay: 0,
    }),
  ).rejects.toThrow("Offline");
  expect(calls).toBe(3);
  expect(cache.client.getQueryData(workspaceKeys.note(note.id))).toEqual(note);
  expect(operationForRequest("/memories/search", "POST")).toBe("memory_recall");
  expect(operationForRequest("/memories", "POST")).toBe("memory_write");
});

test("reprocessing an old note polls from observation time and stops at its bound", async () => {
  const cache = cacheWith(async () => ({ ...note, indexing: "pending" }));
  const options = cache.note(note.id);
  await cache.client.fetchQuery(options);
  const query = cache.client
    .getQueryCache()
    .find({ queryKey: options.queryKey })!;
  const interval = options.refetchInterval as (
    query: unknown,
  ) => number | false;
  const original = Date.now;
  let now = original();
  Date.now = () => now;
  try {
    expect(interval(query)).toBe(5000);
    now += 120001;
    expect(interval(query)).toBe(false);
    cache.client.setQueryData(options.queryKey, note);
    expect(interval(query)).toBe(false);
    const pendingNote: Memory = {
      ...note,
      indexing: "pending",
    };
    cache.client.setQueryData(options.queryKey, pendingNote);
    expect(interval(query)).toBe(5000);
  } finally {
    Date.now = original;
  }
});

test("expiry still prunes a list after its inactive detail snapshot is evicted", async () => {
  const expiring = {
    ...note,
    expiresAt: new Date(Date.now() + 150).toISOString(),
  };
  const cache = cacheWith(async (path) =>
    path === "/memories/search"
      ? { items: [expiring], nextCursor: null }
      : { ...note, id: "00000000-0000-4000-a000-000000000099" },
  );
  const options = cache.notes();
  await cache.client.fetchInfiniteQuery(options);
  cache.client.removeQueries({ queryKey: workspaceKeys.note(note.id) });
  await cache.api("/memories", { content: "Another note reschedules expiry" });
  await expect
    .poll(() => cache.client.getQueryData(options.queryKey)?.pages[0].items)
    .toEqual([]);
});
