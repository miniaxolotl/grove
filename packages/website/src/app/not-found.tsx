import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { GroveMark } from "@/components/brand";

export default function NotFound() {
  return (
    <main
      id="main"
      className="page-container flex min-h-[60vh] flex-col items-center justify-center py-20 text-center"
    >
      <GroveMark className="mb-6 size-14 text-leaf" />
      <p className="eyebrow">404 / A PATH LESS TRAVELED</p>
      <h1 className="section-heading mt-4">
        Nothing planted here.
        <br />
        <em>Let’s head back.</em>
      </h1>
      <p className="mt-6 max-w-sm text-sm leading-7 text-muted">
        This page doesn’t exist. There’s still plenty to discover back at Grove.
      </p>
      <Link href="/" className="button-primary mt-8">
        <ArrowLeft size={16} /> Back to Grove
      </Link>
    </main>
  );
}
