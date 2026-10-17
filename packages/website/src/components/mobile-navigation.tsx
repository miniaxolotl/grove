"use client";

import { ArrowUpRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { navigation } from "@/content/site";

export function MobileNavigation({ github }: { github: string }) {
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

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={container} className="md:hidden">
      <button
        ref={toggle}
        type="button"
        className="grid size-11 place-items-center rounded-full border border-line hover:bg-sage"
        aria-expanded={open}
        aria-controls="mobile-navigation"
        aria-label={open ? "Close navigation" : "Open navigation"}
        onClick={() => setOpen(!open)}
      >
        {open ? <X size={19} /> : <Menu size={19} />}
      </button>
      <nav
        id="mobile-navigation"
        aria-label="Mobile navigation"
        hidden={!open}
        className="absolute inset-x-0 top-full border-b border-line bg-paper px-6 pb-6 pt-3 shadow-xl shadow-forest/5"
      >
        {[...navigation, { label: "Documentation", href: "/install" }].map(
          ({ label, href }) => (
            <Link
              key={label}
              href={href}
              onClick={() => setOpen(false)}
              className="flex min-h-12 items-center border-b border-line text-sm hover:text-leaf"
            >
              {label}
            </Link>
          ),
        )}
        <a
          href={github}
          className="mt-3 flex min-h-11 items-center gap-2 text-sm"
        >
          Explore on GitHub <ArrowUpRight size={15} />
        </a>
      </nav>
    </div>
  );
}
