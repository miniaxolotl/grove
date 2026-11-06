import { z } from "zod";
import {
  effectiveWritingSettings,
  writingPatchSchema,
  writingSettingsSchema,
} from "./core.ts";
import type { Store } from "../oauth.ts";

const originSchema = z
  .string()
  .max(300)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        url.origin === value &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  });
const legacyRecordSchema = z
  .object({
    version: z.number().int().nonnegative().default(0),
    settings: writingSettingsSchema.default(() =>
      writingSettingsSchema.parse({}),
    ),
    sites: z
      .array(
        z
          .object({
            origin: originSchema,
            enabled: z.boolean(),
            restrictions: writingPatchSchema
              .omit({ words: true, language: true })
              .default({}),
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict();
export const writingBrowserKey = "writing-browser:en";
export function normalizeWritingDomain(value: string): string {
  const input = value.trim().replace(/\.$/, "");
  if (
    !input ||
    input.length > 253 ||
    /[\s/@?#%*\\]/.test(input) ||
    (input.includes(":") && !/^\[[\da-f:]+\]$/i.test(input))
  )
    throw new Error(
      "Enter a domain, such as example.com, without a URL or path.",
    );
  const domain = new URL(`https://${input}`).hostname
    .toLowerCase()
    .replace(/\.$/, "");
  if (
    !domain ||
    domain
      .split(".")
      .some(
        (label) =>
          !label ||
          (!domain.startsWith("[") &&
            !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)),
      )
  )
    throw new Error("Enter a valid domain.");
  return domain;
}
const domainSchema = z
  .string()
  .max(300)
  .transform((value, context) => {
    try {
      return normalizeWritingDomain(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Enter a domain without a URL, port or path.",
      });
      return z.NEVER;
    }
  });
const restrictionsSchema = writingPatchSchema.omit({
  words: true,
  language: true,
});
const recordSchema = z
  .object({
    version: z.number().int().nonnegative().default(0),
    settings: writingSettingsSchema.default(() =>
      writingSettingsSchema.parse({}),
    ),
    sites: z
      .array(
        z
          .object({
            domain: domainSchema,
            enabled: z.boolean(),
            restrictions: restrictionsSchema.default({}),
          })
          .strict(),
      )
      .max(200)
      .default([]),
  })
  .strict();
export const configureWritingSchema = z
  .object({
    patch: writingPatchSchema.omit({ words: true, language: true }).optional(),
    addWord: z.string().max(80).optional(),
    removeWord: z.string().max(80).optional(),
    clearWords: z.boolean().optional(),
    removeDomain: domainSchema.optional(),
    site: z
      .object({
        origin: originSchema.optional(),
        domain: domainSchema.optional(),
        enabled: z.boolean(),
        restrictions: writingPatchSchema
          .omit({ words: true, language: true })
          .optional(),
      })
      .strict()
      .refine((site) => !!site.origin !== !!site.domain, "Choose one domain.")
      .optional(),
  })
  .strict();
export type WritingPreferences = z.infer<typeof recordSchema>;

/** All matching ancestors restrict; a child cannot re-enable a blocked parent. */
export function writingSettingsFor(
  current: WritingPreferences,
  origin: string,
  browserEnabled = true,
) {
  let settings = effectiveWritingSettings(current.settings, {}, browserEnabled);
  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol))
      return effectiveWritingSettings(settings, {}, false);
    const hostname = normalizeWritingDomain(url.hostname);
    for (const site of current.sites)
      if (
        hostname === site.domain ||
        (!/^[\d.]+$/.test(site.domain) &&
          !site.domain.startsWith("[") &&
          hostname.endsWith(`.${site.domain}`))
      )
        settings = effectiveWritingSettings(
          settings,
          site.restrictions,
          site.enabled,
        );
    return settings;
  } catch {
    return effectiveWritingSettings(settings, {}, false);
  }
}

/** Called only inside the trusted background's short serialized state transition. */
export class WritingPreferencesStore {
  constructor(
    private storage: Store,
    private apiOrigin: string,
    private legacyRecords?: () => Promise<Record<string, unknown>>,
  ) {}
  private initializing: Promise<WritingPreferences> | undefined;
  private wordKey(accountId?: string) {
    return `writing-words:${this.apiOrigin}:${accountId ? z.uuid().parse(accountId) : "local"}:en`;
  }
  private async browser() {
    const saved = await this.storage.get(writingBrowserKey);
    if (saved !== undefined) return recordSchema.parse(saved);
    return (this.initializing ??= (async () => {
      let settings = writingSettingsSchema.parse({});
      const sites = new Map<string, WritingPreferences["sites"][number]>();
      for (const [key, value] of Object.entries(
        (await this.legacyRecords?.()) ?? {},
      )) {
        if (!key.startsWith("writing:") || !key.endsWith(":en")) continue;
        const parsed = legacyRecordSchema.safeParse(value);
        if (!parsed.success) continue;
        settings = effectiveWritingSettings(settings, parsed.data.settings);
        for (const site of parsed.data.sites) {
          const domain = normalizeWritingDomain(new URL(site.origin).hostname),
            old = sites.get(domain);
          const restrictions = effectiveWritingSettings(
            writingSettingsSchema.parse({}),
            old?.restrictions,
          );
          const {
            language: _language,
            words: _words,
            ...merged
          } = effectiveWritingSettings(restrictions, site.restrictions);
          sites.set(domain, {
            domain,
            enabled: site.enabled && old?.enabled !== false,
            restrictions: merged,
          });
        }
      }
      if (sites.size > 200) settings.enabled = false;
      const next = recordSchema.parse({
        version: 0,
        settings: { ...settings, words: [] },
        sites: [...sites.values()].slice(0, 200),
      });
      await this.storage.set(writingBrowserKey, next);
      return next;
    })().finally(() => {
      this.initializing = undefined;
    }));
  }
  async read(accountId?: string) {
    const current = await this.browser();
    const legacy = accountId
      ? legacyRecordSchema.safeParse(
          await this.storage.get(
            `writing:${this.apiOrigin}:${z.uuid().parse(accountId)}:en`,
          ),
        )
      : undefined;
    const words =
      (await this.storage.get(this.wordKey(accountId))) ??
      (legacy?.success ? legacy.data.settings.words : []);
    return recordSchema.parse({
      ...current,
      settings: { ...current.settings, words },
    });
  }
  async configure(accountId: string | undefined, raw: unknown) {
    const change = configureWritingSchema.parse(raw),
      previous = await this.read(accountId);
    const settings = {
      ...previous.settings,
      ...change.patch,
      rules: { ...previous.settings.rules, ...change.patch?.rules },
    };
    if (change.clearWords) settings.words = [];
    if (change.removeWord)
      settings.words = settings.words.filter(
        (word) =>
          word.toLocaleLowerCase("en") !==
          change.removeWord!.toLocaleLowerCase("en"),
      );
    if (
      change.addWord &&
      !settings.words.some(
        (word) =>
          word.toLocaleLowerCase("en") ===
          change.addWord!.toLocaleLowerCase("en"),
      )
    )
      settings.words = [...settings.words, change.addWord];
    const domain = change.site
      ? (change.site.domain ??
        normalizeWritingDomain(new URL(change.site.origin!).hostname))
      : undefined;
    const oldSite = previous.sites.find((site) => site.domain === domain);
    const sites = change.site
      ? [
          ...previous.sites.filter((site) => site.domain !== domain),
          {
            ...oldSite,
            domain,
            enabled: change.site.enabled,
            restrictions: {
              ...oldSite?.restrictions,
              ...change.site.restrictions,
              rules: {
                ...oldSite?.restrictions.rules,
                ...change.site.restrictions?.rules,
              },
            },
          },
        ]
      : previous.sites.filter((site) => site.domain !== change.removeDomain);
    const next = recordSchema.parse({
      version: previous.version + 1,
      settings,
      sites,
    });
    if (change.addWord || change.removeWord || change.clearWords)
      await this.storage.set(this.wordKey(accountId), next.settings.words);
    await this.storage.set(writingBrowserKey, {
      ...next,
      settings: { ...next.settings, words: [] },
    });
    return next;
  }
}
