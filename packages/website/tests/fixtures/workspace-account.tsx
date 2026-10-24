import { useSyncExternalStore } from "react";
import Link from "next/link";
let identity = { userId: "fixture-user", sessionId: "fixture-session" };
const listeners = new Set<() => void>();
// Test-only account/session switching, never included in production routes.
Object.assign(window, {
  getWorkspaceToken: async (_options?: { skipCache: boolean }) =>
    identity.sessionId
      ? `fixture-token:${identity.userId}:${identity.sessionId}`
      : null,
  switchWorkspaceAccount(userId: string, sessionId: string) {
    identity = { userId, sessionId };
    listeners.forEach((listener) => listener());
  },
});
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useAuth() {
  return useSyncExternalStore(subscribe, () => identity);
}
export function useSession() {
  useAuth();
  return {
    isLoaded: true,
    isSignedIn: !!identity.sessionId,
    session: clerk.session,
  };
}
export function useUser() {
  const { userId } = useAuth();
  return {
    isLoaded: true,
    isSignedIn: !!userId,
    user: { id: userId, firstName: "Alex" },
  };
}
export const RedirectToSignIn = () => <Link href="/sign-in">Sign in</Link>;
export const UserButton = () => (
  <button
    aria-label="Account"
    style={{
      borderRadius: "50%",
      background: "#e3eadf",
      width: 32,
      height: 32,
    }}
  >
    A
  </button>
);
const clerk = {
  get user() {
    return identity.userId ? { id: identity.userId } : null;
  },
  get session() {
    return identity.sessionId
      ? {
          id: identity.sessionId,
          getToken: (options?: { skipCache: boolean }) =>
            (
              window as unknown as {
                getWorkspaceToken: (options?: {
                  skipCache: boolean;
                }) => Promise<string | null>;
              }
            ).getWorkspaceToken(options),
        }
      : null;
  },
  signOut: async () => {},
  openUserProfile: () => {},
};
export const useClerk = () => clerk;
