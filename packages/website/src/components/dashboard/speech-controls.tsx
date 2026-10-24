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
import { VoiceChooser } from "./voice-chooser";
import { ActionMenu } from "./ui/action-menu";
import { IconButton } from "./ui/button";
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
  const [choosing, setChoosing] = useState(false);
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
  const close = () => {
    setChoosing(false);
    setOpen(false);
  };
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
      <div className="speech-header">
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
          <span className="speech-header-actions">
            {access.enabled && access.available && (
              <ActionMenu label="Read aloud options">
                <button type="button" onClick={() => setChoosing(true)}>
                  Change voice
                </button>
              </ActionMenu>
            )}
            <IconButton label="Close read aloud" onClick={close}>
              <X size={16} aria-hidden="true" />
            </IconButton>
          </span>
        )}
      </div>
      {open && (
        <div className="speech-panel">
          {access.account && (
            <ReadAloudVoice
              source={source}
              voiceId={voiceId}
              access={access}
              remembering={remembering}
              onChoose={() => setChoosing(true)}
              onRetry={() => void remember(voiceId)}
              onPrepare={() => setSelected(voiceId)}
            />
          )}
          {!access.account && (
            <Permission access={access} feature="Read aloud" />
          )}
        </div>
      )}
      {open && choosing && access.enabled && access.available && (
        <VoiceChooser
          value={voiceId}
          voices={access.account?.speechVoices}
          onChange={(value) => void remember(value)}
          close={() => setChoosing(false)}
        />
      )}
    </div>
  );
}

function ReadAloudVoice({
  source,
  voiceId,
  access,
  remembering,
  onChoose,
  onRetry,
  onPrepare,
}: {
  source: Source;
  voiceId: SpeechVoiceId;
  access: ReturnType<typeof useSpeechAccess>;
  remembering: "saved" | "saving" | "failed";
  onChoose: () => void;
  onRetry: () => void;
  onPrepare: () => void;
}) {
  const voice = access.account?.speechVoices?.find(
    (entry) => entry.id === voiceId,
  );
  return (
    <>
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
      ) : voice?.available ? (
        <SpeechPreparation
          key={voiceId}
          source={source}
          voice={voice}
          onPrepare={onPrepare}
        />
      ) : (
        <span className="speech-permission">
          {voice?.name ?? "This voice"} is currently unavailable.{" "}
          <button type="button" className="text-button" onClick={onChoose}>
            Change voice
          </button>
        </span>
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
  const playable =
    controller.job?.playable && controller.job.voiceId === voice.id;
  return (
    <>
      {!playable && (
        <div className="speech-preparation-actions">
          <JobControls
            controller={controller}
            label="Prepare audio"
            onStart={onPrepare}
          />
          <span className="speech-label">{voice.name}</span>
        </div>
      )}
      {playable && (
        <>
          <AudioPlayer
            label="read-aloud audio"
            src={`/api/grove/speech/${controller.job!.id}/audio`}
          />
          <span className="speech-label speech-caption">
            {voice.name} · AI-generated voice
          </span>
        </>
      )}
    </>
  );
}
