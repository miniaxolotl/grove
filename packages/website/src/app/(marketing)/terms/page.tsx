import { LegalPage } from "@/components/legal-page";
import { terms } from "@/content/legal";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Terms & conditions — Grove",
  terms.summary,
  "/terms",
);
export default function TermsPage() {
  return <LegalPage document={terms} />;
}
