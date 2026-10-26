"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import type { BillingStatus, BillingMetric } from "@lib/shared/billing";
import { DashboardApiError } from "@/lib/dashboard-api";
import { workspaceKeys } from "@/lib/workspace-cache";
import { useWorkspaceCache } from "./workspace-cache";
import "./billing-panel.css";
import { BillingResources, resourceLabels } from "./billing-resources";
import { PlanDescription, planNames, planSources } from "./account-plan";

const labels: Record<BillingMetric, string> = {
  generation: "AI requests",
  research: "Research",
  transcription: "Transcription",
  synthesis: "Read aloud",
};
const units = (metric: BillingMetric, value: number, timedSpeech: boolean) =>
  new Intl.NumberFormat(undefined, {
    maximumFractionDigits:
      metric === "transcription" || (metric === "synthesis" && timedSpeech)
        ? 2
        : 0,
  }).format(
    metric === "transcription" || (metric === "synthesis" && timedSpeech)
      ? value / (timedSpeech ? 3600000 : 60000)
      : value,
  );
const shortDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
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
const suffix = (metric: BillingMetric, timedSpeech: boolean, limit: number) =>
  (metric === "transcription" || metric === "synthesis") && timedSpeech
    ? limit === 3600000
      ? " hour"
      : " hours"
    : metric === "transcription"
      ? " min"
      : metric === "synthesis"
        ? " characters"
        : "";
const resetDate = (value: string) => (
  <time dateTime={value} title={date(value)}>
    {shortDate(value)}
  </time>
);

