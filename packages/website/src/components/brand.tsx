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

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="Grove home"
      className="inline-flex shrink-0 items-center transition-opacity hover:opacity-70"
    >
      <Image
        src={`/brand-kit/identity/${light ? "inverse" : "primary"}/logos/horizontal.svg`}
        alt=""
        width={176}
        height={44}
        className="h-9 w-auto sm:h-11"
        unoptimized
      />
    </Link>
  );
}
