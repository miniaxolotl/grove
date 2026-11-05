import { test } from "node:test";
import assert from "node:assert/strict";
import * as drafts from "../../packages/browser-extension/src/drafts.ts";

const scope = {
  origin: "https://api.usegrove.cloud",
  accountId: "00000000-0000-4000-a000-000000000001",
  connectionId: "00000000-0000-4000-a000-000000000002",
};
const operationId = "00000000-0000-4000-a000-000000000003";
const now = Date.parse("2026-11-05T20:00:00.000Z");

test("browser draft core isolates accounts and preserves exact uncertain save identity", async (t) => {
  assert.equal(typeof drafts.createCaptureDraft, "function");
  assert.equal(typeof drafts.readCaptureDraft, "function");
  assert.equal(typeof drafts.editCaptureDraft, "function");
  assert.equal(typeof drafts.prepareCaptureSave, "function");
  assert.equal(typeof drafts.settleCaptureSave, "function");

  const initial = () =>
    drafts.createCaptureDraft({
      scope,
      text: "First note",
      projectId: null,
      now,
    });

  await t.test(
    "drafts expire after 24 hours and are scoped to exact origin/account/connection",
    () => {
      const draft = initial();
      assert.deepEqual(
        drafts.readCaptureDraft(
          JSON.parse(JSON.stringify(draft)),
          scope,
          now + 1,
        ),
        draft,
      );
      assert.equal(
        drafts.readCaptureDraft(draft, scope, now + 24 * 60 * 60 * 1000),
        null,
      );
      assert.equal(drafts.readCaptureDraft(draft, scope, now - 1), null);
      for (const changed of [
        { ...scope, accountId: operationId },
        { ...scope, connectionId: operationId },
        { ...scope, origin: "https://other.example" },
      ])
        assert.equal(drafts.readCaptureDraft(draft, changed, now + 1), null);
      assert.equal(
        drafts.readCaptureDraft(
          { ...draft, expiresAt: now + 48 * 60 * 60 * 1000 },
          scope,
          now,
        ),
        null,
      );
      assert.equal(
        drafts.readCaptureDraft(
          { ...draft, tokens: "do-not-store" },
          scope,
          now,
        ),
        null,
      );
      assert.equal(
        drafts.readCaptureDraft(
          { ...draft, text: "a".repeat(6001) },
          scope,
          now,
        ),
        null,
      );
      assert.equal(drafts.readCaptureDraft(null, scope, now), null);
      assert.equal(
        drafts.readCaptureDraft(draft, { ...scope, origin: "not a URL" }, now),
        null,
      );
      assert.equal(
        drafts.readCaptureDraft(
          { ...draft, scope: { ...scope, origin: "not a URL" } },
          scope,
          now,
        ),
        null,
      );
      assert.equal(drafts.readCaptureDraft(draft, scope, Number.NaN), null);
      assert.throws(() =>
        drafts.createCaptureDraft({
          scope: { ...scope, origin: "http://example.com" },
          text: "x",
          projectId: null,
          now,
        }),
      );
    },
  );

  await t.test(
    "edits preserve original expiry and do not overwrite an in-flight snapshot",
    () => {
      const prepared = drafts.prepareCaptureSave(
        initial(),
        scope,
        operationId,
        now + 1,
      );
      const edited = drafts.editCaptureDraft(
        prepared,
        scope,
        { text: "Newer text" },
        now + 2,
      );
      assert.equal(edited.text, "Newer text");
      assert.equal(edited.expiresAt, prepared.expiresAt);
      assert.equal(edited.save?.request.content, "First note");
      assert.equal(edited.save?.request.operationId, operationId);
      assert.throws(() =>
        drafts.editCaptureDraft(edited, scope, { text: "x" }, edited.expiresAt),
      );
      assert.throws(() =>
        drafts.editCaptureDraft(
          edited,
          { ...scope, accountId: operationId },
          { text: "x" },
          now + 3,
        ),
      );
    },
  );

  await t.test(
    "uncertain and failed saves replay exact payload and UUID even after newer edits",
    () => {
      for (const status of ["uncertain", "failed"] as const) {
        const prepared = drafts.prepareCaptureSave(
          initial(),
          scope,
          operationId,
          now + 1,
        );
        const settled = drafts.settleCaptureSave(
          prepared,
          scope,
          operationId,
          { status },
          now + 2,
        );
        const edited = drafts.editCaptureDraft(
          settled,
          scope,
          { text: "Do not send yet", projectId: operationId },
          now + 3,
        );
        const retry = drafts.prepareCaptureSave(
          edited,
          scope,
          operationId,
          now + 4,
        );
        assert.equal(retry.save?.status, "saving");
        assert.deepEqual(retry.save?.request, prepared.save?.request);
        assert.equal(retry.text, "Do not send yet");
        assert.throws(
          () =>
            drafts.prepareCaptureSave(edited, scope, scope.accountId, now + 4),
          /reconcile/i,
        );
      }
    },
  );

  await t.test(
    "success requires a receipt for the exact operation and retains newer edits",
    () => {
      const prepared = drafts.prepareCaptureSave(
        initial(),
        scope,
        operationId,
        now + 1,
      );
      const receipt = {
        status: "saved" as const,
        noteId: scope.accountId,
        version: 1,
        indexing: "pending" as const,
      };
      assert.throws(
        () =>
          drafts.settleCaptureSave(
            prepared,
            scope,
            scope.accountId,
            receipt,
            now + 2,
          ),
        /operation/i,
      );
      assert.throws(() =>
        drafts.settleCaptureSave(
          prepared,
          scope,
          operationId,
          { ...receipt, version: 0 },
          now + 2,
        ),
      );
      const edited = drafts.editCaptureDraft(
        prepared,
        scope,
        { text: "Newer text" },
        now + 2,
      );
      const saved = drafts.settleCaptureSave(
        edited,
        scope,
        operationId,
        receipt,
        now + 3,
      );
      assert.equal(saved.save?.status, "saved");
      assert.equal(saved.text, "Newer text");
      assert.equal(saved.save?.request.content, "First note");
      assert.throws(
        () =>
          drafts.settleCaptureSave(
            saved,
            scope,
            operationId,
            { status: "failed" },
            now + 4,
          ),
        /completed/i,
      );
      assert.throws(
        () => drafts.prepareCaptureSave(saved, scope, operationId, now + 4),
        /new operation/i,
      );
      const next = drafts.prepareCaptureSave(
        saved,
        scope,
        scope.connectionId,
        now + 4,
      );
      assert.equal(next.save?.request.content, "Newer text");
    },
  );

  await t.test(
    "empty/overflowing capture and stale timestamps cannot become prepared saves",
    () => {
      const empty = drafts.editCaptureDraft(
        initial(),
        scope,
        { text: "" },
        now + 1,
      );
      assert.throws(
        () => drafts.prepareCaptureSave(empty, scope, operationId, now + 2),
        /empty/i,
      );
      const source = {
        url: "https://example.com/",
        title: "Docs",
        capturedAt: new Date(now).toISOString(),
      };
      const oversized = drafts.editCaptureDraft(
        initial(),
        scope,
        { text: "a".repeat(6000), source },
        now + 1,
      );
      assert.throws(
        () => drafts.prepareCaptureSave(oversized, scope, operationId, now + 2),
        /6000/,
      );
      assert.throws(() =>
        drafts.prepareCaptureSave(initial(), scope, operationId, now - 1),
      );
      assert.throws(() =>
        drafts.prepareCaptureSave(initial(), scope, "guess", now + 1),
      );
    },
  );
});
