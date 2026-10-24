"use client";

// Capture once per document, before authentication or workspace client navigation.
const initialPath = typeof window === "undefined" ? "" : location.pathname;

export function registrationDocumentReady() {
  if (initialPath !== "/welcome" || typeof document === "undefined")
    return false;
  if (!document.referrer) return true;
  try {
    const referrer = new URL(document.referrer);
    return (
      referrer.origin === location.origin &&
      referrer.pathname === "/welcome" &&
      !referrer.search &&
      !referrer.hash
    );
  } catch {
    return false;
  }
}
