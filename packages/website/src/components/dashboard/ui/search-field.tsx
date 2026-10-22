import { Search, X } from "lucide-react";
import type { InputHTMLAttributes, Ref } from "react";

export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  inputRef,
  submit = false,
  className = "",
  ...inputProps
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "className"
> & {
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
        {...inputProps}
        ref={inputRef}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={inputProps.maxLength ?? 1000}
      />
      <button
        type="button"
        aria-label={`Clear ${label.toLowerCase()}`}
        style={{ visibility: value ? "visible" : "hidden" }}
        disabled={!value}
        onClick={(event) => {
          event.currentTarget.parentElement?.querySelector("input")?.focus();
          onChange("");
        }}
      >
        <X size={15} />
      </button>
      {submit && <button type="submit">Search</button>}
    </div>
  );
}
