"use client";
import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Download, RotateCw } from "lucide-react";
import {
  adminUsageReportSchema,
  usageReportFeatures,
  type AdminUsageReport,
  type AdminUsageReportUser,
  type UsageReportFeature,
} from "@lib/shared/system-admin";
import { useWorkspaceCache } from "./workspace-cache";
import { adminDenied } from "./admin-account-inspector";
import "./admin-usage-reports.css";

const labels: Record<UsageReportFeature, string> = {
  recall: "Recall & search",
  ask: "Ask replies",
  organization: "Note organization",
  assistance: "Summaries & assistance",
  embedding: "Embeddings",
  decision: "Classification",
  generation: "Generation",
  research: "Web research",
  transcription: "Transcription",
  synthesis: "Read aloud",
};
const actions = usageReportFeatures.slice(0, 4);
const providers = usageReportFeatures.slice(4);
const number = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
const isAudio = (feature: UsageReportFeature) =>
  feature === "transcription" || feature === "synthesis";
const unit = (feature: UsageReportFeature) =>
  isAudio(feature)
    ? "minutes"
    : actions.includes(feature)
      ? "actions"
      : "requests";
const quantity = (feature: UsageReportFeature, value: number) =>
  isAudio(feature) ? value / 60000 : value;
const format = (feature: UsageReportFeature, value: number) =>
  value > 0 && quantity(feature, value) < 0.01
    ? "<0.01"
    : number(quantity(feature, value));
const today = () => new Date().toISOString().slice(0, 10);
const month = () => ({ from: `${today().slice(0, 7)}-01`, to: today() });
const date = (value: string) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

