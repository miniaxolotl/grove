import Link from "next/link";
import { groveLeaves, groveStem } from "@/lib/brand-mark";

export function GroveMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d={groveStem}
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d={groveLeaves} fill="currentColor" />
    </svg>
  );
}

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="Grove home"
      className={`inline-flex items-center gap-1.5 transition-opacity hover:opacity-70 ${light ? "text-paper" : "text-forest"}`}
    >
      <GroveMark />
      <span className="text-[32px] font-semibold leading-none tracking-[-1.8px]">
        grove<span className="text-leaf">.</span>
      </span>
    </Link>
  );
}
