import { LegalPage } from "@/components/legal-page";
import { privacy } from "@/content/legal";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Privacy policy — Grove",
  privacy.summary,
  "/privacy",
);
export default function PrivacyPage() {
  return <LegalPage document={privacy} />;
}
