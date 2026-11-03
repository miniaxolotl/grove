import Link from "next/link";
import { documentation } from "@/content/documentation";
import { DocumentationPage } from "@/components/documentation-page";
import { pageMetadata } from "@/lib/metadata";

const description =
  "Set up Grove, connect AI tools, understand scoped memory and use Ask Grove with maintained product and API references.";
export const metadata = pageMetadata(
  "Grove documentation",
  description,
  "/docs",
);

export default function DocsPage() {
  return (
    <DocumentationPage title="Grove documentation" description={description}>
      <h2>Start with your notebook</h2>
      <p>
        Use Grove in your browser without an agent integration. Keep notes in
        notebooks, search by meaning and ask questions with sources. Connecting
        an AI tool is optional; you review what each connection can access.
      </p>
      <p>
        <Link href="/install">Connect your AI tools</Link> for guided setup, or{" "}
        <Link href="/self-host">run your own installation</Link>.
      </p>
      <h2>Reference guides</h2>
      <dl>
        {documentation.map((item) => (
          <div key={item.slug} className="mb-6">
            <dt>
              <Link href={`/docs/${item.slug}`}>{item.title}</Link>
            </dt>
            <dd>{item.description}</dd>
          </div>
        ))}
      </dl>
      <h2>Matched to the website release</h2>
      <p>
        These pages are built from the same committed documentation as this
        website. Self-hosted installations and separately installed clients may
        run different versions; check their release notes before relying on a
        newer feature. Hosted-chat setup describes custom connections, not
        public-directory approval.
      </p>
      <p>
        Private notebooks, accounts and shared-note links are not part of this
        public reference.
      </p>
    </DocumentationPage>
  );
}
