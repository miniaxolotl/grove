"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { Memory } from "@lib/shared/contracts";
import {
  DraftRecovery,
  eraseDeviceDrafts,
  type DraftScope,
} from "@/lib/draft-recovery";
import { DashboardApiError } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import type { WorkspaceCache } from "@/lib/workspace-cache";

export type NoteValues = {
  content: string;
  kind: Memory["kind"];
  retention: string;
  autoKind: boolean;
  projectId: string;
};
export type NoteDraft = NoteValues & {
  base?: Memory;
  latest?: Memory;
  task: string;
  pending: {
    fingerprint: string;
    operationId: string;
    input?: Record<string, unknown>;
  } | null;
  saving?: Promise<Memory>;
  submitted?: NoteValues;
  error?: string;
  dailyConflictId?: string;
  dailyDate?: string;
  recovered?: boolean;
};

class NoteDraftStore extends Map<string, NoteDraft> {
  enabled = false;
  initializing = true;
  recoveryError = "";
  checkpoints = new Map<string, number>();
  private timer?: ReturnType<typeof setTimeout>;
  private queued = new Set<string>();
  private serial: Promise<unknown> = Promise.resolve();
  private active = true;
  private generation = 0;
  private unlocked = false;
  private blocked = new Set<string>();
  private keyGenerations = new Map<string, number>();
  private scopes = new Map<string, DraftScope>();
  constructor(
    private recovery: DraftRecovery,
    private recoveryAccount: string,
  ) {
    super();
  }
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.serial.catch(() => {}).then(run);
    this.serial = next;
    return next;
  }
  private schedule(key: string) {
    if (!this.enabled || !this.active || this.initializing) return;
    this.queued.add(key);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const keys = [...this.queued];
      this.queued.clear();
      for (const key of keys) void this.checkpoint(key).catch(() => {});
    }, 350);
  }
  checkpoint(key: string, snapshotDraft?: NoteDraft) {
    if (this.blocked.has(key))
      return Promise.reject(
        new Error("This source was removed. Device recovery is fenced."),
      );
    const generation = this.keyGenerations.get(key) ?? 0;
    const draft = snapshotDraft ?? this.get(key);
    const scope = draft
      ? {
          noteId: draft.base?.id,
          projectId: draft.base
            ? draft.base.projectId
            : draft.projectId || null,
          targetProjectId: draft.projectId || null,
        }
      : (this.scopes.get(key) ?? { projectId: null });
    const snapshot = draft
      ? JSON.parse(
          JSON.stringify({
            ...draft,
            saving: undefined,
            recovered: undefined,
            error: undefined,
          }),
        )
      : null;
    return this.enqueue(async () => {
      if (!this.enabled) return;
      if (
        !this.active ||
        !this.unlocked ||
        this.blocked.has(key) ||
        generation !== (this.keyGenerations.get(key) ?? 0)
      )
        throw new Error(
          "Device recovery is locked. Reconnect or export your text before disabling recovery.",
        );
      try {
        const at = await this.recovery.write(key, scope, snapshot);
        this.scopes.set(key, scope);
        if (snapshot) this.checkpoints.set(key, at);
        else this.checkpoints.delete(key);
        this.recoveryError = "";
        this.notify();
      } catch (error) {
        this.recoveryError =
          error instanceof Error
            ? error.message
            : "Device recovery unavailable. Copy or export your text.";
        this.notify();
        throw error;
      }
    });
  }
  async initialize(cache: WorkspaceCache) {
    this.active = true;
    this.recovery.resume();
    const generation = ++this.generation;
    const currentSession = () => this.active && generation === this.generation;
    try {
      const { enabled, rows } = await this.recovery.initialize();
      if (!currentSession()) return;
      this.enabled = enabled;
      for (const row of rows) this.scopes.set(row.name, row);
      if (!enabled) {
        if (rows.length) throw new Error("Device recovery key is unavailable");
        this.unlocked = true;
        this.recoveryError = "";
        return;
      }
      // Keep private recovery validation out of the default Notes entry bundle.
      const { memorySchema, kindSchema } =
        await import("@lib/shared/contracts");
      // Fresh authenticated authorization, not persisted credentials or a cached
      // permission decision. Offline uncertainty never unlocks ciphertext.
      await cache.client.fetchQuery({
        ...cache.resource("/me"),
        staleTime: 0,
        networkMode: "always",
        retry: false,
      });
      const projects = await cache.client.fetchQuery({
        ...cache.resource<{ id: string }[]>("/projects"),
        staleTime: 0,
        networkMode: "always",
        retry: false,
      });
      const budget = AbortSignal.timeout(12_000);
      for (const row of rows) {
        if (!currentSession()) return;
        budget.throwIfAborted();
        try {
          if (
            row.expires <= Date.now() ||
            (row.projectId &&
              !projects.some((project) => project.id === row.projectId)) ||
            (row.targetProjectId &&
              !projects.some((project) => project.id === row.targetProjectId))
          ) {
            await this.recovery.eraseScope({ names: [row.name] });
            continue;
          }
          const current = row.noteId
            ? await cache.api<Memory>(
                `/memories/${row.noteId}`,
                undefined,
                undefined,
                budget,
              )
            : undefined;
          if (
            current &&
            (current.status !== "active" ||
              (current.projectId !== row.projectId &&
                current.projectId !== row.targetProjectId) ||
              (current.expiresAt &&
                Date.parse(current.expiresAt) <= Date.now()))
          ) {
            await this.recovery.eraseScope({ names: [row.name] });
            continue;
          }
          if (this.blocked.has(row.name)) continue;
          const value = await this.recovery.decrypt<NoteDraft>(row);
          if (
            !currentSession() ||
            this.blocked.has(row.name) ||
            this.has(row.name)
          )
            continue;
          if (
            typeof value.content !== "string" ||
            typeof value.projectId !== "string" ||
            !kindSchema.safeParse(value.kind).success ||
            typeof value.retention !== "string" ||
            typeof value.autoKind !== "boolean" ||
            (value.projectId || null) !==
              (row.targetProjectId === undefined
                ? row.projectId
                : row.targetProjectId) ||
            value.base?.id !== row.noteId ||
            (value.base && !memorySchema.safeParse(value.base).success)
          )
            throw new Error(
              "Device recovery data is damaged. Keep other drafts and export any open text.",
            );
          super.set(row.name, {
            ...value,
            saving: undefined,
            recovered: true,
            error:
              "Recovered on this device. Review your text, then retry the original save.",
            latest:
              current &&
              value.base &&
              current.version > value.base.version &&
              !value.pending
                ? current
                : undefined,
          });
          this.checkpoints.set(row.name, row.checkpoint);
          this.notify();
        } catch (error) {
          if (
            error instanceof DashboardApiError &&
            [403, 404].includes(error.status)
          )
            await this.recovery.eraseScope({ names: [row.name] });
          else throw error;
        }
      }
      if (currentSession()) {
        this.unlocked = true;
        this.recoveryError = "";
      }
    } catch {
      if (currentSession())
        this.recoveryError =
          "Device recovery couldn’t unlock. Reconnect and retry in Settings; your encrypted drafts were not replaced.";
    } finally {
      if (currentSession()) {
        this.initializing = false;
        this.notify();
      }
    }
  }
  async enable() {
    await this.enqueue(() => this.recovery.enable());
    this.enabled = true;
    this.unlocked = true;
    this.recoveryError = "";
    this.notify();
    for (const key of this.keys()) await this.checkpoint(key);
  }
  async forgetDevice() {
    // Fence immediately, before any pending encryption or queued checkpoint.
    this.enabled = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queued.clear();
    await eraseDeviceDrafts(this.recoveryAccount);
    this.checkpoints.clear();
    this.recoveryError = "";
    this.notify();
  }
  externalErase() {
    this.enabled = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queued.clear();
    this.checkpoints.clear();
    this.recoveryError = "";
    this.notify();
  }
  forgetScope(change: { ids?: string[]; scopes?: (string | null)[] }) {
    for (const [key, scope] of this.scopes) {
      if (
        (scope.noteId && change.ids?.includes(scope.noteId)) ||
        change.scopes?.includes(scope.projectId) ||
        (scope.targetProjectId &&
          change.scopes?.includes(scope.targetProjectId))
      ) {
        this.blocked.add(key);
        this.keyGenerations.set(key, (this.keyGenerations.get(key) ?? 0) + 1);
        super.delete(key);
        this.checkpoints.delete(key);
      }
    }
    void this.recovery.eraseScope(change).catch(() => {
      this.recoveryError =
        "Device checkpoints couldn’t be erased. Keep this tab open and retry forgetting device recovery in Settings.";
      this.notify();
    });
    this.notify();
  }
  stop() {
    this.active = false;
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.recovery.close();
  }
  begin(key: string) {
    // A newly mounted, currently authorized editor may start a new draft after
    // an explicit restore. Erased checkpoints/late writers are never replayed.
    this.blocked.delete(key);
  }
  private revision = 0;
  private listeners = new Set<() => void>();
  private holds = new Map<string, number>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  notify = () => {
    this.revision++;
    this.listeners.forEach((listener) => listener());
  };
  override set(key: string, value: NoteDraft) {
    if (this.blocked.has(key) || !this.active) return this;
    super.set(key, value);
    this.scopes.set(key, {
      noteId: value.base?.id,
      projectId: value.base ? value.base.projectId : value.projectId || null,
      targetProjectId: value.projectId || null,
    });
    this.schedule(key);
    this.notify();
    return this;
  }
  override delete(key: string) {
    const removed = super.delete(key);
    this.schedule(key);
    if (removed) this.notify();
    return removed;
  }
  isHeld = (key: string) => this.holds.has(key);
  hold(key: string) {
    this.holds.set(key, (this.holds.get(key) ?? 0) + 1);
    this.notify();
    return () => {
      const count = this.holds.get(key) ?? 0;
      if (count <= 1) this.holds.delete(key);
      else this.holds.set(key, count - 1);
      this.notify();
    };
  }
}
const Drafts = createContext<NoteDraftStore | null>(null);
const subscribeNone = () => () => {};
const zero = () => 0;
export function useNoteDraftRevision() {
  const drafts = useNoteDrafts();
  return useSyncExternalStore(
    drafts?.subscribe ?? subscribeNone,
    drafts?.snapshot ?? zero,
    zero,
  );
}
export function useDraftsInitializing() {
  const drafts = useNoteDrafts();
  return useSyncExternalStore(
    drafts?.subscribe ?? subscribeNone,
    () => drafts?.initializing ?? false,
    () => true,
  );
}
export function useDraftHeld(key: string) {
  const drafts = useNoteDrafts();
  return useSyncExternalStore(
    drafts?.subscribe ?? subscribeNone,
    () => drafts?.isHeld(key) ?? false,
    () => false,
  );
}

