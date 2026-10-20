import { test, expect } from "./telemetry-fixtures";
import { sanitizeError, sanitizeSpan } from "../src/lib/diagnostics-policy";
import { pagePath } from "../src/lib/analytics-policy";

const dashboard = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const copyCommand = "Copy OpenCode connection command";
test("private route identifiers, errors and span attributes never cross the boundary", () => {
  expect(pagePath("/app/projects/PRIVATE_ID?token=PRIVATE")).toBe(
    "/app/projects/:id",
  );
  expect(pagePath("/sign-in/sso-callback/PRIVATE")).toBe("/sign-in");
  const event = sanitizeError({
    type: undefined,
    message: "PRIVATE",
    user: { email: "PRIVATE" },
    request: {
      url: "https://private.test/PRIVATE",
      headers: { Authorization: "PRIVATE" },
    },
    extra: { private: "PRIVATE" },
    exception: {
      values: [
        {
          type: "TypeError",
          value: "PRIVATE",
          stacktrace: {
            frames: [
              {
                filename:
                  "https://usegrove.cloud/_next/static/chunks/app.js?PRIVATE",
                lineno: 9,
                colno: 2,
                context_line: "PRIVATE",
                vars: { token: "PRIVATE" },
              },
            ],
          },
        },
      ],
    },
  });
  expect(JSON.stringify(event)).not.toContain("PRIVATE");
  expect(event.exception?.values?.[0].stacktrace?.frames?.[0]).toMatchObject({
    filename: "https://usegrove.cloud/_next/static/chunks/app.js",
    lineno: 9,
    colno: 2,
  });
  const span = sanitizeSpan({
    name: "/app/projects/PRIVATE?token=PRIVATE",
    trace_id: "random",
    span_id: "random",
    start_timestamp: 1,
    status: "ok",
    is_segment: false,
    attributes: { "sentry.op": "navigation", "http.request.body": "PRIVATE" },
    links: [{ trace_id: "PRIVATE", span_id: "PRIVATE" }],
  });
  expect(span.name).toBe("/app/projects/:id");
  expect(JSON.stringify(span)).not.toContain("PRIVATE");
});

