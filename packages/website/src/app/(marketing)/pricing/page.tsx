import Link from "next/link";
import { connection } from "next/server";
import {
  billingLimits,
  resourceLimits,
  trialDurationDays,
  writingDailyLimits,
} from "@lib/shared/billing";
import { billingMonthlyUsd, billingYearlyUsd, showBilling } from "@/lib/flags";
import { pageMetadata } from "@/lib/metadata";
import styles from "./pricing.module.css";

export const metadata = pageMetadata(
  "Grove pricing | Free and Pro",
  "Compare Grove Cloud prices, note storage, Ask Grove and audio allowances. Explore guest writing checks and self-hosting.",
  "/pricing",
);

const number = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  trailingZeroDisplay: "stripIfInteger",
});

function validPrice(value: unknown) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 10000 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 0.000001
    ? value
    : null;
}

function PlanPrices({
  enabled,
  monthly,
  yearly,
}: {
  enabled: boolean;
  monthly: number | null;
  yearly: number | null;
}) {
  const savingsCents =
    monthly !== null && yearly !== null
      ? 12 * Math.round(monthly * 100) - Math.round(yearly * 100)
      : 0;
  return (
    <section
      className={styles.offers}
      aria-label="Grove Cloud plans in US dollars"
    >
      <article aria-labelledby="free-heading">
        <h2 id="free-heading">Free</h2>
        <p className={styles.rate}>
          <strong>$0</strong> / month
        </p>
        <p>
          Save up to {number.format(resourceLimits.free.notes)} notes. Search
          your library, ask questions and connect your tools.
        </p>
        <Link className="button-primary" href="/sign-up">
          Create a free account
        </Link>
      </article>
      <article aria-labelledby="pro-heading">
        <h2 id="pro-heading">Pro</h2>
        <div className={styles.rates}>
          {monthly !== null && (
            <p className={styles.rate}>
              <strong>{money.format(monthly)}</strong> / month
            </p>
          )}
          {yearly !== null && (
            <p className={styles.rate}>
              <strong>{money.format(yearly)}</strong> / year
            </p>
          )}
        </div>
        {yearly !== null && (
          <p>
            The yearly plan costs {money.format(yearly)} in one annual payment,
            averaging {money.format(yearly / 12)} per month.
            {savingsCents > 0 &&
              ` Save ${money.format(savingsCents / 100)} compared with 12 monthly payments.`}
          </p>
        )}
        {monthly === null && yearly === null && (
          <p>Current Pro prices are unavailable.</p>
        )}
        <p>
          Store up to {number.format(resourceLimits.pro.notes)} notes, with more
          Ask replies, AI rewrites and audio time.
        </p>
        {enabled ? (
          <>
            <p>
              Confirm your price and billing period in your account. Eligible
              accounts get one {trialDurationDays}-day trial. A payment method
              is required; the trial becomes paid unless you cancel.
            </p>
            <Link className="text-link" href="/app/settings/billing">
              View billing options
            </Link>
          </>
        ) : (
          <p className={styles.availability}>
            Pro purchases and trials are unavailable here. You can still use
            Free.
          </p>
        )}
      </article>
    </section>
  );
}

const rows = [
  ["Stored notes", "notes", false],
  ["Notebooks", "notebooks", false],
  ["Recall and semantic search", "recall", true],
  ["Ask Grove replies", "ask", true],
  ["Note organization", "organization", true],
  ["Summaries and assistance", "assistance", true],
  ["AI rewrites", "writing", true],
] as const;

function Allowances() {
  return (
    <section className={styles.section} aria-labelledby="limits-heading">
      <div>
        <h2 id="limits-heading">Plan allowances</h2>
        <p>
          Monthly and yearly Pro have the same limits. Monthly usage resets on
          the first day of each UTC calendar month. Unused allowances don’t roll
          over.
        </p>
        <p>Your account shows any custom limits and how much you’ve used.</p>
      </div>
      <table
        className={styles.table}
        aria-label="Standard Grove Cloud allowances"
      >
        <thead>
          <tr>
            <th scope="col">Allowance</th>
            <th scope="col">Free</th>
            <th scope="col">Pro</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, key, monthly]) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              {(["free", "pro"] as const).map((tier) => (
                <td key={tier}>
                  {number.format(resourceLimits[tier][key])}
                  {monthly && " / month"}
                </td>
              ))}
            </tr>
          ))}
          {(
            [
              ["Transcription", "transcription"],
              ["Read aloud", "synthesis"],
            ] as const
          ).map(([label, key]) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              {(["free", "pro"] as const).map((tier) => (
                <td key={tier}>
                  {billingLimits[tier][key].monthly / 3600000} hours / month
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default async function PricingPage() {
  await connection();
  const [enabled, monthly, yearly] = await Promise.all([
    showBilling(),
    billingMonthlyUsd(),
    billingYearlyUsd(),
  ]);
  return (
    <main id="main" className={styles.page}>
      <div className={styles.field}>
        <div className={styles.inner}>
          <header>
            <h1>Free and Pro</h1>
            <p>
              Both Grove Cloud plans include the same notebook. Pro adds storage
              and higher monthly limits. Prices for new subscriptions are in
              USD.
            </p>
          </header>
          <PlanPrices
            enabled={enabled}
            monthly={validPrice(monthly)}
            yearly={validPrice(yearly)}
          />
        </div>
      </div>
      <div className={styles.inner}>
        <Allowances />
        <section className={styles.section} aria-labelledby="terms-heading">
          <div>
            <h2 id="terms-heading">Usage and billing</h2>
            <p>
              No automatic overage charges. If you run out of an AI allowance,
              you can still write, read, edit, search by keyword and export.
            </p>
          </div>
          <div className={styles.details}>
            <details>
              <summary>What counts as an action?</summary>
              <p>
                A new Ask reply, assistance result or AI rewrite uses one
                action. A distinct fully cached Ask or assistance request uses
                0.2 actions. Reopening the same result uses none. Provider
                safety limits also apply.
              </p>
            </details>
            <details>
              <summary>What do writing limits cover?</summary>
              <p>
                Spelling and basic grammar checks run locally without limits.
                Each AI rewrite uses one action. Daily caps are{" "}
                {writingDailyLimits.free} on Free and {writingDailyLimits.pro}{" "}
                on Pro.
              </p>
            </details>
            <details>
              <summary>How long can a recording be?</summary>
              <p>
                Record up to 60 seconds at a time. Read aloud accepts up to
                3,000 text units per request. Each has its own monthly
                allowance.
              </p>
            </details>
            <details>
              <summary>What happens if I cancel Pro?</summary>
              <p>
                Subscriptions renew until cancelled. If you cancel at the end of
                a paid period, you keep Pro until that period ends. Returning to
                Free preserves your notes and exports.
              </p>
            </details>
          </div>
        </section>
        <section className={styles.section} aria-labelledby="guest-heading">
          <div>
            <h2 id="guest-heading">Without an account</h2>
            <p>
              Check English spelling and basic grammar in your browser. Text
              stays in this tab and isn’t saved. Saving notes and using AI
              rewrites require an account.
            </p>
            <Link className="text-link" href="/writing">
              Try guest writing checks
            </Link>
          </div>
          <div>
            <h2>On your own server</h2>
            <p>
              Run the open-source notebook on your infrastructure with your own
              providers. You cover hosting and provider costs.
            </p>
            <Link className="text-link" href="/self-host">
              Read the self-hosting guide
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
