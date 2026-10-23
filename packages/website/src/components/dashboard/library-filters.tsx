"use client";
import { Select } from "./ui/select";
import { NotebookSelect } from "./notebook-select";
import {
  useId,
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { SlidersHorizontal, X } from "lucide-react";
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
  const [appliedSearch, setAppliedSearch] = useState(value.search);
  const [tag, setTag] = useState(value.tag);
  const [expanded, setExpanded] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const id = useId();
  // An empty-state reset can clear filters outside this bar. Keep unsent typing
  // until the applied query actually changes, then reconcile before rendering.
  if (appliedSearch !== value.search) {
    setAppliedSearch(value.search);
    if (query.trim() !== value.search) setQuery(value.search);
  }
  useLayoutEffect(() => {
    if (!expanded) return;
    const element = panel.current!;
    let frame = 0;
    const position = () => {
      const anchor = trigger.current!.getBoundingClientRect();
      const viewport = window.visualViewport;
      const topEdge = (viewport?.offsetTop ?? 0) + 12;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 12;
      const bottomEdge =
        topEdge + (viewport?.height ?? window.innerHeight) - 24;
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 24;
      const below = bottomEdge - anchor.bottom - 6;
      const above = anchor.top - topEdge - 6;
      const openBelow =
        below >= Math.min(320, (bottomEdge - topEdge) / 2) || below >= above;
      element.style.maxHeight = `${Math.max(0, openBelow ? below : above)}px`;
      element.style.maxWidth = `${rightEdge - leftEdge}px`;
      element.style.left = `${Math.max(leftEdge, Math.min(anchor.right - element.offsetWidth, rightEdge - element.offsetWidth))}px`;
      element.style.top = `${Math.max(topEdge, openBelow ? anchor.bottom + 6 : anchor.top - element.offsetHeight - 6)}px`;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };
    position();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    observer.observe(trigger.current!);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [expanded]);
  function close() {
    panel.current?.hidePopover();
    trigger.current?.focus({ preventScroll: true });
  }
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
        document.querySelector(
          "dialog[open], [popover]:popover-open, [role=listbox]",
        ) ||
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
          placeholder="Search your notes…"
        />
        <button
          type="button"
          ref={trigger}
          className="app-button secondary library-filter-trigger"
          aria-label="Filters"
          title="Filters and sorting"
          aria-describedby={`${id}-active-count`}
          aria-expanded={expanded}
          aria-controls={`${id}-filters`}
          aria-haspopup="dialog"
          popoverTarget={`${id}-filters`}
        >
          <SlidersHorizontal size={16} />
          <span className="filter-trigger-label">Filters</span>
          <span
            className="filter-count"
            style={{ visibility: active > 0 ? "visible" : "hidden" }}
            aria-hidden="true"
          >
            {active}
          </span>
          <span className="sr-only" id={`${id}-active-count`}>
            {active} active filters
          </span>
        </button>
      </form>
      <div
        id={`${id}-filters`}
        ref={panel}
        popover="auto"
        role="dialog"
        aria-label="Filter notes"
        className="library-filter-popover"
        onBeforeToggle={(event) => {
          const opening = event.newState === "open";
          if (opening) {
            setTag(value.tag);
            setSuggestions(topics);
          }
          setExpanded(opening);
        }}
      >
        <div className="library-filter-heading">
          <h2>Filters</h2>
          <button
            type="button"
            className="app-icon"
            aria-label="Close filters"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <form
          className="library-filters app-form"
          onSubmit={(event) => {
            event.preventDefault();
            update({ tag: tag.trim() });
          }}
        >
          {fixedProject === undefined && (
            <NotebookSelect
              label="Notebook"
              value={value.project}
              onValueChange={(project) => update({ project })}
              projects={projects}
              leading={[
                { value: "all", label: "All notes" },
                { value: "personal", label: "Unfiled" },
              ]}
            />
          )}
          <Select
            label="Sort notes"
            value={value.sort}
            onValueChange={(sort) =>
              update({ sort: sort as LibraryFilters["sort"] })
            }
            options={[
              { value: "updated_desc", label: "Recently updated" },
              { value: "updated_asc", label: "Oldest updated" },
              { value: "created_desc", label: "Date written" },
            ]}
          />
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
              {suggestions.map((topic) => (
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
          {suggestions.length > 0 && (
            <div className="topic-suggestions">
              <span>Suggested topics</span>
              {suggestions.slice(0, 8).map((topic) => (
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
        {active > 0 && (
          <div
            className="filter-chips"
            role="group"
            aria-label="Active filters"
            onClickCapture={(event) => {
              const button = (event.target as HTMLElement).closest("button");
              if (!button) return;
              const sibling =
                button.nextElementSibling ?? button.previousElementSibling;
              (sibling instanceof HTMLButtonElement
                ? sibling
                : done.current
              )?.focus({ preventScroll: true });
            }}
          >
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
                  .join(" / ") || "Unfiled"}
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
          </div>
        )}
        <div className="library-filter-footer">
          <button
            type="button"
            className="text-button"
            disabled={!active}
            onClick={() => {
              done.current?.focus({ preventScroll: true });
              setQuery("");
              setTag("");
              onChange((current) => ({
                ...initialFilters(archive),
                sort: current.sort,
              }));
            }}
          >
            Clear filters
          </button>
          <button
            type="button"
            className="app-button secondary"
            ref={done}
            onClick={close}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
