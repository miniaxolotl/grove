import Link from "next/link";
import type { ReactNode } from "react";
import { contact } from "@/lib/contact";
import styles from "./help-page.module.css";

export function HelpPage({
  title,
  description,
  page,
  children,
}: {
  title: string;
  description: string;
  page: "support" | "contact";
  children: ReactNode;
}) {
  return (
    <main id="main" className={`page-container ${styles.page}`}>
      <Link href="/" className={styles.back}>
        Back to Grove
      </Link>
      <header className={styles.heading}>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <div className={styles.layout}>
        <aside className={styles.contact} aria-label="Email Grove">
          <h2>Write to us.</h2>
          <a className={styles.email} href={contact.href}>
            {contact.email}
          </a>
          <p>
            One address for help, feedback, and privacy or account questions.
          </p>
          <nav aria-label="Help and contact">
            <Link
              href="/support"
              aria-current={page === "support" ? "page" : undefined}
            >
              Support
            </Link>
            <Link
              href="/contact"
              aria-current={page === "contact" ? "page" : undefined}
            >
              Contact
            </Link>
            <Link href="/privacy">Privacy policy</Link>
          </nav>
        </aside>
        <div className={styles.content}>{children}</div>
      </div>
    </main>
  );
}
