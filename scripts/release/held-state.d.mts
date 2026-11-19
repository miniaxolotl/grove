// Receipt values are intentionally opaque outside the validating JS protocol.
export function receiptHash(value: unknown): string;
export function publication(
  context: object,
  digest: string,
  now: number,
): unknown;
export function recordHeld(
  publication: unknown,
  snapshot: object,
  context: object,
  now: number,
): unknown;
export function recordLifecycle(
  publication: unknown,
  held: unknown,
  snapshot: object,
  context: object,
  now: number,
): unknown;
export function approve(
  publication: unknown,
  lifecycle: unknown,
  reconciliation: object,
  context: object,
  now: number,
  qualify: (binding: {
    source: string;
    held: string;
    authority: string;
    providers: string;
    now: number;
  }) => object,
): unknown;
export function advance(
  publication: unknown,
  parent: unknown,
  phase: string,
  context: object,
  now: number,
  evidence: object,
): unknown;
