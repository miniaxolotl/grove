import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { MobileNavigation } from "@/components/mobile-navigation";
import { navigation } from "@/content/site";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="page-container header-inner">
        <Brand compact />
        <nav className="header-navigation" aria-label="Main navigation">
          {navigation.map(({ label, href }) => (
            <Link key={label} href={href} className="nav-link">
              {label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <Link href="/app" className="button-primary navigation-account">
            Your Grove <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
          <MobileNavigation />
        </div>
      </div>
    </header>
  );
}
