import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { AuthenticationProvider } from "@/components/authentication-provider";
import styles from "./entry.module.css";

export const metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthenticationProvider>
      <div className={`auth-page ${styles.page}`} data-private>
        <div className={styles.column}>
          <header>
            <Link className={styles.back} href="/">
              <ArrowLeft size={16} aria-hidden="true" /> Back to Grove
            </Link>
          </header>
          <main id="main" className={styles.entry}>
            {children}
          </main>
        </div>
      </div>
    </AuthenticationProvider>
  );
}
