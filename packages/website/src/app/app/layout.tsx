import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import localFont from "next/font/local";
import { DashboardShell } from "@/components/dashboard/shell";
import { AuthSetup } from "@/components/auth-setup";
import "./dashboard.css";

const inter = localFont({
  src: "../../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
  adjustFontFallback: "Arial",
});

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your memory — Grove",
  robots: { index: false, follow: false },
};
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY
  )
    return (
      <main id="main" className="p-12">
        <AuthSetup />
      </main>
    );
  const session = await auth();
  if (!session.userId) redirect("/sign-in");
  return (
    <div className={inter.variable}>
      <DashboardShell key={session.userId}>{children}</DashboardShell>
    </div>
  );
}
