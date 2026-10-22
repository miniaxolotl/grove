/** Dependency-free options shared by the owner UI and server deadline calculation. */
export const shareDurations = {
  "1h": { label: "1 hour", seconds: 3600 },
  "4h": { label: "4 hours", seconds: 14400 },
  "1d": { label: "1 day", seconds: 86400 },
  "1w": { label: "1 week", seconds: 604800 },
  "2w": { label: "2 weeks", seconds: 1209600 },
  "1mo": { label: "1 month", seconds: 2592000 },
} as const;
