import type { ComponentProps, ReactNode } from "react";
import { Dialog } from "../dialog";
import { SearchField } from "./search-field";

/** Shared search-led layout; each consumer owns its result semantics and data. */
export function PaletteDialog({
  title,
  close,
  search,
  children,
  footer,
  onDismissed,
}: {
  title: string;
  close: () => void;
  search: ComponentProps<typeof SearchField>;
  children: ReactNode;
  footer: ReactNode;
  onDismissed?: () => void;
}) {
  return (
    <Dialog
      title={title}
      close={close}
      variant="palette"
      onDismissed={onDismissed}
      header={
        <SearchField
          {...search}
          className="palette-search"
          clearLabel
          autoComplete="off"
          spellCheck={false}
        />
      }
    >
      <div className="palette-body">{children}</div>
      <div className="palette-footer">{footer}</div>
    </Dialog>
  );
}