// Memory-only by default. Explicit device opt-in persists encrypted envelopes,
// never URLs/localStorage, credentials, query caches or permission decisions.
export function NoteDraftsProvider({
  account,
  children,
}: {
  account: string;
  children: React.ReactNode;
}) {
  const cache = useWorkspaceCache();
  const [drafts] = useState(
    () => new NoteDraftStore(new DraftRecovery(account), account),
  );
  useEffect(() => {
    void drafts.initialize(cache);
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(`grove-drafts:${account}`)
        : undefined;
    if (channel)
      channel.onmessage = (event) => {
        if (event.data?.erased === true) drafts.externalErase();
      };
    const unsubscribe = cache.observePrivacy((change) => {
      if (change.terminal) void drafts.forgetDevice().catch(() => {});
      else drafts.forgetScope(change);
    });
    return () => {
      channel?.close();
      unsubscribe();
      drafts.stop();
    };
  }, [drafts, cache, account]);
  useEffect(() => {
    const protectDrafts = (event: BeforeUnloadEvent) => {
      if (!drafts.size) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDrafts);
    return () => window.removeEventListener("beforeunload", protectDrafts);
  }, [drafts]);
  return <Drafts.Provider value={drafts}>{children}</Drafts.Provider>;
}

export const useNoteDrafts = () => useContext(Drafts);
