"use client";

import { useCallback, useId, useState } from "react";
import * as Primitive from "@radix-ui/react-select";
import { isolateOverlay } from "./overlay-focus";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};
export type SelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  label?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

/** One controlled dropdown for forms, filters and toolbars, including modal dialogs. */
export function Select({
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
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const [container, setContainer] = useState<HTMLElement | null>(null);
  // Keep popovers inside the nearest modal's top layer and the workspace font scope.
  const [font, setFont] = useState<string>();
  const attach = useCallback((element: HTMLButtonElement | null) => {
    if (!element) return;
    setContainer(
      element.closest(
        "[popover], dialog, .memory-graph, .grove-app, .connect-shell",
      ),
    );
    setFont(getComputedStyle(element).fontFamily);
  }, []);
  // Radix traps focus and hides background content from assistive technology.
  // Also make it inert so hidden controls cannot receive programmatic focus.
  const isolate = useCallback(
    (element: HTMLDivElement | null) =>
      element?.isConnected ? isolateOverlay(element) : undefined,
    [],
  );
  return (
    <div className={`app-select-field ${className}`}>
      {label && <label htmlFor={controlId}>{label}</label>}
      <Primitive.Root
        name={name}
        value={`value:${value}`}
        onValueChange={(next) => onValueChange(next.slice(6))}
        disabled={disabled}
      >
        <Primitive.Trigger
          {...aria}
          id={controlId}
          aria-label={aria["aria-label"] ?? label}
          className="app-select-trigger"
          ref={attach}
        >
          <Primitive.Value placeholder={placeholder} />
          <Primitive.Icon asChild>
            <ChevronDown size={15} aria-hidden="true" />
          </Primitive.Icon>
        </Primitive.Trigger>
        <Primitive.Portal container={container}>
          <Primitive.Content
            ref={isolate}
            position="popper"
            sideOffset={6}
            collisionPadding={12}
            className="app-select-content"
            style={{ fontFamily: font }}
            onEscapeKeyDown={(event) => event.stopPropagation()}
          >
            <Primitive.Viewport className="app-select-viewport">
              {options.map((option) => (
                <Primitive.Item
                  key={option.value}
                  value={`value:${option.value}`}
                  textValue={option.label}
                  disabled={option.disabled}
                  className="app-select-option"
                  data-value={option.value}
                >
                  <span className="app-select-copy">
                    <Primitive.ItemText>{option.label}</Primitive.ItemText>
                    {option.description && (
                      <span className="app-select-description">
                        {option.description}
                      </span>
                    )}
                  </span>
                  <Primitive.ItemIndicator className="app-select-check">
                    <Check size={15} />
                  </Primitive.ItemIndicator>
                </Primitive.Item>
              ))}
            </Primitive.Viewport>
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
    </div>
  );
}
