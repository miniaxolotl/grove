"use client";

import { useSyncExternalStore } from "react";

const stores = [
  [
    "firefox",
    "Add to Firefox",
    "https://addons.mozilla.org/firefox/addon/grove-private-notes/",
  ],
  [
    "edge",
    "Add to Edge",
    "https://microsoftedge.microsoft.com/addons/detail/epmjpecpdnjbgbjnjkfjafonocecffmo",
  ],
  [
    "chrome",
    "Add to Chrome",
    "https://chromewebstore.google.com/detail/ghcndbpbnocjiefnbikdoakajemflcaa",
  ],
] as const;

const setupLabels = {
  firefox: "Add to Firefox",
  edge: "Add to Edge",
  chrome: "Add to Chrome",
};

// Recommend a store for a supported desktop browser, not its underlying engine.
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

export function ExtensionStoreLinks({
  settings = false,
}: { settings?: boolean } = {}) {
  const detected = useSyncExternalStore(subscribe, desktopBrowser, neutral);
  if (settings)
    return (
      <div>
        <ul
          aria-label="Browser extension stores"
          className="flex flex-wrap gap-2"
        >
          {stores.map(([browser, , href]) => (
            <li key={browser}>
              <a
                className={`app-button ${detected === browser ? "primary" : "secondary"}`}
                href={href}
              >
                {setupLabels[browser]}
                {detected === browser && (
                  <span className="sr-only"> (your browser)</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
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
