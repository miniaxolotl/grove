import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { dockerSetup } from "@/content/install";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata(
  "Self-host Grove Open Source",
  "Run Grove on your infrastructure with PostgreSQL, your own authentication, and the same agent integrations.",
  "/self-host",
);

export default function SelfHostPage() {
  return (
    <main id="main" className="page-container py-16">
      <div className="max-w-3xl">
        <p className="eyebrow">GROVE OPEN SOURCE</p>
        <h1 className="section-heading mt-5">
          Run Grove
          <br />
          <em>on your own server.</em>
        </h1>
        <p className="mt-6 text-sm leading-7 text-muted">
          Run the Grove API, worker and private PostgreSQL database with Docker
          Compose. Configure a dedicated Clerk application and a website for
          sign-in and connection approval.
        </p>
        <p className="mt-4 text-sm leading-7 text-muted">
          You will need Git, Docker Compose, a hostname with HTTPS, and your
          Clerk credentials. The first startup downloads the local embedding
          model.
        </p>
        <div className="mt-8">
          <CodeBlock title="Self-hosted Docker setup" code={dockerSetup} />
        </div>
        <p className="mt-4 text-sm leading-7 text-muted">
          Follow the deployment guide to configure authentication, your website,
          database credentials, migrations, and TLS before connecting clients.
        </p>
        <a className="button-primary mt-5" href={site.deployDocs}>
          Open the deployment guide
        </a>
        <div className="mt-10">
          <CodeBlock
            title="Connect to your server"
            code="npx @miniaxolotl/grove connect opencode --url https://grove-api.example.com"
          />
        </div>
        <p className="mt-4 text-sm leading-7 text-muted">
          Replace the example URL with your API origin and choose opencode,
          claude, or codex. Setup opens your configured website for approval.
        </p>
        <Link
          className="mt-8 inline-block text-sm text-leaf underline underline-offset-4"
          href="/install"
        >
          Prefer managed hosting? Connect to Grove Cloud
        </Link>
      </div>
    </main>
  );
}
