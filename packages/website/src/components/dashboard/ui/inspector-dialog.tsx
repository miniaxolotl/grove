import type { ReactNode } from "react";
import { Dialog } from "../dialog";

/** Auxiliary note controls share native modal focus, dismissal and viewport fitting. */
export function InspectorDialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog title={title} close={close} variant="inspector">
      <div className="inspector-body">{children}</div>
    </Dialog>
  );
}
