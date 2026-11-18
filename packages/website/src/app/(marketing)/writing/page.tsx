import Link from "next/link";
import { GuestWritingCheck } from "@/components/guest-writing-check";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Spelling and grammar checker",
  "Check English spelling and grammar in your browser without an account.",
  "/writing",
);

export default function WritingPage() {
  return (
    <main id="main" className="page-container setup-page setup-intro">
      <h1 className="setup-heading">Check your writing</h1>
      <p>
        Check English spelling and basic grammar. Your text stays in this tab
        and isn’t saved.
      </p>
      <GuestWritingCheck />
      <p>
        Check writing on other sites with the{" "}
        <Link className="text-link" href="/install#browser-extension">
          browser extension
        </Link>
        .
      </p>
      <section
        className="guest-writing-account"
        aria-labelledby="guest-account-heading"
      >
        <h2 id="guest-account-heading">Keep your notes in Grove</h2>
        <p>
          With an account, you can save and search notes, use Ask Grove, and
          connect the browser extension.
        </p>
        <div className="home-resource-links">
          <Link className="text-link" href="/sign-up">
            Create an account
          </Link>
          <Link className="text-link" href="/sign-in">
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
