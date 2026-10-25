"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import type { AccountPlan } from "@lib/shared/billing";
import { useWorkspaceCache } from "./workspace-cache";
import "./account-plan.css";

export const planNames = { free: "Free", pro: "Pro", unlimited: "Unlimited" };
export const planSources = {
  free: "Free plan",
  paid: "Paid subscription",
  trial: "Trial subscription",
  complimentary: "Complimentary",
};

function useAccountPlan() {
  const cache = useWorkspaceCache();
  return useQuery(cache.resource<{ plan?: AccountPlan | null }>("/me"));
}

export function PlanBadge({ plan }: { plan: AccountPlan }) {
  return (
    <span
      className={`plan-badge${plan.tier === "free" ? " plan-badge-free" : ""}`}
    >
      {planNames[plan.tier]}
    </span>
  );
}

export function PlanDescription({ plan }: { plan: AccountPlan }) {
  return (
    <p className="account-plan-description">
      {plan.source === "complimentary"
        ? `${planNames[plan.tier]} access provided by the Grove team at no charge. This does not cancel any separate subscription.`
        : plan.source === "paid"
          ? "Your Pro access comes from a paid subscription."
          : plan.source === "trial"
            ? "Your Pro access comes from a subscription trial."
            : "You’re on the Free plan. No subscription is required."}
    </p>
  );
}

export function WorkspacePlan() {
  const query = useAccountPlan();
  if (query.isPending) return <div className="workspace-plan-placeholder" />;
  if (query.isError)
    return (
      <button
        className="workspace-plan workspace-plan-retry"
        onClick={() => void query.refetch()}
      >
        Plan unavailable <span>Try again</span>
      </button>
    );
  const plan = query.data?.plan;
  if (!plan) return null;
  return (
    <Link
      className="workspace-plan"
      href="/app/settings/account#account-plan"
      aria-label={`${planNames[plan.tier]}, ${planSources[plan.source]}. View plan details`}
    >
      <PlanBadge plan={plan} />
      <span className="workspace-plan-source">{planSources[plan.source]}</span>
      <ChevronRight size={14} aria-hidden="true" />
    </Link>
  );
}

export function AccountPlanDetails() {
  const query = useAccountPlan();
  if (query.isPending)
    return (
      <p className="account-plan-description" role="status">
        Loading your plan…
      </p>
    );
  if (query.isError)
    return (
      <section
        className="account-plan-details"
        id="account-plan"
        aria-label="Your plan"
      >
        <p role="alert">Couldn’t load your plan.</p>
        <button className="text-button" onClick={() => void query.refetch()}>
          Try again
        </button>
      </section>
    );
  const plan = query.data?.plan;
  if (!plan) return null;
  return (
    <section
      className="account-plan-details"
      id="account-plan"
      aria-labelledby="account-plan-heading"
    >
      <div className="account-plan-heading">
        <h3 id="account-plan-heading">Your plan</h3>
        <PlanBadge plan={plan} />
        <span className="account-plan-source">{planSources[plan.source]}</span>
      </div>
      <PlanDescription plan={plan} />
    </section>
  );
}
