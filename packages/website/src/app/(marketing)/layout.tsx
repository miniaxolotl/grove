import { Analytics } from "@vercel/analytics/next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { MarketingMotion } from "@/components/marketing-motion";
import { WebsiteSpeedInsights } from "@/components/website-speed-insights";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MarketingMotion>
      <SiteHeader />
      {children}
      <SiteFooter />
      <Analytics />
      {process.env.VERCEL_ENV === "production" && <WebsiteSpeedInsights />}
    </MarketingMotion>
  );
}
