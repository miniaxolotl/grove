"use client";

import { type ReactNode, useEffect, useRef } from "react";

// Content is visible in server HTML. Only off-screen elements are enhanced.
export function MarketingMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = root.current;
    if (!container || !window.IntersectionObserver) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const elements = container.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.revealState = "visible";
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.05 },
    );
    const sync = () => {
      observer.disconnect();
      for (const element of elements) {
        delete element.dataset.revealState;
        if (
          !preference.matches &&
          element.getBoundingClientRect().top >= window.innerHeight
        ) {
          element.dataset.revealState = "pending";
          observer.observe(element);
        }
      }
    };
    const revealFocused = (event: FocusEvent) => {
      if (!(event.target instanceof Node)) return;
      for (const element of elements) {
        if (element.contains(event.target)) {
          delete element.dataset.revealState;
          observer.unobserve(element);
        }
      }
    };
    sync();
    preference.addEventListener("change", sync);
    container.addEventListener("focusin", revealFocused);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", sync);
      container.removeEventListener("focusin", revealFocused);
      for (const element of elements) delete element.dataset.revealState;
    };
  }, []);
  return (
    <div ref={root} className="marketing-site">
      {children}
    </div>
  );
}
