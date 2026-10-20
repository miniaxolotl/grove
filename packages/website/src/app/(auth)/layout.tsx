import Link from "next/link";
import { Brand } from "@/components/brand";
import { GroveMark } from "@/components/brand";
import { ArrowLeft, Check, LockKeyhole } from "lucide-react";
export const metadata = { robots: { index: false, follow: false } };
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth-page">
      <header className="page-container auth-header">
        <Brand />
        <Link href="/">
          <ArrowLeft size={14} aria-hidden="true" /> Back to Grove
        </Link>
      </header>
      <main id="main" className="page-container auth-shell">
        <aside className="auth-story" aria-label="A home for your ideas">
          <span className="auth-sprout">
            <GroveMark className="size-16" />
          </span>
          <p className="eyebrow">YOUR IDEAS HAVE A HOME HERE.</p>
          <h2>
            Good to have
            <br />
            <em>you here.</em>
          </h2>
          <p>
            Your plans. Your little discoveries. The thought you want to come
            back to. Give them a place to grow with you.
          </p>
          <ul>
            <li>
              <Check size={15} aria-hidden="true" /> Notes, notebooks, and a
              journal of your own
            </li>
            <li>
              <Check size={15} aria-hidden="true" /> Find answers and
              connections in what you save
            </li>
            <li>
              <LockKeyhole size={15} aria-hidden="true" /> Private to your
              account and approved connections
            </li>
          </ul>
        </aside>
        <section className="auth-entry" aria-label="Grove account access">
          {children}
          <p className="auth-help">
            Need a hand? <a href="mailto:grove@mawa.dev">Get in touch</a>
          </p>
          <nav className="auth-policies" aria-label="Legal">
            <Link href="/privacy">Privacy policy</Link>
            <Link href="/terms">Terms & conditions</Link>
          </nav>
        </section>
      </main>
    </div>
  );
}
