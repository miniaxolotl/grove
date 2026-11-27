"use client";

import { useState } from "react";
import { Link as LinkIcon, Pin, PinOff } from "lucide-react";
import { filterOutline, type NoteHeading } from "@/lib/note-headings";
import { IconButton } from "./ui/button";
import { useToast } from "./toasts";
import { OutlineItems } from "./ui/outline-items";

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
  const [manual, setManual] = useState("");
  const toast = useToast();
  const matches = filterOutline(headings, query);
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
        <OutlineItems
          headings={matches}
          active={headings[active]?.id}
          jump={jump}
          action={(heading, labelId) => (
            <IconButton
              label="Copy section link"
              aria-describedby={labelId}
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
          )}
        />
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
