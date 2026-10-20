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
export const RedirectToSignIn = () => <Link href="/sign-in">Sign in</Link>;
export const UserButton = () => (
  <button onClick={changeAccount}>Switch account</button>
);
export const useClerk = () => ({
  signOut: async () => {},
  openUserProfile: () => {},
});
