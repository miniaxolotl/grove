import { InferenceError } from "@lib/ai";
import { databaseSignal } from "@lib/database";
import {
  retrievalReasons,
  type RetrievalDiagnostic,
  type RetrievalReason,
} from "@lib/shared/contracts";
import { currentTelemetry } from "@lib/telemetry/context";

/** Never expose arbitrary provider messages, input, identifiers or cache keys. */
function failureReason(error: unknown): RetrievalReason {
  try {
    if (
      error instanceof InferenceError &&
      (retrievalReasons as readonly string[]).includes(error.code)
    )
      return error.code as RetrievalReason;
  } catch {
    /* Hostile error getters are not diagnostics. */
  }
  return "query_unavailable";
}

export async function retrievalEmbedding(
  requested: "hybrid" | "lexical",
  run?: () => Promise<number[]>,
  signal?: AbortSignal,
  fallback: RetrievalReason = "not_configured",
): Promise<{ vector?: number[]; retrieval: RetrievalDiagnostic }> {
  signal ??= databaseSignal();
  const started = performance.now();
  let vector: number[] | undefined;
  let reason: RetrievalReason | undefined;
  signal?.throwIfAborted();
  if (requested === "hybrid") {
    if (!run) reason = fallback;
    else {
      try {
        vector = await run();
      } catch (error) {
        signal?.throwIfAborted();
        reason = failureReason(error);
      }
    }
  }
  const retrieval: RetrievalDiagnostic = {
    requested,
    executed: vector ? "hybrid" : "lexical",
    ...(reason ? { reason } : {}),
  };
  currentTelemetry().capture("retrieval_completed", {
    retrieval_mode: retrieval.executed,
    retrieval_reason: reason,
    duration_ms: performance.now() - started,
  });
  return { vector, retrieval };
}
