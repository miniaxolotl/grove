"use client";

import { ArrowUpRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { navigation } from "@/content/site";

export function MobileNavigation() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnResize = () => setOpen(false);

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    desktop.addEventListener("change", closeOnResize);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      desktop.removeEventListener("change", closeOnResize);
    };
  }, [open]);

  return (
    <div
      ref={container}
      className="header-menu"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={toggle}
        type="button"
        className="header-menu-toggle"
        aria-expanded={open}
        aria-controls="mobile-navigation"
        aria-label={open ? "Close navigation" : "Open navigation"}
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <X size={18} aria-hidden="true" />
        ) : (
          <Menu size={18} aria-hidden="true" />
        )}
      </button>
      <nav
        id="mobile-navigation"
        aria-label="Mobile navigation"
        hidden={!open}
        className="absolute inset-x-0 top-full border-b border-line bg-paper px-6 pb-6 pt-3 shadow-xl shadow-forest/5"
      >
        {[
          ...navigation,
          { label: "Connect AI tools", href: "/install" },
          { label: "Your Grove", href: "/app" },
        ].map(({ label, href }) => (
          <Link
            key={label}
            href={href}
            onClick={() => setOpen(false)}
            className="flex min-h-12 items-center border-b border-line text-sm hover:text-leaf"
          >
            {label}
          </Link>
        ))}
        <Link
          href="/sign-up"
          className="button-primary mt-4 w-full"
          onClick={() => setOpen(false)}
        >
          Start your notebook <ArrowUpRight size={15} />
        </Link>
      </nav>
    </div>
  );
}
