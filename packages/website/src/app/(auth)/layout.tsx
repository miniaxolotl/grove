import Link from "next/link";
import { Brand } from "@/components/brand";
export const metadata = { robots: { index: false, follow: false } };
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main id="main" className="grid min-h-screen place-items-center px-5 py-12">
      <div className="grid justify-items-center gap-8">
        <Brand />
        {children}
        <Link href="/" className="text-sm text-muted underline">
          Back to Grove
        </Link>
      </div>
    </main>
  );
}
