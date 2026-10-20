import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { BrambleFamily } from "@/components/bramble-family";
import { GitHubIcon as Github } from "@/components/github-icon";
import { ShareSite } from "@/components/share-site";
import { site } from "@/lib/site";

export function SiteFooter() {
  const shareText = site.shareText;

  return (
    <footer className="border-t border-line bg-paper">
      <div className="page-container pb-7 pt-12 sm:pt-16">
        <div className="grid gap-10 pb-12 sm:grid-cols-[1fr_auto_auto] sm:gap-16">
          <div>
            <Brand />
            <p className="mt-4 max-w-60 text-xs leading-6 text-muted">
              A private notebook for your notes, plans, and everyday ideas.
              <br />
              Made with care by Bramble Labs Inc.
            </p>
            <p className="mt-5 text-[11px] text-leaf">
              Good ideas. Room to grow.
            </p>
          </div>
          <nav aria-label="Resources">
            <p className="eyebrow mb-3">EXPLORE</p>
            <Link href="/#features" className="footer-link">
              Why Grove
            </Link>
            <Link href="/app" className="footer-link">
              Your notebook
            </Link>
            <Link href="/install" className="footer-link">
              Connect AI tools
            </Link>
            <Link href="/self-host" className="footer-link">
              Self-host Grove
            </Link>
          </nav>
          <div>
            <p className="eyebrow mb-3">STAY IN TOUCH</p>
            <a href="mailto:grove@mawa.dev" className="footer-link">
              Say hello <ArrowUpRight size={12} />
            </a>
            <a href={site.github} className="footer-link">
              <Github size={14} /> GitHub <ArrowUpRight size={12} />
            </a>
            <ShareSite url={site.url} />
            <div className="mt-1 flex flex-wrap gap-x-4">
              <a
                className="footer-link text-[11px]!"
                href={`https://twitter.com/intent/tweet?${new URLSearchParams({ text: shareText, url: site.url })}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Share Grove on X (opens a new tab)"
              >
                X ↗
              </a>
              <a
                className="footer-link text-[11px]!"
                href={`https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url: site.url })}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Share Grove on LinkedIn (opens a new tab)"
              >
                LinkedIn ↗
              </a>
              <a
                className="footer-link text-[11px]!"
                href={`https://bsky.app/intent/compose?${new URLSearchParams({ text: `${shareText} ${site.url}` })}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Share Grove on Bluesky (opens a new tab)"
              >
                Bluesky ↗
              </a>
            </div>
          </div>
        </div>
        <BrambleFamily current="grove" />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-[10px] text-muted">
          <p>© {new Date().getFullYear()} Bramble Labs Inc.</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <Link
              href="/privacy"
              className="inline-flex min-h-9 items-center hover:text-forest"
            >
              Privacy policy
            </Link>
            <Link
              href="/terms"
              className="inline-flex min-h-9 items-center hover:text-forest"
            >
              Terms & conditions
            </Link>
            <a
              href="mailto:grove@mawa.dev"
              className="inline-flex min-h-9 items-center hover:text-forest"
            >
              Contact
            </a>
            <a
              href={`${site.github}/blob/HEAD/LICENSE`}
              className="inline-flex min-h-9 items-center hover:text-forest"
            >
              MIT license
            </a>
            <a
              href="#top"
              className="inline-flex min-h-9 items-center gap-1 hover:text-forest"
            >
              Back to top ↑
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
