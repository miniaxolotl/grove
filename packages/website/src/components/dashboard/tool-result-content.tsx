"use client";

import { useId, useState } from "react";
import type { AssistanceResult, ActionItem } from "@lib/shared/assistance";
import type { ToolRequest } from "@lib/shared/notebook-workflows";
import { SourceEvidence } from "./source-evidence";
import { Button } from "./ui/button";

function Finding({ item }: { item: ActionItem }) {
  return (
    <div className="border-b border-line pb-4 space-y-2">
      <p className="whitespace-pre-wrap break-words">{item.text}</p>
      <SourceEvidence sources={item.sources} />
    </div>
  );
}

export function ToolResultContent({
  input,
  result,
}: {
  input: ToolRequest;
  result: AssistanceResult;
}) {
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set());
  const [practice, setPractice] = useState<Record<number, string>>({});
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const answerId = useId();
  return (
    <div className="space-y-6">
      {input.kind === "preparation" && (
        <div>
          <h3 className="text-xl font-semibold break-words">
            {input.title || "Your brief"}
          </h3>
          <p className="text-sm text-muted whitespace-pre-wrap break-words">
            {input.goal}
          </p>
          {input.audience && (
            <p className="text-xs text-muted">For: {input.audience}</p>
          )}
        </div>
      )}
      {result.preparation &&
        (result.preparation.sections.some((section) => section.items.length) ? (
          result.preparation.sections.map((section, index) => (
            <section key={index} className="space-y-3">
              <h3 className="text-lg font-semibold break-words">
                {section.heading}
              </h3>
              {section.items.map((item, i) => (
                <Finding key={i} item={item} />
              ))}
            </section>
          ))
        ) : (
          <p>
            No relevant evidence found for this goal. Try another focus or
            review more sources.
          </p>
        ))}
      {result.study && (
        <>
          {!result.study.items.length && (
            <p>
              Not enough supported material to create a study set. Try more
              notes or a different focus.
            </p>
          )}
          {input.kind === "study" && input.format !== "explanations" && (
            <div className="space-y-2 rounded-lg bg-sage p-4">
              <p className="text-sm text-muted">
                Try answering before revealing. Again/Got it is temporary
                practice, not a grade or saved progress.
              </p>
              <p role="status" className="text-sm">
                {revealed.size} of {result.study.items.length} answers revealed.{" "}
                {
                  Object.values(practice).filter((value) => value === "Got it")
                    .length
                }{" "}
                marked Got it;{" "}
                {
                  Object.values(practice).filter(
                    (value) => value === "Review again",
                  ).length
                }{" "}
                to review again.
              </p>
            </div>
          )}
          {result.study.items.map((item, index) => (
            <section
              key={index}
              className="border-b border-line pb-5 space-y-3"
            >
              <p className="text-xs text-muted">
                {input.kind === "study" && input.format === "flashcards"
                  ? "Card"
                  : "Item"}{" "}
                {index + 1} of {result.study!.items.length}
              </p>
              <h3 className="font-semibold break-words">{item.prompt}</h3>
              {input.kind === "study" && input.format === "quiz" && (
                <label className="app-label">
                  Your answer (optional)
                  <textarea
                    className="app-input"
                    rows={2}
                    value={answers[index] ?? ""}
                    onChange={(event) =>
                      setAnswers((old) => ({
                        ...old,
                        [index]: event.target.value,
                      }))
                    }
                  />
                </label>
              )}
              {input.kind === "study" && input.format !== "explanations" && (
                <Button
                  variant="secondary"
                  aria-expanded={revealed.has(index)}
                  aria-controls={`${answerId}-${index}`}
                  onClick={() =>
                    setRevealed((old) => {
                      const next = new Set(old);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      return next;
                    })
                  }
                >
                  {revealed.has(index)
                    ? `Hide answer ${index + 1}`
                    : `Reveal answer ${index + 1}`}
                </Button>
              )}
              <div
                id={`${answerId}-${index}`}
                hidden={
                  !(
                    input.kind === "study" && input.format === "explanations"
                  ) && !revealed.has(index)
                }
                className="space-y-3 border-l-2 border-leaf pl-4"
              >
                <p className="text-xs font-medium">Source-supported answer</p>
                <p className="whitespace-pre-wrap break-words">{item.answer}</p>
                <p className="text-sm text-muted whitespace-pre-wrap break-words">
                  {item.explanation}
                </p>
                <SourceEvidence sources={item.sources} />
                {input.kind === "study" && input.format !== "explanations" && (
                  <div className="workbench-practice flex flex-wrap items-center gap-2">
                    <Button
                      variant={
                        practice[index] === "Review again"
                          ? "primary"
                          : "secondary"
                      }
                      aria-pressed={practice[index] === "Review again"}
                      onClick={() =>
                        setPractice((old) => ({
                          ...old,
                          [index]: "Review again",
                        }))
                      }
                    >
                      Again
                    </Button>
                    <Button
                      variant={
                        practice[index] === "Got it" ? "primary" : "secondary"
                      }
                      aria-pressed={practice[index] === "Got it"}
                      onClick={() =>
                        setPractice((old) => ({
                          ...old,
                          [index]: "Got it",
                        }))
                      }
                    >
                      Got it
                    </Button>
                    <span role="status" className="text-sm text-muted">
                      {practice[index]}
                    </span>
                  </div>
                )}
              </div>
            </section>
          ))}
        </>
      )}
      {result.weekly && (
        <>
          {result.window && (
            <p className="text-sm text-muted">
              {input.kind === "weekly_review"
                ? `Week beginning ${input.weekStart}`
                : "Calendar week"}{" "}
              · {result.window.timeZone}
              {result.window.inProgress ? " · Week in progress" : ""}
            </p>
          )}
          {result.coverage.historyOmitted && (
            <p role="status" className="text-sm text-muted">
              Some historical evidence was unavailable or exceeded this batch’s
              budget. Decision changes may be incomplete.
            </p>
          )}
          <section className="space-y-3">
            <h3 className="text-lg font-semibold">New ideas</h3>
            {result.weekly.ideas.length ? (
              result.weekly.ideas.map((item, index) => (
                <Finding key={index} item={item} />
              ))
            ) : (
              <p className="text-sm text-muted">
                No new ideas found in this window’s reviewed evidence.
              </p>
            )}
          </section>
          <section className="space-y-3">
            <h3 className="text-lg font-semibold">Changed decisions</h3>
            {result.weekly.decisions.length ? (
              result.weekly.decisions.map((item, index) => (
                <div key={index} className="border-b pb-4 space-y-2">
                  <p className="break-words">{item.text}</p>
                  <p className="text-xs text-muted">Before</p>
                  <SourceEvidence sources={item.before} />
                  <p className="text-xs text-muted">After</p>
                  <SourceEvidence sources={item.after} />
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">
                No supported decision changes found. A current decision alone
                does not prove a change.
              </p>
            )}
          </section>
          <section className="space-y-3">
            <h3 className="text-lg font-semibold">Unfinished actions</h3>
            <p className="text-xs text-muted">
              Includes older actions that remain open, not just notes changed
              this week.
            </p>
            {result.weekly.openActions.length ? (
              result.weekly.openActions.map((item, index) => (
                <Finding key={index} item={item} />
              ))
            ) : (
              <p className="text-sm text-muted">
                No unfinished actions found in the reviewed evidence.
              </p>
            )}
          </section>
        </>
      )}
      {result.gaps && (
        <>
          <p className="text-sm text-muted">
            These are recorded questions or claims whose answers/evidence were
            not found in the reviewed sources—not proof that no answer exists.
          </p>
          {result.answerSearch && (
            <p className="text-xs text-muted">
              Answer lookup supplied {result.answerSearch.supplied} notes
              {result.answerSearch.partial
                ? "; lookup coverage is partial."
                : "."}
            </p>
          )}
          {result.gaps.findings.length ? (
            result.gaps.findings.map((item, index) => (
              <section key={index} className="space-y-2">
                <p className="text-xs text-muted">
                  {item.kind === "unanswered_question"
                    ? "Unanswered question"
                    : "Missing evidence"}{" "}
                  in reviewed sources
                </p>
                <Finding item={item} />
              </section>
            ))
          ) : (
            <p>
              No supported gaps remain after checking for answers. This is not a
              claim that your whole library is complete.
            </p>
          )}
        </>
      )}
      {result.problems && (
        <>
          {!result.problems.matches.length && (
            <p>
              No sufficiently supported past solution found. Try describing the
              constraints, symptoms or outcome you need.
            </p>
          )}
          {result.problems.matches.map((match, index) => (
            <section key={index} className="space-y-3 border-b pb-5">
              <h3 className="font-semibold break-words">
                {match.problem.text}
              </h3>
              <SourceEvidence sources={match.problem.sources} />
              <p className="text-xs text-muted">Recorded approach</p>
              <Finding item={match.solution} />
              <p className="font-medium">
                Recorded outcome: {match.outcome.status}
              </p>
              {match.outcome.evidence.length ? (
                <SourceEvidence sources={match.outcome.evidence} />
              ) : (
                <p className="text-sm text-muted">
                  No outcome was recorded. Do not assume this approach worked.
                </p>
              )}
              <h4 className="font-medium">Why it may help</h4>
              {match.similarities.map((item, i) => (
                <Finding key={i} item={item} />
              ))}
              <h4 className="font-medium">Important differences</h4>
              {match.differences.length ? (
                match.differences.map((item, i) => (
                  <Finding key={i} item={item} />
                ))
              ) : (
                <p className="text-sm text-muted">
                  No supported differences found in the reviewed evidence. Check
                  applicability before acting.
                </p>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
