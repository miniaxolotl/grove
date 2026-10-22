import type { Metadata } from "next";
import { Brand } from "@/components/brand";
import { SharedHistoryRefresh } from "@/components/sharing/history-refresh";
import "../sharing.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Shared with you · Grove",
  description: "Read a note or notebook shared with you on Grove.",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    googleBot: { index: false, follow: false },
  },
  openGraph: {
    title: "Shared with you · Grove",
    description: "Read a note or notebook shared with you on Grove.",
  },
  twitter: {
    card: "summary",
    title: "Shared with you · Grove",
    description: "Read a note or notebook shared with you on Grove.",
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
        <span>Shared with you</span>
      </header>
      <main id="main">{children}</main>
      <footer className="shared-footer">
        A little room for your ideas. Made with Grove.
      </footer>
      <SharedHistoryRefresh />
    </div>
  );
}
