"use client";
import { FileText, RotateCw } from "lucide-react";

export function LoadingState({
  label,
  className = "",
  failed = false,
  retry,
  list = false,
}: {
  label: string;
  className?: string;
  failed?: boolean;
  retry?: () => void;
  list?: boolean;
}) {
  return (
    <div className={`feature-placeholder ${className}`}>
      <div className="feature-placeholder-content">
        <div
          className="feature-placeholder-message"
          role={failed ? "alert" : "status"}
        >
          <FileText size={20} strokeWidth={1.5} aria-hidden="true" />
          <p className="feature-placeholder-title">
            {failed ? "This view couldn’t open." : label}
          </p>
          {failed && <p>Try loading it again. Your notes are still here.</p>}
        </div>
        {failed ? (
          <button
            type="button"
            className="app-button secondary"
            onClick={(event) => {
              // The retry control unmounts; keep keyboard focus inside its dialog.
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
        ) : (
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
        )}
      </div>
    </div>
  );
}
