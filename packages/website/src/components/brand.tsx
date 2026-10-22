import Link from "next/link";
import Image from "next/image";
import { groveSprout } from "@/lib/brand-mark";

export function GroveMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg
      viewBox="0 5 100 100"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path d={groveSprout} fill="currentColor" />
    </svg>
  );
}

export function Brand({
  light = false,
  href = "/",
  compact = false,
}: {
  light?: boolean;
  href?: string;
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={href === "/app" ? "Grove notes" : "Grove home"}
      className={`inline-flex shrink-0 items-center transition-opacity hover:opacity-70${compact ? " site-brand" : ""}`}
    >
      <Image
        src={
          compact
            ? `/brand/wordmark-${light ? "inverse" : "primary"}.svg`
            : `/brand-kit/identity/${light ? "inverse" : "primary"}/logos/horizontal.svg`
        }
        alt=""
        width={compact ? 1224 : 176}
        height={compact ? 228 : 44}
        className="h-9 w-auto sm:h-11"
        unoptimized
      />
    </Link>
  );
}
