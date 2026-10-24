"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BillingStatus, BillingMetric } from "@lib/shared/billing";
import { DashboardApiError, errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";

const labels: Record<BillingMetric, string> = {
  generation: "AI generation requests",
  research: "Web research calls",
  transcription: "Transcription minutes",
  synthesis: "Read-aloud characters",
};
const units = (metric: BillingMetric, value: number) =>
  new Intl.NumberFormat(undefined, {
    maximumFractionDigits: metric === "transcription" ? 1 : 0,
  }).format(metric === "transcription" ? value / 60000 : value);
const date = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
const money = (amount: number, currency: string) => {
  const format = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  });
  return format.format(
    amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2),
  );
};

export function BillingPanel() {
  const cache = useWorkspaceCache();
  const query = useQuery({
    ...cache.resource<BillingStatus>("/billing"),
    staleTime: 0,
    refetchInterval: 60000,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  async function open(
    path: string,
    interval?: "month" | "year",
    expectedAmount?: number,
  ) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await cache.api<{ url: string }>(
        path,
        interval ? { interval, expectedAmount } : {},
      );
      const target = new URL(result.url);
      if (
        target.protocol !== "https:" ||
        !["checkout.stripe.com", "billing.stripe.com"].includes(target.hostname)
      )
        throw new Error("Billing could not open. Try again.");
      window.location.assign(target.href);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const state = query.data,
    usage = state?.usage;
  const subscription = state?.subscription;
  const ongoing =
    subscription &&
    !["canceled", "incomplete_expired"].includes(subscription.status);
  if (
    (query.error instanceof DashboardApiError && query.error.status === 404) ||
    state?.enabled === false
  )
    return null;
  return (
    <div className="settings-content">
      <div>
        <h2 className="settings-section-heading">Billing</h2>
        <p className="settings-section-description">
          Start free. Subscribe to Pro when you need more AI usage.
        </p>
      </div>
      {error || query.error ? (
        <div className="app-error" role="alert">
          <p>{error || errorMessage(query.error)}</p>
          <button
            className="text-button"
            onClick={() => {
              setError("");
              void query.refetch();
            }}
          >
            Refresh billing
          </button>
        </div>
      ) : null}
      {!state ? (
        <p role="status">
          {query.isPending
            ? "Loading your plan and usage…"
            : "Your billing details could not load."}
        </p>
      ) : (
        <>
          <section className="app-panel" aria-label="Current plan">
            <h3 className="font-editorial text-2xl">
              {usage?.plan === "pro" ? "Grove Pro" : "Grove Free"}
            </h3>
            <p className="mt-3 text-sm text-muted">
              {usage?.plan === "pro"
                ? "Higher allowances for your notebook and connected agents."
                : "Writing, reading, editing and exporting stay available when you reach an AI allowance."}
            </p>
            {subscription ? (
              <p className="mt-3 text-sm">
                {subscription.status === "past_due" ||
                subscription.status === "unpaid"
                  ? "Your payment needs attention. Update it to restore Pro usage."
                  : subscription.cancelAtPeriodEnd
                    ? `Your subscription ends ${date(subscription.periodEnd)}.`
                    : ongoing
                      ? `Subscription status: ${subscription.status.replaceAll("_", " ")}. Current period ends ${date(subscription.periodEnd)}.`
                      : "Your subscription has ended."}
              </p>
            ) : null}
            {state.enabled && !ongoing ? (
              <p className="mt-3 text-sm text-muted">
                Pro includes{" "}
                {units("generation", state.proLimits.generation.monthly)} AI
                generation requests,{" "}
                {units("research", state.proLimits.research.monthly)} research
                calls,{" "}
                {units("transcription", state.proLimits.transcription.monthly)}{" "}
                transcription minutes and{" "}
                {units("synthesis", state.proLimits.synthesis.monthly)}{" "}
                read-aloud characters each month. Daily limits still apply.
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-3">
              {state.customer ? (
                <button
                  className="app-button secondary"
                  disabled={busy}
                  onClick={() => void open("/billing/portal")}
                >
                  {busy ? "Opening billing…" : "Manage subscription"}
                </button>
              ) : null}
              {state.enabled && !ongoing
                ? state.prices.map((price) => (
                    <button
                      key={price.interval}
                      className="app-button"
                      disabled={busy}
                      onClick={() =>
                        void open(
                          "/billing/checkout",
                          price.interval,
                          price.amount,
                        )
                      }
                    >
                      {busy
                        ? "Opening billing…"
                        : `Upgrade to Pro · ${money(price.amount, price.currency)}/${price.interval === "month" ? "month" : "year"}`}
                    </button>
                  ))
                : null}
            </div>
            <p className="mt-3 text-sm text-muted">
              Payments and cancellation are managed securely through Stripe. No
              automatic usage overage charges.
            </p>
          </section>
          {usage ? (
            <section
              className="app-panel"
              aria-labelledby="billing-usage-heading"
            >
              <h3
                id="billing-usage-heading"
                className="font-editorial text-2xl"
              >
                Your usage
              </h3>
              <p className="mt-3 text-sm text-muted">
                Monthly allowances reset {date(usage.monthlyResetAt)}. Unused
                allowances do not roll over.
              </p>
              <dl className="mt-5 grid gap-5">
                {(Object.keys(labels) as BillingMetric[]).map((metric) => {
                  const value = usage.metrics[metric];
                  return (
                    <div
                      key={metric}
                      className="border-t border-current/10 pt-4"
                    >
                      <dt className="text-sm font-medium">{labels[metric]}</dt>
                      <dd className="mt-1 text-sm text-muted">
                        {units(
                          metric,
                          Math.max(0, value.monthlyLimit - value.month),
                        )}{" "}
                        remaining of {units(metric, value.monthlyLimit)} this
                        month
                      </dd>
                      {value.dailyLimit !== null ? (
                        <dd className="mt-1 text-sm text-muted">
                          {units(metric, value.today)} of{" "}
                          {units(metric, value.dailyLimit)} today
                        </dd>
                      ) : null}
                    </div>
                  );
                })}
              </dl>
              <p className="mt-5 text-sm text-muted">
                Daily allowances reset {date(usage.dailyResetAt)}. One action
                may use several AI generation requests. Background generation
                counts too; writing and basic search do not use this allowance.
                Provider attempts, including retries, count even when no result
                is returned.
              </p>
              <p className="mt-3 text-sm text-muted">
                Additional safety limits apply: 180 API requests per minute,
                2,000 total AI requests per day, and per speech type 20 attempts
                per day with up to 10 transcription minutes or 60,000 read-aloud
                characters. Research also depends on the service’s shared
                provider budget.
              </p>
            </section>
          ) : null}
          <button
            className="text-button w-fit"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? "Refreshing…" : "Refresh usage"}
          </button>
        </>
      )}
    </div>
  );
}
