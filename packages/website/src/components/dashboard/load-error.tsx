import { RefreshCw } from "lucide-react";
import { RecoveryState } from "@/components/recovery-state";

export function LoadError({
  message,
  retry,
  title = "This view couldn’t load",
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
            <RefreshCw size={14} aria-hidden="true" /> Try loading again
          </button>
        }
      />
    </div>
  );
}
