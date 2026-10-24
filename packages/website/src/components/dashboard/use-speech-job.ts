"use client";

import { useEffect, useRef, useState } from "react";
import type { SpeechTask, SpeechRequest } from "@lib/shared/speech";
import type { SpeechVoiceId } from "@lib/shared/speech-voices";
import { api, DashboardApiError, errorMessage } from "@/lib/dashboard-api";

export type SpeechSource = {
  noteId: string;
  version: number;
  mediaId?: string;
  voiceId?: SpeechVoiceId;
};
type Attempt = {
  noteId: string;
  input: SpeechRequest;
  abandoned: boolean;
};
export const activeSpeech = (job: SpeechTask | null) =>
  !!job && ["pending", "running"].includes(job.status);

async function cancelOwned(id: string) {
  // A close may beat the enqueue commit. Retain the ID for bounded, idempotent
  // cancellation retries; a later enqueue settlement also attempts cancellation.
  for (const delay of [0, 250, 1000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await api<SpeechTask>(
        `/speech/${id}/cancel`,
        {},
        "POST",
        AbortSignal.timeout(5000),
      );
    } catch (error) {
      if (
        error instanceof DashboardApiError &&
        [401, 403].includes(error.status)
      )
        return;
    }
  }
}

/** Mount with a key for the source/voice. Every response also checks its attempt. */
export function useSpeechJob(source: SpeechSource) {
  const [job, setJob] = useState<SpeechTask | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const operation = useRef<Attempt | null>(null);
  const sending = useRef(false);
  const current = useRef<SpeechTask | null>(null);
  useEffect(
    () => () => {
      const attempt = operation.current;
      if (!attempt) return;
      attempt.abandoned = true;
      operation.current = null;
      if (!current.current || activeSpeech(current.current))
        void cancelOwned(attempt.input.id);
    },
    [],
  );
  useEffect(() => {
    const attempt = operation.current;
    if (!job || !activeSpeech(job) || !attempt || attempt.abandoned) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const next = await api<SpeechTask>(
          `/speech/${job.id}`,
          undefined,
          undefined,
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          attempt.abandoned ||
          operation.current !== attempt
        )
          return;
        if (
          next.id !== attempt.input.id ||
          (attempt.input.voiceId && next.voiceId !== attempt.input.voiceId)
        )
          throw new Error("The voice changed. Start again.");
        current.current = next;
        setJob(next);
        setError("");
      } catch (cause) {
        if (!controller.signal.aborted && !attempt.abandoned)
          setError(errorMessage(cause));
      }
    }, 1000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [job, refresh]);
  function clear() {
    const attempt = operation.current;
    if (attempt) {
      attempt.abandoned = true;
      if (!current.current || activeSpeech(current.current))
        void cancelOwned(attempt.input.id);
    }
    operation.current = null;
    current.current = null;
    setJob(null);
    setError("");
    setBusy(false);
    sending.current = false;
  }
  return {
    job,
    error,
    busy,
    clear,
    refresh() {
      setError("");
      setRefresh((value) => value + 1);
    },
    async cancel() {
      const attempt = operation.current;
      if (!attempt) return;
      attempt.abandoned = true;
      setBusy(true);
      setError("");
      const next = await cancelOwned(attempt.input.id);
      if (operation.current !== attempt) return;
      if (
        next?.id === attempt.input.id &&
        (!source.voiceId || next.voiceId === source.voiceId)
      ) {
        current.current = next;
        setJob(next);
      } else {
        // Keep a fresh read identity while fencing the old enqueue response.
        operation.current = { ...attempt, abandoned: false };
        setJob(current.current ? { ...current.current } : null);
        setError("Cancellation couldn’t be confirmed. Check again.");
      }
      setBusy(false);
      sending.current = false;
    },
    async start() {
      if (sending.current || activeSpeech(job)) return;
      if (job) operation.current = null;
      const attempt = operation.current ?? {
        noteId: source.noteId,
        input: {
          id: crypto.randomUUID(),
          version: source.version,
          ...(source.mediaId
            ? { mediaId: source.mediaId }
            : { voiceId: source.voiceId }),
        },
        abandoned: false,
      };
      operation.current = attempt;
      sending.current = true;
      current.current = null;
      setJob(null);
      setBusy(true);
      setError("");
      const live = () => !attempt.abandoned && operation.current === attempt;
      try {
        // Let this write settle on close so its late receipt can be cancelled.
        // Reads and players are stopped immediately; no late result reaches UI.
        const next = await api<SpeechTask>(
          `/memories/${attempt.noteId}/speech`,
          attempt.input,
          "POST",
          AbortSignal.timeout(30000),
        );
        if (!live()) return;
        if (
          next.id !== attempt.input.id ||
          (attempt.input.voiceId && next.voiceId !== attempt.input.voiceId)
        )
          throw new Error("The voice changed. Start again.");
        current.current = next;
        setJob(next);
      } catch (cause) {
        if (live()) setError(errorMessage(cause));
      } finally {
        if (live()) {
          sending.current = false;
          setBusy(false);
        } else void cancelOwned(attempt.input.id);
      }
    },
  };
}
