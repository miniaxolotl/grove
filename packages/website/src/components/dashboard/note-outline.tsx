"use client";

import { useId, useState } from "react";
import { Link as LinkIcon, Pin, PinOff } from "lucide-react";
import type { NoteHeading } from "@/lib/note-headings";
import { IconButton } from "./ui/button";
import { useToast } from "./toasts";

export function NoteOutline({
  headings,
  active,
  jump,
  noteId,
  pinned,
  togglePin,
  compact = false,
}: {
  headings: NoteHeading[];
  active: number;
  jump: (heading: NoteHeading) => void;
  noteId?: string;
  pinned: boolean;
  togglePin: () => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const id = useId();
  const [manual, setManual] = useState("");
  const toast = useToast();
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = headings.filter((heading) =>
    words.every((word) => heading.title.toLowerCase().includes(word)),
  );
  const minLevel = Math.min(...headings.map((heading) => heading.level));
  async function copy(heading: NoteHeading) {
    if (!noteId) return;
    const url = new URL(
      `/app/memories/${encodeURIComponent(noteId)}`,
      location.origin,
    );
    url.hash = heading.id;
    try {
      await navigator.clipboard.writeText(url.href);
      setManual("");
      toast("Section link copied");
    } catch {
      setManual(url.href);
      toast("Select the section link to copy manually");
    }
  }
  return (
    <nav className="writing-outline" aria-label="Sections in this note">
      <div className="outline-controls">
        <input
          aria-label="Find a heading"
          placeholder="Find a heading…"
          value={query}
          data-autofocus={compact || undefined}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (
              !event.nativeEvent.isComposing &&
              event.key === "Enter" &&
              matches[0]
            ) {
              event.preventDefault();
              jump(matches[0]);
            }
          }}
        />
        <IconButton
          label={pinned ? "Unpin outline" : "Pin outline on wide screens"}
          aria-pressed={pinned}
          onClick={togglePin}
        >
          {pinned ? <PinOff size={16} /> : <Pin size={16} />}
        </IconButton>
      </div>
      {manual && (
        <label className="outline-copy-fallback">
          Select and copy this private section link
          <input
            aria-label="Section link"
            readOnly
            value={manual}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
      {matches.length ? (
        <ul>
          {matches.map((heading) => (
            <li key={heading.id}>
              <button
                id={`${id}-${heading.id}`}
                type="button"
                aria-label={heading.title}
                aria-current={
                  headings[active]?.id === heading.id ? "location" : undefined
                }
                style={{
                  paddingLeft: 8 + Math.min(heading.level - minLevel, 3) * 12,
                }}
                onClick={() => jump(heading)}
              >
                <span className="outline-level" aria-hidden="true">
                  H{heading.level}
                </span>
                <span>{heading.title}</span>
              </button>
              <IconButton
                label="Copy section link"
                aria-describedby={`${id}-${heading.id}`}
                disabled={!noteId}
                title={
                  !noteId
                    ? "Save this note before copying section links"
                    : `Copy section link to ${heading.title}`
                }
                onClick={() => void copy(heading)}
              >
                <LinkIcon size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          {headings.length
            ? "No matching headings."
            : "Add a heading to find your way around."}
        </p>
      )}
    </nav>
  );
}
