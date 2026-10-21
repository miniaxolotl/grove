import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { MarketingMotion } from "@/components/marketing-motion";

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
    </MarketingMotion>
  );
}
