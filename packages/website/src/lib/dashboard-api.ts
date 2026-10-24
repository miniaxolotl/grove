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

export function createDashboardApi(
  send: (url: string, init: RequestInit) => Promise<Response>,
) {
  return async function api<T>(
    path: string,
    body?: unknown,
    method?: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const started = performance.now();
    const verb = method ?? (body === undefined ? "GET" : "POST");
    let outcome: Outcome = "unavailable";
    try {
      const response = await send(`/api/grove${path}`, {
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
      let result: ApiEnvelope<T> | null;
      try {
        result = (await response.json()) as ApiEnvelope<T>;
      } catch (error) {
        signal?.throwIfAborted();
        if (
          response.ok ||
          (error instanceof Error && error.name === "AbortError")
        )
          throw error;
        // A middleware/proxy error need not have Grove's JSON envelope. Keep
        // its HTTP status so auth denials cannot turn into transient retries.
        result = null;
      }
      if (!response.ok || result?.success !== true) {
        const failure = result?.success === false ? result.error : undefined;
        throw new DashboardApiError(
          typeof failure?.code === "string" ? failure.code : "unavailable",
          typeof failure?.message === "string"
            ? failure.message
            : response.status === 401
              ? "Sign in to Grove to continue"
              : response.status === 403
                ? "This request is not allowed."
                : "Grove could not complete the request",
          response.status,
        );
      }
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
  };
}
export const api = createDashboardApi((url, init) => fetch(url, init));
export type { Notebook as Project } from "@lib/shared/contracts";
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
