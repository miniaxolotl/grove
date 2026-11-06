import { z } from "zod";
import { writingPatchSchema, writingSettingsSchema } from "./core.ts";
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
export const configureWritingSchema = z
  .object({
    patch: writingPatchSchema.omit({ words: true, language: true }).optional(),
    addWord: z.string().max(80).optional(),
    removeWord: z.string().max(80).optional(),
    clearWords: z.boolean().optional(),
    site: z
      .object({
        origin: originSchema,
        enabled: z.boolean(),
        restrictions: writingPatchSchema
          .omit({ words: true, language: true })
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type WritingPreferences = z.infer<typeof recordSchema>;

/** Called only inside the trusted background's short serialized state transition. */
export class WritingPreferencesStore {
  constructor(
    private storage: Store,
    private apiOrigin: string,
  ) {}
  private key(accountId: string) {
    return `writing:${this.apiOrigin}:${z.uuid().parse(accountId)}:en`;
  }
  async read(accountId: string) {
    return recordSchema.parse(
      (await this.storage.get(this.key(accountId))) ?? {},
    );
  }
  async configure(accountId: string, raw: unknown) {
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
    const oldSite = previous.sites.find(
      (site) => site.origin === change.site?.origin,
    );
    const sites = change.site
      ? [
          ...previous.sites.filter(
            (site) => site.origin !== change.site!.origin,
          ),
          {
            ...oldSite,
            ...change.site,
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
      : previous.sites;
    const next = recordSchema.parse({
      version: previous.version + 1,
      settings,
      sites,
    });
    await this.storage.set(this.key(accountId), next);
    return next;
  }
}
