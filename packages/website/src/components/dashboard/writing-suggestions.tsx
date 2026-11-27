"use client";

import { useLayoutEffect, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import {
  englishMessages,
  type WritingIssue,
} from "@lib/shared/writing-settings";
import { similarWritingIssues } from "@/lib/writing/editor-checks";
import { InspectorDialog } from "./ui/inspector-dialog";
import { writingCategoryLabel, type useWritingProofing } from "./note-writing";

function IssueReplacements({
  issue,
  issues,
  apply,
}: {
  issue: WritingIssue;
  issues: WritingIssue[];
  apply: (replacement: string, similar: boolean) => void;
}) {
  const alternatives = issue.replacements.map((replacement) => {
    const matching = similarWritingIssues(issues, issue, replacement).length;
    const label =
      replacement === "" ? "Delete extra word" : `Apply “${replacement}”`;
    return (
      <div key={replacement} className="grove-writing-replacement-row">
        <button
          type="button"
          className="grove-writing-replacement"
          onClick={() => apply(replacement, false)}
        >
          {label}
        </button>
        {matching > 1 && (
          <button
            type="button"
            className="text-button"
            aria-label={`${label} to ${matching} similar`}
            onClick={() => apply(replacement, true)}
          >
            Apply to {matching} similar
          </button>
        )}
      </div>
    );
  });
  return (
    <div className="grove-writing-list-replacements">
      {alternatives[0]}
      {alternatives.length > 1 && (
        <details>
          <summary>
            {alternatives.length - 1} more replacement
            {alternatives.length === 2 ? "" : "s"}
          </summary>
          {alternatives.slice(1)}
        </details>
      )}
    </div>
  );
}

/** One review surface for the current editor's local and consented hosted issues. */
export function WritingSuggestions({
  proofing,
  view,
  readOnly = false,
}: {
  proofing: ReturnType<typeof useWritingProofing>;
  view: EditorView | null;
  readOnly?: boolean;
}) {
  const list = useRef<HTMLUListElement>(null);
  const check = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const pendingJump = useRef<WritingIssue | null>(null);
  const { issues, status } = proofing;
  useLayoutEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    pendingFocus.current = null;
    const rows = list.current?.querySelectorAll<HTMLButtonElement>(
      "[data-writing-jump]",
    );
    (rows?.[Math.min(index, rows.length - 1)] ?? check.current)?.focus({
      preventScroll: true,
    });
  }, [issues]);
  function act(index: number, action: () => boolean) {
    if (action()) pendingFocus.current = index;
  }
  return (
    <InspectorDialog
      title="Writing suggestions"
      close={() => proofing.setListOpen(false)}
      onDismissed={() => {
        const issue = pendingJump.current;
        pendingJump.current = null;
        proofing.selectIssue(null);
        if (issue) proofing.jumpToIssue(issue);
      }}
    >
      <div className="grove-writing-review-controls">
        <p role="status">
          {status === "checking"
            ? "Checking spelling and grammar…"
            : status === "off"
              ? "Writing checks paused"
              : status === "idle"
                ? "Ready to check"
                : status === "unavailable"
                  ? "Writing checks unavailable"
                  : `${issues.length} suggestion${issues.length === 1 ? "" : "s"}`}
        </p>
        {!readOnly && status !== "off" && (
          <button
            ref={check}
            type="button"
            className="text-button"
            onClick={() => proofing.checkNow()}
          >
            {status === "unavailable"
              ? "Retry writing checks"
              : "Check writing"}
          </button>
        )}
      </div>
      {proofing.notice && (
        <p className="app-error" role="alert">
          {proofing.notice}
        </p>
      )}
      {readOnly ? (
        <p>
          Switch to Write or Markdown to review and apply writing suggestions.
        </p>
      ) : status === "off" ? (
        <p>
          Enable spelling or basic grammar in{" "}
          <a href="/app/settings">Writing settings</a>. Your saved choices have
          not changed.
        </p>
      ) : (
        <>
          <p className="text-muted grove-writing-review-help">
            On-device English checks. Similar actions affect existing matching
            issues only.
          </p>
          {proofing.enhancedStatus && (
            <p role="status">{proofing.enhancedStatus}</p>
          )}
          {issues.length === 0 && status === "ready" && (
            <p>
              No issues found by spelling and basic grammar checks. This is not
              a complete grammar guarantee.
            </p>
          )}
          {issues.length > 0 && (
            <ul ref={list} className="grove-writing-list">
              {issues.map((issue, index) => {
                const source = view?.state.doc.toString() ?? "";
                const line = view?.state.doc.lineAt(
                  Math.min(issue.from, source.length),
                );
                const contextFrom = Math.max(line?.from ?? 0, issue.from - 45);
                const contextTo = Math.min(
                  view?.state.doc.lineAt(Math.min(issue.to, source.length))
                    .to ?? source.length,
                  issue.to + 45,
                );
                const similar = similarWritingIssues(issues, issue).length;
                return (
                  <li key={issue.id} data-writing-rule={issue.rule}>
                    <div className="grove-writing-issue-heading">
                      <strong>{writingCategoryLabel(issue.rule)}</strong>
                      <button
                        type="button"
                        className="text-button"
                        data-writing-jump
                        onClick={() => {
                          pendingJump.current = issue;
                          proofing.setListOpen(false);
                        }}
                      >
                        Show in text · line {line?.number ?? 1}
                      </button>
                    </div>
                    <p className="grove-writing-excerpt">
                      {contextFrom > (line?.from ?? 0) ? "…" : ""}
                      {source.slice(contextFrom, issue.from)}
                      <mark>
                        {issue.original.trim() ? issue.original : "[space]"}
                      </mark>
                      {source.slice(issue.to, contextTo)}
                      {contextTo < (line?.to ?? source.length) ? "…" : ""}
                    </p>
                    <p>{englishMessages[issue.message]}</p>
                    <IssueReplacements
                      issue={issue}
                      issues={issues}
                      apply={(replacement, similar) =>
                        act(index, () =>
                          proofing.applyReplacement(
                            issue,
                            replacement,
                            similar,
                            false,
                          ),
                        )
                      }
                    />
                    <div className="grove-writing-actions">
                      <button
                        type="button"
                        onClick={() =>
                          act(index, () => proofing.ignoreIssue(issue))
                        }
                      >
                        Ignore
                      </button>
                      {similar > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            act(index, () => proofing.ignoreIssue(issue, true))
                          }
                        >
                          Ignore {similar} similar
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {issues.length >= 50 && (
            <p className="text-muted">
              Checks return up to 50 suggestions at a time. Resolve these, then
              choose Check writing for remaining issues.
            </p>
          )}
        </>
      )}
    </InspectorDialog>
  );
}
