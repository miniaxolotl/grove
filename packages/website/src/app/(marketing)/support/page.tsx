import type { Metadata } from "next";
import Link from "next/link";
import { HelpPage } from "@/components/help-page";
import { site } from "@/lib/site";

const description =
  "Get help with your Grove notebook, account access, connected AI tools, or self-hosting.";
export const metadata: Metadata = {
  title: "Support | Grove",
  description,
  alternates: { canonical: "/support" },
  openGraph: { title: "Support | Grove", description, url: "/support" },
  twitter: { title: "Support | Grove", description },
};
export default function SupportPage() {
  return (
    <HelpPage
      page="support"
      title="Support for Grove."
      description={description}
    >
      <section>
        <h2>Account and notebook access</h2>
        <p>
          Use the sign-in method linked to your Grove account. If a page cannot
          load, check your connection and try its retry action. If the issue
          continues, tell us which screen was affected and what you expected to
          happen.
        </p>
        <p>
          Do not email passwords, authentication codes, private notes, or
          recordings.
        </p>
      </section>
      <section>
        <h2>Connect your AI tools</h2>
        <p>
          The <Link href="/install">connection guide</Link> explains how to
          connect supported tools. Review the account and permissions in the
          approval screen before granting access.
        </p>
        <p>
          If a connection fails, include the tool name, client version, and a
          redacted error. Never send API keys, OAuth tokens, or full connection
          links.
        </p>
      </section>
      <section>
        <h2>Running Grove yourself</h2>
        <p>
          Start with the <Link href="/self-host">self-hosting guide</Link> and{" "}
          <a href={site.deployDocs}>deployment documentation</a>. A self-hosted
          instance is operated by its owner; its configuration and availability
          are separate from Grove Cloud.
        </p>
      </section>
      <section>
        <h2>What to include in an email</h2>
        <ul>
          <li>Whether you use Grove Cloud or a self-hosted instance.</li>
          <li>Your browser or client version and operating system.</li>
          <li>A brief description, redacted error, and approximate time.</li>
        </ul>
        <p>
          For general feedback, privacy, or account requests,{" "}
          <Link href="/contact">contact Grove</Link>.
        </p>
      </section>
    </HelpPage>
  );
}
