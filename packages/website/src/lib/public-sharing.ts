import "server-only";
import { notFound } from "next/navigation";
import {
  publicReaderStateSchema,
  publicReaderQuerySchema,
  publicNavigationSchema,
  publicNavigationQuerySchema,
  shareTokenSchema,
} from "@lib/shared/sharing";
import { apiOrigin } from "./api-origin";
import type { PublicReaderState } from "@lib/shared/sharing";

export class PublicReadError extends Error {
  constructor(
    public status: number,
    public retryAfter?: string,
  ) {
    super("Could not open this link");
  }
}
async function publicFetch<T>(
  token: string,
  suffix: string,
  schema: { parse: (input: unknown) => T },
  input?: unknown,
  signal?: AbortSignal,
) {
  if (!shareTokenSchema.safeParse(token).success)
    throw new PublicReadError(404);
  try {
    const response = await fetch(
      new URL(
        `/public/shares/${token}${suffix}`,
        apiOrigin(process.env.GROVE_API_URL),
      ),
      {
        cache: "no-store",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
        ...(input
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            }
          : {}),
      },
    );
    if (!response.ok)
      throw new PublicReadError(
        [400, 404, 429].includes(response.status) ? response.status : 503,
        response.headers.get("retry-after") ?? undefined,
      );
    const result = await response.json();
    if (!result.success) throw new Error();
    return schema.parse(result.data);
  } catch (error) {
    if (error instanceof PublicReadError) throw error;
    // Never propagate capability-bearing network/configuration/validation errors.
    throw new PublicReadError(503);
  }
}
export function readPublicNavigation(
  token: string,
  input: unknown,
  signal?: AbortSignal,
) {
  return publicFetch(
    token,
    "/navigation",
    publicNavigationSchema,
    publicNavigationQuerySchema.parse(input),
    signal,
  );
}
export async function readPublicReader(
  token: string,
  kind: "root" | "notes" | "notebooks" = "root",
  id?: string,
  cursor?: string,
  library?: { listingFolder?: string; listingCursors?: (string | null)[] },
  signal?: AbortSignal,
): Promise<PublicReaderState> {
  const input = publicReaderQuerySchema.safeParse({
    kind,
    id,
    cursor,
    ...library,
  });
  if (!input.success) throw new PublicReadError(404);
  return publicFetch(
    token,
    "/reader",
    publicReaderStateSchema,
    input.data,
    signal,
  );
}
export async function initialPublicReader(
  ...args: Parameters<typeof readPublicReader>
) {
  try {
    return await readPublicReader(...args);
  } catch (error) {
    if (error instanceof PublicReadError && error.status === 404) notFound();
    throw error;
  }
}
