"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { AccountPlan, AccountPlanUsage } from "@lib/shared/billing";
import { useWorkspaceCache } from "./workspace-cache";
import { workspaceKeys } from "@/lib/workspace-cache";
import { overlayViewport } from "./ui/overlay-focus";
import { PlanUsageBreakdown } from "./plan-usage";
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
        ? "Provided by Grove. No payment required for this access."
        : plan.source === "paid"
          ? "Billed through your subscription."
          : plan.source === "trial"
            ? "Pro access during your trial."
            : "No payment required."}
    </p>
  );
}

export function WorkspacePlan() {
  const query = useAccountPlan();
  const cache = useWorkspaceCache();
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pinned = useRef(false);
  const usage = useQuery({
    ...cache.resource<{ planUsage?: AccountPlanUsage }>("/account/usage"),
    enabled: open,
  });
  const plan =
    open && usage.isSuccess && usage.data?.planUsage
      ? usage.data.planUsage.plan
      : query.data?.plan;
  useEffect(() => {
    if (usage.dataUpdatedAt)
      void cache.client.invalidateQueries({
        queryKey: workspaceKeys.resource("/me"),
      });
  }, [cache, usage.dataUpdatedAt]);
  const clearTimer = () => clearTimeout(timer.current);
  const show = () => {
    clearTimer();
    popup.current?.showPopover();
    setOpen(true);
  };
  const close = () => {
    clearTimer();
    pinned.current = false;
    popup.current?.hidePopover();
    setOpen(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open || !popup.current || !anchor.current) return;
    const element = popup.current;
    const trigger = anchor.current;
    const place = () => {
      if (!trigger.getClientRects().length) {
        element.hidePopover();
        return;
      }
      const bounds = overlayViewport();
      const left = bounds.left + 8,
        top = bounds.top + 8;
      const right = bounds.left + bounds.width - 8,
        bottom = bounds.top + bounds.height - 8;
      element.style.maxHeight = `${Math.max(0, bottom - top)}px`;
      element.style.maxWidth = `${Math.max(0, right - left)}px`;
      const rect = trigger.getBoundingClientRect(),
        panel = element.getBoundingClientRect();
      const y =
        rect.bottom + 4 + panel.height <= bottom
          ? rect.bottom + 4
          : rect.top - panel.height - 4;
      element.style.left = `${Math.max(left, Math.min(rect.right - panel.width, right - panel.width))}px`;
      element.style.top = `${Math.max(top, Math.min(y, bottom - panel.height))}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    observer.observe(trigger);
    document.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      document.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open]);
  if (!query.isPending && !query.isError && !query.data?.plan && !plan)
    return null;
  return (
    <div
      ref={root}
      className="workspace-plan-control"
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        clearTimer();
        timer.current = setTimeout(show, 180);
      }}
      onPointerLeave={() => {
        clearTimer();
        if (!pinned.current && !root.current?.contains(document.activeElement))
          timer.current = setTimeout(close, 200);
      }}
      onFocusCapture={clearTimer}
      onBlurCapture={(event) => {
        if (!root.current?.contains(event.relatedTarget)) {
          close();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
          anchor.current?.focus({ preventScroll: true });
        }
      }}
    >
      <button
        ref={anchor}
        type="button"
        className="workspace-plan"
        aria-label={
          plan
            ? `${planNames[plan.tier]}, ${planSources[plan.source]}. Plan and usage`
            : "Plan and usage"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onFocus={(event) => {
          // Restoring focus from inside the panel must not reopen it on close.
          if (!root.current?.contains(event.relatedTarget)) show();
        }}
        onClick={() => {
          if (pinned.current && open) close();
          else {
            pinned.current = true;
            show();
          }
        }}
      >
        {plan ? (
          <PlanBadge plan={plan} />
        ) : (
          <span className="plan-badge plan-badge-free">Plan</span>
        )}
      </button>
      <div
        ref={popup}
        id={id}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-heading`}
        className="plan-popover"
        onToggle={(event) => {
          const next = event.newState === "open";
          setOpen(next);
          if (!next) {
            pinned.current = false;
            clearTimer();
          }
        }}
      >
        <header className="plan-popover-heading">
          <div>
            <h3 id={`${id}-heading`}>
              {plan ? `${planNames[plan.tier]} plan` : "Your plan"}
            </h3>
            {plan ? <p>{planSources[plan.source]}</p> : null}
          </div>
          <button
            type="button"
            className="app-icon"
            aria-label="Close plan details"
            onClick={() => {
              close();
              anchor.current?.focus({ preventScroll: true });
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        {plan?.source === "complimentary" ? (
          <p className="plan-popover-note">Provided by Grove at no charge.</p>
        ) : null}
        {usage.isError ? (
          <div className="plan-popover-error" role="alert">
            <p>
              {plan ? "Couldn’t load usage." : "Couldn’t load plan & usage."}
            </p>
            <button
              className="text-button"
              onClick={() => {
                void usage.refetch();
                if (query.isError) void query.refetch();
              }}
            >
              Try again
            </button>
          </div>
        ) : usage.isPending ? (
          <p className="plan-popover-note" role="status">
            Loading usage…
          </p>
        ) : usage.data?.planUsage ? (
          <PlanUsageBreakdown snapshot={usage.data.planUsage} />
        ) : (
          <p className="plan-popover-note">
            Usage details aren’t available yet.
          </p>
        )}
        <Link
          className="plan-popover-link"
          href="/app/settings/account#account-plan"
          onClick={close}
        >
          Account details
        </Link>
      </div>
    </div>
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
