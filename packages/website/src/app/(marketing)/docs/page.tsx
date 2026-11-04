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
      <h2>Choose your starting point</h2>
      <p>
        Start with the notebook guide for browser use. For a coding agent or web
        chat, use the guided connection setup; it is separate from creating your
        Grove account.
      </p>
      <p>
        <Link href="/install">Connect your AI tools</Link> for guided setup, or{" "}
        <Link href="/self-host">run your own installation</Link>.
      </p>
      <h2>Guides and reference</h2>
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
