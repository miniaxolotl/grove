import { createHash, randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { tenant, type Knex } from "@lib/database";
import { InferenceError, type SpeechProviders } from "@lib/ai";
import { GroveError, type Principal } from "@lib/shared/contracts";
import {
  speechLimits,
  speechText,
  type SpeechRequest,
  type SpeechTask,
} from "@lib/shared/speech";
import type { MemoryService } from "./index.ts";
import {
  isSpeechVoice,
  speechVoices,
  type SpeechVoice,
  type SpeechVoiceId,
} from "@lib/shared/speech-voices";
import type { ArtifactStore } from "./exports.ts";
import { fingerprint } from "./tasks.ts";
import { budgetedInference } from "./processing.ts";
import { billingAllows } from "./billing-quotas.ts";
import {
  TaskError,
  taskTransaction,
  type ClaimedTask,
  type TaskHandler,
} from "./task-runner.ts";

const kinds = ["speech_transcribe", "speech_synthesize"] as const;
type Kind = (typeof kinds)[number];
type Payload = {
  memoryId: string;
  version: number;
  mediaId?: string;
  voiceId?: SpeechVoiceId;
  profile: string;
  preferenceVersion: number;
  epoch: number;
  sessionId: string;
  fingerprint: string;
  cacheKey: string;
  sha256?: string;
  textHash?: string;
  transcriptVersion?: number;
};
type Row = ClaimedTask & {
  payload: Payload;
  status: SpeechTask["status"];
  expiresAt: Date;
  errorCode: string | null;
};
const keys = (kind: string) =>
  kind === "speech_transcribe"
    ? ({
        preference: "transcriptionEnabled",
        version: "transcriptionVersion",
        provider: "transcription",
      } as const)
    : ({
        preference: "readAloudEnabled",
        version: "readAloudVersion",
        provider: "synthesis",
      } as const);
const unavailable = () =>
  new GroveError("speech_unavailable", "Speech is not configured", 503);
const changed = () =>
  new GroveError(
    "speech_changed",
    "The note, transcript or speech settings changed. Start again.",
    409,
  );

const synthesisProtocol = "speech-content-cache-v1";
type Configuration = {
  transcription: string | null;
  synthesis: string | null;
  synthesisProfiles: Partial<Record<SpeechVoiceId, string>>;
};
function configuredProfile(
  configuration: Configuration | undefined,
  kind: string,
  voiceId?: SpeechVoiceId,
) {
  if (kind === "speech_transcribe") return configuration?.transcription;
  return configuration?.synthesis === synthesisProtocol &&
    isSpeechVoice(voiceId)
    ? configuration.synthesisProfiles[voiceId]
    : undefined;
}
function selectedProvider(
  providers: SpeechProviders,
  kind: string,
  voiceId?: SpeechVoiceId,
) {
  return kind === "speech_transcribe"
    ? providers.transcription
    : isSpeechVoice(voiceId)
      ? providers.synthesis?.[voiceId]
      : undefined;
}

/** Only the API publishes desired installation profiles. Older workers may not
 * send source data or publish cached output after a provider/key/voice cutover. */
export async function configureSpeech(db: Knex, providers: SpeechProviders) {
  const profiles = Object.fromEntries(
    Object.entries(providers.synthesis ?? {}).map(([id, provider]) => [
      id,
      provider.profile,
    ]),
  );
  await db("speech_configuration")
    .where({ singleton: true })
    .update({
      transcription: providers.transcription?.profile ?? null,
      synthesis: Object.keys(profiles).length ? synthesisProtocol : null,
      synthesisProfiles: JSON.stringify(profiles),
    });
}
async function source(
  trx: Knex.Transaction,
  memoryId: string,
  version: number,
  mediaId?: string,
) {
  const note = await trx("memories")
    .where({ id: memoryId, status: "active" })
    .where((q) =>
      q.whereNull("expiresAt").orWhere("expiresAt", ">", trx.fn.now()),
    )
    .first();
  if (!note) throw new GroveError("not_found", "Note is unavailable", 404);
  if (note.version !== version) throw changed();
  if (mediaId) {
    const object = await trx("media_objects")
      .where({ id: mediaId, memoryId, status: "ready", mime: "audio/wav" })
      .whereExists(
        trx("media_revision_bindings")
          .select(trx.raw("1"))
          .where({ mediaId, memoryId, version }),
      )
      .first();
    if (!object)
      throw new GroveError("not_found", "Recording is unavailable", 404);
    const transcript = await trx("media_transcripts")
      .where({ mediaId })
      .first("version");
    return {
      object,
      text: "",
      units: Number(object.durationMs),
      transcriptVersion: transcript?.version ?? 0,
    };
  }
  const text = speechText(note.content);
  if (!text || text.length > speechLimits.text)
    throw new GroveError(
      "speech_text_limit",
      `Read aloud supports up to ${speechLimits.text} text characters.`,
      422,
    );
  return {
    object: undefined,
    text,
    textHash: createHash("sha256").update(note.content).digest("hex"),
    expiresAt: note.expiresAt,
    units: text.length,
    transcriptVersion: undefined,
  };
}
async function validate(
  trx: Knex.Transaction,
  row: Row,
  providers: SpeechProviders,
) {
  const account = await trx("accounts")
    .where({ id: row.accountId, status: "active" })
    .first();
  const key = keys(row.kind),
    payload = row.payload;
  if (
    !account?.[key.preference] ||
    account[key.version] !== payload.preferenceVersion
  )
    throw changed();
  const configuration = await trx("speech_configuration").first();
  if (
    !payload.profile ||
    configuredProfile(configuration, row.kind, payload.voiceId) !==
      payload.profile ||
    selectedProvider(providers, row.kind, payload.voiceId)?.profile !==
      payload.profile
  )
    throw changed();
  const control = await trx("processing_control").first("epoch");
  const session = await trx.raw(
    "SELECT grove_speech_session_active(?::uuid) AS active",
    [row.id],
  );
  const fresh = await trx("background_tasks")
    .where({ id: row.id })
    .where("expiresAt", ">", trx.fn.now())
    .first("id");
  if (control.epoch !== payload.epoch || !session.rows[0].active || !fresh)
    throw changed();
  const current = await source(
    trx,
    payload.memoryId,
    payload.version,
    payload.mediaId,
  );
  if (
    current.object &&
    (current.object.sha256 !== payload.sha256 ||
      current.transcriptVersion !== payload.transcriptVersion)
  )
    throw changed();
  if (row.kind === "speech_synthesize" && current.textHash !== payload.textHash)
    throw changed();
  return current;
}
const descriptor = (row: Row, error?: string): SpeechTask => ({
  id: row.id,
  kind: row.kind === "speech_transcribe" ? "transcription" : "readAloud",
  status: error ? "failed" : row.status,
  error: error ?? row.errorCode ?? null,
  ...(row.kind === "speech_synthesize" && isSpeechVoice(row.payload.voiceId)
    ? { voiceId: row.payload.voiceId }
    : {}),
  playable:
    !error && row.status === "succeeded" && row.kind === "speech_synthesize",
  ...(!error && row.status === "succeeded" && row.kind === "speech_transcribe"
    ? { transcript: String(row.result?.transcript ?? "") }
    : {}),
});
async function artifact(trx: Knex.Transaction, row: Row) {
  const object =
    row.result?.key &&
    (await trx("export_objects")
      .where({ accountId: row.accountId, objectKey: row.result.key })
      .where("expiresAt", ">", trx.fn.now())
      .first());
  if (!object) throw changed();
  return {
    key: String(object.objectKey),
    bytes: Number(object.bytes),
    mime: "audio/mpeg",
    sha256: String(row.result?.sha256),
  };
}

export class SpeechJobs {
  constructor(
    private service: MemoryService,
    private providers: SpeechProviders,
    private store?: ArtifactStore | null,
  ) {}
  async availability() {
    return (await this.describe()).speechAvailable;
  }
  async describe() {
    const configuration = await this.service.db("speech_configuration").first();
    const voices: SpeechVoice[] = speechVoices.map((voice) => {
      const provider = this.providers.synthesis?.[voice.id];
      const available =
        !!this.store &&
        !!provider &&
        configuredProfile(configuration, "speech_synthesize", voice.id) ===
          provider.profile;
      return {
        ...voice,
        available,
        ...(provider?.sampleId ? { sampleId: provider.sampleId } : {}),
      };
    });
    return {
      speechVoices: voices,
      speechAvailable: {
        transcription:
          !!this.providers.transcription &&
          configuration?.transcription === this.providers.transcription.profile,
        synthesis: voices.some((voice) => voice.available),
      },
    };
  }
  async enqueue(principal: Principal, memoryId: string, input: SpeechRequest) {
    const kind: Kind = input.mediaId
        ? "speech_transcribe"
        : "speech_synthesize",
      key = keys(kind);
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      if (!account[key.preference])
        throw new GroveError(
          "speech_disabled",
          "Enable this feature in AI preferences first.",
          403,
        );
      const old = await trx("background_tasks")
        .where({ id: input.id })
        .whereIn("kind", kinds)
        .first();
      const hash = fingerprint({ memoryId, ...input });
      if (old) {
        if (old.payload.fingerprint !== hash) throw changed();
        return this.present(trx, old);
      }
      const voiceId = input.mediaId
        ? undefined
        : (input.voiceId ?? account.readAloudVoiceId);
      const provider = selectedProvider(this.providers, kind, voiceId);
      if (!provider || (!input.mediaId && !this.store)) throw unavailable();
      const current = await source(trx, memoryId, input.version, input.mediaId);
      const { epoch } = await trx("processing_control").first("epoch");
      const owner = await trx("accounts").where({ id: account.id }).first();
      const payload: Payload = {
        memoryId,
        version: input.version,
        ...(input.mediaId
          ? {
              mediaId: input.mediaId,
              sha256: current.object.sha256,
              transcriptVersion: current.transcriptVersion,
            }
          : { voiceId, textHash: current.textHash }),
        profile: provider.profile,
        preferenceVersion: owner[key.version],
        epoch,
        sessionId: principal.sessionId ?? "",
        fingerprint: hash,
        cacheKey: "",
      };
      payload.cacheKey = fingerprint([
        account.id,
        memoryId,
        input.mediaId ? input.version : payload.textHash,
        voiceId,
        provider.profile,
        payload.preferenceVersion,
        epoch,
      ]);
      const configuration = await trx("speech_configuration").first();
      if (configuredProfile(configuration, kind, voiceId) !== provider.profile)
        throw unavailable();
      const pending = await trx("background_tasks")
        .whereIn("kind", kinds)
        .whereIn("status", ["pending", "running"])
        .count("id as count")
        .first();
      if (Number(pending?.count) >= 2)
        throw new GroveError(
          "speech_busy",
          "Wait for existing speech jobs, or cancel one.",
          429,
        );
      const cached =
        kind === "speech_synthesize" &&
        (await trx("export_objects")
          .where({ accountId: account.id, speechCacheKey: payload.cacheKey })
          .where("expiresAt", ">", trx.fn.now())
          .first());
      const [row] = await trx("background_tasks")
        .insert({
          id: input.id,
          accountId: account.id,
          kind,
          dedupeKey: input.id,
          payload: JSON.stringify(payload),
          expiresAt: trx.raw("now()+interval '1 day'"),
          ...(cached
            ? {
                status: "succeeded",
                result: JSON.stringify({
                  key: cached.objectKey,
                  bytes: Number(cached.bytes),
                  sha256: cached.speechSha256,
                }),
                finishedAt: trx.fn.now(),
              }
            : {}),
        })
        .onConflict("id")
        .ignore()
        .returning("*");
      if (!row) throw changed();
      return this.present(trx, row);
    });
  }
  private async present(trx: Knex.Transaction, row: Row) {
    if (row.status === "cancelled") return descriptor(row);
    try {
      await validate(trx, row, this.providers);
      if (row.status === "succeeded" && row.kind === "speech_synthesize")
        await artifact(trx, row);
      return descriptor(row);
    } catch (error) {
      if (error instanceof GroveError) return descriptor(row, "speech_changed");
      throw error;
    }
  }
  async get(principal: Principal, id: string) {
    return this.service.access(principal, "admin", async ({ trx }) => {
      const row = await trx("background_tasks")
        .where({ id })
        .whereIn("kind", kinds)
        .first();
      if (!row)
        throw new GroveError("not_found", "Speech job is unavailable", 404);
      return this.present(trx, row);
    });
  }
  async cancel(principal: Principal, id: string) {
    return this.service.access(principal, "admin", async ({ trx }) => {
      await trx("background_tasks")
        .where({ id })
        .whereIn("kind", kinds)
        .whereIn("status", ["pending", "running"])
        .update({
          status: "cancelled",
          leaseId: null,
          leaseUntil: null,
          finishedAt: trx.fn.now(),
          updatedAt: trx.fn.now(),
        });
      const row = await trx("background_tasks")
        .where({ id })
        .whereIn("kind", kinds)
        .first();
      if (!row)
        throw new GroveError("not_found", "Speech job is unavailable", 404);
      return this.present(trx, row);
    });
  }
  async audio(principal: Principal, id: string) {
    return this.service.access(principal, "admin", async ({ trx }) => {
      const row = await trx("background_tasks")
        .where({ id, kind: "speech_synthesize", status: "succeeded" })
        .first();
      if (!row) throw changed();
      await validate(trx, row, this.providers);
      return artifact(trx, row);
    });
  }
}

