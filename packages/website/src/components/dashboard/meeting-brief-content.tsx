import type { MeetingBrief } from "@lib/shared/assistance";
import { SourceEvidence } from "./source-evidence";

const headings = {
  decisions: "Decisions",
  discussions: "Previous discussions",
  questions: "Open questions",
} as const;
export function MeetingBriefContent({
  brief,
  title,
  agenda,
  meetingDate,
}: {
  brief: MeetingBrief;
  title: string;
  agenda: string;
  meetingDate?: string;
}) {
  return (
    <div className="app-form">
      <header>
        <h3 className="text-lg font-semibold break-words">{title}</h3>
        <p className="text-sm text-muted whitespace-pre-wrap break-words">
          {agenda}
        </p>
        {meetingDate && (
          <p className="mt-2 text-xs text-muted">Meeting date: {meetingDate}</p>
        )}
      </header>
      {(Object.keys(headings) as (keyof typeof headings)[]).map((key) => (
        <section key={key} className="border-t pt-4">
          <h3 className="font-semibold">{headings[key]}</h3>
          {brief[key].length ? (
            brief[key].map((item, index) => (
              <div key={index} className="mt-3">
                <p className="break-words">{item.text}</p>
                <SourceEvidence sources={item.sources} />
              </div>
            ))
          ) : (
            <p className="mt-2 text-sm text-muted">
              No relevant recorded evidence found.
            </p>
          )}
        </section>
      ))}
      <p className="text-xs text-muted">
        Recorded discussions come from these notes, not private chats. Missing
        evidence does not mean no decision exists elsewhere.
      </p>
    </div>
  );
}
