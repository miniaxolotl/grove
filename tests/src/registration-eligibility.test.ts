import assert from "node:assert/strict";
import test from "node:test";
import {
  isNewRegistration,
  verifyNewRegistration,
} from "../../packages/website/src/lib/registration-eligibility.ts";

const now = Date.UTC(2026, 9, 24, 18);
const user = {
  id: "user_registration",
  createdAt: now - 30_000,
  banned: false,
  locked: false,
};
const session = {
  id: "sess_registration",
  userId: user.id,
  status: "active",
  createdAt: user.createdAt + 1_000,
  expireAt: now + 60_000,
  actor: null,
};
const identity = { userId: user.id, sessionId: session.id };

test("a recent verified user and initial active session are eligible", () => {
  assert.equal(isNewRegistration(identity, user, session, now), true);
});

test("registration eligibility includes the exact fifteen-minute boundary", () => {
  const createdAt = now - 15 * 60_000;
  assert.equal(
    isNewRegistration(
      identity,
      { ...user, createdAt },
      { ...session, createdAt },
      now,
    ),
    true,
  );
  assert.equal(
    isNewRegistration(
      identity,
      { ...user, createdAt: createdAt - 1 },
      { ...session, createdAt },
      now,
    ),
    false,
  );
});

test("returning users and later sign-in sessions do not become signup conversions", () => {
  assert.equal(
    isNewRegistration(
      identity,
      { ...user, createdAt: now - 86_400_000 },
      session,
      now,
    ),
    false,
  );
  assert.equal(
    isNewRegistration(
      identity,
      user,
      { ...session, createdAt: user.createdAt + 60_001 },
      now,
    ),
    false,
  );
});

test("a session created exactly one minute after the user is eligible", () => {
  const createdAt = now - 120_000;
  assert.equal(
    isNewRegistration(
      identity,
      { ...user, createdAt },
      { ...session, createdAt: createdAt + 60_000 },
      now,
    ),
    true,
  );
});

test("missing, mismatched and impersonated identities fail closed", () => {
  for (const invalid of [
    null,
    { userId: null, sessionId: session.id },
    { userId: user.id, sessionId: null },
    { ...identity, userId: "user_other" },
    { ...identity, sessionId: "sess_other" },
  ]) {
    assert.equal(isNewRegistration(invalid, user, session, now), false);
  }
  assert.equal(isNewRegistration(identity, null, session, now), false);
  assert.equal(isNewRegistration(identity, user, null, now), false);
  assert.equal(
    isNewRegistration(
      identity,
      user,
      { ...session, userId: "user_other" },
      now,
    ),
    false,
  );
  assert.equal(
    isNewRegistration(identity, user, { ...session, actor: {} }, now),
    false,
  );
});

test("unavailable users, inactive sessions and exact expiry are ineligible", () => {
  assert.equal(
    isNewRegistration(identity, { ...user, banned: true }, session, now),
    false,
  );
  assert.equal(
    isNewRegistration(identity, { ...user, locked: true }, session, now),
    false,
  );
  for (const status of ["ended", "revoked", "abandoned", "pending"]) {
    assert.equal(
      isNewRegistration(identity, user, { ...session, status }, now),
      false,
    );
  }
  assert.equal(
    isNewRegistration(identity, user, { ...session, expireAt: now }, now),
    false,
  );
});

test("invalid, future and seconds-based provider timestamps fail closed", () => {
  for (const createdAt of [NaN, Infinity, 0, -1, now / 1000, now + 1]) {
    assert.equal(
      isNewRegistration(identity, { ...user, createdAt }, session, now),
      false,
    );
    assert.equal(
      isNewRegistration(identity, user, { ...session, createdAt }, now),
      false,
    );
  }
  assert.equal(
    isNewRegistration(
      identity,
      user,
      { ...session, createdAt: user.createdAt - 1 },
      now,
    ),
    false,
  );
  assert.equal(isNewRegistration(identity, user, session, NaN), false);
});

test("provider verification reads the bound user/session once in parallel", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const result = verifyNewRegistration(
    identity,
    {
      async getUser(id) {
        calls.push(id);
        await held;
        return user;
      },
      async getSession(id) {
        calls.push(id);
        await held;
        return session;
      },
    },
    now,
  );
  assert.deepEqual(calls, [user.id, session.id]);
  release();
  assert.equal(await result, true);
});

test("provider outages fail closed without blocking ordinary sign-in", async () => {
  assert.equal(
    await verifyNewRegistration(
      identity,
      {
        async getUser() {
          throw new Error("PRIVATE_PROVIDER_RESPONSE");
        },
        async getSession() {
          return session;
        },
      },
      now,
    ),
    false,
  );
  const unexpected = async () => {
    throw new Error("must not read a provider");
  };
  assert.equal(
    await verifyNewRegistration(
      null,
      { getUser: unexpected, getSession: unexpected },
      now,
    ),
    false,
  );
});
