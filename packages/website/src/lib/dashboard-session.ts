import { createDashboardApi, DashboardApiError } from "./dashboard-api";

/** A refresh outage is retryable by the user, not evidence of an ended session. */
export class SessionRefreshError extends DashboardApiError {
  constructor() {
    super(
      "session_unavailable",
      "We couldn’t reconnect to your session. Please try again.",
      503,
    );
  }
}

function waitFor<T>(
  pending: Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    // Keep observing the SDK promise even after cancellation; it is shared and
    // cannot be cancelled by one departing request.
    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/** One transport per mounted user AND session; credentials never cross owners. */
export function createSessionApi(session: {
  getToken: (options?: { skipCache: boolean }) => Promise<string | null>;
  isCurrent: () => boolean;
}) {
  let refreshed = 0;
  let refreshing: Promise<string> | undefined;
  const check = (signal?: AbortSignal | null) => {
    signal?.throwIfAborted();
    if (!session.isCurrent())
      throw new DOMException("Workspace session changed", "AbortError");
  };
  async function token(skipCache = false) {
    check();
    let value: string | null;
    try {
      value = await waitFor(
        session.getToken(skipCache ? { skipCache: true } : undefined),
        AbortSignal.timeout(10_000),
      );
    } catch {
      check();
      throw new SessionRefreshError();
    }
    check();
    if (!value)
      throw new DashboardApiError(
        "unauthorized",
        "Sign in to Grove to continue",
        401,
      );
    return value;
  }
  function refresh(version: number) {
    if (refreshing) return refreshing;
    // A late 401 from before a completed refresh must use the SDK's current
    // token, rather than force another refresh for the same batch of requests.
    if (version !== refreshed) return token();
    refreshing = token(true)
      .then((value) => {
        refreshed++;
        return value;
      })
      .finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  }
  return createDashboardApi(async (url, init) => {
    const { signal } = init;
    check(signal);
    const version = refreshed;
    const initial = await waitFor(refreshing ?? token(), signal);
    const send = (credential: string) => {
      check(signal);
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${credential}`);
      return fetch(url, { ...init, headers });
    };
    let response = await send(initial);
    check(signal);
    if (response.status === 401) {
      await response.body?.cancel();
      check(signal);
      const renewed = await waitFor(refresh(version), signal);
      // Only an explicit auth rejection is replayed, once. init already contains
      // the serialized original body, including its version and operation ID.
      response = await send(renewed);
      check(signal);
    }
    return response;
  });
}
