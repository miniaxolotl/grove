"use client";
import { useEffect } from "react";

/** A history restoration must recheck the live capability, not reuse old content. */
export function SharedHistoryRefresh() {
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      document
        .querySelector<HTMLElement>("[data-shared-content]")
        ?.setAttribute("hidden", "");
      window.location.reload();
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  return null;
}
