"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { AssistanceRequest } from "@lib/shared/assistance";
import type { AccountSettings } from "@lib/shared/account-settings";
import type { Memory } from "@lib/shared/contracts";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { useNotebooks } from "./notebooks-provider";
import { Dialog } from "./dialog";
import { Button } from "./ui/button";
import { LoadError } from "./load-error";
import { AssistancePanel } from "./assistance-panel";
import type { MeetingScope } from "./meeting-preparation-action";

export function MeetingPreparation({
  scope,
  close,
}: {
  scope: MeetingScope;
  close: () => void;
}) {
  const cache = useWorkspaceCache();
  const { projects } = useNotebooks();
  const settings = useQuery(
    cache.resource<
      AccountSettings & { aiAvailability?: { generation: boolean } }
    >("/me"),
  );
  const [title, setTitle] = useState("");
  const [agenda, setAgenda] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [request, setRequest] = useState<AssistanceRequest | null>(null);
  const [sources, setSources] = useState(scope.sources ?? []);
  const selectedNotes = useQueries({
    queries: sources.map((source) => ({
      ...cache.resource<Memory>(`/memories/${source.id}`),
      enabled: !request,
    })),
  });
  const enabled = settings.data?.meetingPreparationEnabled === true;
  const unavailable = settings.data?.aiAvailability?.generation === false;
  if (request)
    return (
      <AssistancePanel
        initial={request}
        close={close}
        back={() => setRequest(null)}
      />
    );
  const notebook = projects.find((project) => project.id === scope.projectId);
  return (
    <Dialog title="Meeting preparation" close={close}>
      <form
        className="app-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !enabled ||
            unavailable ||
            !title.trim() ||
            !agenda.trim() ||
            (scope.sources && !sources.length)
          )
            return;
          setRequest({
            ...scope,
            ...(scope.sources ? { sources } : {}),
            kind: "meeting",
            id: crypto.randomUUID(),
            title: title.trim(),
            agenda: agenda.trim(),
            ...(meetingDate ? { meetingDate } : {}),
          });
        }}
      >
        <p className="text-sm text-muted">
          {scope.sources
            ? `Selected notes only (${sources.length}).`
            : `Only direct notes in ${notebook?.name ?? "this notebook"}.`}{" "}
          No calendar access or messages to participants. Originals stay
          unchanged.
        </p>
        {scope.sources && (
          <details className="connection-support">
            <summary>Selected notes ({sources.length})</summary>
            <ul className="space-y-3 mt-3">
              {sources.map((source, index) => (
                <li
                  key={source.id}
                  className="flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 text-sm">
                    <p className="break-words">
                      {selectedNotes[index]?.data?.content
                        .split("\n")[0]
                        .replace(/^#+\s*/, "")
                        .slice(0, 100) ||
                        (selectedNotes[index]?.error
                          ? "Selected note unavailable"
                          : "Opening selected note…")}
                    </p>
                    <Link
                      className="text-button text-xs"
                      href={`/app/memories/${source.id}?revision=${source.version}`}
                    >
                      Selected revision {source.version}
                    </Link>
                  </div>
                  <button
                    type="button"
                    className="text-button text-xs"
                    aria-label={`Remove selected note ${index + 1}`}
                    onClick={(event) => {
                      event.currentTarget
                        .closest("details")
                        ?.querySelector("summary")
                        ?.focus();
                      setSources((current) =>
                        current.filter((ref) => ref.id !== source.id),
                      );
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            {!sources.length && (
              <p className="text-sm text-muted">
                Select at least one saved note from Notes to prepare a brief.
              </p>
            )}
          </details>
        )}
        <label className="app-label">
          Meeting title
          <input
            className="app-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            required
          />
        </label>
        <label className="app-label">
          Agenda or topic
          <textarea
            className="app-input"
            rows={4}
            value={agenda}
            onChange={(event) => setAgenda(event.target.value)}
            maxLength={1000}
            required
            placeholder="What decisions or questions should the meeting cover?"
          />
        </label>
        <label className="app-label">
          Meeting date (optional)
          <input
            className="app-input"
            type="date"
            value={meetingDate}
            onChange={(event) => setMeetingDate(event.target.value)}
          />
        </label>
        {settings.error ? (
          <LoadError
            message={errorMessage(settings.error)}
            retry={() => void settings.refetch()}
          />
        ) : settings.isPending ? (
          <p role="status">Checking preferences…</p>
        ) : !enabled ? (
          <p>
            Enable Meeting preparation in{" "}
            <Link href="/app/settings" className="text-button">
              AI preferences
            </Link>{" "}
            to prepare a brief.
          </p>
        ) : unavailable ? (
          <p>Configure a generation provider in Settings to prepare a brief.</p>
        ) : null}
        <p className="text-xs text-muted">
          A new generated brief uses one assistance result. Review its sources
          before saving.
        </p>
        <div className="app-actions">
          <Button
            type="submit"
            disabled={
              !enabled ||
              unavailable ||
              !title.trim() ||
              !agenda.trim() ||
              (!!scope.sources && !sources.length)
            }
          >
            Prepare brief
          </Button>
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
