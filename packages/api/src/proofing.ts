import { z } from "zod";
import { GroveError } from "@lib/shared/contracts";
import {
  projectWritingText,
  type ProofingCheck,
  type ProofingResult,
} from "@lib/shared/proofing-contract";

// Pin individual LT 6.8 IDs, not categories, descriptions or user-supplied IDs.
const families = new Map<string, keyof ProofingCheck["rules"]>([
  ["YOUR_YOU_2", "confusion"],
  ["WHO_S_NN_VB", "confusion"],
  ["ITS_TO_IT_S", "confusion"],
  ["IT_IS", "confusion"],
  ["FEWER_LESS", "confusion"],
  ["BETWEEN_YOU_AND_I", "agreement"],
  ["MORFOLOGIK_RULE_EN_US", "spelling"],
]);
const upstreamSchema = z.object({
  warnings: z.object({ incompleteResults: z.boolean() }).optional(),
  matches: z.array(
    z.object({
      rule: z.object({ id: z.string() }),
      offset: z.int(),
      length: z.int(),
      replacements: z.array(z.object({ value: z.string() })),
    }),
  ),
});
const unavailable = () =>
  new GroveError(
    "proofing_unavailable",
    "Enhanced grammar is temporarily unavailable.",
    503,
  );
const maxBytes = 64 * 1024;
async function upstreamJson(response: Response) {
  if (
    !response.ok ||
    !/^application\/json(?:\s*;|$)/i.test(
      response.headers.get("content-type") ?? "",
    ) ||
    Number(response.headers.get("content-length")) > maxBytes ||
    !response.body
  )
    throw unavailable();
  const reader = response.body.getReader();
  let size = 0,
    json = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw unavailable();
      json += decoder.decode(value, { stream: true });
    }
    return upstreamSchema.parse(JSON.parse(json + decoder.decode()));
  } finally {
    reader.releaseLock();
  }
}

/** Configuration is the only source of the origin. Malformed or absent config
 * disables the optional adapter without taking down notes or database readiness. */
export function proofingEndpoint(origin?: string) {
  if (origin && URL.canParse(origin)) {
    const url = new URL(origin);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      ["languagetool", "localhost", "127.0.0.1", "[::1]"].includes(
        url.hostname,
      ) &&
      !url.username &&
      !url.password &&
      url.href === url.origin + "/"
    )
      return new URL("/v2/check", url);
  }
}

export function languageTool(origin?: string) {
  const endpoint = proofingEndpoint(origin);
  return async (
    input: ProofingCheck,
    signal: AbortSignal,
  ): Promise<ProofingResult> => {
    signal.throwIfAborted();
    const ids = [...families]
      .filter(([, family]) => input.rules[family])
      .map(([id]) => id);
    const projection = projectWritingText(input.text);
    const result: ProofingResult = {
      revision: input.revision,
      complete: true,
      issues: [],
    };
    if (!ids.length || !projection.text.trim()) return result;
    if (!endpoint) throw unavailable();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, signal]),
        headers: { accept: "application/json" },
        body: new URLSearchParams({
          text: projection.text,
          language: "en-US",
          level: "default",
          enabledOnly: "true",
          enabledRules: ids.join(","),
        }),
      });
      const data = await upstreamJson(response);
      result.complete = !data.warnings?.incompleteResults;
      for (const match of data.matches) {
        const rule = families.get(match.rule.id),
          from = match.offset,
          to = from + match.length;
        if (
          !rule ||
          !input.rules[rule] ||
          from < 0 ||
          match.length < 1 ||
          match.length > 160 ||
          to > input.text.length ||
          projection.protectedSpans.some(
            (span) => from < span.to && to > span.from,
          )
        )
          continue;
        const original = input.text.slice(from, to);
        // A cut through a surrogate pair is a lone surrogate in the slice.
        if (!original.trim() || /\p{Cs}/u.test(original)) continue;
        const replacements = [
          ...new Set(
            match.replacements
              .map((r) => r.value)
              .filter(
                (v) =>
                  v.length <= 100 && !/[\p{C}\r\n]/u.test(v) && v !== original,
              ),
          ),
        ].slice(0, 3);
        // 6.8 ranks “It's” before “it's” mid-clause. Promote only an offered
        // lowercase contraction, never when the original begins a sentence.
        if (
          match.rule.id === "ITS_TO_IT_S" &&
          original === "its" &&
          /[\p{L},;:]\s+$/u.test(projection.text.slice(0, from))
        )
          replacements.sort(
            (a, b) => Number(b === "it's") - Number(a === "it's"),
          );
        if (!replacements.length) continue;
        if (result.issues.length === 50) {
          result.complete = false;
          break;
        }
        result.issues.push({
          id: `${rule}:${from}:${to}`,
          rule,
          message: rule,
          from,
          to,
          original,
          replacements,
        });
      }
      return result;
    } catch {
      throw unavailable();
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
