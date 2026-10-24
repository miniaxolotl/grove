import Stripe from "stripe";
import { GroveError } from "@lib/shared/contracts";

/** One product, immutable monthly USD prices. Flag changes affect new sales only. */
export class MonthlyPricing {
  constructor(
    private stripe: Stripe,
    readonly productId: string,
    private dollars: (subject: string) => Promise<unknown>,
  ) {}

  async quote(subject: string) {
    const dollars = await this.dollars(subject);
    const cents = typeof dollars === "number" ? Math.round(dollars * 100) : NaN;
    if (
      !Number.isFinite(cents) ||
      cents < 100 ||
      cents > 1000000 ||
      Math.abs(cents / 100 - (dollars as number)) > 0.0000001
    )
      throw new GroveError(
        "billing_price_invalid",
        "Subscription pricing is unavailable. Try again shortly.",
        503,
      );
    return { interval: "month" as const, amount: cents, currency: "usd" };
  }

  async resolve(subject: string, expectedAmount: number | undefined) {
    const quote = await this.quote(subject);
    if (expectedAmount !== quote.amount)
      throw new GroveError(
        "billing_price_changed",
        "Subscription pricing changed. Refresh billing to review the current price.",
        409,
      );
    const product = await this.stripe.products.retrieve(this.productId);
    if ("deleted" in product || !product.active)
      throw new GroveError(
        "billing_price_invalid",
        "This subscription is unavailable",
        503,
      );
    const key = `grove-pro-${this.productId}-usd-month-${quote.amount}`;
    const existing = await this.stripe.prices.list({
      lookup_keys: [key],
      active: true,
      limit: 1,
    });
    const price =
      existing.data[0] ??
      (await this.stripe.prices.create(
        {
          product: this.productId,
          currency: "usd",
          unit_amount: quote.amount,
          recurring: {
            interval: "month",
            interval_count: 1,
            usage_type: "licensed",
          },
          lookup_key: key,
          metadata: { grovePlan: "pro" },
        },
        { idempotencyKey: key },
      ));
    if (
      price.unit_amount !== quote.amount ||
      price.currency !== "usd" ||
      price.product !== this.productId ||
      !price.active ||
      price.recurring?.interval !== "month" ||
      price.recurring.interval_count !== 1 ||
      price.recurring.usage_type !== "licensed"
    )
      throw new GroveError(
        "billing_price_invalid",
        "Subscription pricing could not be verified",
        503,
      );
    return price;
  }
}
