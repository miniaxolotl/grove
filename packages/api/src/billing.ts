import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import type { MonthlyPricing } from "./billing-pricing.ts";
import { tenant, type Knex } from "@lib/database";
import { billingUsage, resourceUsage, type MemoryService } from "@lib/memory";
import { GroveError, type Principal } from "@lib/shared/contracts";
import {
  billingLimits,
  billingUnits,
  resourceLimits,
  type ResourceLimits,
  type BillingStatus,
  type PlanLimits,
} from "@lib/shared/billing";

type Options = {
  stripe: Stripe;
  webhookSecret: string;
  siteUrl: string;
  prices: Partial<Record<"month" | "year", string>>;
  pricing?: MonthlyPricing;
  portalConfigurationId?: string;
  enabled: (subject: string) => Promise<boolean>;
  proLimits?: PlanLimits;
  proResources?: ResourceLimits;
};
const ongoing = (status: string) =>
  !["canceled", "incomplete_expired"].includes(status);
const replaceableCheckout = (
  session: Stripe.Checkout.Session,
  subscriptions: Stripe.Subscription[],
) => {
  if (session.status === "expired") return true;
  const id =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  return (
    session.status === "complete" &&
    subscriptions.some(
      (subscription) => subscription.id === id && !ongoing(subscription.status),
    )
  );
};
const destination = (url: string | null, host: string) => {
  if (
    !url ||
    new URL(url).protocol !== "https:" ||
    new URL(url).hostname !== host
  )
    throw new GroveError(
      "billing_unavailable",
      "Billing is temporarily unavailable. Try again.",
      503,
    );
  return { url };
};

export class Billing {
  constructor(
    private service: MemoryService,
    private options: Options,
  ) {}

