import { z } from "zod";
import { preferenceKeys, type PreferenceKey } from "./preferences.ts";

export const settingsUpdateSchema = z
  .object({
    ...(Object.fromEntries(
      preferenceKeys.map((key) => [key, z.boolean().optional()]),
    ) as Record<PreferenceKey, z.ZodOptional<z.ZodBoolean>>),
    organizeEnabled: z.boolean().optional(),
    summariesEnabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    {
      message: "Choose at least one preference to update",
    },
  );
