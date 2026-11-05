"use client";

import { Check, Share2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { positioning } from "@/content/site";
import styles from "./share-site.module.css";

export function ShareSite({ url }: { url: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "fallback">("idle");
  const [busy, setBusy] = useState(false);
  const fallback = useRef<HTMLDialogElement>(null);
  const heading = useId();

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
            title: positioning.title,
            text: positioning.shareText,
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
      fallback.current?.showModal();
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
        {status === "copied" ? (
          <Check size={15} aria-hidden="true" />
        ) : (
          <Share2 size={15} aria-hidden="true" />
        )}
        <span className={styles.label}>
          <span aria-hidden={status === "copied"}>Share Grove</span>
          <span aria-hidden={status !== "copied"}>Link copied</span>
        </span>
      </button>
      <span role="status" className="sr-only">
        {status === "copied" ? "Grove link copied to your clipboard." : ""}
      </span>
      <dialog
        ref={fallback}
        aria-labelledby={heading}
        className={styles.dialog}
      >
        <form method="dialog">
          <h2 id={heading}>Share Grove</h2>
          <label>
            Copy this link to share Grove
            <input
              aria-label="Grove link to share"
              value={url}
              readOnly
              onFocus={(event) => event.target.select()}
            />
          </label>
          <button type="submit">Done</button>
        </form>
      </dialog>
    </div>
  );
}
