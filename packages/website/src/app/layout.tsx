import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import localFont from "next/font/local";
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
  category: "productivity",
  keywords: [
    "private notebook",
    "note taking",
    "personal journal",
    "connected notes",
    "organize ideas",
    "AI note search",
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
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
          <ClerkProvider
            signInUrl="/sign-in"
            signUpUrl="/sign-up"
            signInFallbackRedirectUrl="/app"
            signUpFallbackRedirectUrl="/app"
            appearance={{
              variables: {
                colorPrimary: "#326349",
                colorPrimaryForeground: "#fffef9",
                colorBackground: "#fffef9",
                colorForeground: "#253e31",
                colorMutedForeground: "#5d6962",
                colorInput: "#ffffff",
                colorInputForeground: "#253e31",
                colorBorder: "#dce0d3",
                colorDanger: "#833323",
                colorRing: "#32634980",
                colorModalBackdrop: "#15251bb3",
                borderRadius: "0.75rem",
                fontFamily: "var(--font-dm-sans)",
              },
              options: {
                logoImageUrl: "/icon.svg",
                logoLinkUrl: "/",
                privacyPageUrl: "/privacy",
                termsPageUrl: "/terms",
                helpPageUrl: "mailto:grove@mawa.dev",
              },
            }}
          >
            {children}
          </ClerkProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
