export function SettingsSaveRow({
  label,
  dirty,
  busy,
  error,
  onDiscard,
  busyMessage = "Saving…",
}: {
  label: string;
  dirty: boolean;
  busy: boolean;
  error?: string;
  onDiscard: () => void;
  busyMessage?: string;
}) {
  return (
    <div className="settings-save-row">
      <button type="submit" className="app-button" disabled={busy || !dirty}>
        {label}
      </button>
      <button
        type="button"
        className="app-button secondary"
        disabled={busy || !dirty}
        onClick={onDiscard}
      >
        Discard changes
      </button>
      <p className="settings-save-status" role="status" aria-live="polite">
        {busy
          ? busyMessage
          : error
            ? "Couldn’t complete. Try again."
            : dirty
              ? "Unsaved changes"
              : "All changes saved"}
      </p>
    </div>
  );
}
