"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorMessage } from "@/lib/dashboard-api";
import { mediaPath } from "@/lib/media-path";
export function RecordingPlayer({
  src,
  title,
  noteId,
  mediaId,
  shared,
  onUse,
}: {
  src: string;
  title: ReactNode;
  noteId: string;
  mediaId: string;
  shared: boolean;
  onUse?: (text: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [text, setText] = useState(""),
    [version, setVersion] = useState<number>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const operation = useRef<{
    text: string;
    id: string;
    version: number;
  } | null>(null);
  const work = useRef<AbortController | null>(null);
  useEffect(() => () => work.current?.abort(), []);
  const path = `${mediaPath(noteId, mediaId)}/transcript`;
  useEffect(() => {
    if (!open || shared || version !== undefined) return;
    const controller = new AbortController();
    void api<{ text: string; version: number }>(
      path,
      undefined,
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setText(result.text);
          setVersion(result.version);
          setError("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
  }, [open, path, shared, version]);
  const save = async () => {
    if (version === undefined || busy) return;
    setBusy(true);
    setError("");
    operation.current ??= { text, id: crypto.randomUUID(), version };
    const controller = new AbortController();
    work.current = controller;
    try {
      const pending = operation.current;
      const result = await api<{ text: string; version: number }>(
        path,
        {
          text: pending.text,
          expectedVersion: pending.version,
          operationId: pending.id,
        },
        "PATCH",
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setVersion(result.version);
        operation.current = null;
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      work.current = null;
    }
  };
  return (
    <span
      className="recording-player"
      style={{ display: "block", width: "100%", maxWidth: "34rem" }}
    >
      <span className="recording-title">{title}</span>
      <audio
        controls
        preload="none"
        src={src}
        aria-label="Recording playback"
        style={{ display: "block", width: "100%", maxWidth: "100%" }}
      />
      {!shared && (
        <>
          <button
            type="button"
            className="text-button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            Transcript
          </button>
          {open && (
            <span className="recording-transcript">
              <label>
                <span className="sr-only">Transcript</span>
                <textarea
                  value={text}
                  maxLength={6000}
                  rows={4}
                  disabled={version === undefined || busy}
                  placeholder="No transcript yet. Add your own text, or transcribe when speech is configured."
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <span className="recording-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={version === undefined || busy}
                  onClick={() => void save()}
                >
                  Save transcript
                </button>
                {onUse && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={!text.trim() || busy}
                    onClick={() => onUse(text)}
                  >
                    Use in note
                  </button>
                )}
              </span>
              {error && (
                <span role="alert" className="app-error">
                  {error}{" "}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      operation.current = null;
                      setVersion(undefined);
                      setError("");
                    }}
                  >
                    Reload saved transcript
                  </button>
                </span>
              )}
            </span>
          )}
        </>
      )}
    </span>
  );
}
