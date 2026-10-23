"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Volume2, X } from "lucide-react";
import type { SpeechTask } from "@lib/shared/speech";
import type { AccountPreferences } from "@lib/shared/preferences";
import { api, errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { AudioPlayer } from "./audio-player";
import "./speech-controls.css";

type Source = { noteId: string; version: number; mediaId?: string };
type SpeechAccount = AccountPreferences & {
  speechAvailable?: { transcription: boolean; synthesis: boolean };
};
const active = (job: SpeechTask | null) =>
  !!job && ["pending", "running"].includes(job.status);
function useSpeechAccess(source: Source, enabled: boolean) {
  const cache = useWorkspaceCache();
  const query = useQuery({ ...cache.resource<SpeechAccount>("/me"), enabled });
  return {
    checking: query.isLoading,
    enabled:
      !!query.data?.[
        source.mediaId ? "transcriptionEnabled" : "readAloudEnabled"
      ],
    available:
      !!query.data?.speechAvailable?.[
        source.mediaId ? "transcription" : "synthesis"
      ],
  };
}
function useSpeechJob(source: Source) {
  const [job, setJob] = useState<SpeechTask | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const operation = useRef<string | null>(null),
    work = useRef<AbortController | null>(null),
    current = useRef<SpeechTask | null>(null);
  // Candidates and binary audio never enter the workspace read cache or storage.
  useEffect(
    () => () => {
      work.current?.abort();
      const id = operation.current;
      if (id && (!current.current || active(current.current)))
        void api(`/speech/${id}/cancel`, {}).catch(() => {});
    },
    [],
  );
  useEffect(() => {
    if (!job || !active(job)) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const next = await api<SpeechTask>(
          `/speech/${job.id}`,
          undefined,
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          current.current = next;
          setJob(next);
          setError("");
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(errorMessage(error));
      }
    }, 1000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [job, refresh]);
  function clear() {
    setJob(null);
    setError("");
    current.current = null;
    operation.current = null;
  }
  async function cancel() {
    if (!operation.current) return;
    work.current?.abort();
    const controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setError("");
    try {
      const next = await api<SpeechTask>(
        `/speech/${operation.current}/cancel`,
        {},
        "POST",
        controller.signal,
      );
      if (!controller.signal.aborted) {
        current.current = next;
        setJob(next);
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return {
    job,
    busy,
    error,
    refresh() {
      setError("");
      setRefresh((value) => value + 1);
    },
    clear,
    cancel,
    dismiss() {
      // A missing response is not a terminal job: retain its operation identity
      // and attempt cancellation before it can be forgotten on close/unmount.
      if (operation.current && (!current.current || active(current.current)))
        void cancel();
      else clear();
    },
    async start() {
      if (busy || active(job)) return;
      if (job) operation.current = null;
      operation.current ??= crypto.randomUUID();
      current.current = null;
      setJob(null);
      const controller = new AbortController();
      work.current = controller;
      setBusy(true);
      setError("");
      try {
        const next = await api<SpeechTask>(
          `/memories/${source.noteId}/speech`,
          {
            id: operation.current,
            version: source.version,
            ...(source.mediaId ? { mediaId: source.mediaId } : {}),
          },
          "POST",
          controller.signal,
        );
        if (!controller.signal.aborted) {
          current.current = next;
          setJob(next);
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(errorMessage(error));
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    },
  };
}
function JobControls({
  controller,
  label,
}: {
  controller: ReturnType<typeof useSpeechJob>;
  label: string;
}) {
  const { job, error, busy } = controller;
  if (job?.status === "succeeded" && !error) return null;
  return (
    <span className="speech-actions">
      {active(job) ? (
        <>
          <span role="status">
            {job?.status === "pending"
              ? "Queued…"
              : label === "Transcribe"
                ? "Transcribing…"
                : "Preparing audio…"}
          </span>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void controller.cancel()}
          >
            Cancel speech
          </button>
        </>
      ) : job?.status !== "succeeded" ? (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => void controller.start()}
        >
          {busy ? "Requesting…" : job ? "Try again" : label}
        </button>
      ) : null}
      {job?.status === "failed" && (
        <span role="status">
          {job.error === "speech_budget" || job.error === "inference_budget"
            ? "Speech limit reached. Try tomorrow."
            : job.error === "speech_changed"
              ? "The source or settings changed. Start again."
              : "Speech couldn’t finish. Try again."}
        </span>
      )}
      {job?.status === "cancelled" && <span role="status">Cancelled.</span>}
      {error && (
        <span role="alert">
          {error}{" "}
          {active(job) && (
            <button
              type="button"
              className="text-button"
              onClick={controller.refresh}
            >
              Check again
            </button>
          )}
        </span>
      )}
    </span>
  );
}
function Permission({
  access,
  feature,
}: {
  access: ReturnType<typeof useSpeechAccess>;
  feature: "Recording transcription" | "Read aloud";
}) {
  return (
    <span className="speech-permission">
      {access.checking ? (
        "Checking speech…"
      ) : !access.available ? (
        `${feature} is currently unavailable.`
      ) : (
        <>
          Turn on {feature} in <Link href="/app/settings">AI preferences</Link>.
        </>
      )}
    </span>
  );
}
export function TranscribeRecording({
  noteId,
  version,
  mediaId,
  hasDraft,
  onUse,
}: Source & {
  mediaId: string;
  hasDraft: boolean;
  onUse: (text: string) => void;
}) {
  const source = { noteId, version, mediaId },
    access = useSpeechAccess(source, true),
    controller = useSpeechJob(source);
  if (!access.enabled || !access.available)
    return <Permission access={access} feature="Recording transcription" />;
  return (
    <span className="speech-transcription">
      <JobControls controller={controller} label="Transcribe" />
      {controller.job?.transcript !== undefined && (
        <span className="speech-candidate">
          <span className="speech-label">Suggested transcript</span>
          <span className="speech-candidate-text">
            {controller.job.transcript || "No speech detected."}
          </span>
          <button
            type="button"
            className="text-button"
            disabled={!controller.job.transcript.trim()}
            onClick={() => {
              onUse(controller.job!.transcript!);
              controller.clear();
            }}
          >
            {hasDraft
              ? "Replace draft with transcription"
              : "Use transcription"}
          </button>
        </span>
      )}
    </span>
  );
}
export function ReadAloud({ noteId, version }: Source) {
  const [open, setOpen] = useState(false);
  const source = { noteId, version },
    access = useSpeechAccess(source, open),
    controller = useSpeechJob(source);
  const close = () => {
    controller.dismiss();
    setOpen(false);
  };
  return (
    <div className="speech-read-aloud">
      <button
        type="button"
        className="text-button speech-trigger"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Volume2 size={16} aria-hidden="true" />
        Read aloud
      </button>
      {open && (
        <div className="speech-panel">
          <button
            type="button"
            className="speech-close"
            aria-label="Close read aloud"
            onClick={close}
          >
            <X size={16} aria-hidden="true" />
          </button>
          {!access.enabled || !access.available ? (
            <Permission access={access} feature="Read aloud" />
          ) : (
            <>
              <JobControls controller={controller} label="Prepare audio" />
              {controller.job?.playable && (
                <>
                  <span className="speech-label">AI-generated voice</span>
                  <AudioPlayer
                    label="read-aloud audio"
                    src={`/api/grove/speech/${controller.job.id}/audio`}
                  />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
