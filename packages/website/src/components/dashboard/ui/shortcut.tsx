"use client";

import { Fragment, useSyncExternalStore } from "react";

const subscribePlatform = () => () => {};
export function Shortcut({ children }: { children: string }) {
  const mac = useSyncExternalStore(
    subscribePlatform,
    () => /Mac|iPhone|iPad/.test(navigator.platform + navigator.userAgent),
    () => false,
  );
  const label = children
    .replaceAll("Mod", mac ? "⌘" : "Ctrl")
    .replaceAll("Alt", mac ? "Option" : "Alt");
  return (
    <kbd className="shortcut-keys" aria-label={label}>
      {label.split(" ").map((key, index) => (
        <Fragment key={index}>
          {index > 0 && " "}
          <span
            className={
              key === "/" && label.includes(" / ")
                ? "shortcut-separator"
                : undefined
            }
          >
            {key}
          </span>
        </Fragment>
      ))}
    </kbd>
  );
}
