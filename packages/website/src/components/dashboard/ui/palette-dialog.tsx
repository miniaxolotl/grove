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
}: {
  title: string;
  close: () => void;
  search: ComponentProps<typeof SearchField>;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Dialog
      title={title}
      close={close}
      variant="palette"
      header={
        <SearchField
          {...search}
          className="palette-search"
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
