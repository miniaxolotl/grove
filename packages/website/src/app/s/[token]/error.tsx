"use client";
import { usePathname } from "next/navigation";

export default function SharedError() {
  const path = usePathname();
  return (
    <section className="shared-message">
      <h1>Could not open this link</h1>
      <p>Grove is temporarily unavailable. Please try again.</p>
      <a className="shared-next" href={path}>
        Try again
      </a>
    </section>
  );
}
