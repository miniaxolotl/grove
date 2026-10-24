import type { Metadata } from "next";
import Link from "next/link";
import { HelpPage } from "@/components/help-page";

const description =
  "Contact Grove for product questions, feedback, privacy requests, or account assistance.";
export const metadata: Metadata = {
  title: "Contact | Grove",
  description,
  alternates: { canonical: "/contact" },
  openGraph: { title: "Contact | Grove", description, url: "/contact" },
  twitter: { title: "Contact | Grove", description },
};
export default function ContactPage() {
  return (
    <HelpPage
      page="contact"
      title="Contact Grove."
      description="Questions about your notebook, an idea for Grove, or something that needs attention? Email us."
    >
      <section>
        <h2>Questions and feedback</h2>
        <p>
          Tell us what you want to do, what could be clearer, or what you would
          like us to improve. One email address handles both general inquiries
          and support.
        </p>
        <p>
          If something is not working, our{" "}
          <Link href="/support">support page</Link> has troubleshooting guidance
          and links to setup documentation.
        </p>
      </section>
      <section>
        <h2>Privacy and account requests</h2>
        <p>
          Use the same address for questions about your information or account.
          Describe the request without sending notebook contents. We may need to
          verify ownership before discussing private account details.
        </p>
        <p>
          Read our <Link href="/privacy">privacy policy</Link> for information
          about hosted, self-hosted, and support data.
        </p>
      </section>
      <section>
        <h2>Report a security concern privately</h2>
        <p>
          Email a concise description of the concern without access tokens,
          connection credentials, private notes, or recordings. Do not put
          sensitive information in a public issue. We can discuss appropriate
          next steps by email.
        </p>
      </section>
    </HelpPage>
  );
}
