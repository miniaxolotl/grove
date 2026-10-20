"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { capture } from "@/lib/analytics";
import { recordWebsiteOperation } from "@/lib/diagnostics";

export function CopyButton({
  text,
  label = "Copy",
  installation = false,
}: {
  text: string;
  label?: string;
  installation?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timeout = window.setTimeout(() => setStatus("idle"), 4000);
    return () => window.clearTimeout(timeout);
  }, [status]);

  async function copy() {
    const started = performance.now();
    const operation = installation
      ? "copy_install_command"
      : "copy_example_command";
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
      if (installation)
        capture("install_command_copied", { placement: "install" });
      recordWebsiteOperation(operation, "success", performance.now() - started);
    } catch {
      setStatus("error");
      recordWebsiteOperation(
        operation,
        "unavailable",
        performance.now() - started,
      );
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
