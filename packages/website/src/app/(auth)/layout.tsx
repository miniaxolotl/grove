import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { AuthenticationProvider } from "@/components/authentication-provider";
import styles from "./entry.module.css";
import { publicSans } from "@/lib/public-font";

export const metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthenticationProvider>
      <div
        className={`auth-page ${publicSans.variable} ${styles.page}`}
        data-private
      >
        <div className={styles.column}>
          <header>
            <Link className={styles.back} href="/">
              <ArrowLeft size={16} aria-hidden="true" /> Back to Grove
            </Link>
          </header>
          <main id="main" className={styles.entry}>
            {children}
          </main>
          <nav aria-label="Account resources" className={styles.resources}>
            <Link href="/support">Support</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </nav>
        </div>
      </div>
    </AuthenticationProvider>
  );
}
