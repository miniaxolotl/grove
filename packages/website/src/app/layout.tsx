import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import localFont from "next/font/local";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { site } from "@/lib/site";
import "./globals.css";

const dmSans = localFont({
  src: "../../node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2",
  variable: "--font-dm-sans",
  weight: "100 1000",
  display: "swap",
  adjustFontFallback: "Arial",
});

const instrumentSerif = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-instrument-serif",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: site.title,
  description: site.description,
  applicationName: site.name,
  authors: [{ name: site.creator }],
  creator: site.creator,
  publisher: site.creator,
  category: "technology",
  keywords: [
    "AI memory",
    "MCP server",
    "self-hosted",
    "semantic search",
    "knowledge graph",
    "Qdrant",
    "agent memory",
    "Grove",
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: { "max-image-preview": "large", "max-snippet": -1 },
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f6f0",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        id="top"
        className={`${dmSans.variable} ${instrumentSerif.variable}`}
      >
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SiteHeader />
        {children}
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  );
}
