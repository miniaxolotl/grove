import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { GitHubIcon as Github } from "@/components/github-icon";
import { MobileNavigation } from "@/components/mobile-navigation";
import { navigation } from "@/content/site";
import { site } from "@/lib/site";

export function SiteHeader() {
  return (
    <>
      <div className="lab-bar">
        <div className="page-container">
          <span>
            Bramble Labs Inc.{" "}
            <span className="hidden text-paper/65 sm:inline">
              / Developer tools
            </span>
          </span>
          <a
            href="https://useburrow.app"
            className="inline-flex items-center gap-1.5 text-lime hover:underline"
          >
            Meet Burrow <ArrowUpRight size={12} />
          </a>
        </div>
      </div>
      <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur-lg">
        <div className="page-container flex h-[76px] items-center justify-between gap-5">
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
            <a
              href={site.github}
              className="hidden size-11 place-items-center rounded-full text-forest transition-colors hover:bg-sage sm:grid"
              aria-label="Grove on GitHub"
            >
              <Github size={20} />
            </a>
            <Link
              href="/#install"
              className="button-primary hidden min-h-10! gap-3! px-4! py-2! text-xs! min-[360px]:inline-flex"
            >
              Install Grove <ArrowRight size={15} />
            </Link>
            <MobileNavigation github={site.github} />
          </div>
        </div>
      </header>
    </>
  );
}
