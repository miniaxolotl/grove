"use client";

import { Check, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

export function ShareSite({ url }: { url: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "fallback">("idle");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status !== "copied") return;
    const timeout = window.setTimeout(() => setStatus("idle"), 4000);
    return () => window.clearTimeout(timeout);
  }, [status]);

  async function share() {
    setBusy(true);
    try {
      if (navigator.share) {
        try {
          await navigator.share({
            title: "Grove — New session. Same context.",
            text: "A little memory for your AI agent. Open source, self-hosted, and yours to grow.",
            url,
          });
          setStatus("idle");
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return;
        }
      }
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      setStatus("fallback");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={share}
        disabled={busy}
        className="inline-flex min-h-11 items-center gap-2 text-xs font-medium text-forest hover:text-leaf disabled:opacity-50"
      >
        {status === "copied" ? <Check size={15} /> : <Share2 size={15} />}
        {status === "copied"
          ? "Link copied. Let it grow."
          : "Share a little Grove"}
      </button>
      <span role="status" className="sr-only">
        {status === "copied" ? "Grove link copied to your clipboard." : ""}
      </span>
      {status === "fallback" && (
        <label className="mt-1 block text-[11px] text-muted">
          Copy this link to share
          <input
            aria-label="Grove link to share"
            value={url}
            readOnly
            onFocus={(event) => event.target.select()}
            className="mt-2 block w-full rounded-md border border-line bg-white px-3 py-2 text-xs text-forest"
          />
        </label>
      )}
    </div>
  );
}
