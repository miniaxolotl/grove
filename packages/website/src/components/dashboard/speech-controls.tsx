"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Volume2, X } from "lucide-react";
import type { AccountSettings } from "@lib/shared/account-settings";
import {
  defaultSpeechVoice,
  type SpeechVoice,
  type SpeechVoiceId,
} from "@lib/shared/speech-voices";
import { useWorkspaceCache } from "./workspace-cache";
import { AudioPlayer } from "./audio-player";
import { VoiceSelector } from "./voice-selector";
import { useSpeechJob, activeSpeech as active } from "./use-speech-job";
import "./speech-controls.css";

type Source = { noteId: string; version: number; mediaId?: string };
type SpeechAccount = AccountSettings & {
  speechAvailable?: { transcription: boolean; synthesis: boolean };
  speechVoices?: SpeechVoice[];
};
function useSpeechAccess(source: Source, enabled: boolean) {
  const cache = useWorkspaceCache();
  const query = useQuery({ ...cache.resource<SpeechAccount>("/me"), enabled });
  return {
    account: query.data,
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
function JobControls({
  controller,
  label,
  onStart,
}: {
  controller: ReturnType<typeof useSpeechJob>;
  label: string;
  onStart?: () => void;
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
          onClick={() => {
            onStart?.();
            void controller.start();
          }}
        >
          {busy ? "Requesting…" : job ? "Try again" : label}
        </button>
      ) : null}
      {job?.status === "failed" && (
        <span role="status">
          {job.error === "speech_budget" || job.error === "inference_budget"
            ? "Speech allowance reached. Check Settings for usage and reset dates."
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
  return (
    <ReadAloudSource
      key={`${noteId}:${version}`}
      noteId={noteId}
      version={version}
    />
  );
}
function ReadAloudSource({ noteId, version }: Source) {
  const [open, setOpen] = useState(false);
  const source = { noteId, version };
  const access = useSpeechAccess(source, open);
  const cache = useWorkspaceCache();
  const [selected, setSelected] = useState<SpeechVoiceId | null>(null);
  const [remembering, setRemembering] = useState<"saved" | "saving" | "failed">(
    "saved",
  );
  const saveGeneration = useRef(0);
  const voiceId =
    selected ?? access.account?.readAloudVoiceId ?? defaultSpeechVoice;
  const close = () => setOpen(false);
  async function remember(value: SpeechVoiceId) {
    const generation = ++saveGeneration.current;
    setSelected(value);
    setRemembering("saving");
    try {
      await cache.api(
        "/account/settings",
        { readAloudVoiceId: value },
        "PATCH",
      );
      if (saveGeneration.current === generation) setRemembering("saved");
    } catch {
      if (saveGeneration.current === generation) setRemembering("failed");
    }
  }
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
          {access.account && (
            <ReadAloudVoice
              source={source}
              voiceId={voiceId}
              access={access}
              remembering={remembering}
              onChange={(value) => void remember(value)}
              onRetry={() => void remember(voiceId)}
              onPrepare={() => setSelected(voiceId)}
            />
          )}
          {!access.account && (
            <Permission access={access} feature="Read aloud" />
          )}
        </div>
      )}
    </div>
  );
}

function ReadAloudVoice({
  source,
  voiceId,
  access,
  remembering,
  onChange,
  onRetry,
  onPrepare,
}: {
  source: Source;
  voiceId: SpeechVoiceId;
  access: ReturnType<typeof useSpeechAccess>;
  remembering: "saved" | "saving" | "failed";
  onChange: (value: SpeechVoiceId) => void;
  onRetry: () => void;
  onPrepare: () => void;
}) {
  const [sampleGeneration, setSampleGeneration] = useState(0);
  const voice = access.account?.speechVoices?.find(
    (entry) => entry.id === voiceId,
  );
  return (
    <>
      <VoiceSelector
        key={sampleGeneration}
        value={voiceId}
        voices={access.account?.speechVoices}
        remembered={access.account?.readAloudVoiceId}
        onChange={onChange}
      />
      {remembering !== "saved" && (
        <span className="speech-remembering" role="status">
          {remembering === "saving" ? (
            "Remembering voice…"
          ) : (
            <>
              Voice wasn’t remembered.{" "}
              <button type="button" className="text-button" onClick={onRetry}>
                Retry saving voice
              </button>
            </>
          )}
        </span>
      )}
      {!access.enabled || !access.available ? (
        <Permission access={access} feature="Read aloud" />
      ) : (
        voice?.available && (
          <SpeechPreparation
            key={voiceId}
            source={source}
            voice={voice}
            onPrepare={() => {
              onPrepare();
              setSampleGeneration((value) => value + 1);
            }}
          />
        )
      )}
    </>
  );
}
function SpeechPreparation({
  source,
  voice,
  onPrepare,
}: {
  source: Source;
  voice: SpeechVoice;
  onPrepare: () => void;
}) {
  const controller = useSpeechJob({ ...source, voiceId: voice.id });
  return (
    <>
      <JobControls
        controller={controller}
        label="Prepare audio"
        onStart={onPrepare}
      />
      {controller.job?.playable && controller.job.voiceId === voice.id && (
        <>
          <span className="speech-label">
            {voice.name} · AI-generated voice
          </span>
          <AudioPlayer
            label="read-aloud audio"
            src={`/api/grove/speech/${controller.job.id}/audio`}
          />
        </>
      )}
    </>
  );
}
