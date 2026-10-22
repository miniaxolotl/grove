import * as CookieConsent from "vanilla-cookieconsent";

export const consentCookie = "cc_cookie";
export const consentEvent = "website:consent";
const revision = 1;
let started = false;
let storageFailed = false;
let ready = false;
let preferencesOpen = false;

export function preferencesVisible() {
  return preferencesOpen;
}

export function consentPending() {
  return ready && !CookieConsent.validConsent();
}
export function acceptCookies() {
  CookieConsent.acceptCategory("all");
}
export function dismissCookies() {
  CookieConsent.acceptCategory([]);
}

export function consentAllowed(category: "analytics" | "advertising") {
  if (typeof window === "undefined" || storageFailed) return false;
  try {
    if (
      navigator.doNotTrack === "1" ||
      (navigator as Navigator & { globalPrivacyControl?: boolean })
        .globalPrivacyControl ||
      new URL(location.href).searchParams.get("tracking") === "off"
    )
      return false;
    // Unavailable storage must not silently enable tracking.
    localStorage.getItem("website.consent.changed");
    // Read the persisted cookie, not the library's per-tab category cache.
    const cookie = CookieConsent.getCookie();
    return (
      cookie.revision === revision &&
      !!cookie.consentId &&
      cookie.expirationTime > Date.now() &&
      cookie.categories?.includes(category) === true
    );
  } catch {
    return false;
  }
}

export function subscribeConsent(callback: () => void) {
  window.addEventListener(consentEvent, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(consentEvent, callback);
    window.removeEventListener("storage", callback);
  };
}

export function showCookieSettings() {
  CookieConsent.showPreferences();
}

export function initializeCookieConsent(
  onChoice: (analytics: boolean) => void,
  onReady: () => void,
) {
  if (started) return;
  started = true;
  const notify = () => {
    onReady();
    window.dispatchEvent(new Event(consentEvent));
  };
  const choose = (analyticsChanged = true) => {
    if (
      CookieConsent.acceptedCategory("analytics") ||
      CookieConsent.acceptedCategory("advertising")
    ) {
      const url = new URL(location.href);
      if (url.searchParams.get("tracking") === "off") {
        url.searchParams.delete("tracking");
        history.replaceState(history.state, "", url.href);
      }
    }
    try {
      localStorage.setItem("website.consent.changed", crypto.randomUUID());
    } catch {
      storageFailed = true;
    }
    if (analyticsChanged) onChoice(consentAllowed("analytics"));
    notify();
  };
  window.addEventListener("storage", (event) => {
    if (event.key === "website.consent.changed") location.reload();
  });
  void CookieConsent.run({
    mode: "opt-in",
    autoShow: false,
    revision,
    hideFromBots: false,
    manageScriptTags: false,
    cookie: { name: consentCookie, expiresAfterDays: 180, sameSite: "Lax" },
    guiOptions: {
      consentModal: {
        layout: "box inline",
        position: "bottom left",
        equalWeightButtons: true,
      },
      preferencesModal: { layout: "box", equalWeightButtons: true },
    },
    onFirstConsent: () => choose(),
    onModalShow: ({ modalName }) => {
      if (modalName === "preferencesModal") {
        preferencesOpen = true;
        window.dispatchEvent(new Event(consentEvent));
      }
    },
    onModalHide: ({ modalName }) => {
      if (modalName === "preferencesModal") {
        preferencesOpen = false;
        window.dispatchEvent(new Event(consentEvent));
        if (!CookieConsent.validConsent())
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLButtonElement>(".cookie-notice-settings")
              ?.focus(),
          );
      }
    },
    onConsent: notify,
    onChange: ({ changedCategories }) =>
      choose(changedCategories.includes("analytics")),
    categories: {
      necessary: { enabled: true, readOnly: true },
      analytics: {
        autoClear: {
          cookies: [{ name: /^ph_/ }, { name: /^_ga/ }, { name: "_gid" }],
        },
      },
      advertising: {
        autoClear: {
          cookies: [
            { name: /^__adroll/ },
            { name: /^__ar_v4/ },
            { name: /^_adroll/ },
          ],
        },
      },
    },
    language: {
      default: "en",
      translations: {
        en: {
          consentModal: {
            title: "Cookies",
            description:
              "Optional cookies help improve this site and personalize ads.",
            acceptAllBtn: "Accept all",
            acceptNecessaryBtn: "No thanks",
            showPreferencesBtn: "Settings",
          },
          preferencesModal: {
            title: "Cookie settings",
            acceptAllBtn: "Accept all",
            acceptNecessaryBtn: "No thanks",
            savePreferencesBtn: "Save choices",
            closeIconLabel: "Close cookie settings",
            sections: [
              {
                title: "Your choice",
                description:
                  "Optional cookies are off until you agree. Change your choices anytime.",
              },
              {
                title: "Essential",
                linkedCategory: "necessary",
                description: "Keep the site working and remember your choices.",
              },
              {
                title: "Analytics",
                linkedCategory: "analytics",
                description: "Understand site usage and performance.",
              },
              {
                title: "Advertising",
                linkedCategory: "advertising",
                description:
                  "Measure campaigns and personalize ads across websites.",
              },
              {
                title: "More information",
                description: 'Read our <a href="/privacy">privacy policy</a>.',
              },
            ],
          },
        },
      },
    },
  })
    .then(() => {
      ready = true;
      window.dispatchEvent(new Event(consentEvent));
    })
    .catch(() => {
      /* A failed consent UI never enables optional tracking. */
    });
}
