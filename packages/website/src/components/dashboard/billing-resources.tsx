import type { ResourceUsage } from "@lib/shared/billing";

export const resourceLabels = {
  notes: "Notes",
  notebooks: "Notebooks",
  recall: "Agent recall & semantic search",
  ask: "Ask Grove replies",
  organization: "Note organization",
  assistance: "Summaries & assistance",
} as const;

const count = (value: number) => new Intl.NumberFormat().format(value);

export function BillingResources({ usage }: { usage: ResourceUsage }) {
  return (
    <section
      className="billing-usage"
      aria-labelledby="billing-resources-heading"
    >
      <div className="billing-usage-heading">
        <h3 id="billing-resources-heading">Your allowance</h3>
        <span className="billing-caption">
          Monthly actions reset{" "}
          <time
            dateTime={usage.resetAt}
            title={new Date(usage.resetAt).toLocaleString()}
          >
            {new Date(usage.resetAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </time>
        </span>
      </div>
      <dl className="billing-metrics">
        {(Object.keys(resourceLabels) as (keyof typeof resourceLabels)[]).map(
          (resource) => {
            const value = usage.metrics[resource];
            const total = value.used + value.reserved;
            const ratio =
              value.limit === null
                ? 0
                : value.limit === 0
                  ? 1
                  : total / value.limit;
            const storage = resource === "notes" || resource === "notebooks";
            const labelId = `billing-resource-${resource}`;
            return (
              <div className="billing-metric" key={resource}>
                <dt id={labelId}>{resourceLabels[resource]}</dt>
                <dd className="billing-metric-count">
                  {count(value.used)}{" "}
                  <span className="billing-caption">
                    / {value.limit === null ? "Unlimited" : count(value.limit)}
                    {storage ? " stored" : " this month"}
                  </span>
                </dd>
                {value.limit !== null ? (
                  <dd className="billing-meter">
                    <meter
                      aria-labelledby={labelId}
                      aria-valuetext={`${count(value.used)} used, ${count(value.reserved)} pending, of ${count(value.limit)}`}
                      min={0}
                      max={Math.max(1, value.limit)}
                      value={Math.min(total, Math.max(1, value.limit))}
                    />
                  </dd>
                ) : null}
                {!storage &&
                value.cache &&
                value.cache.fresh + value.cache.cached > 0 ? (
                  <dd className="billing-metric-note">
                    <span>
                      {count(value.cache.fresh)} fresh ·{" "}
                      {count(value.cache.cached)} cached requests
                      {value.cache.cached > 0 ? ` · ${count(value.cache.cached * 4 / 5)} actions saved` : ""}
                    </span>
                  </dd>
                ) : null}
                {value.reserved > 0 || ratio >= 0.8 ? (
                  <dd className="billing-metric-note">
                    {value.reserved > 0 ? (
                      <span>{count(value.reserved)} pending</span>
                    ) : null}
                    {ratio >= 1 ? (
                      <span>
                        {storage
                          ? "Storage limit reached — remove an item to add another"
                          : "Monthly limit reached"}
                      </span>
                    ) : ratio >= 0.95 ? (
                      <span>Almost at your limit</span>
                    ) : ratio >= 0.8 ? (
                      <span>
                        {Math.floor(ratio * 100)}% of your allowance used or
                        pending
                      </span>
                    ) : null}
                  </dd>
                ) : null}
              </div>
            );
          },
        )}
      </dl>
      <p className="billing-caption billing-resource-help">
        Editing, keyword search and export stay available. Autosaves and
        internal retries don’t use extra actions.
        {Object.values(usage.metrics).some((metric) => metric.cache) ? (
          <>
            {" "}
            Each allowance stays separate. Fresh requests use 1 action; fully
            cached requests use 0.2.
          </>
        ) : null}
      </p>
    </section>
  );
}
