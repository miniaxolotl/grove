import { z } from "zod";
import { writingRules } from "./writing-settings.ts";
export { projectWritingText } from "./writing-markdown.ts";

export const proofingScope = "grove-note-editor";
export const proofingVersion = 1;
const consentFields = z.strictObject({
  enabled: z.boolean(),
  automatic: z.boolean(),
});
const validConsent = (value: { enabled: boolean; automatic: boolean }) =>
  value.enabled || !value.automatic;
export const proofingConsentSchema = consentFields.refine(validConsent);
// Availability describes this deployment; it is not client-writable consent.
export const proofingConsentStatusSchema = consentFields
  .extend({ available: z.boolean().optional() })
  .refine(validConsent);
const rule = z.enum(["spelling", ...writingRules]);
export const proofingCheckSchema = z.strictObject({
  text: z
    .string()
    .min(1)
    .max(1500)
    .refine(
      (text) =>
        !/[\r\n]\s*[\r\n]|\u2029/u.test(text.replaceAll("\r\n", "\n")) &&
        !/[\p{Cs}]/u.test(text),
    ),
  revision: z.int().nonnegative(),
  rules: z.record(rule, z.boolean()),
});
export const proofingResultSchema = z.strictObject({
  revision: z.int().nonnegative(),
  complete: z.boolean(),
  issues: z
    .array(
      z.strictObject({
        id: z.string().max(80),
        rule,
        message: rule,
        from: z.int().nonnegative(),
        to: z.int().max(1500),
        original: z.string().max(160),
        replacements: z.array(z.string().max(100)).max(3),
      }),
    )
    .max(50),
});
export type ProofingConsent = z.infer<typeof proofingConsentSchema>;
export type ProofingCheck = z.infer<typeof proofingCheckSchema>;
export type ProofingRules = ProofingCheck["rules"];
export type ProofingResult = z.infer<typeof proofingResultSchema>;
