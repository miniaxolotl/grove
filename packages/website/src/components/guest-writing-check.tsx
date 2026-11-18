"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  englishMessages,
  writingSettingsSchema,
  type WritingResult,
} from "@lib/shared/writing-settings";
import { loadWritingChecker } from "@/lib/writing/dictionary";
import { NATIVE_WRITING_ATTRIBUTE } from "@/lib/writing/settings";

export function GuestWritingCheck() {
  const [text, setText] = useState("");
  // Native edits made before hydration never reached the change handler.
  const adoptDraft = useCallback((input: HTMLTextAreaElement | null) => {
    if (input) setText(input.value);
  }, []);
  const [result, setResult] = useState<WritingResult>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const checker = useRef<ReturnType<typeof loadWritingChecker> | null>(null);
  useEffect(() => {
    document.documentElement.setAttribute(NATIVE_WRITING_ATTRIBUTE, "true");
    return () =>
      document.documentElement.removeAttribute(NATIVE_WRITING_ATTRIBUTE);
  }, []);
  return (
    <form
      className="guest-writing-form ph-no-capture"
      data-private
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !text.trim()) return;
        setBusy(true);
        setError(false);
        try {
          checker.current ??= loadWritingChecker();
          const engine = await checker.current;
          setResult(engine.check(text, writingSettingsSchema.parse({})));
        } catch {
          checker.current = null;
          setError(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="guest-writing-text">English text</label>
      <textarea
        ref={adoptDraft}
        id="guest-writing-text"
        rows={6}
        maxLength={6000}
        spellCheck={false}
        autoComplete="off"
        readOnly={busy}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setResult(undefined);
          setError(false);
        }}
      />
      <button
        type="submit"
        className="button-primary"
        disabled={!text.trim()}
        aria-disabled={busy || undefined}
      >
        {busy ? "Checking…" : "Check writing"}
      </button>
      <p role="status">
        {error
          ? "The writing checker couldn’t load. Try again."
          : result
            ? result.issues.length
              ? `${result.issues.length} ${result.issues.length === 1 ? "issue" : "issues"} found${result.complete ? "." : " in the checked text."}`
              : result.complete
                ? "No issues found."
                : "No issues in the checked text."
            : ""}
      </p>
      {!!result?.issues.length && (
        <ul aria-label="Writing suggestions">
          {result.issues.map((issue) => (
            <li key={issue.id}>
              <strong>{issueExcerpt(issue, text)}</strong>{" "}
              {englishMessages[issue.message]}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

function quoteExcerpt(text: string) {
  const characters = Array.from(text.replace(/\s+/gu, " "));
  return `“${characters.length > 36 ? characters.slice(0, 36).join("") + "…" : characters.join("")}”`;
}

function issueExcerpt(issue: WritingResult["issues"][number], text: string) {
  if (issue.original.trim()) return quoteExcerpt(issue.original.trim());
  // Spacing checks cover either a run of spaces or a zero-length insertion.
  const spaces = issue.original.length;
  const gap =
    spaces === 0
      ? "Missing space"
      : spaces === 1
        ? "Space"
        : `${spaces} spaces`;
  const next = text.slice(issue.to).match(/^[\p{L}\p{M}]+|^\S+/u)?.[0];
  return next ? `${gap} before ${quoteExcerpt(next)}` : gap;
}
