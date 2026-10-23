"use client";
import { usePathname } from "next/navigation";

export default function SharedError() {
  const path = usePathname();
  return (
    <section className="shared-message">
      <h1>Could not open this link</h1>
      <p>Grove is temporarily unavailable. Try again in a moment.</p>
      <a className="shared-retry" href={path}>
        Try again
      </a>
    </section>
  );
}
