// New parameterized version of the retained operator-control mechanism.
// No credential access or effects on import. Private state never lives in code.
import { createHash } from "node:crypto";
import process from "node:process";
import { open as openFile, mkdir as makeDirectory } from "node:fs/promises";
import { constants } from "node:fs";
import {
  resolve,
  dirname,
  basename,
  join,
  relative,
  isAbsolute,
} from "node:path";
export const need = (condition, code) => {
  if (!condition) throw Object.assign(new Error(code), { code });
};
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export const hashJSON = (value) => sha(canonical(value));
export const safeCode = (e) =>
  /^[A-Z0-9_]{2,64}$/.test(e?.code ?? "") ? e.code : "OPERATOR_FAILED";
export const uuid = (value) =>
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value ?? "");
const states = new Set([
  "pending",
  "backup_pending",
  "backup_captured",
  "restore_pending",
  "backup_verified",
  "backup_complete_hold",
  "transaction_pending",
  "transaction_started",
  "commit_pending",
  "committed_unverified_hold",
  "committed_hold",
  "rolled_back_hold",
  "failed_hold",
  "uncertain_hold",
  "cleanup_failed_hold",
]);
const fields = new Set([
  "source",
  "planHash",
  "manifestHash",
  "approvalHash",
  "code",
  "backupHash",
  "backupReceiptHash",
  "catalogHash",
  "rowsetsHash",
  "mediaHash",
  "providerHash",
  "transactionMs",
  "phaseMs",
  "hold",
  "fixtureOnly",
]);
export function createControl(
  root,
  {
    anchor,
    requireAnchors = false,
    expectedIdentity,
    fileSystem = { open: openFile, mkdir: makeDirectory },
  } = {},
) {
  const { open, mkdir } = fileSystem;
  need(isAbsolute(root), "PRIVATE_PATH_REJECTED");
  root = resolve(root);
  let identity = expectedIdentity;
  const scoped = (path) => {
    const p = resolve(path);
    need(p === root || p.startsWith(root + "/"), "PRIVATE_PATH_REJECTED");
    return p;
  };
  // Linux dirfd-relative traversal through pinned directory handles. No pathname
  // ancestor is followed after validation; every component is opened NOFOLLOW.
  async function directory(path, create = false) {
    const dir = scoped(path);
    let f = await open("/", constants.O_RDONLY | constants.O_DIRECTORY),
      current = "";
    try {
      for (const part of dir.split("/").filter(Boolean)) {
        current += "/" + part;
        const child = `/proc/self/fd/${f.fd}/${part}`;
        if (create && current.startsWith(root + "/")) {
          try {
            await mkdir(child, { mode: 0o700 });
            await f.sync();
          } catch (e) {
            if (e.code !== "EEXIST") throw e;
          }
        }
        const next = await open(
          child,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        await f.close();
        f = next;
        const s = await f.stat(),
          privatePart = current === root || current.startsWith(root + "/");
        need(
          s.isDirectory() &&
            [0, process.getuid()].includes(s.uid) &&
            (s.mode & (privatePart ? 0o077 : 0o022)) === 0 &&
            (!privatePart || s.uid === process.getuid()),
          "PRIVATE_DIRECTORY_REJECTED",
        );
        if (current === root) {
          const found = `${s.dev}:${s.ino}`;
          if (identity === undefined) identity = found;
          need(identity === found, "PRIVATE_ROOT_REPLACED");
        }
      }
      return f;
    } catch (e) {
      await f.close();
      throw e;
    }
  }
  async function assertIdentity() {
    const d = await directory(root);
    await d.close();
  }
  async function privateDirectory(path, { create = false } = {}) {
    const d = await directory(path, create);
    await d.close();
    return scoped(path);
  }
  async function readPrivate(
    path,
    { json = true, max = 2 * 1024 * 1024 } = {},
  ) {
    const p = scoped(path);
    const d = await directory(dirname(p));
    let f;
    try {
      f = await open(
        `/proc/self/fd/${d.fd}/${basename(p)}`,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } finally {
      await d.close();
    }
    try {
      const s = await f.stat();
      need(
        s.isFile() &&
          s.nlink === 1 &&
          s.uid === process.getuid() &&
          (s.mode & 0o077) === 0 &&
          s.size <= max,
        "PRIVATE_FILE_REJECTED",
      );
      const bytes = await f.readFile();
      await assertIdentity();
      need(bytes.length <= max, "PRIVATE_FILE_REJECTED");
      return json ? JSON.parse(bytes) : bytes;
    } finally {
      await f.close();
    }
  }
  async function syncDirectory(path) {
    const d = await directory(path);
    try {
      await d.sync();
    } finally {
      await d.close();
    }
  }
  async function durableWrite(path, bytes) {
    const p = scoped(path);
    const d = await directory(dirname(p));
    let f;
    try {
      f = await open(
        `/proc/self/fd/${d.fd}/${basename(p)}`,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
    } catch (e) {
      await d.close();
      throw e;
    }
    try {
      await f.writeFile(bytes);
      await f.sync();
      await d.sync();
      await assertIdentity();
    } finally {
      await f.close();
      await d.close();
    }
    await syncDirectory(dirname(p));
  }
  async function openJournal(
    journalDirectory,
    id,
    initial,
    { expiresAt, now = Date.now } = {},
  ) {
    need(!requireAnchors || anchor, "DURABLE_JOURNAL_AUTHORITY_REQUIRED");
    initial = JSON.parse(JSON.stringify(initial));
    need(uuid(id), "APPROVAL_ID_REJECTED");
    const dir = await privateDirectory(journalDirectory, { create: true }),
      path = join(dir, id + ".jsonl");
    const key = relative(root, path);
    const fresh = () =>
      need(
        expiresAt === undefined ||
          (Number.isSafeInteger(expiresAt) && expiresAt > now()),
        "QUALIFICATION_APPROVAL_EXPIRED",
      );
    fresh();
    if (anchor)
      await anchor.reserve(key, {
        rootIdentity: identity,
        binding: hashJSON(initial),
        ...(expiresAt === undefined ? {} : { expiresAt }),
      });
    let f;
    try {
      const d = await directory(dir);
      try {
        fresh();
        f = await open(
          `/proc/self/fd/${d.fd}/${id}.jsonl`,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
      } finally {
        await d.close();
      }
    } catch (e) {
      if (e.code === "EEXIST")
        throw Object.assign(Error("APPROVAL_ALREADY_CONSUMED"), {
          code: "APPROVAL_ALREADY_CONSUMED",
        });
      throw e;
    }
    let sequence = 0,
      previous = null,
      chain = Promise.resolve(),
      closed = false;
    const journal = {
      path,
      append(state, data = {}) {
        need(!closed, "JOURNAL_CLOSED");
        const operation = chain.then(async () => {
          need(states.has(state), "JOURNAL_STATE_REJECTED");
          for (const [k, v] of Object.entries(data))
            need(
              fields.has(k) &&
                (typeof v === "boolean" ||
                  (typeof v === "number" && Number.isFinite(v)) ||
                  (typeof v === "string" &&
                    /^[A-Za-z0-9_.:-]{1,128}$/.test(v))),
              "JOURNAL_PAYLOAD_REJECTED",
            );
          const record = {
              sequence: ++sequence,
              previous,
              state,
              at: Date.now(),
              ...data,
            },
            hash = hashJSON(record);
          await assertIdentity();
          await f.writeFile(JSON.stringify({ ...record, hash }) + "\n");
          await f.sync();
          await assertIdentity();
          if (anchor)
            await anchor.advance(
              key,
              { sequence: sequence - 1, hash: previous },
              { sequence, hash },
              { rootIdentity: identity },
            );
          previous = hash;
        });
        chain = operation;
        return operation;
      },
      async close() {
        if (closed) return;
        closed = true;
        try {
          await chain;
        } finally {
          await f.close();
        }
      },
    };
    try {
      await journal.append("pending", initial);
      await syncDirectory(dir);
    } catch (e) {
      await journal.close().catch(() => {});
      throw e;
    }
    return journal;
  }
  async function readJournal(path, { fixtureEvidence = false } = {}) {
    need(
      fixtureEvidence || !requireAnchors || anchor,
      "DURABLE_JOURNAL_AUTHORITY_REQUIRED",
    );
    const bytes = await readPrivate(path, { json: false }),
      text = bytes.toString(),
      incomplete = !text.endsWith("\n"),
      lines = text.split("\n");
    lines.pop();
    let records;
    try {
      records = lines.map((s) => JSON.parse(s));
    } catch {
      need(false, "JOURNAL_CORRUPT");
    }
    let previous = null;
    for (const [i, { hash, ...r }] of records.entries()) {
      need(
        states.has(r.state) &&
          r.sequence === i + 1 &&
          r.previous === previous &&
          Number.isFinite(r.at) &&
          hashJSON(r) === hash,
        "JOURNAL_CORRUPT",
      );
      previous = hash;
    }
    if (anchor && !fixtureEvidence) {
      const head = await anchor.head(relative(root, scoped(path)), {
        rootIdentity: identity,
      });
      need(
        head && head.sequence === records.length && head.hash === previous,
        "JOURNAL_ANCHOR_MISMATCH",
      );
    }
    return {
      records,
      last: records.at(-1) ?? { state: "uncertain_hold", at: 0 },
      requiresReconciliation: incomplete || records.length === 0,
      incompleteTail: incomplete,
    };
  }
  return {
    root,
    scoped,
    privateDirectory,
    readPrivate,
    durableWrite,
    openJournal,
    readJournal,
    assertIdentity,
  };
}
// The CLI only loads this facade after operatorManifest has admitted the install.
const installed = new Map();
export async function installedControl() {
  need(process.env.GROVE_OPERATOR_CUSTODY_ROOT, "OPERATOR_NOT_CONFIGURED");
  const root = process.env.GROVE_OPERATOR_CUSTODY_ROOT;
  const reader = createControl(root, { requireAnchors: true }),
    config = await reader.readPrivate(root + "/installation.json");
  const { validateConfig } = await import("./config.mjs");
  validateConfig(config);
  need(
    config.authority?.workRoot === root &&
      config.authority.source === config.inventory.source,
    "AUTHORITY_INSTALLATION_BINDING",
  );
  const { readTrustedPin } =
      await import("../../scripts/release/held-operator-bootstrap.mjs"),
    trusted = await readTrustedPin();
  const { openAuthority, assertPinnedAuthority } =
    await import("./authority.mjs");
  assertPinnedAuthority(config.authority, trusted);
  const anchor = openAuthority(config.authority);
  await anchor.status();
  const binding = hashJSON(config.authority);
  if (!installed.has(root))
    installed.set(root, {
      binding,
      control: createControl(root, {
        anchor,
        requireAnchors: true,
        expectedIdentity: config.authority.workIdentity,
      }),
    });
  need(
    installed.get(root).binding === binding,
    "AUTHORITY_CONFIGURATION_CHANGED",
  );
  return installed.get(root).control;
}
export const readPrivate = async (...args) =>
  (await installedControl()).readPrivate(...args);
export const readJournal = async (...args) =>
  (await installedControl()).readJournal(...args);
export const openJournal = async (...args) =>
  (await installedControl()).openJournal(...args);
