import { RefreshCw } from "lucide-react";
import { RecoveryState } from "@/components/recovery-state";

export function LoadError({
  message,
  retry,
  title = "Couldn’t load this page",
}: {
  message: string;
  retry: () => void;
  title?: string;
}) {
  return (
    <div className="load-error">
      <RecoveryState
        compact
        title={title}
        description={message}
        actions={
          <button
            type="button"
            className="app-button secondary"
            onClick={retry}
          >
            <RefreshCw size={14} aria-hidden="true" /> Try again
          </button>
        }
      />
    </div>
  );
}
