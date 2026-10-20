import type { ApiEnvelope } from "@lib/shared/contracts";

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
  const response = await fetch(`/api/grove${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const result = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !result.success)
    throw new DashboardApiError(
      !result.success ? result.error.code : "unavailable",
      !result.success
        ? result.error.message
        : "Grove could not complete the request",
      response.status,
    );
  return result.data;
}
export type { Notebook as Project } from "@lib/shared/contracts";
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
