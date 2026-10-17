import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { GitHubIcon as Github } from "@/components/github-icon";
import { ShareSite } from "@/components/share-site";
import { site } from "@/lib/site";

export function SiteFooter() {
  const shareText =
    "New session. Same context. Grove is self-hosted memory for your AI agents.";

  return (
    <footer className="border-t border-line bg-paper">
      <div className="page-container pb-7 pt-12 sm:pt-16">
        <div className="grid gap-10 pb-12 sm:grid-cols-[1fr_auto_auto] sm:gap-16">
          <div>
            <Brand />
            <p className="mt-4 max-w-60 text-xs leading-6 text-muted">
              Persistent memory for AI agents.
              <br />A developer tool by Bramble Labs Inc.
            </p>
            <p className="mt-5 font-mono text-[10px] text-leaf">
              OPEN SOURCE. SELF-HOSTED. YOURS.
            </p>
          </div>
          <nav aria-label="Resources">
            <p className="eyebrow mb-3">EXPLORE</p>
            <Link href="/#features" className="footer-link">
              Why Grove
            </Link>
            <Link href="/install" className="footer-link">
              Installation guide
            </Link>
            <a href={site.docs} className="footer-link">
              Tool reference <ArrowUpRight size={12} />
            </a>
            <a href={site.pluginDocs} className="footer-link">
              OpenCode plugin <ArrowUpRight size={12} />
            </a>
          </nav>
          <div>
            <p className="eyebrow mb-3">COMMUNITY</p>
            <a href={site.github} className="footer-link">
              <Github size={14} /> GitHub <ArrowUpRight size={12} />
            </a>
            <a href={site.npm} className="footer-link">
              npm package <ArrowUpRight size={12} />
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-[10px] text-muted">
          <p>© {new Date().getFullYear()} Bramble Labs Inc.</p>
          <div className="flex items-center gap-5">
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
