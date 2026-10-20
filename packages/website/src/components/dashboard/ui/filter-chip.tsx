import { X } from "lucide-react";
import type { ReactNode } from "react";

export function FilterChip({
  label,
  children,
  onRemove,
}: {
  label: string;
  children: ReactNode;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove ${label} filter`}
    >
      <span>{children}</span>
      <X size={13} />
    </button>
  );
}
