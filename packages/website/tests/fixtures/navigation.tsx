// Match the persistent-layout behavior of Next client navigation in this fixture.
import { useSyncExternalStore, type AnchorHTMLAttributes } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}
export const useLocation = () =>
  useSyncExternalStore(
    subscribe,
    () => window.location.pathname + window.location.search,
  );
export const usePathname = () => useLocation().split("?")[0];
function navigate(href: string, replace = false, scroll = true) {
  window.history[replace ? "replaceState" : "pushState"]({}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
  if (scroll) window.scrollTo(0, 0);
}
export const useRouter = () => ({
  push: (href: string, options?: { scroll?: boolean }) =>
    navigate(href, false, options?.scroll),
  replace: (href: string, options?: { scroll?: boolean }) =>
    navigate(href, true, options?.scroll),
});
export function FixtureLink({
  href = "",
  onClick,
  scroll = true,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { scroll?: boolean }) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.target ||
          props.download
        )
          return;
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin || url.hash) return;
        event.preventDefault();
        navigate(url.pathname + url.search, false, scroll);
      }}
    />
  );
}
