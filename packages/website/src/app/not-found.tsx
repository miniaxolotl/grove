import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { GroveMark } from "@/components/brand";

export default function NotFound() {
  return (
    <main
      id="main"
      className="page-container recovery-page flex min-h-[75vh] flex-col items-center justify-center py-20 text-center"
    >
      <span className="recovery-mark">
        <GroveMark className="size-14 text-leaf" />
      </span>
      <p className="eyebrow">404</p>
      <h1 className="section-heading mt-4">
        Page <em>not found.</em>
      </h1>
      <p className="mt-6 max-w-sm text-sm leading-7 text-muted">
        This page does not exist. Return to the homepage.
      </p>
      <Link href="/" className="button-primary mt-8">
        <ArrowLeft size={16} /> Back to Grove
      </Link>
      <nav className="recovery-links" aria-label="Helpful links">
        <Link href="/install">Installation</Link>
        <a href="mailto:grove@mawa.dev">Get help</a>
      </nav>
    </main>
  );
}
