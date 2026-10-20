import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/shell";
import { AuthSetup } from "@/components/auth-setup";
import "./dashboard.css";
import "./exploration.css";
import "./editor.css";
import "./controls.css";
import "./notebooks.css";
import "./workspace.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your notebook | Grove",
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
  return <DashboardShell key={session.userId}>{children}</DashboardShell>;
}
