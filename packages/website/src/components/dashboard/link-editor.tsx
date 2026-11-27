"use client";
import { useId, useState } from "react";
import {
  createGroveLink,
  formatMarkdownLink,
  parseGroveLink,
} from "@lib/shared/internal-links";
import { InspectorDialog } from "./ui/inspector-dialog";

export type LinkDraft = {
  href: string;
  label: string;
  followTitle: boolean;
  editing: boolean;
};

export function LinkEditor({
  initial,
  apply,
  close,
  onDismissed,
}: {
  initial: LinkDraft;
  apply: (markdown: string) => void;
  close: () => void;
  onDismissed: () => void;
}) {
  const id = useId();
  const [href, setHref] = useState(initial.href);
  const [label, setLabel] = useState(initial.label);
  const [followTitle, setFollowTitle] = useState(initial.followTitle);
  const [error, setError] = useState("");
  const internal = !!parseGroveLink(
    href,
    typeof window === "undefined" ? undefined : window.location.origin,
  );
  return (
    <InspectorDialog
      title={initial.editing ? "Edit link" : "Insert link"}
      close={close}
      onDismissed={onDismissed}
    >
      <div
        className="link-editor-form"
        onKeyDown={(event) => {
          if (
            event.key !== "Enter" ||
            event.nativeEvent.isComposing ||
            !(event.target instanceof HTMLInputElement) ||
            event.target.type === "checkbox"
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget
            .querySelector<HTMLButtonElement>("[data-apply-link]")
            ?.click();
        }}
      >
        <label htmlFor={`${id}-destination`}>Destination</label>
        <input
          id={`${id}-destination`}
          type="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={4096}
          value={href}
          onChange={(event) => setHref(event.target.value)}
          placeholder="Paste a note, notebook or web link"
        />
        <label htmlFor={`${id}-label`}>Label</label>
        <input
          id={`${id}-label`}
          type="text"
          maxLength={500}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        {internal ? (
          <label className="link-editor-title-choice">
            <input
              type="checkbox"
              checked={followTitle}
              onChange={(event) => setFollowTitle(event.target.checked)}
            />
            Follow the linked title
          </label>
        ) : null}
        {internal && followTitle ? (
          <p className="app-hint">
            The label stays as a readable fallback in Markdown and shared
            readers.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="app-error">
            {error}
          </p>
        ) : null}
        <div className="link-editor-actions">
          <button
            type="button"
            className="app-button secondary"
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="button"
            data-apply-link
            className="app-button"
            onClick={() => {
              setError("");
              try {
                const destination = href.trim();
                const origin = window.location.origin;
                if (
                  !destination ||
                  destination.length > 4096 ||
                  /[\s\\]/.test(destination) ||
                  !/^(?:https?:\/\/|mailto:|\/app\/|#)/i.test(destination)
                )
                  throw new Error(
                    "Choose a supported destination: an http(s), email, Grove or section link.",
                  );
                if (!label.trim() || label.length > 500 || /[\r\n]/.test(label))
                  throw new Error(
                    "Choose a single-line label of up to 500 characters.",
                  );
                const linked = parseGroveLink(destination, origin);
                const markdown = linked
                  ? createGroveLink(destination, label, followTitle, origin)
                  : formatMarkdownLink(destination, label);
                apply(markdown);
                close();
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "The link could not be inserted.",
                );
              }
            }}
          >
            {initial.editing ? "Update link" : "Insert link"}
          </button>
        </div>
      </div>
    </InspectorDialog>
  );
}
