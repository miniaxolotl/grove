import type { Metadata } from "next";
import { Brand } from "@/components/brand";
import { SharedHistoryRefresh } from "@/components/sharing/history-refresh";
import "../sharing.css";

export const dynamic = "force-dynamic";
const title = "Shared with you · Grove";
const description = "Read a note or notebook shared with you on Grove.";

export const metadata: Metadata = {
  title,
  description,
  referrer: "no-referrer",
  authors: null,
  creator: null,
  publisher: null,
  keywords: null,
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    googleBot: { index: false, follow: false },
  },
  openGraph: {
    title,
    description,
    type: "website",
    siteName: "Grove",
    // Do not inherit the marketing image or publish capability URLs/content.
    images: [],
  },
  twitter: {
    card: "summary",
    title,
    description,
    images: [],
  },
};
export default function SharedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="shared-page" data-private>
      <header className="shared-site-header">
        <Brand />
        <span>Read only</span>
      </header>
      <main id="main">{children}</main>
      <SharedHistoryRefresh />
    </div>
  );
}