function downloadTotals(report: AdminUsageReport) {
  const rows = [
    [
      "Feature",
      "Unit",
      "Used",
      "Pending actions",
      "Requests",
      "Fresh completed",
      "Cached completed",
      "Input tokens",
      "Output tokens",
    ],
    ...usageReportFeatures.map((feature) => {
      const metric = report.totals.metrics[feature];
      return [
        labels[feature],
        isAudio(feature) ? "milliseconds" : unit(feature),
        metric.used,
        metric.reserved,
        metric.requests,
        metric.fresh,
        metric.cached,
        metric.inputTokens,
        metric.outputTokens,
      ];
    }),
  ];
  const blob = new Blob(
    [
      rows
        .map((row) =>
          row
            .map((value) => `"${String(value).replaceAll('"', '""')}"`)
            .join(","),
        )
        .join("\r\n"),
    ],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `grove-usage-${report.from}-${report.to}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AdminUsageReports({
  onDenied,
  onInspect,
}: {
  onDenied: () => void;
  onInspect: (user: AdminUsageReportUser) => void;
}) {
  const cache = useWorkspaceCache();
  const [range, setRange] = useState(month);
  const [draft, setDraft] = useState(range);
  const [validation, setValidation] = useState("");
  const [feature, setFeature] = useState<UsageReportFeature>("ask");
  const query = useInfiniteQuery({
    queryKey: ["admin-usage", range.from, range.to],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      cache.api<AdminUsageReport>(
        "/admin/usage",
        { ...range, ...(pageParam ? { after: pageParam } : {}) },
        "POST",
        signal,
      ),
    getNextPageParam: (page) => page.users.nextCursor ?? undefined,
    staleTime: 0,
    retry: false,
  });
  const denied = adminDenied(query.error);
  useEffect(() => {
    if (denied) onDenied();
  }, [denied, onDenied]);
  if (denied) return null;
  const report = query.data?.pages[0];
  const users = query.data?.pages.flatMap((page) => page.users.accounts) ?? [];
  const apply = (next: typeof range) => {
    if (!adminUsageReportSchema.safeParse(next).success || next.to > today()) {
      setValidation(
        "Choose a valid UTC date range of at most 366 days, ending today or earlier.",
      );
      return;
    }
    setValidation("");
    setDraft(next);
    if (range.from === next.from && range.to === next.to) void query.refetch();
    else setRange(next);
  };
  const days = report
    ? Array.from(
        {
          length:
            Math.round(
              (Date.parse(report.to) - Date.parse(report.from)) / 86400000,
            ) + 1,
        },
        (_, index) => {
          const day = new Date(Date.parse(report.from) + index * 86400000)
            .toISOString()
            .slice(0, 10);
          return {
            day,
            used:
              report.days.find(
                (row) => row.day === day && row.feature === feature,
              )?.used ?? 0,
          };
        },
      )
    : [];
  const maximum = Math.max(...days.map((day) => day.used), 1);
  return (
    <section className="admin-report" aria-labelledby="admin-report-title">
      <header className="admin-heading">
        <div>
          <h2 id="admin-report-title" className="settings-section-heading">
            Usage reports
          </h2>
          <p className="admin-caption">
            Recorded usage across every Grove account. Calendar dates are UTC.
          </p>
        </div>
        <button
          type="button"
          className="app-button secondary admin-refresh"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RotateCw size={16} />
          Refresh reports
        </button>
      </header>
      <form
        className="admin-report-range"
        onSubmit={(event) => {
          event.preventDefault();
          apply(draft);
        }}
      >
        <label>
          From
          <input
            type="date"
            required
            value={draft.from}
            max={today()}
            onChange={(event) =>
              setDraft({ ...draft, from: event.target.value })
            }
          />
        </label>
        <label>
          Through
          <input
            type="date"
            required
            value={draft.to}
            max={today()}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </label>
        <button
          className="app-button secondary"
          type="submit"
          disabled={query.isFetching}
        >
          Apply range
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => apply(month())}
        >
          This month
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() =>
            apply({
              from: new Date(Date.parse(today()) - 29 * 86400000)
                .toISOString()
                .slice(0, 10),
              to: today(),
            })
          }
        >
          Last 30 days
        </button>
      </form>
      {validation ? (
        <p role="alert" className="admin-error">
          {validation}
        </p>
      ) : null}
      {query.error ? (
        <div className="admin-error" role="alert">
          <p>
            {query.isFetchNextPageError
              ? "Couldn’t load more people. Loaded rows are still shown."
              : report
                ? "Couldn’t refresh the report. Previous figures are still shown."
                : "Couldn’t load usage reports."}
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              void (query.isFetchNextPageError
                ? query.fetchNextPage()
                : query.refetch())
            }
          >
            Try again
          </button>
        </div>
      ) : null}
      {!report ? (
        <p role="status">
          {query.isPending
            ? "Loading recorded usage…"
            : "Choose Try again to load this report."}
        </p>
      ) : (
        <>
          <div className="admin-report-summary">
            <p>
              <strong>{number(report.totals.accounts)} accounts</strong> ·{" "}
              {number(report.totals.activeUsers)} with recorded activity
              <br />
              <span className="admin-caption">
                {date(report.from)} – {date(report.to)} · Updated{" "}
                {new Date(report.generatedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {query.isFetching ? " · Refreshing…" : ""}
              </span>
            </p>
            <button
              type="button"
              className="app-button secondary admin-report-export"
              onClick={() => downloadTotals(report)}
            >
              <Download size={16} />
              Export feature totals
            </button>
          </div>
          <dl className="admin-report-footprint" aria-label="Current footprint">
            <div>
              <dt>Notes now</dt>
              <dd>{number(report.totals.current.notes)}</dd>
            </div>
            <div>
              <dt>Notebooks now</dt>
              <dd>{number(report.totals.current.notebooks)}</dd>
            </div>
            <div>
              <dt>Active connections now</dt>
              <dd>{number(report.totals.current.connections)}</dd>
            </div>
          </dl>
          {!report.totals.activeUsers ? (
            <p className="admin-empty">
              No recorded usage in this range. Current account and library
              counts are shown separately.
            </p>
          ) : null}
          <section>
            <h3>Recorded user actions</h3>
            <p className="admin-caption">
              Each feature stays separate. Fully cached requests use 0.2
              actions; fresh or partly cached requests use 1.
            </p>
            <div
              className="admin-report-table"
              role="region"
              aria-label="User action totals"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Feature</th>
                    <th scope="col">Actions</th>
                    <th scope="col">Fresh</th>
                    <th scope="col">Cached</th>
                    <th scope="col">Pending actions</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((key) => {
                    const metric = report.totals.metrics[key];
                    return (
                      <tr key={key}>
                        <th scope="row">{labels[key]}</th>
                        <td>{number(metric.used)}</td>
                        <td>{number(metric.fresh)}</td>
                        <td>{number(metric.cached)}</td>
                        <td>{number(metric.reserved)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <h3>Provider &amp; audio usage</h3>
            <p className="admin-caption">
              Actual recorded attempts, including failed or reserved work. These
              are not invoices or extra user actions.
            </p>
            <div
              className="admin-report-table"
              role="region"
              aria-label="Provider and audio totals"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Feature</th>
                    <th scope="col">Usage</th>
                    <th scope="col">Requests</th>
                    <th scope="col">Input / output tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((key) => {
                    const metric = report.totals.metrics[key];
                    return (
                      <tr key={key}>
                        <th scope="row">{labels[key]}</th>
                        <td>
                          {format(key, metric.used)}{" "}
                          <span className="admin-caption">{unit(key)}</span>
                        </td>
                        <td>{number(metric.requests)}</td>
                        <td>
                          {["embedding", "decision", "generation"].includes(key)
                            ? `${number(metric.inputTokens)} / ${number(metric.outputTokens)}`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <div className="admin-section-heading">
              <h3>Activity &amp; people</h3>
              <label className="admin-report-feature">
                Feature
                <select
                  value={feature}
                  onChange={(event) =>
                    setFeature(event.target.value as UsageReportFeature)
                  }
                >
                  {usageReportFeatures.map((key) => (
                    <option key={key} value={key}>
                      {labels[key]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <figure className="admin-report-chart">
              <figcaption>
                {labels[feature]} per day · {unit(feature)}
              </figcaption>
              <ol
                aria-label={`${labels[feature]} daily activity`}
                className="admin-report-bars"
              >
                {days.map((day) => (
                  <li
                    key={day.day}
                    title={`${day.day}: ${format(feature, day.used)} ${unit(feature)}`}
                  >
                    <span
                      style={{
                        height: `${Math.max(day.used > 0 ? 2 : 0, (day.used / maximum) * 100)}%`,
                      }}
                    />
                    <span className="sr-only">
                      {day.day}: {format(feature, day.used)} {unit(feature)}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="admin-report-chart-dates" aria-hidden="true">
                <span>{date(report.from)}</span>
                <span>{date(report.to)}</span>
              </div>
            </figure>
            <details className="admin-report-daily">
              <summary>Daily figures</summary>
              <div className="admin-report-table">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">UTC date</th>
                      <th scope="col">{unit(feature)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((day) => (
                      <tr key={day.day}>
                        <th scope="row">{day.day}</th>
                        <td>{format(feature, day.used)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <p className="admin-caption">
              Showing {users.length} of {report.users.total} accounts ·{" "}
              {labels[feature]}
            </p>
            <ul className="admin-report-users" aria-label="Usage by person">
              {users.map((user) => (
                <li key={user.accountId}>
                  <div className="admin-person">
                    <strong>{user.name || user.email || user.subject}</strong>
                    <span className="admin-caption">
                      {user.email || user.subject}
                      {user.status !== "active" ? " · Unavailable" : ""}
                    </span>
                  </div>
                  <span className="admin-report-person-amount">
                    {format(feature, user.metrics[feature].used)}{" "}
                    <span className="admin-caption">{unit(feature)}</span>
                  </span>
                  <button
                    type="button"
                    className="app-button secondary"
                    onClick={() => onInspect(user)}
                    disabled={!["active", "disabled"].includes(user.status)}
                    aria-label={`Inspect ${user.email || user.subject}`}
                  >
                    Inspect
                  </button>
                </li>
              ))}
            </ul>
            {query.hasNextPage ? (
              <button
                type="button"
                className="app-button secondary"
                disabled={query.isFetching}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage
                  ? "Loading…"
                  : query.isFetchNextPageError
                    ? "Try loading more again"
                    : "Load more people"}
              </button>
            ) : null}
          </section>
          <p className="admin-caption admin-report-notes">
            Reports use retained counters, not private note content. Action
            counts exist only where plan metering applies; unmetered/manual work
            is not reconstructed. Actions are attributed to their request date
            within the quota month, not completion time. Footprint is a current
            snapshot, independent of the chosen range. Feature exports include
            global totals, not just loaded people.
          </p>
        </>
      )}
    </section>
  );
}
