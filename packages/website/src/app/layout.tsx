import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import localFont from "next/font/local";
import { site } from "@/lib/site";
import { WebsiteTelemetry } from "@/components/website-telemetry";
import "./globals.css";
import "./brand-family.css";

const space = localFont({
  src: [
    {
      path: "../../public/brand-kit/fonts/space-grotesk-400.woff2",
      weight: "400",
    },
    {
      path: "../../public/brand-kit/fonts/space-grotesk-500.woff2",
      weight: "500",
    },
    {
      path: "../../public/brand-kit/fonts/space-grotesk-600.woff2",
      weight: "600",
    },
    {
      path: "../../public/brand-kit/fonts/space-grotesk-700.woff2",
      weight: "700",
    },
  ],
  variable: "--font-space-grotesk",
  display: "swap",
  adjustFontFallback: "Arial",
});

const mono = localFont({
  src: [
    {
      path: "../../public/brand-kit/fonts/jetbrains-mono-400.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/brand-kit/fonts/jetbrains-mono-500.woff2",
      weight: "500",
      style: "normal",
    },
  ],
  variable: "--font-jetbrains-mono",
  display: "swap",
  adjustFontFallback: false,
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
  themeColor: "#faf9f3",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body id="top" className={`${space.variable} ${mono.variable}`}>
        <WebsiteTelemetry />
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
          <ClerkProvider
            prefetchUI={false}
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
                fontFamily: "var(--font-space-grotesk)",
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
