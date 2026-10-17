"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timeout = window.setTimeout(() => setStatus("idle"), 4000);
    return () => window.clearTimeout(timeout);
  }, [status]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2">
      <button
        type="button"
        onClick={copy}
        className="copy-button"
        aria-label={label}
      >
        {status === "copied" ? <Check size={14} /> : <Copy size={14} />}
        {status === "copied" ? "Copied" : "Copy"}
      </button>
      <span
        role="status"
        className={status === "error" ? "max-w-40 text-[11px]" : "sr-only"}
      >
        {status === "copied"
          ? `${label}: copied to clipboard.`
          : status === "error"
            ? "Select the text below to copy manually."
            : ""}
      </span>
    </span>
  );
}
