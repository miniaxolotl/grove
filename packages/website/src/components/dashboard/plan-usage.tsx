import type { AccountPlanUsage, ResourceUsage } from "@lib/shared/billing";

const labels = {
  notes: "Notes",
  notebooks: "Notebooks",
  recall: "Recall & search",
  ask: "Ask replies",
  organization: "Organization",
  assistance: "AI assistance",
} as const;
const number = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
const hours = (value: number) =>
  value > 0 && value < 36000 ? "<0.01" : number(value / 3600000);
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

function ResourceRows({
  usage,
  resources,
}: {
  usage: ResourceUsage;
  resources: (keyof typeof labels)[];
}) {
  return (
    <dl className="plan-usage-rows">
      {resources.map((key) => {
        const value = usage.metrics[key],
          total = value.used + value.reserved;
        const full = value.limit !== null && total >= value.limit;
        return (
          <div
            className="plan-usage-row"
            key={key}
            data-full={full || undefined}
          >
            <dt>{labels[key]}</dt>
            <dd className="plan-usage-count">
              {number(value.used)}{" "}
              <span>
                / {value.limit === null ? "Unlimited" : number(value.limit)}
              </span>
            </dd>
            {value.reserved > 0 || full ? (
              <dd className="plan-usage-pending">
                {value.reserved > 0
                  ? `${number(value.reserved)} pending`
                  : null}
                {value.reserved > 0 && full ? " · " : null}
                {full ? "Limit reached" : null}
              </dd>
            ) : null}
          </div>
        );
      })}
    </dl>
  );
}

export function PlanUsageBreakdown({
  snapshot,
}: {
  snapshot: AccountPlanUsage;
}) {
  const { resources, usage } = snapshot;
  if (!resources && !usage)
    return (
      <p className="plan-popover-note">
        No plan limits are configured for this account.
      </p>
    );
  return (
    <div className="plan-usage-breakdown">
      {resources ? (
        <>
          <section aria-label="Library limits">
            <div className="plan-usage-section-heading">
              <h4>Library</h4>
              <span>Used / limit</span>
            </div>
            <ResourceRows
              usage={resources}
              resources={["notes", "notebooks"]}
            />
          </section>
          <section aria-label="Monthly action limits">
            <div className="plan-usage-section-heading">
              <h4>This month</h4>
              <span>
                Resets{" "}
                <time dateTime={resources.resetAt}>
                  {date(resources.resetAt)}
                </time>
              </span>
            </div>
            <ResourceRows
              usage={resources}
              resources={["recall", "ask", "organization", "assistance"]}
            />
          </section>
        </>
      ) : null}
      {usage ? (
        <details className="plan-extra-limits">
          <summary>AI & audio limits</summary>
          <dl className="plan-usage-rows">
            {(
              ["generation", "research", "transcription", "synthesis"] as const
            ).map((key) => {
              const value = usage.metrics[key],
                timed = snapshot.units[key] === "milliseconds";
              const format = timed ? hours : number;
              const label = {
                generation: "AI requests",
                research: "Web research",
                transcription: "Transcription",
                synthesis: "Read aloud",
              }[key];
              return (
                <div className="plan-usage-row" key={key}>
                  <dt>{label}</dt>
                  <dd className="plan-usage-count">
                    {format(value.month)}{" "}
                    <span>
                      /{" "}
                      {value.monthlyLimit === null
                        ? "Unlimited"
                        : `${format(value.monthlyLimit)}${timed ? " h" : ""}`}
                    </span>
                  </dd>
                  {value.dailyLimit !== null ? (
                    <dd className="plan-usage-pending">
                      Today: {number(value.today)} / {number(value.dailyLimit)}
                    </dd>
                  ) : null}
                </div>
              );
            })}
          </dl>
          <p className="plan-popover-note">
            Monthly limits reset{" "}
            <time dateTime={usage.monthlyResetAt}>
              {date(usage.monthlyResetAt)}
            </time>
            . AI requests include background processing.
          </p>
        </details>
      ) : null}
    </div>
  );
}
