"use client";

import { useEffect, useRef, useState } from "react";
import {
  writingSettingsSchema,
  type WritingResult,
} from "@lib/shared/writing-settings";
import { loadWritingChecker } from "@/lib/writing/dictionary";
import { NATIVE_WRITING_ATTRIBUTE } from "@/lib/writing/settings";

export function GuestWritingCheck() {
  const [text, setText] = useState("");
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
        disabled={busy || !text.trim()}
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
            <li key={issue.id}>{issue.message}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