test("real SDKs emit sanitized browser events, errors, streamed spans, logs and metrics", async ({
  page,
  context,
  telemetry,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/install?token=PRIVATE#PRIVATE", {
    referer: "https://example.com/PRIVATE?token=PRIVATE",
  });
  await page.getByRole("button", { name: copyCommand, exact: true }).click();
  await page.evaluate(() => {
    setTimeout(() => {
      throw new TypeError("PRIVATE");
    }, 0);
  });
  await expect
    .poll(
      () =>
        telemetry.events.some(
          (event) => event.event === "install_command_copied",
        ),
      { timeout: 15000 },
    )
    .toBe(true);
  for (const type of ["event", "span", "log", "trace_metric"])
    await expect
      .poll(() => telemetry.sentry.some((item) => item.type === type), {
        timeout: 15000,
      })
      .toBe(true);
  expect(
    telemetry.events.filter((event) => event.event === "$pageview"),
  ).toHaveLength(1);
  expect(
    telemetry.events.find((event) => event.event === "$pageview")?.properties,
  ).toMatchObject({
    $current_url: "https://usegrove.cloud/install",
    $referring_domain: "example.com",
  });
  expect(JSON.stringify(telemetry.events)).not.toContain("PRIVATE");
  expect(JSON.stringify(telemetry.sentry)).not.toContain("PRIVATE");
});
for (const preference of ["stored", "gpc", "dnt"]) {
  test(`${preference} disables both browser providers before initialization`, async ({
    page,
    telemetry,
  }) => {
    await page.addInitScript((preference) => {
      if (preference === "stored")
        localStorage.setItem("grove.telemetry.optout", "true");
      if (preference === "gpc")
        Object.defineProperty(navigator, "globalPrivacyControl", {
          value: true,
        });
      if (preference === "dnt")
        Object.defineProperty(navigator, "doNotTrack", { value: "1" });
    }, preference);
    await page.goto("/");
    await expect(
      page.getByRole("button", {
        name:
          preference === "stored"
            ? "Enable website telemetry"
            : "Telemetry disabled by browser",
      }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Privacy policy", exact: true })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Privacy",
    );
    expect(telemetry.requests).toEqual([]);
  });
}
test("cross-tab opt-out blocks initialized providers and re-enable never revives the old identity", async ({
  page,
  context,
  telemetry,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/install");
  const other = await context.newPage();
  await other.goto("/install");
  await expect
    .poll(
      () =>
        telemetry.events.filter((event) => event.event === "$pageview").length,
      { timeout: 15000 },
    )
    .toBe(2);
  const identity = telemetry.events[0].properties.distinct_id;
  await page.getByRole("button", { name: "Disable website telemetry" }).click();
  await expect(
    other.getByRole("button", { name: "Enable website telemetry" }),
  ).toBeVisible();
  expect(
    await other.evaluate(() =>
      Object.keys(localStorage).filter(
        (key) => key.startsWith("ph_") && key.endsWith("_posthog"),
      ),
    ),
  ).toEqual([]);
  telemetry.requests.length = 0;
  await other.getByRole("button", { name: copyCommand, exact: true }).click();
  await other.evaluate(() => {
    setTimeout(() => {
      throw new Error("PRIVATE");
    }, 0);
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Enable website telemetry" }),
  ).toBeVisible();
  expect(telemetry.requests).toEqual([]);
  await page.getByRole("button", { name: "Enable website telemetry" }).click();
  await expect
    .poll(
      () =>
        telemetry.events.filter((event) => event.event === "$pageview").length,
      { timeout: 15000 },
    )
    .toBe(3);
  expect(
    telemetry.events.filter((event) => event.event === "$pageview").at(-1)
      ?.properties.distinct_id,
  ).not.toBe(identity);
  const before = telemetry.events.length;
  await other.getByRole("button", { name: copyCommand, exact: true }).click();
  await page.getByRole("button", { name: copyCommand, exact: true }).click();
  await expect
    .poll(
      () =>
        telemetry.events
          .slice(before)
          .filter((event) => event.event === "install_command_copied").length,
      { timeout: 15000 },
    )
    .toBe(1);
  expect(
    telemetry.events
      .slice(before)
      .some((event) => event.properties.distinct_id === identity),
  ).toBe(false);
});
test("a failed preference write immediately disables collection in the current tab", async ({
  page,
  context,
  telemetry,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/install");
  await expect
    .poll(() => telemetry.events.some((event) => event.event === "$pageview"), {
      timeout: 15000,
    })
    .toBe(true);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage full", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "Disable website telemetry" }).click();
  await expect(
    page.getByRole("button", { name: "Enable website telemetry" }),
  ).toBeVisible();
  telemetry.requests.length = 0;
  await page.getByRole("button", { name: copyCommand, exact: true }).click();
  await page.getByRole("link", { name: "Privacy policy", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Privacy",
  );
  expect(telemetry.requests).toEqual([]);
});

test("clipboard failure is an outcome, not an installation conversion", async ({
  page,
  telemetry,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("PRIVATE")) },
    }),
  );
  await page.goto("/install");
  await page.getByRole("button", { name: copyCommand, exact: true }).click();
  await expect
    .poll(
      () =>
        telemetry.events.some((event) => event.event === "operation_completed"),
      { timeout: 15000 },
    )
    .toBe(true);
  expect(
    telemetry.events.some((event) => event.event === "install_command_copied"),
  ).toBe(false);
  expect(
    telemetry.events.find((event) => event.event === "operation_completed")
      ?.properties.outcome,
  ).toBe("unavailable");
});
test("provider failures leave navigation and clipboard usable", async ({
  page,
  context,
}) => {
  await context.route(/^https:\/\/[^/]*(posthog\.com|sentry\.io)\//, (route) =>
    route.abort(),
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/install");
  await page.getByRole("button", { name: copyCommand, exact: true }).click();
  await expect(
    page.getByText(`${copyCommand}: copied to clipboard.`, { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test.describe("remote controls and private workspace", () => {
  test.use({ telemetrySettings: { replay: true, variant: "benefit" } });
  test("decoded recordings mask public text, inputs, media and inherited query strings", async ({
    page,
    telemetry,
  }) => {
    await page.goto("/?token=REPLAY_SECRET#REPLAY_SECRET");
    await expect(
      page.getByRole("link", { name: "Give your ideas a home", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        telemetry.requests.some((url) => url.includes("posthog-recorder.js")),
      )
      .toBe(true);
    await page.evaluate(() => {
      const content = document.createElement("section");
      content.innerHTML =
        '<p>REPLAY_SECRET</p><input id="replay-input" value="REPLAY_SECRET"/><div data-private>REPLAY_SECRET</div><img src="/REPLAY_SECRET.png" alt="REPLAY_SECRET" />';
      document.getElementById("main")!.append(content);
    });
    await page.locator("#replay-input").fill("REPLAY_SECRET");
    await expect
      .poll(
        () =>
          JSON.stringify(
            telemetry.events.filter((event) => event.event === "$snapshot"),
          ).includes("replay-input"),
        { timeout: 20000 },
      )
      .toBe(true);
    expect(
      JSON.stringify(
        telemetry.events.filter((event) => event.event === "$snapshot"),
      ),
    ).not.toContain("REPLAY_SECRET");
    const exposures = telemetry.events.filter(
      (event) =>
        event.event === "$feature_flag_called" &&
        event.properties.$feature_flag === "website-cta-copy",
    );
    expect(exposures).toHaveLength(1);
    expect(exposures[0].properties.$feature_flag_response).toBe("benefit");
  });
  test("workspace transitions stop recording, redact request content, and reset identities on account change", async ({
    page,
    telemetry,
  }) => {
    const requestBodies: unknown[] = [];
    await page.route("**/api/grove/**", async (route) => {
      const request = route.request();
      if (request.method() === "PATCH")
        requestBodies.push(request.postDataJSON());
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: [] }),
      });
    });
    await page.goto(`${dashboard}/?telemetry_fixture=1`);
    await expect
      .poll(
        async () => {
          // The recorder loads asynchronously after the flag/config response;
          // keep interacting until it can observe activity and upload a batch.
          await page.getByRole("heading", { name: "Public fixture" }).click();
          return telemetry.events.some((event) => event.event === "$snapshot");
        },
        { timeout: 20000 },
      )
      .toBe(true);
    await page.getByRole("link", { name: "Open workspace fixture" }).click();
    await expect(
      page.getByText("PRIVATE_NOTE_CONTENT", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save note fixture" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /^Saved$/ }),
    ).toBeVisible();
    await expect
      .poll(
        () =>
          telemetry.events.some(
            (event) =>
              event.event === "operation_completed" &&
              event.properties.operation === "memory_write",
          ),
        { timeout: 15000 },
      )
      .toBe(true);
    const first = telemetry.events.find(
      (event) =>
        event.event === "operation_completed" &&
        event.properties.operation === "memory_write",
    )?.properties.distinct_id;
    const snapshotCount = telemetry.events.filter(
      (event) => event.event === "$snapshot",
    ).length;
    await page.getByRole("button", { name: "Switch account" }).last().click();
    await page.getByRole("button", { name: "Save note fixture" }).click();
    await expect
      .poll(
        () =>
          telemetry.events.filter(
            (event) =>
              event.event === "operation_completed" &&
              event.properties.operation === "memory_write",
          ).length,
        { timeout: 15000 },
      )
      .toBe(2);
    expect(
      telemetry.events
        .filter(
          (event) =>
            event.event === "operation_completed" &&
            event.properties.operation === "memory_write",
        )
        .at(-1)?.properties.distinct_id,
    ).not.toBe(first);
    expect(
      telemetry.events.filter((event) => event.event === "$snapshot"),
    ).toHaveLength(snapshotCount);
    expect(requestBodies).toEqual([
      { content: "PRIVATE_NOTE_CONTENT" },
      { content: "PRIVATE_NOTE_CONTENT" },
    ]);
    expect(JSON.stringify(telemetry.events)).not.toContain("PRIVATE");
    expect(JSON.stringify(telemetry.sentry)).not.toContain("PRIVATE");
    expect(
      telemetry.events.filter((event) => event.event === "$pageview").at(-1)
        ?.properties,
    ).toMatchObject({ surface: "workspace", $pathname: "/app/projects/:id" });
  });
});
