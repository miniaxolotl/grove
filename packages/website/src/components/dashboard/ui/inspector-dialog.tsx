import type { ReactNode } from "react";
import { Dialog } from "../dialog";

/** Auxiliary note controls share native modal focus, dismissal and viewport fitting. */
export function InspectorDialog({
  title,
  close,
  children,
  onDismissed,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  onDismissed?: () => void;
}) {
  return (
    <Dialog
      title={title}
      close={close}
      variant="inspector"
      onDismissed={onDismissed}
    >
      <div className="inspector-body">{children}</div>
    </Dialog>
  );
}
