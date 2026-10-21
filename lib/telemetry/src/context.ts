import { AsyncLocalStorage } from "node:async_hooks";
import type { EventName, Operation, Outcome, Properties } from "./policy.ts";

export type TelemetrySink = {
  capture: (event: EventName, properties?: Properties) => void;
  operation: (
    operation: Operation,
    started: number,
    outcome: Outcome,
    properties?: Properties,
    error?: unknown,
  ) => void;
};
const context = new AsyncLocalStorage<TelemetrySink>();
const inert: TelemetrySink = { capture() {}, operation() {} };
export const currentTelemetry = () => context.getStore() ?? inert;
export const withTelemetry = <T>(sink: TelemetrySink, run: () => T): T =>
  context.run(sink, run);
export const requestCollectionAllowed = (headers: Headers) =>
  headers.get("X-Grove-Telemetry") !== "off" &&
  headers.get("DNT") !== "1" &&
  headers.get("Sec-GPC") !== "1";
export function outcome(error: unknown): Outcome {
  if (error && typeof error === "object") {
    const detail = error as {
      name?: unknown;
      status?: unknown;
      code?: unknown;
    };
    if (detail.name === "AbortError") return "cancelled";
    if (typeof detail.status === "number" || typeof detail.code === "string")
      return "unavailable";
  }
  return "error";
}
