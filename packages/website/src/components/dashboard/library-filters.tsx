"use client";
import { Select } from "./ui/select";
import { NotebookSelect } from "./notebook-select";
import {
  useId,
  useRef,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { SlidersHorizontal } from "lucide-react";
import type { Memory, MemoryList } from "@lib/shared/contracts";
import type { Project } from "@/lib/dashboard-api";
import { notebookPath } from "@/lib/notebooks";
import { Button } from "./ui/button";
import { SearchField } from "./ui/search-field";
import { FilterChip } from "./ui/filter-chip";

export type LibraryFilters = {
  search: string;
  project: string;
  kind: string;
  tag: string;
  status: string;
  sourceAgent: string;
  updatedAfter: string;
  period: string;
  sort: NonNullable<MemoryList["sort"]>;
  lifetime: string;
};
export const initialFilters = (archive = false): LibraryFilters => ({
  search: "",
  project: "all",
  kind: "",
  tag: "",
  status: archive ? "archived" : "active",
  sourceAgent: "",
  updatedAfter: "",
  period: "",
  sort: "updated_desc",
  lifetime: "",
});
export const kindOptions = [
  { value: "", label: "All types" },
  { value: "preference", label: "Preferences" },
  { value: "fact", label: "Notes" },
  { value: "decision", label: "Decisions" },
  { value: "solution", label: "How-tos" },
  { value: "handoff", label: "Progress notes" },
];
const sources = [
  ["", "Any source"],
  ["website", "Written by me"],
  ["opencode", "OpenCode"],
  ["claude", "Claude Code"],
  ["codex", "Codex"],
  ["cli", "CLI"],
  ["import", "Import"],
  ["api", "API"],
];

export function LibraryFilterBar({
  value,
  onChange,
  projects,
  topics,
  fixedProject,
  archive = false,
}: {
  value: LibraryFilters;
  onChange: Dispatch<SetStateAction<LibraryFilters>>;
  projects: Project[];
  topics: string[];
  fixedProject?: string | null;
  archive?: boolean;
}) {
  const [query, setQuery] = useState(value.search);
  const [tag, setTag] = useState(value.tag);
  const [expanded, setExpanded] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    const timer = setTimeout(
      () =>
        onChange((current) =>
          current.search === query.trim()
            ? current
            : { ...current, search: query.trim() },
        ),
      350,
    );
    return () => clearTimeout(timer);
  }, [query, onChange]);
  const update = (patch: Partial<LibraryFilters>) =>
    onChange((current) => ({ ...current, ...patch }));
  const active = [
    value.search,
    fixedProject === undefined && value.project !== "all",
    value.kind,
    value.tag,
    value.sourceAgent,
    value.updatedAfter,
    value.lifetime,
    archive && value.status === "expired",
  ].filter(Boolean).length;
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        document.querySelector("dialog[open]") ||
        (event.target as HTMLElement).closest(
          "input, textarea, select, [contenteditable=true]",
        )
      )
        return;
      event.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  return (
    <div className="library-filter-bar">
      <form
        className="workspace-search"
        onSubmit={(event) => {
          event.preventDefault();
          update({ search: query.trim() });
        }}
      >
        <SearchField
          label="Search notes"
          inputRef={input}
          value={query}
          onChange={setQuery}
          placeholder="Search words or describe an idea…"
        />
        {fixedProject === undefined && (
          <NotebookSelect
            aria-label="Notebook"
            className="filter-notebook"
            value={value.project}
            onValueChange={(project) => update({ project })}
            projects={projects}
            leading={[
              { value: "all", label: "All notebooks" },
              { value: "personal", label: "Personal" },
            ]}
          />
        )}
        <Button
          variant="secondary"
          aria-expanded={expanded}
          aria-controls={`${id}-filters`}
          onClick={() => setExpanded(!expanded)}
        >
          <SlidersHorizontal size={16} />
          Filters
          {active > 0 && (
            <span
              className="filter-count"
              aria-label={`${active} active filters`}
            >
              {active}
            </span>
          )}
        </Button>
      </form>
      {expanded && (
        <form
          id={`${id}-filters`}
          className="library-filters app-form"
          onSubmit={(event) => {
            event.preventDefault();
            update({ tag: tag.trim() });
          }}
        >
          <Select
            label="Note type"
            value={value.kind}
            onValueChange={(kind) => update({ kind: kind as Memory["kind"] })}
            options={kindOptions}
          />
          <Select
            label="Keep for"
            value={value.lifetime}
            onValueChange={(lifetime) => update({ lifetime })}
            options={[
              { value: "", label: "Any duration" },
              { value: "permanent", label: "Until I remove it" },
              { value: "ephemeral", label: "A limited time" },
            ]}
          />
          <Select
            label="Source"
            value={value.sourceAgent}
            onValueChange={(sourceAgent) => update({ sourceAgent })}
            options={sources.map(([value, label]) => ({ value, label }))}
          />
          <Select
            label="Last updated"
            value={value.period}
            onValueChange={(period) =>
              update({
                period,
                updatedAfter: period
                  ? new Date(
                      Date.now() - Number(period) * 86400000,
                    ).toISOString()
                  : "",
              })
            }
            options={[
              { value: "", label: "Any time" },
              ...[7, 30, 90].map((days) => ({
                value: String(days),
                label: `Last ${days} days`,
              })),
            ]}
          />
          <label>
            Topic tag
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              maxLength={40}
              placeholder="Choose or enter a topic"
              list={`${id}-topics`}
            />
            <datalist id={`${id}-topics`}>
              {topics.map((topic) => (
                <option key={topic} value={topic} />
              ))}
            </datalist>
          </label>
          <Button
            type="submit"
            variant="secondary"
            className="apply-tag"
            disabled={tag.trim() === value.tag}
          >
            Apply tag
          </Button>
          {archive && (
            <Select
              label="Archive status"
              value={value.status}
              onValueChange={(status) => update({ status })}
              options={[
                { value: "archived", label: "Archived" },
                { value: "expired", label: "Expired notes" },
              ]}
            />
          )}
          {topics.length > 0 && (
            <div className="topic-suggestions">
              <span>Topics in these results</span>
              {topics.slice(0, 8).map((topic) => (
                <button
                  type="button"
                  key={topic}
                  aria-pressed={value.tag === topic}
                  onClick={() => {
                    setTag(topic);
                    update({ tag: topic });
                  }}
                >
                  {topic}
                </button>
              ))}
            </div>
          )}
        </form>
      )}
      {active > 0 && (
        <div className="filter-chips" aria-label="Active filters">
          {value.lifetime && (
            <FilterChip
              label="lifetime"
              onRemove={() => update({ lifetime: "" })}
            >
              {value.lifetime === "ephemeral" ? "Temporary" : "Kept"}
            </FilterChip>
          )}
          {value.search && (
            <FilterChip
              label="search"
              onRemove={() => {
                setQuery("");
                update({ search: "" });
              }}
            >
              “{value.search}”
            </FilterChip>
          )}
          {fixedProject === undefined && value.project !== "all" && (
            <FilterChip
              label="project"
              onRemove={() => update({ project: "all" })}
            >
              {notebookPath(projects, value.project)
                .map((p) => p.name)
                .join(" / ") || "Personal"}
            </FilterChip>
          )}
          {value.kind && (
            <FilterChip label="kind" onRemove={() => update({ kind: "" })}>
              {kindOptions.find((k) => k.value === value.kind)?.label}
            </FilterChip>
          )}
          {value.tag && (
            <FilterChip
              label="tag"
              onRemove={() => {
                setTag("");
                update({ tag: "" });
              }}
            >
              {value.tag}
            </FilterChip>
          )}
          {value.sourceAgent && (
            <FilterChip
              label="source"
              onRemove={() => update({ sourceAgent: "" })}
            >
              {sources.find((s) => s[0] === value.sourceAgent)?.[1]}
            </FilterChip>
          )}
          {value.updatedAfter && (
            <FilterChip
              label="date"
              onRemove={() => update({ updatedAfter: "", period: "" })}
            >
              Last {value.period} days
            </FilterChip>
          )}
          {value.status === "expired" && (
            <FilterChip
              label="expired"
              onRemove={() => update({ status: "archived" })}
            >
              Expired notes
            </FilterChip>
          )}
          <button
            className="clear-filters"
            onClick={() => {
              setQuery("");
              setTag("");
              onChange(initialFilters(archive));
            }}
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
