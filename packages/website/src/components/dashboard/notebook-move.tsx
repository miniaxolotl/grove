"use client";
import { useEffect, useMemo, useState } from "react";
import { Folder, Layers } from "lucide-react";
import type { Project } from "@/lib/dashboard-api";
import { notebookOptions, notebookOrder, notebookPath } from "@/lib/notebooks";
import { useNotebooks } from "./notebooks-provider";
import { useDialogBusy } from "./dialog";
import { SearchField } from "./ui/search-field";
import { Select } from "./ui/select";

export function NotebookMove({
  project,
  cancel,
  done,
}: {
  project: Project;
  cancel: () => void;
  done?: (project: Project) => void;
}) {
  const notebooks = useNotebooks();
  const [base] = useState(project);
  const [query, setQuery] = useState("");
  const [parentId, setParentId] = useState(project.parentId ?? "");
  const [position, setPosition] = useState("end");
  const setDialogBusy = useDialogBusy();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDialogBusy(saving);
    return () => setDialogBusy(false);
  }, [saving, setDialogBusy]);
  const options = useMemo(() => {
    const byId = new Map(notebooks.projects.map((p) => [p.id, p]));
    return [
      {
        value: "",
        label: "Top level",
        name: "Top level",
        path: "Outside all notebooks",
      },
      ...notebookOptions(notebooks.projects, base.id).map((option) => {
        const project = byId.get(option.value)!;
        return {
          ...option,
          name: project.name,
          path: notebookPath(notebooks.projects, project.parentId, byId)
            .map((p) => p.name)
            .join(" / "),
        };
      }),
    ];
  }, [notebooks.projects, base.id]);
  const visible = options.filter((p) =>
    p.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const siblings = notebooks.projects
    .filter((p) => p.id !== base.id && (p.parentId ?? "") === parentId)
    .sort(notebookOrder);
  const target = options.find((p) => p.value === parentId);
  const currentSiblings = notebooks.projects
    .filter((p) => (p.parentId ?? "") === (base.parentId ?? ""))
    .sort(notebookOrder);
  const noChange =
    parentId === (base.parentId ?? "") &&
    position === "end" &&
    currentSiblings.at(-1)?.id === base.id;
  const positionOptions = [
    { value: "end", label: "At the end" },
    ...siblings.flatMap((p) => [
      { value: `before:${p.id}`, label: `Before ${p.name}` },
      { value: `after:${p.id}`, label: `After ${p.name}` },
    ]),
  ];
  return (
    <form
      className="notebook-move app-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (saving || notebooks.organizationLocked || !target || noChange)
          return;
        setSaving(true);
        const [direction, anchor] = position.split(":");
        try {
          const result = await notebooks.organize(base, {
            parentId: parentId || null,
            ...(direction === "before"
              ? { beforeId: anchor }
              : direction === "after"
                ? { afterId: anchor }
                : {}),
          });
          if (result) done?.(result.project);
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="notebook-move-body">
        <div className="notebook-move-summary">
          <p>
            <strong>{base.name}</strong>
          </p>
          <p className="notebook-location">
            Currently in{" "}
            {base.parentId
              ? notebookPath(notebooks.projects, base.parentId)
                  .map((p) => p.name)
                  .join(" / ")
              : "Top level"}
          </p>
          <p className="notebook-move-help">Sub-notebooks move with it.</p>
        </div>
        <SearchField
          label="Find destination"
          value={query}
          onChange={setQuery}
          placeholder="Find a notebook…"
          autoFocus
          disabled={saving}
        />
        <fieldset
          className="notebook-destinations"
          disabled={saving || notebooks.organizationLocked}
        >
          <legend>Move into</legend>
          <div className="notebook-destination-list">
            {visible.map((p) => (
              <label
                key={p.value || "root"}
                data-selected={p.value === parentId || undefined}
              >
                <input
                  type="radio"
                  name="notebook-destination"
                  aria-label={p.label}
                  value={p.value}
                  checked={parentId === p.value}
                  onChange={() => {
                    setParentId(p.value);
                    setPosition("end");
                  }}
                />
                {p.value ? (
                  <Folder size={18} aria-hidden="true" />
                ) : (
                  <Layers size={18} aria-hidden="true" />
                )}
                <span className="notebook-destination-name">
                  <span>{p.name}</span>
                  {p.path && <small>{p.path}</small>}
                </span>
                {p.value === (base.parentId ?? "") && (
                  <small
                    className="notebook-destination-current"
                    aria-hidden="true"
                  >
                    Current
                  </small>
                )}
              </label>
            ))}
            {!visible.length && (
              <div className="notebook-organizer-empty">
                <p>No matching destinations.</p>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setQuery("")}
                >
                  Clear search
                </button>
              </div>
            )}
          </div>
        </fieldset>
        <Select
          label="Position"
          value={position}
          onValueChange={setPosition}
          disabled={saving || notebooks.organizationLocked}
          options={positionOptions}
        />
        <p className="notebook-move-review">
          {target ? (
            <>
              Destination: <strong>{target.label}</strong>.{" "}
              {
                positionOptions.find((option) => option.value === position)
                  ?.label
              }
              .
            </>
          ) : (
            "Choose an available destination."
          )}
        </p>
        <p className="notebook-move-help">
          Existing shared notebook links may cover notes in their new location.
          Agent access stays unchanged.
        </p>
      </div>
      <div className="notebook-move-buttons">
        <button
          className="app-button secondary"
          type="button"
          disabled={saving}
          onClick={cancel}
        >
          Cancel
        </button>
        <button
          className="app-button"
          disabled={
            saving || notebooks.organizationLocked || !target || noChange
          }
        >
          {saving ? "Moving…" : "Move notebook"}
        </button>
      </div>
    </form>
  );
}
