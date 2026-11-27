import { DashboardShell } from "@/components/dashboard/shell";
import { connection } from "next/server";
import "@/app/globals.css";
import "@/app/app/dashboard.css";
import "@/app/app/exploration.css";
import "@/app/app/editor.css";
import "@/app/app/controls.css";
import "@/app/app/notebooks.css";
import "@/app/app/workspace.css";
import "@/app/app/actions.css";
import "@/app/app/palette.css";
import "@/app/app/sidebar.css";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Production enters through Clerk's request-bound layout. Keep the isolated
  // synthetic shell request-rendered too, without importing that authentication.
  await connection();
  return (
    <html lang="en">
      <body>
        <DashboardShell>{children}</DashboardShell>
      </body>
    </html>
  );
}
