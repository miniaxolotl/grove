"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Upload, ImagePlus, Paperclip } from "lucide-react";
import { createPortal } from "react-dom";
import { ActionMenu } from "./ui/action-menu";
import type { beginRecording } from "@/lib/audio-recorder";
export function RecordingControl({
  disabled,
  onFile,
  onImage,
  statusTarget,
}: {
  disabled: boolean;
  onFile: (file: File) => void;
  onImage: () => void;
  statusTarget: HTMLElement | null;
}) {
  const active = useRef<Awaited<ReturnType<typeof beginRecording>> | null>(
      null,
    ),
    file = useRef<HTMLInputElement>(null),
    generation = useRef(0);
  const deliver = useRef(onFile);
  useEffect(() => {
    deliver.current = onFile;
  }, [onFile]);
  const [recording, setRecording] = useState(false),
    [seconds, setSeconds] = useState(0),
    [error, setError] = useState("");
  useEffect(
    () => () => {
      generation.current++;
      void active.current?.cancel();
    },
    [],
  );
  const start = async () => {
    if (disabled || recording) return;
    const current = ++generation.current;
    setRecording(true);
    setError("");
    setSeconds(0);
    try {
      const { beginRecording } = await import("@/lib/audio-recorder");
      const session = await beginRecording(setSeconds);
      if (current !== generation.current) {
        await session.cancel();
        return;
      }
      active.current = session;
      const result = await session.finished;
      if (current !== generation.current) return;
      active.current = null;
      setRecording(false);
      if (result) deliver.current(result);
    } catch (error) {
      if (current === generation.current) {
        setRecording(false);
        setError(
          error instanceof Error
            ? error.message
            : "Microphone unavailable. Upload WAV instead.",
        );
      }
    }
  };
  return (
    <span className="recording-control">
      <ActionMenu label="Add media" icon={<Paperclip size={17} />}>
        <button
          type="button"
          disabled={disabled || recording}
          onClick={onImage}
        >
          <ImagePlus size={17} />
          Add image
        </button>
        <button
          type="button"
          disabled={disabled || recording}
          onClick={() => void start()}
        >
          <Mic size={17} />
          Record audio
        </button>
        <button
          type="button"
          disabled={disabled || recording}
          onClick={() => file.current?.click()}
        >
          <Upload size={17} />
          Upload recording
        </button>
      </ActionMenu>
      {recording &&
        statusTarget &&
        createPortal(
          <span className="media-feedback">
            <span role="status">Recording {seconds}s / 60s</span>
            <button
              type="button"
              className="text-button"
              onClick={() => void active.current?.stop()}
            >
              Stop and attach
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                generation.current++;
                void active.current?.cancel();
                active.current = null;
                setRecording(false);
              }}
            >
              Cancel recording
            </button>
          </span>,
          statusTarget,
        )}
      <input
        ref={file}
        type="file"
        accept="audio/wav,audio/x-wav,.wav"
        hidden
        onChange={(event) => {
          const selected = event.target.files?.[0];
          event.target.value = "";
          if (selected) onFile(selected);
        }}
      />
      {error &&
        statusTarget &&
        createPortal(
          <span role="alert" className="app-error">
            {error}
          </span>,
          statusTarget,
        )}
    </span>
  );
}
