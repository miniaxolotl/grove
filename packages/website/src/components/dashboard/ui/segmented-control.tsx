import type { ReactNode } from "react";

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  focusKey,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  focusKey?: string;
}) {
  return (
    <div className="segmented-control" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          data-focus-key={focusKey ? `${focusKey}-${option.value}` : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
