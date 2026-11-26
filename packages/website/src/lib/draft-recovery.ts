/** Device-only, opt-in draft envelopes. Never persist tokens or the query cache. */
export const recoveryLimits = {
  drafts: 32,
  bytes: 1_048_576,
  ageMs: 7 * 86400_000,
};
type Owner = { id: string; epoch: string; key?: CryptoKey };
export type DraftScope = {
  noteId?: string;
  projectId: string | null;
  targetProjectId?: string | null;
};
type Envelope = DraftScope & {
  id: string;
  owner: string;
  name: string;
  sequence: number;
  expires: number;
  checkpoint: number;
  iv?: Uint8Array<ArrayBuffer>;
  ciphertext?: ArrayBuffer;
};
const request = <T>(value: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
const complete = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("Device storage transaction interrupted"));
  });
function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(
      () =>
        fail(
          new Error("Device storage did not open. Keep your text in this tab."),
        ),
      3000,
    );
    let value: IDBOpenDBRequest;
    try {
      value = indexedDB.open("grove-draft-recovery", 1);
    } catch (error) {
      fail(error);
      return;
    }
    value.onupgradeneeded = () => {
      value.result.createObjectStore("owners", { keyPath: "id" });
      const drafts = value.result.createObjectStore("drafts", {
        keyPath: "id",
      });
      drafts.createIndex("owner", "owner");
    };
    value.onerror = () => fail(value.error);
    value.onblocked = () =>
      fail(new Error("Close an older Grove tab to use device recovery"));
    value.onsuccess = () => {
      clearTimeout(timer);
      if (settled) value.result.close();
      else {
        settled = true;
        resolve(value.result);
      }
    };
  });
}
const associatedData = (owner: Owner, row: Envelope) =>
  new TextEncoder().encode(
    JSON.stringify([
      1,
      owner.id,
      owner.epoch,
      row.name,
      row.sequence,
      row.expires,
      row.noteId ?? null,
      row.projectId,
      row.targetProjectId ?? null,
    ]),
  );
const envelopeBytes = (row: Envelope) =>
  new TextEncoder().encode(
    JSON.stringify({ ...row, ciphertext: undefined, iv: undefined }),
  ).byteLength +
  (row.ciphertext?.byteLength ?? 0) +
  (row.iv?.byteLength ?? 0);

