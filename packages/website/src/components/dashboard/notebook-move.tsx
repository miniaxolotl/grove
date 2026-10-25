"use client";
import { useEffect, useState } from "react";
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
  const options = [
    { value: "", label: "Top level" },
    ...notebookOptions(notebooks.projects, base.id),
  ];
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
      <p>
        Move <strong>{base.name}</strong> and its sub-notebooks.
      </p>
      <p className="notebook-location">
        Currently in{" "}
        {base.parentId
          ? notebookPath(notebooks.projects, base.parentId)
              .map((p) => p.name)
              .join(" / ")
          : "Top level"}
      </p>
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
                value={p.value}
                checked={parentId === p.value}
                onChange={() => {
                  setParentId(p.value);
                  setPosition("end");
                }}
              />
              <span>{p.label}</span>
            </label>
          ))}
          {!visible.length && (
            <p>No matching destinations. Clear the search to browse.</p>
          )}
        </div>
      </fieldset>
      <Select
        label="Position"
        value={position}
        onValueChange={setPosition}
        disabled={saving || notebooks.organizationLocked}
        options={[
          { value: "end", label: "At the end" },
          ...siblings.flatMap((p) => [
            { value: `before:${p.id}`, label: `Before ${p.name}` },
            { value: `after:${p.id}`, label: `After ${p.name}` },
          ]),
        ]}
      />
      <p className="notebook-move-review">
        {target ? (
          <>
            Move into <strong>{target.label}</strong>.
          </>
        ) : (
          "Choose an available destination."
        )}{" "}
        Existing shared notebook links may cover notes in their new location.
        Agent access stays unchanged.
      </p>
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
