import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { MobileNavigation } from "@/components/mobile-navigation";
import { navigation } from "@/content/site";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur-lg">
      <div className="page-container flex h-16 items-center justify-between gap-5">
        <Brand />
        <nav
          className="hidden items-center gap-8 md:flex"
          aria-label="Main navigation"
        >
          {navigation.map(({ label, href }) => (
            <Link key={label} href={href} className="nav-link">
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 sm:gap-5">
          <Link
            href="/app"
            className="button-primary hidden min-h-10! gap-3! px-4! py-2! text-xs! min-[360px]:inline-flex"
          >
            Your Grove <ArrowRight size={15} />
          </Link>
          <MobileNavigation />
        </div>
      </div>
    </header>
  );
}
