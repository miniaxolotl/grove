import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { publicSans } from "@/lib/public-font";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`marketing-site ${publicSans.variable}`}>
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}
