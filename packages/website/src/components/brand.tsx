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
        src={light ? "/brand/grove-logo-ivory.svg" : "/brand/grove-logo.svg"}
        alt=""
        width={154}
        height={28}
        className="h-6 w-auto sm:h-7"
        unoptimized
      />
    </Link>
  );
}
