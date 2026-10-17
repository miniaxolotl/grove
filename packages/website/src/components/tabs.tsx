"use client";

import type { KeyboardEvent } from "react";

type Option = { value: string; label: string; badge?: string };

export function Tabs({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: readonly Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % options.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + options.length) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else return;

    event.preventDefault();
    onChange(options[next].value);
    document.getElementById(`${id}-tab-${options[next].value}`)?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className="tab-list">
      {options.map((option, index) => (
        <button
          key={option.value}
          id={`${id}-tab-${option.value}`}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          aria-controls={`${id}-panel-${option.value}`}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {option.label}
          {option.badge && (
            <span className="hidden rounded-full bg-sage px-2 py-0.5 text-[9px] text-forest sm:inline">
              {option.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
