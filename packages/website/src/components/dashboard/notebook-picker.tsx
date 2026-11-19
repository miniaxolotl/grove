import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import { overlayViewport } from "./ui/overlay-focus";
import { SearchField } from "./ui/search-field";
import type { SelectProps } from "./ui/select";
import "./notebook-picker.css";

function printable(event: KeyboardEvent) {
  return (
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.nativeEvent.isComposing &&
    event.key.length === 1
  );
}

/** A native modal keeps the filter and options together in the top layer,
 * including inside note properties, library filters and quick search. */
export function NotebookPicker({
  value,
  onValueChange,
  options,
  label,
  id,
  name,
  disabled,
  placeholder = "Choose…",
  className = "",
  ...aria
}: SelectProps) {
  const uid = useId();
  const popupId = `${uid}-notebooks`;
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const touchOpen = useRef(false);
  const [query, setQuery] = useState<string | null>(null);
  const open = query !== null && !disabled;
  const selected = options.find((option) => option.value === value);
  const search = query?.trim().toLocaleLowerCase() ?? "";
  const visible = open
    ? options.filter((option) =>
        option.label.toLocaleLowerCase().includes(search),
      )
    : [];
  const title = aria["aria-label"] ?? label ?? "Notebook";

  useLayoutEffect(() => {
    if (!open) return;
    const popup = dialog.current!;
    const trigger = button.current!;
    const position = () => {
      const rect = trigger.getBoundingClientRect();
      const viewport = overlayViewport();
      const width = Math.min(Math.max(320, rect.width), viewport.width - 24);
      const above = rect.top - viewport.top - 18;
      const below = viewport.top + viewport.height - rect.bottom - 18;
      const flip = below < 300 && above > below;
      popup.style.width = `${width}px`;
      popup.style.maxHeight = `${Math.min(340, Math.max(0, flip ? above : below))}px`;
      popup.style.left = `${Math.max(viewport.left + 12, Math.min(rect.left, viewport.left + viewport.width - width - 12))}px`;
      popup.style.top = flip ? "auto" : `${rect.bottom + 6}px`;
      popup.style.bottom = flip
        ? `${window.innerHeight - rect.top + 6}px`
        : "auto";
    };
    position();
    // showModal() focuses its first input synchronously. On touch, give it
    // the browsing target up front so it never requests a software keyboard.
    const initial = touchOpen.current
      ? (popup.querySelector<HTMLElement>('[aria-selected="true"]:enabled') ??
        popup.querySelector<HTMLElement>('[role="option"]:enabled') ??
        popup)
      : input.current!;
    initial.autofocus = true;
    popup.showModal();
    initial.autofocus = false;
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      popup.close();
      trigger.focus({ preventScroll: true });
    };
  }, [open]);

  function choose(next: string) {
    setQuery(null);
    if (next !== value && !disabled) onValueChange(next);
  }

  function navigate(event: KeyboardEvent<HTMLDialogElement>) {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    const target = event.target;
    const typing = target === input.current;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="option"]:not(:disabled)',
      ),
    );
    const index = buttons.indexOf(target as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (event.key === "ArrowDown")
        buttons[Math.min(index + 1, buttons.length - 1)]?.focus();
      else if (index === 0) input.current?.focus();
      else buttons.at(index < 0 ? -1 : index - 1)?.focus();
    } else if (
      (!typing || !query) &&
      (event.key === "Home" || event.key === "End")
    ) {
      event.preventDefault();
      buttons.at(event.key === "Home" ? 0 : -1)?.focus();
    } else if (typing && event.key === "Enter") {
      event.preventDefault();
      const match = search
        ? buttons[0]
        : buttons.find((option) => option.dataset.value === value);
      match?.click();
    } else if (index >= 0 && printable(event) && event.key !== " ") {
      event.preventDefault();
      setQuery((query ?? "") + event.key);
      input.current?.focus();
    }
  }

  return (
    <div className={`app-select-field ${className}`}>
      {label && <label htmlFor={id ?? uid}>{label}</label>}
      {name && (
        <input type="hidden" name={name} value={value} disabled={disabled} />
      )}
      <button
        {...aria}
        ref={button}
        type="button"
        role="combobox"
        aria-haspopup="dialog"
        aria-controls={popupId}
        aria-expanded={open}
        aria-label={title}
        id={id ?? uid}
        disabled={disabled}
        className="app-select-trigger"
        data-state={open ? "open" : "closed"}
        onPointerDown={(event) => {
          touchOpen.current = event.pointerType === "touch";
        }}
        onClick={() => setQuery("")}
        onKeyDown={(event) => {
          touchOpen.current = false;
          if (
            event.key === "ArrowDown" ||
            event.key === "ArrowUp" ||
            (printable(event) && event.key !== " ")
          ) {
            event.preventDefault();
            setQuery(printable(event) ? event.key : "");
          }
        }}
      >
        <span>{selected?.displayLabel ?? selected?.label ?? placeholder}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <dialog
        ref={dialog}
        id={popupId}
        aria-label={title}
        closedby="any"
        className="app-select-content notebook-picker"
        onKeyDown={navigate}
        onCancel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setQuery(null);
        }}
        onClose={(event) => {
          event.stopPropagation();
          if (!event.currentTarget.open) setQuery(null);
        }}
      >
        {open && (
          <>
            <div className="notebook-picker-heading">
              <SearchField
                label="Filter notebooks"
                placeholder="Filter notebooks…"
                inputRef={input}
                value={query}
                onChange={setQuery}
                autoComplete="off"
                spellCheck={false}
                aria-controls={`${uid}-choices`}
              />
              <button
                type="button"
                className="text-button notebook-picker-back"
                aria-label={`Back to ${title}`}
                onClick={() => setQuery(null)}
              >
                Back
              </button>
            </div>
            <div
              id={`${uid}-choices`}
              role="listbox"
              aria-label={title}
              className="app-select-viewport"
            >
              {visible.map((option) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={value === option.value}
                  aria-label={option.label}
                  key={option.value}
                  disabled={option.disabled}
                  tabIndex={-1}
                  data-value={option.value}
                  data-disabled={option.disabled || undefined}
                  data-state={value === option.value ? "checked" : "unchecked"}
                  className="app-select-option"
                  onClick={() => choose(option.value)}
                >
                  <span className="app-select-copy">
                    {option.displayLabel ?? option.label}
                    {option.description && (
                      <span className="app-select-description">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {value === option.value && (
                    <Check
                      size={15}
                      className="app-select-check"
                      aria-hidden="true"
                    />
                  )}
                </button>
              ))}
            </div>
            {!visible.length && (
              <p role="status">
                No matching notebooks. Try another name or path.
              </p>
            )}
          </>
        )}
      </dialog>
    </div>
  );
}