  private checkoutParameters(
    accountId: string,
    customerId: string,
    priceId: string,
  ): Stripe.Checkout.SessionCreateParams {
    return {
      mode: "subscription",
      customer: customerId,
      client_reference_id: accountId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { groveAccountId: accountId } },
      success_url: `${this.options.siteUrl}/app/settings/billing?checkout=success`,
      cancel_url: `${this.options.siteUrl}/app/settings/billing?checkout=canceled`,
    };
  }

  private async checkoutSession(
    accountId: string,
    row: {
      customerId: string;
      checkoutId: string | null;
      checkoutPrice: string;
      checkoutOperation: string;
    },
  ) {
    const id =
      row.checkoutId ??
      (
        await this.options.stripe.checkout.sessions.create(
          this.checkoutParameters(accountId, row.customerId, row.checkoutPrice),
          { idempotencyKey: `grove-checkout-${row.checkoutOperation}` },
        )
      ).id;
    // Idempotent POST replays are historical responses, not current state. A lost
    // response may now refer to an expired or paid Checkout, including on deletion.
    return this.options.stripe.checkout.sessions.retrieve(id);
  }

  async cancelForDeletion(accountId: string, transaction?: Knex.Transaction) {
    const cancel = async (trx: Knex.Transaction) => {
      const row = await trx("billing_customers").where({ accountId }).first();
      if (!row?.customerId) return;
      if (row.checkoutId || row.checkoutPrice) {
        const session = await this.checkoutSession(accountId, row);
        if (session.status === "open")
          await this.options.stripe.checkout.sessions.expire(session.id);
      }
      const subscriptions = await this.options.stripe.subscriptions.list({
        customer: row.customerId,
        status: "all",
        limit: 100,
      });
      if (subscriptions.has_more)
        throw new GroveError(
          "billing_unavailable",
          "Subscription review is required before deleting this account",
          503,
        );
      for (const subscription of subscriptions.data.filter((s) =>
        ongoing(s.status),
      ))
        await this.options.stripe.subscriptions.cancel(subscription.id);
    };
    if (transaction) await cancel(transaction);
    else await tenant(this.service.db, accountId, cancel);
  }

  private async price(interval: "month" | "year") {
    const id = this.options.prices[interval];
    if (!id)
      throw new GroveError(
        "billing_price_missing",
        "This subscription option is unavailable",
        400,
      );
    const price = await this.options.stripe.prices.retrieve(id);
    if (
      !price.active ||
      price.type !== "recurring" ||
      price.recurring?.interval !== interval ||
      price.recurring.interval_count !== 1 ||
      price.recurring.usage_type !== "licensed" ||
      price.unit_amount === null ||
      price.unit_amount <= 0
    )
      throw new GroveError(
        "billing_price_invalid",
        "This subscription option is unavailable",
        503,
      );
    return price;
  }

  /** Refresh under the customer row lock. Event arrival order never determines access. */
  private async sync(
    trx: Knex.Transaction,
    accountId: string,
    customerId: string,
  ) {
    const subscriptions = await this.options.stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    if (subscriptions.has_more)
      throw new GroveError(
        "billing_unavailable",
        "Subscription review is required",
        503,
      );
    for (const subscription of subscriptions.data) {
      const item = subscription.items.data[0];
      if (!item)
        throw new GroveError(
          "billing_unavailable",
          "Subscription details are unavailable",
          503,
        );
      await trx("billing_subscriptions")
        .insert({
          id: subscription.id,
          accountId,
          customerId,
          priceId:
            subscription.items.data.length === 1 && item.quantity === 1
              ? item.price.id
              : "unsupported",
          status: subscription.status,
          productId:
            subscription.items.data.length === 1 && item.quantity === 1
              ? typeof item.price.product === "string"
                ? item.price.product
                : item.price.product?.id
              : null,
          periodEnd: new Date(item.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        })
        .onConflict("id")
        .merge([
          "priceId",
          "productId",
          "status",
          "periodEnd",
          "cancelAtPeriodEnd",
        ]);
    }
    // A provider-side removal cannot leave an old local entitlement active.
    await trx("billing_subscriptions")
      .where({ accountId, customerId })
      .whereNotIn(
        "id",
        subscriptions.data.map((s) => s.id),
      )
      .update({ status: "canceled", updatedAt: trx.fn.now() });
    return subscriptions.data;
  }

  async status(principal: Principal): Promise<BillingStatus> {
    const enabled = await this.service.access(
      principal,
      "admin",
      ({ account }) => this.options.enabled(account.clerkSubject),
    );
    if (!enabled)
      throw new GroveError("billing_disabled", "Route not found", 404);
    const state = await this.service.access(
      principal,
      "admin",
      async ({ trx }) => {
        const customer = await trx("billing_customers")
          .where({ accountId: principal.accountId })
          .forUpdate()
          .first();
        if (customer?.customerId)
          await this.sync(trx, principal.accountId, customer.customerId);
        const subscription = await trx("billing_subscriptions")
          .where({ accountId: principal.accountId })
          .orderByRaw("(status NOT IN ('canceled','incomplete_expired')) DESC")
          .orderBy("periodEnd", "desc")
          .first();
        return {
          customer: !!customer?.customerId,
          subscription: subscription
            ? {
                status: subscription.status,
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                periodEnd: new Date(subscription.periodEnd).toISOString(),
              }
            : null,
          usage: await billingUsage(this.service.db, trx, principal.accountId),
          resources: await resourceUsage(
            this.service.db,
            trx,
            principal.accountId,
          ),
        };
      },
    );
    const prices = this.options.pricing
      ? [await this.options.pricing.quote(principal.subject)]
      : enabled
        ? await Promise.all(
            (Object.keys(this.options.prices) as ("month" | "year")[]).map(
              async (interval) => {
                const price = await this.price(interval);
                return {
                  interval,
                  amount: price.unit_amount!,
                  currency: price.currency,
                };
              },
            ),
          )
        : [];
    return {
      enabled,
      units: billingUnits,
      ...state,
      prices,
      proLimits: this.options.proLimits ?? billingLimits.pro,
      proResources: this.options.proResources ?? resourceLimits.pro,
    };
  }

  async checkout(
    principal: Principal,
    interval: "month" | "year",
    expectedAmount?: number,
  ): Promise<{ url: string }> {
    await this.service.access(principal, "admin", async ({ account, trx }) => {
      if (!(await this.options.enabled(account.clerkSubject)))
        throw new GroveError(
          "billing_disabled",
          "Subscriptions are not available yet",
          404,
        );
      await trx("billing_customers")
        .insert({ accountId: principal.accountId })
        .onConflict("accountId")
        .ignore();
    });
    if (this.options.pricing && interval !== "month")
      throw new GroveError(
        "billing_price_missing",
        "This subscription option is unavailable",
        400,
      );
    const price = this.options.pricing
      ? await this.options.pricing.resolve(principal.subject, expectedAmount)
      : await this.price(interval);
    // Persist the selected price before the remote write: lost responses must reuse
    // both the idempotency key and its original request parameters.
    await this.service.access(principal, "admin", async ({ trx }) => {
      const row = await trx("billing_customers")
        .where({ accountId: principal.accountId })
        .forUpdate()
        .first();
      if (row.checkoutPrice && row.checkoutPrice !== price.id) {
        const previous = row.customerId
          ? await this.checkoutSession(principal.accountId, row)
          : null;
        const subscriptions =
          previous?.status === "complete"
            ? await this.sync(trx, principal.accountId, row.customerId)
            : [];
        if (previous && !replaceableCheckout(previous, subscriptions))
          throw new GroveError(
            "checkout_pending",
            "Finish or let your existing checkout expire before changing billing frequency",
            409,
          );
        await trx("billing_customers")
          .where({ accountId: principal.accountId })
          .update({
            checkoutId: null,
            checkoutPrice: price.id,
            checkoutOperation: randomUUID(),
          });
      }
      if (!row.checkoutPrice)
        await trx("billing_customers")
          .where({ accountId: principal.accountId })
          .update({ checkoutPrice: price.id });
    });
    // Commit customer mapping independently of Checkout. A lost Checkout response
    // must not erase the only durable customer identity needed for cancellation.
    await this.service.access(principal, "admin", async ({ trx }) => {
      const row = await trx("billing_customers")
        .where({ accountId: principal.accountId })
        .forUpdate()
        .first();
      if (!row.customerId) {
        const customer = await this.options.stripe.customers.create(
          { metadata: { groveAccountId: principal.accountId } },
          { idempotencyKey: `grove-customer-${principal.accountId}` },
        );
        await trx("billing_customers")
          .where({ accountId: principal.accountId })
          .update({ customerId: customer.id });
      }
    });
    const result = await this.service.access(
      principal,
      "admin",
      async ({ trx, account }) => {
        if (!(await this.options.enabled(account.clerkSubject)))
          throw new GroveError(
            "billing_disabled",
            "Subscriptions are not available yet",
            404,
          );
        const row = await trx("billing_customers")
          .where({ accountId: principal.accountId })
          .forUpdate()
          .first();
        if (row.checkoutPrice !== price.id)
          throw new GroveError(
            "checkout_pending",
            "Your checkout changed. Refresh billing and try again.",
            409,
          );
        const customerId = row.customerId as string;
        const subscriptions = await this.sync(
          trx,
          principal.accountId,
          customerId,
        );
        if (subscriptions.some((s) => ongoing(s.status)))
          throw new GroveError(
            "subscription_exists",
            "Manage your existing subscription instead",
            409,
          );
        const session = await this.checkoutSession(principal.accountId, row);
        if (replaceableCheckout(session, subscriptions)) {
          await trx("billing_customers")
            .where({ accountId: principal.accountId })
            .update({
              checkoutId: null,
              checkoutPrice: null,
              checkoutOperation: randomUUID(),
            });
          return null;
        }
        if (session.status !== "open")
          throw new GroveError(
            "checkout_processing",
            "Your subscription is processing. Refresh billing shortly.",
            409,
          );
        await trx("billing_customers")
          .where({ accountId: principal.accountId })
          .update({ checkoutId: session.id });
        return destination(session.url, "checkout.stripe.com");
      },
    );
    return result ?? this.checkout(principal, interval, expectedAmount);
  }

  async portal(principal: Principal) {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      if (!(await this.options.enabled(account.clerkSubject)))
        throw new GroveError("billing_disabled", "Route not found", 404);
      const customer = await trx("billing_customers")
        .where({ accountId: principal.accountId })
        .first();
      if (!customer?.customerId)
        throw new GroveError(
          "billing_customer_missing",
          "No subscription to manage yet",
          404,
        );
      const session = await this.options.stripe.billingPortal.sessions.create({
        customer: customer.customerId,
        ...(this.options.portalConfigurationId
          ? { configuration: this.options.portalConfigurationId }
          : {}),
        return_url: `${this.options.siteUrl}/app/settings/billing`,
      });
      return destination(session.url, "billing.stripe.com");
    });
  }

  async webhook(body: string, signature: string) {
    let event: Stripe.Event;
    try {
      event = this.options.stripe.webhooks.constructEvent(
        body,
        signature,
        this.options.webhookSecret,
      );
    } catch {
      throw new GroveError(
        "invalid_signature",
        "Invalid webhook signature",
        400,
      );
    }
    if (
      !/^(customer\.subscription\.(created|updated|deleted)|checkout\.session\.(completed|async_payment_succeeded|async_payment_failed)|invoice\.(paid|payment_failed))$/.test(
        event.type,
      )
    )
      return;
    const object = event.data.object as {
      customer?: string | { id: string } | null;
    };
    const customerId =
      typeof object.customer === "string"
        ? object.customer
        : object.customer?.id;
    if (!customerId) return;
    const {
      rows: [lookup],
    } = await this.service.db.raw("SELECT grove_billing_account(?) AS id", [
      customerId,
    ]);
    if (!lookup?.id) return;
    await tenant(this.service.db, lookup.id, async (trx) => {
      await trx("billing_customers")
        .where({ accountId: lookup.id })
        .forUpdate()
        .first();
      if (await trx("billing_events").where({ id: event.id }).first()) return;
      const account = await trx("accounts")
        .where({ id: lookup.id })
        .first("status");
      if (account?.status !== "active")
        await this.cancelForDeletion(lookup.id, trx);
      await this.sync(trx, lookup.id, customerId);
      await trx("billing_events").insert({
        id: event.id,
        accountId: lookup.id,
      });
    });
  }
}
