import { useSyncExternalStore } from "react";
import Link from "next/link";
let id = "PRIVATE_ACCOUNT_A";
export function changeAccount() {
  id = id.endsWith("A") ? "PRIVATE_ACCOUNT_B" : "PRIVATE_ACCOUNT_A";
  window.dispatchEvent(new Event("fixture-account"));
}
function subscribe(callback: () => void) {
  window.addEventListener("fixture-account", callback);
  return () => window.removeEventListener("fixture-account", callback);
}
export function useUser() {
  const account = useSyncExternalStore(subscribe, () => id);
  return {
    isLoaded: true,
    isSignedIn: true,
    user: { id: account, firstName: "PRIVATE_NAME" },
  };
}
export const useAuth = () => ({ sessionId: "telemetry-fixture-session" });
export function useSession() {
  useUser();
  return { isLoaded: true, isSignedIn: true, session: clerk.session };
}
export const RedirectToSignIn = () => <Link href="/sign-in">Sign in</Link>;
export const UserButton = () => (
  <button onClick={changeAccount}>Switch account</button>
);
const clerk = {
  get user() {
    return { id };
  },
  session: {
    id: "telemetry-fixture-session",
    getToken: async () => "fixture-token",
  },
  signOut: async () => {},
  openUserProfile: () => {},
};
export const useClerk = () => clerk;
