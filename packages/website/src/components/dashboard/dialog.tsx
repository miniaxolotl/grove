"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
export function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    element
      .querySelector<HTMLElement>(
        "textarea, input:not([type=checkbox]), select",
      )
      ?.focus();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={close}
      aria-label={title}
      className="app-dialog"
    >
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="font-editorial text-3xl">{title}</h2>
        <button onClick={close} className="app-icon" aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
