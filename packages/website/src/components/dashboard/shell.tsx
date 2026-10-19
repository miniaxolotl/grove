"use client";
import { RedirectToSignIn, UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Folder,
  Archive,
  Plug,
  Settings,
  ArrowUpRight,
} from "lucide-react";
import { Brand } from "@/components/brand";

const links = [
  { href: "/app", name: "Memories", icon: BookOpen },
  { href: "/app/projects", name: "Projects", icon: Folder },
  { href: "/app/archive", name: "Archive", icon: Archive },
  { href: "/app/connections", name: "Connections", icon: Plug },
  { href: "/app/settings", name: "Settings", icon: Settings },
];
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { user, isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return null;
  if (!isSignedIn) return <RedirectToSignIn />;
  return (
    <div className="grove-app">
      <aside className="app-sidebar">
        <Brand />
        <p className="mt-9 px-3 text-[10px] font-semibold tracking-[0.15em] text-muted">
          YOUR PRIVATE GROVE
        </p>
        <nav
          aria-label="Memory navigation"
          className="mt-3 flex gap-1 overflow-x-auto lg:flex-col"
        >
          {links.map(({ href, name, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={
                (
                  href === "/app"
                    ? path === href || path.startsWith("/app/memories/")
                    : path.startsWith(href)
                )
                  ? "page"
                  : undefined
              }
              className="app-nav"
            >
              <Icon size={17} strokeWidth={1.6} />
              {name}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden pt-12 lg:block">
          <div className="rounded-xl bg-sage/70 p-4">
            <p className="font-editorial text-xl">
              A little context goes a long way.
            </p>
            <Link
              href="/app/connections"
              className="mt-3 inline-flex items-center gap-2 text-xs font-medium"
            >
              Connect your agents <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="mt-6 flex items-center gap-3 px-2">
            <UserButton />
            <span className="truncate text-xs">
              {user?.firstName ?? "Your account"}
            </span>
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="app-topbar">
          <span className="text-xs text-muted">Personal workspace</span>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-muted">PRIVATE BY ACCOUNT</span>
            <div className="lg:hidden">
              <UserButton />
            </div>
          </div>
        </header>
        <main id="main" className="app-content" key={user?.id}>
          {children}
        </main>
      </div>
    </div>
  );
}
