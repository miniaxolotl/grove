import type { ApiEnvelope } from "@lib/shared/contracts";
import { operationForRequest, type Outcome } from "./analytics-policy";
import { recordWebsiteOperation } from "./diagnostics";
import { telemetryAllowed } from "./telemetry-choice";

export class DashboardApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "DashboardApiError";
  }
}

export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
  signal?: AbortSignal,
): Promise<T> {
  const started = performance.now();
  const verb = method ?? (body === undefined ? "GET" : "POST");
  let outcome: Outcome = "unavailable";
  try {
    const response = await fetch(`/api/grove${path}`, {
      method: verb,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(!telemetryAllowed() ? { "X-Grove-Telemetry": "off" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    if (response.status >= 500) outcome = "error";
    const result = (await response.json()) as ApiEnvelope<T>;
    if (!response.ok || !result.success)
      throw new DashboardApiError(
        !result.success ? result.error.code : "unavailable",
        !result.success
          ? result.error.message
          : "Grove could not complete the request",
        response.status,
      );
    outcome = "success";
    return result.data;
  } finally {
    // Only a closed operation category and timing cross this boundary.
    if (!signal?.aborted)
      recordWebsiteOperation(
        operationForRequest(path, verb),
        outcome,
        performance.now() - started,
      );
  }
}
export type { Notebook as Project } from "@lib/shared/contracts";
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
