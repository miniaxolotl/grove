import { Search, X } from "lucide-react";
import type { Ref } from "react";

export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  inputRef,
  submit = false,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: Ref<HTMLInputElement>;
  submit?: boolean;
  className?: string;
}) {
  return (
    <div className={`app-search ${className}`}>
      <Search size={17} aria-hidden="true" />
      <input
        ref={inputRef}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={1000}
      />
      {value && (
        <button
          type="button"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={() => onChange("")}
        >
          <X size={15} />
        </button>
      )}
      {submit && <button type="submit">Search</button>}
    </div>
  );
}