export class DraftRecovery {
  private db?: IDBDatabase;
  private opening?: Promise<IDBDatabase>;
  private lifetime = 0;
  private owner?: Owner;
  private sequence = new Map<string, number>();
  private expires = new Map<string, number>();
  private closed = false;
  constructor(private account: string) {}
  private async database() {
    if (this.closed) throw new Error("Device recovery session ended");
    if (!this.db) {
      const lifetime = this.lifetime;
      const opening = (this.opening ??= open());
      const db = await opening.finally(() => {
        if (this.opening === opening) this.opening = undefined;
      });
      if (this.closed || lifetime !== this.lifetime) {
        db.close();
        throw new Error("Device recovery session ended");
      }
      this.db = db;
      db.onversionchange = () => this.close();
    }
    return this.db;
  }
  async initialize() {
    const db = await this.database();
    const tx = db.transaction(["owners", "drafts"], "readonly");
    const done = complete(tx);
    const [owner, rows] = await Promise.all([
      request<Owner | undefined>(tx.objectStore("owners").get(this.account)),
      request<Envelope[]>(
        tx.objectStore("drafts").index("owner").getAll(this.account),
      ),
    ]);
    await done;
    this.owner = owner;
    this.sequence = new Map(rows.map((row) => [row.name, row.sequence]));
    this.expires = new Map(rows.map((row) => [row.name, row.expires]));
    return {
      enabled: !!owner?.key,
      rows: rows.filter((row) => !!row.ciphertext),
    };
  }
  async enable() {
    const db = await this.database();
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const tx = db.transaction(["owners", "drafts"], "readwrite");
    const done = complete(tx);
    const store = tx.objectStore("owners");
    const current: Owner | undefined = await request(store.get(this.account));
    const rows: Envelope[] = await request(
      tx.objectStore("drafts").index("owner").getAll(this.account),
    );
    if (!current?.key && rows.some((row) => !!row.ciphertext)) {
      tx.abort();
      await done.catch(() => {});
      throw new Error(
        "The device recovery key is unavailable. Export open text, then explicitly forget device checkpoints before enabling a new key.",
      );
    }
    const owner = current?.key
      ? current
      : { id: this.account, epoch: crypto.randomUUID(), key };
    store.put(owner);
    await done;
    if (this.owner?.epoch !== owner.epoch) {
      this.sequence.clear();
      this.expires.clear();
    }
    this.owner = owner;
  }
  async erase() {
    const db = await this.database();
    const tx = db.transaction(["owners", "drafts"], "readwrite");
    const done = complete(tx);
    this.owner = { id: this.account, epoch: crypto.randomUUID() };
    tx.objectStore("owners").put(this.owner);
    const rows: Envelope[] = await request(
      tx.objectStore("drafts").index("owner").getAll(this.account),
    );
    for (const row of rows) tx.objectStore("drafts").delete(row.id);
    await done;
    this.sequence.clear();
    this.expires.clear();
  }
  async eraseScope(change: {
    names?: string[];
    ids?: string[];
    scopes?: (string | null)[];
  }) {
    const db = await this.database();
    const tx = db.transaction("drafts", "readwrite");
    const done = complete(tx);
    const store = tx.objectStore("drafts");
    const rows: Envelope[] = await request(
      store.index("owner").getAll(this.account),
    );
    const tombstones: Envelope[] = [];
    for (const row of rows) {
      if (
        !change.names?.includes(row.name) &&
        !(row.noteId && change.ids?.includes(row.noteId)) &&
        !change.scopes?.includes(row.projectId) &&
        !(row.targetProjectId && change.scopes?.includes(row.targetProjectId))
      )
        continue;
      const tombstone = {
        ...row,
        ciphertext: undefined,
        iv: undefined,
        sequence: row.sequence + 1,
        expires: Date.now() + recoveryLimits.ageMs,
      };
      store.put(tombstone);
      tombstones.push(tombstone);
    }
    await done;
    for (const row of tombstones) {
      this.sequence.set(row.name, row.sequence);
      this.expires.set(row.name, row.expires);
    }
  }
  async decrypt<T>(row: Envelope): Promise<T> {
    const owner = this.owner;
    if (!owner?.key || row.expires <= Date.now() || !row.ciphertext || !row.iv)
      throw new Error("Device recovery expired or is unavailable");
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: row.iv,
        additionalData: associatedData(owner, row),
      },
      owner.key,
      row.ciphertext,
    );
    const db = await this.database();
    const tx = db.transaction(["owners", "drafts"], "readonly");
    const done = complete(tx);
    const [current, envelope] = await Promise.all([
      request<Owner | undefined>(tx.objectStore("owners").get(this.account)),
      request<Envelope | undefined>(tx.objectStore("drafts").get(row.id)),
    ]);
    await done;
    if (
      this.closed ||
      !current?.key ||
      current.epoch !== owner.epoch ||
      envelope?.sequence !== row.sequence ||
      !envelope.ciphertext ||
      row.expires <= Date.now()
    )
      throw new Error("Device recovery changed while unlocking");
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  }
  async write(name: string, scope: DraftScope, value: unknown | null) {
    const db = await this.database();
    const lifetime = this.lifetime;
    const owner = this.owner;
    if (!owner?.key) throw new Error("Device recovery is off");
    const expected = this.sequence.get(name) ?? 0;
    // Encryption happens outside the transaction. The final epoch/sequence check
    // fences disable/sign-out and other tabs even if crypto finishes late.
    const expires =
      value === null
        ? Date.now() + recoveryLimits.ageMs
        : (this.expires.get(name) ?? Date.now() + recoveryLimits.ageMs);
    if (expires <= Date.now())
      throw new Error(
        "This device checkpoint expired. Save or export your text before resetting device recovery.",
      );
    const row: Envelope = {
      ...scope,
      id: JSON.stringify([this.account, name]),
      owner: this.account,
      name,
      sequence: expected + 1,
      checkpoint: Date.now(),
      expires,
    };
    if (value !== null) {
      row.iv = crypto.getRandomValues(new Uint8Array(12));
      row.ciphertext = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: row.iv,
          additionalData: associatedData(owner, row),
        },
        owner.key,
        new TextEncoder().encode(JSON.stringify(value)),
      );
    }
    const tx = db.transaction(["owners", "drafts"], "readwrite");
    const done = complete(tx);
    const drafts = tx.objectStore("drafts");
    const [current, rows] = await Promise.all([
      request<Owner | undefined>(tx.objectStore("owners").get(this.account)),
      request<Envelope[]>(drafts.index("owner").getAll(this.account)),
    ]);
    const previous = rows.find((item) => item.name === name);
    const others = rows.filter(
      (item) => item.name !== name && item.expires > Date.now(),
    );
    let failure = "";
    if (
      this.closed ||
      lifetime !== this.lifetime ||
      !current?.key ||
      current.epoch !== owner.epoch
    )
      failure = "Device recovery changed in another tab";
    else if ((previous?.sequence ?? 0) !== expected)
      failure =
        "Another tab changed this recovery draft. Copy your text before closing this tab.";
    else if (
      row.ciphertext &&
      (others.filter((item) => !!item.ciphertext).length >=
        recoveryLimits.drafts ||
        others.reduce(
          (sum, item) => sum + envelopeBytes(item),
          envelopeBytes(row),
        ) > recoveryLimits.bytes)
    )
      failure =
        "Device recovery is full. Save or export a draft before trying again.";
    if (failure) {
      tx.abort();
      await done.catch(() => {});
      throw new Error(failure);
    }
    // Never silently evict live drafts. Expired envelopes and old tombstones
    // can be removed; stale writers still fail their nonzero expected sequence.
    for (const item of rows)
      if (item.expires <= Date.now()) drafts.delete(item.id);
    drafts.put(row);
    await done;
    this.sequence.set(name, row.sequence);
    this.expires.set(name, row.expires);
    return row.checkpoint;
  }
  close() {
    this.closed = true;
    this.lifetime++;
    this.opening = undefined;
    this.db?.close();
    this.db = undefined;
  }
  resume() {
    this.closed = false;
  }
}

export async function eraseDeviceDrafts(account: string) {
  const recovery = new DraftRecovery(account);
  try {
    await recovery.erase();
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(`grove-drafts:${account}`);
      channel.postMessage({ erased: true });
      channel.close();
    }
  } finally {
    recovery.close();
  }
}