export function BillingPanel() {
  const cache = useWorkspaceCache();
  const query = useQuery({
    ...cache.resource<BillingStatus>("/billing"),
    staleTime: 0,
    refetchInterval: 60000,
  });
  // Billing reconciles Stripe before returning. Refresh the lightweight badge
  // snapshot after that sync rather than leaving a checkout's old Free label.
  useEffect(() => {
    if (query.dataUpdatedAt)
      void cache.client.invalidateQueries({
        queryKey: workspaceKeys.resource("/me"),
      });
  }, [cache, query.dataUpdatedAt]);
  const [action, setAction] = useState<string | null>(null),
    [error, setError] = useState("");
  const busy = action !== null;
  const pending = useRef(false);
  async function open(
    path: string,
    interval?: "month" | "year",
    expectedAmount?: number,
  ) {
    if (pending.current) return;
    pending.current = true;
    setAction(interval ?? "portal");
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
      setError(
        e instanceof DashboardApiError && e.code === "billing_price_changed"
          ? "The price changed. Refresh to review it."
          : "Couldn’t open billing. Please try again.",
      );
    } finally {
      pending.current = false;
      setAction(null);
    }
  }
  const state = query.data,
    usage = state?.usage;
  // A retained response from an older API must never label characters as hours.
  const timedSpeech = state?.units?.synthesis === "milliseconds";
  const subscription = state?.subscription;
  const ongoing =
    subscription &&
    !["canceled", "incomplete_expired"].includes(subscription.status);
  const paymentDue =
    subscription && ["past_due", "unpaid"].includes(subscription.status);
  if (
    (query.error instanceof DashboardApiError && query.error.status === 404) ||
    state?.enabled === false
  )
    return null;
  return (
    <div className="billing-sheet">
      <h2 className="settings-section-heading">Billing</h2>
      {error || query.error ? (
        <div className="billing-error" role="alert">
          <p>{error || "Couldn’t load your plan."}</p>
          <button
            className="text-button"
            onClick={() => {
              setError("");
              void query.refetch();
            }}
          >
            Try again
          </button>
        </div>
      ) : null}
      {!state ? (
        <p className="billing-loading" role="status">
          {query.isPending ? "Loading your plan…" : "Your plan is unavailable."}
        </p>
      ) : (
        <>
          <section className="billing-plan" aria-label="Current plan">
            <div>
              <div className="billing-plan-name">
                <h3>
                  {state.plan
                    ? planNames[state.plan.tier]
                    : usage
                      ? planNames[usage.plan]
                      : "Your plan"}
                </h3>
                {state.plan ? (
                  <span className="account-plan-source">
                    {planSources[state.plan.source]}
                  </span>
                ) : (
                  <span className="billing-current">Current plan</span>
                )}
              </div>
              {state.plan?.source === "complimentary" ||
              state.plan?.source === "free" ? (
                <PlanDescription plan={state.plan} />
              ) : null}
              {state.plan?.source === "complimentary" && ongoing ? (
                <p className="billing-caption">
                  A separate subscription is still active. Complimentary access
                  does not cancel it.
                </p>
              ) : null}
              {subscription ? (
                <p className="billing-caption">
                  {paymentDue ? (
                    "Payment overdue"
                  ) : subscription.cancelAtPeriodEnd ? (
                    <>Ends {resetDate(subscription.periodEnd)}</>
                  ) : ["active", "trialing"].includes(subscription.status) ? (
                    <>
                      {subscription.status === "trialing"
                        ? "Trial ends"
                        : "Renews"}{" "}
                      {resetDate(subscription.periodEnd)}
                    </>
                  ) : ongoing ? (
                    "Payment pending"
                  ) : (
                    "Subscription ended"
                  )}
                </p>
              ) : null}
            </div>
            {state.customer ? (
              <button
                className="app-button secondary"
                disabled={busy}
                onClick={() => void open("/billing/portal")}
              >
                {action === "portal"
                  ? "Opening…"
                  : paymentDue
                    ? "Update payment"
                    : "Manage subscription"}
              </button>
            ) : null}
          </section>
          {state.resources ? (
            <BillingResources usage={state.resources} />
          ) : null}
          {usage ? (
            <section
              className="billing-usage"
              aria-labelledby="billing-usage-heading"
            >
              <div className="billing-usage-heading">
                <h3 id="billing-usage-heading">
                  {state.resources ? "AI, research & audio" : "This month"}
                </h3>
                <span className="billing-caption">
                  Resets {resetDate(usage.monthlyResetAt)}
                </span>
                <button
                  type="button"
                  className="app-icon billing-refresh"
                  title="Refresh usage"
                  aria-label="Refresh usage"
                  disabled={query.isFetching}
                  onClick={() => void query.refetch()}
                >
                  <RotateCw size={14} aria-hidden="true" />
                </button>
                <span className="sr-only" role="status">
                  {query.isFetching ? "Refreshing usage…" : ""}
                </span>
              </div>
              <dl className="billing-metrics">
                {(Object.keys(labels) as BillingMetric[]).map((metric) => {
                  const value = usage.metrics[metric];
                  const monthlyFull =
                    value.monthlyLimit !== null &&
                    value.month >= value.monthlyLimit;
                  const dailyFull =
                    value.dailyLimit !== null &&
                    value.today >= value.dailyLimit;
                  const labelId = `billing-${metric}`;
                  return (
                    <div key={metric} className="billing-metric">
                      <dt id={labelId}>{labels[metric]}</dt>
                      <dd className="billing-metric-count">
                        <span>{units(metric, value.month, timedSpeech)}</span>
                        <span className="billing-caption">
                          {" "}
                          /{" "}
                          {value.monthlyLimit === null
                            ? "Unlimited"
                            : units(metric, value.monthlyLimit, timedSpeech)}
                          {suffix(metric, timedSpeech, value.monthlyLimit ?? 0)}
                        </span>
                      </dd>
                      {value.monthlyLimit !== null ? (
                        <dd className="billing-meter">
                          <meter
                            aria-labelledby={labelId}
                            aria-valuetext={`${units(metric, value.month, timedSpeech)} of ${units(metric, value.monthlyLimit, timedSpeech)}${suffix(metric, timedSpeech, value.monthlyLimit)} used`}
                            min={0}
                            max={Math.max(1, value.monthlyLimit)}
                            value={Math.min(
                              value.month,
                              Math.max(1, value.monthlyLimit),
                            )}
                          />
                        </dd>
                      ) : null}
                      {value.dailyLimit !== null ? (
                        <dd className="billing-metric-note">
                          <span>
                            {units(metric, value.today, timedSpeech)} /{" "}
                            {units(metric, value.dailyLimit, timedSpeech)} today
                          </span>
                          {monthlyFull ? (
                            <span>Monthly limit reached</span>
                          ) : dailyFull ? (
                            <span>Resets {resetDate(usage.dailyResetAt)}</span>
                          ) : null}
                        </dd>
                      ) : monthlyFull ? (
                        <dd className="billing-metric-note">
                          Monthly limit reached
                        </dd>
                      ) : null}
                    </div>
                  );
                })}
              </dl>
            </section>
          ) : null}
          {state.enabled &&
          usage?.plan === "free" &&
          !ongoing &&
          state.prices.length ? (
            <section
              className="billing-upgrade"
              aria-labelledby="billing-pro-heading"
            >
              <div className="billing-offer-heading">
                <h3 id="billing-pro-heading">Pro</h3>
                <span className="billing-caption">Monthly allowances</span>
              </div>
              {state.prices.map((price) => (
                <div className="billing-purchase" key={price.interval}>
                  <p
                    className="billing-price"
                    id={`billing-price-${price.interval}`}
                  >
                    <strong>{money(price.amount, price.currency)}</strong>
                    <span>
                      {" "}
                      / {price.interval === "month" ? "month" : "year"}
                    </span>
                  </p>
                  <button
                    className="app-button"
                    aria-describedby={`billing-price-${price.interval}`}
                    disabled={busy}
                    onClick={() =>
                      void open(
                        "/billing/checkout",
                        price.interval,
                        price.amount,
                      )
                    }
                  >
                    {action === price.interval ? "Opening…" : "Upgrade to Pro"}
                  </button>
                </div>
              ))}
              <dl className="billing-included">
                {state.proResources
                  ? (
                      Object.keys(
                        resourceLabels,
                      ) as (keyof typeof resourceLabels)[]
                    ).map((resource) => (
                      <div key={resource}>
                        <dt>{resourceLabels[resource]}</dt>
                        <dd>
                          {new Intl.NumberFormat().format(
                            state.proResources![resource],
                          )}
                          {resource === "notes" || resource === "notebooks"
                            ? " stored"
                            : " / month"}
                        </dd>
                      </div>
                    ))
                  : null}
                {(Object.keys(labels) as BillingMetric[]).map((metric) => (
                  <div key={metric}>
                    <dt>{labels[metric]}</dt>
                    <dd>
                      {units(
                        metric,
                        state.proLimits[metric].monthly,
                        timedSpeech,
                      )}
                      {suffix(
                        metric,
                        timedSpeech,
                        state.proLimits[metric].monthly,
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
