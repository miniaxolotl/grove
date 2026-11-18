"use client";

import { useClerk, useSession, useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  proofingConsentSchema,
  type ProofingConsent as Consent,
} from "@lib/shared/proofing-contract";

type Grant = Consent & { signal: AbortSignal };

/** The credential SDK can't cancel its promise; a departed editor must stop waiting. */
function sessionToken(token: Promise<string | null>, signal: AbortSignal) {
  return new Promise<string | null>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    token.then(
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

/** Deliberately outside query caches, diagnostics, refresh/replay and offline queues. */
export function useEnhancedConsent(eligible = true) {
  const clerk = useClerk();
  const { user } = useUser();
  const { session } = useSession();
  const account = user?.id,
    sessionId = session?.id;
  const active =
    eligible && !!account && !!sessionId && session.status === "active";
  const [grant, setGrant] = useState<Grant | null>(null);
  const [failed, setFailed] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const current = useCallback(
    () =>
      active &&
      clerk.user?.id === account &&
      clerk.session?.id === sessionId &&
      clerk.session?.status === "active" &&
      clerk.session.expireAt.getTime() > Date.now(),
    [active, account, sessionId, clerk],
  );
  const request = useCallback(
    async (
      path: "consent" | "check",
      method: string,
      body: unknown,
      signal: AbortSignal,
      mode?: "automatic" | "manual",
    ) => {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
      const verify = () => {
        deadline.throwIfAborted();
        if (!current()) throw new Error("Writing session changed");
      };
      verify();
      if (!(await sessionToken(clerk.session!.getToken(), deadline)))
        throw new Error("Writing session ended");
      verify();
      const res = await fetch(`/api/grove/proofing/${path}`, {
        method,
        signal: deadline,
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Grove-Proofing-Session": sessionId!,
          "X-Grove-Telemetry": "off",
          ...(mode && { "X-Grove-Proofing-Mode": mode }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      verify();
      if (!res.ok) {
        if (path === "check" && (res.status === 401 || res.status === 403)) {
          lifetime.current?.abort();
          setGrant(null);
          setFailed(true);
        }
        throw new Error("Enhanced check unavailable");
      }
      const result = await res.json();
      verify();
      return result;
    },
    [clerk, sessionId, current],
  );

  const invalidate = useCallback(() => {
    lifetime.current?.abort();
    setGrant(null);
    setFailed(false);
  }, []);
  const refresh = useCallback(
    async (next?: Consent) => {
      invalidate();
      if (!current()) return;
      const controller = new AbortController();
      lifetime.current = controller;
      if (next) channel.current?.postMessage("pending");
      try {
        const data = proofingConsentSchema.parse(
          await request(
            "consent",
            next ? "PUT" : "GET",
            next,
            controller.signal,
          ),
        );
        setGrant({
          enabled: data.enabled,
          automatic: data.automatic,
          signal: controller.signal,
        });
        if (next) channel.current?.postMessage("refresh");
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    },
    [current, request, invalidate],
  );
  useEffect(() => {
    if (!active) return;
    const updates =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(`grove-proofing:${account}`);
    channel.current = updates;
    if (updates)
      updates.onmessage = ({ data }) => {
        if (data === "pending") invalidate();
        if (data === "refresh") void refresh();
      };
    const start = setTimeout(() => void refresh(), 0);
    // Clerk can extend a session. Re-read the current deadline on wake; never
    // let an idle tab keep a grant past an expiry without a React render.
    let expiry: ReturnType<typeof setTimeout>;
    const onExpiry = () => {
      const remaining = (clerk.session?.expireAt.getTime() ?? 0) - Date.now();
      if (remaining <= 0 || !current()) invalidate();
      else expiry = setTimeout(onExpiry, Math.min(remaining, 2_147_483_647));
    };
    expiry = setTimeout(
      onExpiry,
      Math.max(
        0,
        Math.min(
          (clerk.session?.expireAt.getTime() ?? 0) - Date.now(),
          2_147_483_647,
        ),
      ),
    );
    return () => {
      clearTimeout(start);
      clearTimeout(expiry);
      lifetime.current?.abort();
      updates?.close();
      channel.current = null;
    };
  }, [account, active, refresh, invalidate, current, clerk]);
  return {
    grant: active && grant && !grant.signal.aborted ? grant : null,
    failed,
    refresh,
    request,
    current,
  };
}
