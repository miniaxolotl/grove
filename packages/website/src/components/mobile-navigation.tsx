"use client";

import { ArrowUpRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { navigation } from "@/content/site";

export function MobileNavigation() {
  const container = useRef<HTMLDetailsElement>(null);
  const toggle = useRef<HTMLElement>(null);

  useEffect(() => {
    const menu = container.current;
    if (!menu) return;
    const close = () => {
      menu.open = false;
    };
    function onKeyDown(event: KeyboardEvent) {
      if (menu?.open && event.key === "Escape") {
        close();
        toggle.current?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (menu?.open && !menu.contains(event.target as Node)) close();
    }
    const desktop = window.matchMedia("(min-width: 1024px)");
    desktop.addEventListener("change", close);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      desktop.removeEventListener("change", close);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return (
    <details
      ref={container}
      className="header-menu"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          event.currentTarget.open = false;
      }}
    >
      <summary
        role="button"
        ref={toggle}
        className="header-menu-toggle"
        aria-controls="mobile-navigation"
      >
        <span className="menu-closed">
          <Menu size={18} aria-hidden="true" />
          <span className="sr-only">Open navigation</span>
        </span>
        <span className="menu-open">
          <X size={18} aria-hidden="true" />
          <span className="sr-only">Close navigation</span>
        </span>
      </summary>
      <nav
        id="mobile-navigation"
        aria-label="Mobile navigation"
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("a") &&
            container.current
          )
            container.current.open = false;
        }}
      >
        {navigation.map(({ label, href }) => (
          <Link key={label} href={href}>
            {label}
          </Link>
        ))}
        <Link href="/sign-up" className="header-signup">
          Start your notebook <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </nav>
    </details>
  );
}
