"use client";
import { FileText, RotateCw } from "lucide-react";
import { RecoveryState } from "@/components/recovery-state";

export function LoadingState({
  label,
  className = "",
  failed = false,
  retry,
  list = false,
  failureTitle = "This view couldn’t open",
  failureDescription = "Something interrupted loading. Try opening it again in a moment.",
}: {
  label: string;
  className?: string;
  failed?: boolean;
  retry?: () => void;
  list?: boolean;
  failureTitle?: string;
  failureDescription?: string;
}) {
  if (failed)
    return (
      <div className={`feature-placeholder is-error ${className}`}>
        <RecoveryState
          title={failureTitle}
          description={failureDescription}
          actions={
            <button
              type="button"
              className="app-button"
              onClick={(event) => {
                // Retry replaces its button; retain focus inside the current dialog.
                event.currentTarget
                  .closest("dialog")
                  ?.querySelector<HTMLButtonElement>(".dialog-heading button")
                  ?.focus({ preventScroll: true });
                retry?.();
              }}
            >
              <RotateCw size={15} aria-hidden="true" />
              Try opening again
            </button>
          }
        />
      </div>
    );
  return (
    <div className={`feature-placeholder ${className}`}>
      <div className="feature-placeholder-content">
        <div className="feature-placeholder-message" role="status">
          <FileText size={20} strokeWidth={1.5} aria-hidden="true" />
          <p className="feature-placeholder-title">{label}</p>
        </div>
        <div
          className={`feature-placeholder-lines${list ? " is-list" : ""}`}
          aria-hidden="true"
        >
          {Array.from({ length: list ? 5 : 3 }, (_, index) => (
            <div key={index}>
              <i />
              <i />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
