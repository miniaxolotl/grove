"use client";

import { useSyncExternalStore } from "react";

const stores = [
  [
    "firefox",
    "Firefox Add-ons",
    "https://addons.mozilla.org/firefox/addon/grove-private-notes/",
  ],
  [
    "edge",
    "Microsoft Edge Add-ons",
    "https://microsoftedge.microsoft.com/addons/detail/epmjpecpdnjbgbjnjkfjafonocecffmo",
  ],
  [
    "chrome",
    "Chrome Web Store (not yet available)",
    "https://chromewebstore.google.com/detail/ghcndbpbnocjiefnbikdoakajemflcaa",
  ],
] as const;

// Marketing and Settings share the same neutral HTML. Only mark a store when
// the browser identifies itself, not merely its underlying Chromium engine.
function desktopBrowser() {
  const ua = navigator.userAgent;
  const hints = (
    navigator as Navigator & {
      userAgentData?: { mobile: boolean; brands: { brand: string }[] };
    }
  ).userAgentData;
  if (
    hints?.mobile ||
    /Android|Mobile|iPad|iPhone/i.test(ua) ||
    !/Windows NT|Macintosh|X11|CrOS/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  )
    return null;
  if (Number(ua.match(/\bEdg\/(\d+)/)?.[1]) >= 127) return "edge";
  if (Number(ua.match(/\bFirefox\/(\d+)(?:\.\d+)*$/)?.[1]) >= 142)
    return "firefox";
  if (
    Number(ua.match(/\bChrome\/(\d+)/)?.[1]) >= 127 &&
    hints?.brands.some(({ brand }) => brand === "Google Chrome")
  )
    return "chrome";
  return null;
}

const subscribe = () => () => {};
const neutral = () => null;

export function ExtensionStoreLinks() {
  const detected = useSyncExternalStore(subscribe, desktopBrowser, neutral);
  return (
    <ul
      aria-label="Browser extension stores"
      className="flex flex-wrap gap-x-5 text-sm"
    >
      {stores.map(([browser, label, href]) => (
        <li key={href}>
          <a
            className="inline-flex min-h-11 items-center underline underline-offset-4"
            href={href}
          >
            {detected === browser ? (
              <strong>{label} · Your browser</strong>
            ) : (
              label
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}
