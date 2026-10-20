import { RefreshCw } from "lucide-react";

export function LoadError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div className="app-error app-retry" role="alert">
      <p>{message}</p>
      <button className="app-button secondary" onClick={retry}>
        <RefreshCw size={14} aria-hidden="true" /> Try loading again
      </button>
    </div>
  );
}