export function speechHandlers(
  service: MemoryService,
  providers: SpeechProviders,
  store: ArtifactStore | null,
  readSource: ((key: string, signal: AbortSignal) => Promise<Buffer>) | null,
  db = service.db,
  concurrency = 2,
): Partial<Record<Kind, TaskHandler>> {
  const execute: TaskHandler = async (claimed, parent) => {
    const row = claimed as Row,
      key = keys(row.kind);
    const stopped = new AbortController(),
      monitoring = new AbortController();
    const signal = AbortSignal.any([
      parent,
      stopped.signal,
      AbortSignal.timeout(60000),
    ]);
    const check = () =>
      tenant(db, row.accountId!, async (trx) => {
        await trx("accounts").where({ id: row.accountId }).forShare().first();
        const owned = await trx("background_tasks")
          .where({ id: row.id, leaseId: row.leaseId, status: "running" })
          .where("leaseUntil", ">", trx.fn.now())
          .forShare()
          .first();
        if (!owned) throw new TaskError("task_superseded", false);
        return validate(trx, row, providers);
      });
    let slot = false;
    const watcher = (async () => {
      try {
        while (!monitoring.signal.aborted) {
          await setTimeout(1000, undefined, { signal: monitoring.signal });
          await check();
        }
      } catch (error) {
        if (!monitoring.signal.aborted)
          stopped.abort(
            error instanceof TaskError
              ? error
              : new TaskError("speech_changed", false),
          );
      }
    })();
    try {
      const current = await check();
      const { rows } = await db.raw(
        "SELECT grove_speech_acquire(?::uuid,?::uuid,?) AS acquired",
        [row.id, row.leaseId, concurrency],
      );
      if (!rows[0].acquired) throw new TaskError("speech_provider_busy");
      slot = true;
      await tenant(db, row.accountId!, async (trx) => {
        await trx("accounts").where({ id: row.accountId }).forUpdate().first();
        await validate(trx, row, providers);
        const usage = await trx("speech_usage")
          .where({ kind: row.kind })
          .whereRaw("day=(now() AT TIME ZONE 'UTC')::date")
          .first();
        const limit =
          row.kind === "speech_transcribe"
            ? speechLimits.dailyAudioMs
            : speechLimits.dailyCharacters;
        if (
          (usage?.requests ?? 0) >= speechLimits.dailyRequests ||
          (usage?.units ?? 0) + current.units > limit ||
          !(await billingAllows(
            db,
            trx,
            row.accountId!,
            key.provider,
            current.units,
          ))
        )
          throw new TaskError("speech_budget", false);
        await trx.raw(
          `INSERT INTO speech_usage(account_id,kind,day,requests,units) VALUES(?,?,(now() AT TIME ZONE 'UTC')::date,1,?)
          ON CONFLICT(account_id,day,kind) DO UPDATE SET requests=speech_usage.requests+1,units=speech_usage.units+excluded.units`,
          [row.accountId, row.kind, current.units],
        );
      });
      const result = await budgetedInference(
        db,
        row.accountId!,
        key.provider,
        service.dailyRequestLimit,
        async () => {
          await check();
          signal.throwIfAborted();
          if (row.kind === "speech_transcribe") {
            if (!readSource || !providers.transcription || !current.object)
              throw new TaskError("speech_unavailable", false);
            const audio = await readSource(current.object.objectKey, signal);
            if (
              audio.length !== Number(current.object.bytes) ||
              createHash("sha256").update(audio).digest("hex") !==
                current.object.sha256
            )
              throw new TaskError("media_integrity", false);
            await check();
            signal.throwIfAborted();
            const transcript = await providers.transcription.transcribe(
              audio,
              signal,
            );
            if (transcript.length > 6000)
              throw new TaskError("speech_text_limit", false);
            return { transcript };
          }
          const provider =
            row.payload.voiceId && providers.synthesis?.[row.payload.voiceId];
          if (!store || !provider)
            throw new TaskError("speech_unavailable", false);
          const bytes = await provider.synthesize(current.text, signal);
          if (!bytes.length || bytes.length > speechLimits.audioBytes)
            throw new TaskError("speech_audio_limit", false);
          await check();
          signal.throwIfAborted();
          const objectKey = `narration/${row.accountId}/${row.id}/${randomUUID()}.mp3`;
          await tenant(db, row.accountId!, async (trx) => {
            await trx("accounts")
              .where({ id: row.accountId })
              .forUpdate()
              .first();
            await validate(trx, row, providers);
            await trx("export_objects").insert({
              objectKey,
              taskId: row.id,
              accountId: row.accountId,
              bytes: bytes.length,
            });
          });
          await store.write(objectKey, bytes, signal);
          return {
            key: objectKey,
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          };
        },
      );
      signal.throwIfAborted();
      await taskTransaction(db, row, async (trx) => {
        const source = await validate(trx, row, providers);
        if (row.kind === "speech_synthesize" && "key" in result) {
          // Publish retention and the receipt atomically, only after the write and
          // lease/source fences pass. Failed attempts retain their one-day expiry.
          await trx("export_objects")
            .where({ objectKey: result.key, taskId: row.id })
            .update({
              speechMemoryId: row.payload.memoryId,
              speechTextHash: row.payload.textHash,
              speechCacheKey: row.payload.cacheKey,
              speechSha256: result.sha256,
              expiresAt: source.expiresAt
                ? trx.raw("?::timestamptz+interval '7 days'", [
                    source.expiresAt,
                  ])
                : trx.raw("'infinity'::timestamptz"),
            });
        }
        return { complete: true, processed: 1, result };
      });
    } catch (error) {
      if (stopped.signal.aborted) throw stopped.signal.reason;
      if (error instanceof TaskError) throw error;
      if (error instanceof GroveError)
        throw new TaskError("speech_changed", false);
      if (error instanceof InferenceError)
        throw new TaskError(
          error.code,
          error.retryable && error.code !== "inference_budget",
        );
      throw error;
    } finally {
      monitoring.abort();
      await watcher;
      if (slot)
        await db.raw("SELECT grove_speech_release(?::uuid,?::uuid)", [
          row.id,
          row.leaseId,
        ]);
    }
  };
  return { speech_transcribe: execute, speech_synthesize: execute };
}
