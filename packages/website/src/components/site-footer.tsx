import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { BrambleFamily } from "@/components/bramble-family";
import { GitHubIcon as Github } from "@/components/github-icon";
import { ShareSite } from "@/components/share-site";
import { site } from "@/lib/site";
import { TelemetryChoice } from "@/components/website-telemetry";

export function SiteFooter() {
  const shareText = site.shareText;

  return (
    <footer className="site-footer">
      <div className="page-container">
        <div className="footer-main">
          <div className="footer-brand">
            <Brand compact />
            <p className="mt-4 max-w-60 text-xs leading-6 text-muted">
              A private notebook for notes, plans and journal entries.
            </p>
          </div>
          <nav className="footer-links" aria-label="Resources">
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
          <div className="footer-links">
            <p className="eyebrow mb-3">STAY IN TOUCH</p>
            <Link href="/contact" className="footer-link">
              Say hello <ArrowUpRight size={12} />
            </Link>
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
                X <ArrowUpRight size={12} aria-hidden="true" />
              </a>
              <a
                className="footer-link text-[11px]!"
                href={`https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url: site.url })}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Share Grove on LinkedIn (opens a new tab)"
              >
                LinkedIn <ArrowUpRight size={12} aria-hidden="true" />
              </a>
              <a
                className="footer-link text-[11px]!"
                href={`https://bsky.app/intent/compose?${new URLSearchParams({ text: `${shareText} ${site.url}` })}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Share Grove on Bluesky (opens a new tab)"
              >
                Bluesky <ArrowUpRight size={12} aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
        <BrambleFamily current="grove" />
        <div className="footer-bottom">
          <p>Copyright {new Date().getFullYear()} Bramble Labs Inc.</p>
          <nav className="footer-utilities" aria-label="Legal and contact">
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
            <TelemetryChoice />
            <Link
              href="/support"
              className="inline-flex min-h-9 items-center hover:text-forest"
            >
              Support
            </Link>
            <Link
              href="/contact"
              className="inline-flex min-h-9 items-center hover:text-forest"
            >
              Contact
            </Link>
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
              Back to top
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
