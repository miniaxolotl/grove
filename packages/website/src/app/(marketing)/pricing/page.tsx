import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import { resourceLimits, billingLimits } from "@lib/shared/billing";
import {
  billingMonthlyUsd,
  billingYearlyUsd,
  showBilling,
} from "@/lib/flags";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Grove pricing | Free and Pro",
  "Start with Grove Free. Compare note storage, search, Ask Grove and audio allowances with Pro. No automatic overage charges.",
  "/pricing",
);

const number = new Intl.NumberFormat("en-US");
function validPrice(value: unknown) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 10000 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 0.000001
    ? value
    : null;
}
const usd = (digits: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const comparisons = [
  ["Stored notes", "notes", false],
  ["Notebooks", "notebooks", false],
  ["Recall and semantic search", "recall", true],
  ["Ask Grove replies", "ask", true],
  ["Note organization", "organization", true],
  ["Summaries and assistance", "assistance", true],
  ["AI rewrites", "writing", true],
] as const;

export default async function PricingPage() {
  await connection();
  const enabled = await showBilling();
  const monthly = validPrice(await billingMonthlyUsd());
  const yearly = validPrice(await billingYearlyUsd());
  const formattedMonthly =
    monthly === null ? null : usd(2).format(monthly);
  const formattedYearly = yearly === null ? null : usd(0).format(yearly);
  const yearlyPerMonth =
    yearly === null ? null : usd(2).format(yearly / 12);
  const yearlySavings =
    monthly === null || yearly === null || monthly * 12 - yearly <= 0.005
      ? null
      : usd(0).format(Math.round(monthly * 12 - yearly));
  return (
    <main id="main" className="product-redesign pricing-page">
      <section
        className="page-container pricing-intro"
        aria-labelledby="pricing-heading"
      >
        <h1 id="pricing-heading" className="hero-title">
          Free and Pro
        </h1>
        <p className="hero-summary">
          Compare storage and monthly allowances. Both plans use the same
          notebook.
        </p>
      </section>
      <section
        className="page-container plan-pair"
        aria-label="Grove Cloud plans"
      >
        <article className="plan" aria-labelledby="free-heading" data-reveal>
          <h2 id="free-heading">Free</h2>
          <p className="plan-price">
            $0 <span>USD / month</span>
          </p>
          <p>Writing, search and source-linked answers.</p>
          <ul>
            <li>
              {number.format(resourceLimits.free.notes)} notes and{" "}
              {number.format(resourceLimits.free.notebooks)} notebooks
            </li>
            <li>
              {number.format(resourceLimits.free.ask)} Ask Grove replies each
              month
            </li>
            <li>Semantic search and agent connections</li>
            <li>Revision history and exports</li>
          </ul>
          <Link href="/sign-up" className="button-primary">
            Start your notebook <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </article>
        <article
          className="plan plan-pro"
          aria-labelledby="pro-heading"
          data-reveal
        >
          <h2 id="pro-heading">Pro</h2>
          <p className="plan-price">
            {formattedMonthly ?? "More capacity"}
            {formattedMonthly ? <span> USD / month</span> : null}
          </p>
          {formattedYearly ? (
            <p className="plan-billing-alt">
              or {formattedYearly} <span>USD / year</span>
              {yearlyPerMonth ? (
                <>
                  {" "}
                  ({yearlyPerMonth} / month
                  {yearlySavings ? `, save ${yearlySavings}` : ""})
                </>
              ) : null}
            </p>
          ) : null}
          <p>
            {formattedMonthly
              ? "Introductory prices. Confirm the current amount in your account before checkout."
              : "Check your account for current upgrade availability and pricing."}
          </p>
          <ul>
            <li>
              {number.format(resourceLimits.pro.notes)} notes and{" "}
              {number.format(resourceLimits.pro.notebooks)} notebooks
            </li>
            <li>
              {number.format(resourceLimits.pro.ask)} Ask Grove replies each
              month
            </li>
            <li>Higher search and organization allowances</li>
            <li>More transcription and read-aloud time</li>
          </ul>
          <Link
            href={enabled ? "/app/settings/billing" : "/sign-up"}
            className="button-primary"
          >
            {enabled ? "View your upgrade" : "Create an account"}{" "}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          {!enabled ? (
            <p className="plan-note">
              Pro purchases aren’t currently available here. You can still start
              free.
            </p>
          ) : null}
        </article>
      </section>
      <section
        className="page-container story-section"
        aria-labelledby="included-heading"
      >
        <div className="section-lead">
          <h2 id="included-heading" className="section-title">
            The notebook is included
          </h2>
          <p>
            Both plans include the editor, journal, graph, source-linked answers
            and optional agent integrations. Pro raises your allowances.
          </p>
        </div>
        <div
          className="comparison-scroll"
          tabIndex={0}
          role="region"
          aria-label="Free and Pro allowance comparison"
        >
          <table className="plan-comparison">
            <caption>Standard Grove Cloud allowances</caption>
            <thead>
              <tr>
                <th scope="col">What you can use</th>
                <th scope="col">Free</th>
                <th scope="col">Pro</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map(([label, key, monthly]) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td>
                    {number.format(resourceLimits.free[key])}
                    {monthly ? " / month" : ""}
                  </td>
                  <td>
                    {number.format(resourceLimits.pro[key])}
                    {monthly ? " / month" : ""}
                  </td>
                </tr>
              ))}
              <tr>
                <th scope="row">Transcription</th>
                <td>
                  {billingLimits.free.transcription.monthly / 3600000} hours /
                  month
                </td>
                <td>
                  {billingLimits.pro.transcription.monthly / 3600000} hours /
                  month
                </td>
              </tr>
              <tr>
                <th scope="row">Read aloud</th>
                <td>
                  {billingLimits.free.synthesis.monthly / 3600000} hours / month
                </td>
                <td>
                  {billingLimits.pro.synthesis.monthly / 3600000} hours / month
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="comparison-note">
          Standard limits are shown here. Your account shows its effective
          limits and usage, including any custom access. Spelling and grammar
          checks run on your device and are unlimited on both plans.
        </p>
      </section>
      <section className="feature-index">
        <div className="page-container feature-index-layout">
          <h2 className="section-title">
            Clear limits.
            <br />
            No overages.
          </h2>
          <dl className="feature-list">
            <div className="feature-row">
              <dt>What happens at a limit?</dt>
              <dd>
                Writing, reading, editing, keyword search and export remain
                available when an AI allowance runs out. Wait for the reset or
                upgrade where available. There are no automatic overage charges.
              </dd>
            </div>
            <div className="feature-row">
              <dt>When does usage reset?</dt>
              <dd>
                Monthly action and audio allowances reset on the first day of
                each UTC calendar month, not your billing anniversary. Unused
                allowances don’t roll over.
              </dd>
            </div>
            <div className="feature-row">
              <dt>Do you offer yearly billing?</dt>
              <dd>
                Yes. Pro is available month-to-month or once a year; both
                include the same monthly allowances. Yearly renews each year
                until you cancel.
              </dd>
            </div>
            <div className="feature-row">
              <dt>What counts as an action?</dt>
              <dd>
                A fresh Ask reply, assistance result or AI rewrite uses one
                action. A distinct fully cached Ask or assistance request uses
                0.2 actions. Reopening the same completed result doesn’t use
                another action. Separate provider safety budgets also apply.
              </dd>
            </div>
            <div className="feature-row">
              <dt>What do writing limits cover?</dt>
              <dd>
                Spelling and grammar checks run on your device and never use
                an allowance. Each explicit AI rewrite request — Shorten,
                Expand, Rewrite, Humanize, Synonyms or Opposite words — uses
                one rewrite from your monthly allowance (100 on Free, 1,000
                on Pro, up to 30 a day on Free and 200 a day on Pro). Waiting
                for the reset or upgrading restores rewrites; local checks
                keep working either way.
              </dd>
            </div>
            <div className="feature-row">
              <dt>How does audio work?</dt>
              <dd>
                The time shown is a monthly total, not a single recording limit.
                Recordings are up to 60 seconds each; read aloud accepts up to
                3,000 text units per request.
              </dd>
            </div>
            <div className="feature-row">
              <dt>Can I cancel or take my notes?</dt>
              <dd>
                Manage a subscription in Settings → Billing. Period-end
                cancellation keeps Pro until the paid period ends. A downgrade
                preserves your notes, and you can export your library.
              </dd>
            </div>
          </dl>
        </div>
      </section>
      <section
        className="page-container page-close"
        aria-labelledby="self-host-heading"
      >
        <div>
          <h2 id="self-host-heading" className="section-title">
            Prefer your own server?
          </h2>
          <p>
            Grove is open source. Run it on your infrastructure and bring your
            own providers; hosting and provider costs are yours.
          </p>
        </div>
        <Link href="/self-host" className="text-link">
          Read the self-hosting guide
        </Link>
      </section>
    </main>
  );
}
