import localFont from "next/font/local";

// Scoped to public/auth layouts; the notebook keeps its existing interface font.
export const publicSans = localFont({
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
  variable: "--font-public-sans",
  display: "swap",
  adjustFontFallback: "Arial",
});
