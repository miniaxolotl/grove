import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import Stripe from "stripe";
import * as application from "../../packages/api/src/app.ts";

test("Vercel amount selects immutable USD monthly Stripe prices and rejects invalid or stale quotes", async () => {
  assert.equal(typeof application.MonthlyPricing, "function");
  let amount: unknown = 5;
  const prices: Record<
    string,
    { id: string; lookup_key: string | null; unit_amount: number }
  > = {};
  let creates = 0;
  const server = createServer(async (req, res) => {
    const buffers: Buffer[] = [];
    for await (const chunk of req) buffers.push(Buffer.from(chunk));
    const fields = new URLSearchParams(Buffer.concat(buffers).toString());
    const url = new URL(req.url!, "http://localhost");
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/v1/products/prod_grove")
      return res.end(JSON.stringify({ id: "prod_grove", active: true }));
    if (req.method === "GET")
      return res.end(
        JSON.stringify({
          data: Object.values(prices).filter(
            (p) => p.lookup_key === url.searchParams.get("lookup_keys[0]"),
          ),
          has_more: false,
        }),
      );
    creates++;
    assert(req.headers["idempotency-key"]);
    assert.equal(fields.get("product"), "prod_grove");
    const price = {
      id: `price_${fields.get("unit_amount")}`,
      product: "prod_grove",
      active: true,
      currency: "usd",
      type: "recurring",
      unit_amount: Number(fields.get("unit_amount")),
      recurring: {
        interval: "month",
        interval_count: 1,
        usage_type: "licensed",
      },
      lookup_key: fields.get("lookup_key"),
    };
    prices[price.id] = price;
    res.end(JSON.stringify(price));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const stripe = new Stripe("sk_test_fixture", {
      host: "127.0.0.1",
      port: (server.address() as { port: number }).port,
      protocol: "http",
      maxNetworkRetries: 0,
    });
    const pricing = new application.MonthlyPricing(
      stripe,
      "prod_grove",
      async () => amount,
    );
    assert.deepEqual(await pricing.quote("user_fixture"), {
      interval: "month",
      amount: 500,
      currency: "usd",
    });
    assert.equal(creates, 0, "displaying pricing must not write to Stripe");
    assert.equal((await pricing.resolve("user_fixture", 500)).id, "price_500");
    assert.equal((await pricing.resolve("user_fixture", 500)).id, "price_500");
    assert.equal(creates, 1);
    amount = 7;
    await assert.rejects(pricing.resolve("user_fixture", 500), {
      code: "billing_price_changed",
    });
    assert.equal((await pricing.resolve("user_fixture", 700)).id, "price_700");
    assert.equal(creates, 2);
    assert.equal(
      (prices.price_500 as { unit_amount: number }).unit_amount,
      500,
    );
    for (amount of [null, undefined, 0, -5, 5.001, "5", Infinity, 10001])
      await assert.rejects(pricing.quote("user_fixture"), {
        code: "billing_price_invalid",
      });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
