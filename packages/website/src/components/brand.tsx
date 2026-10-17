import Link from "next/link";

export function GroveMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M20 32V18M20 25l-8-8M20 20l8-8M20 32l-5 4m5-4 5 4"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.8 19C11 19 6 13.6 6 6c8.6 0 13.8 5.5 13.8 13ZM20.2 15C20.2 7 25.2 3 33 3c0 7.5-5.1 12-12.8 12Z"
        fill="currentColor"
      />
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
