import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { GroveError, type Principal } from "@lib/shared/contracts";
import {
  conversationHistoryCursorSchema,
  type ConversationHistoryCursor,
  type ConversationHistoryInput,
  type ConversationHistoryPage,
} from "@lib/shared/conversation-history";
import type { MemoryService } from "./index.ts";

/** Private history search; never loads assistant payloads or invokes a model. */
export async function searchConversationHistory(
  service: MemoryService,
  principal: Principal,
  input: ConversationHistoryInput,
): Promise<ConversationHistoryPage> {
  return service.access(principal, "admin", async ({ trx, account }) => {
    const queryHash = createHash("sha256").update(input.query).digest("hex");
    const signature = (value: string) =>
      createHmac("sha256", service.cursorSecret)
        .update(`history:${value}`)
        .digest();
    let cursor: ConversationHistoryCursor | undefined;
    if (input.after) {
      try {
        const [encoded, mac, extra] = input.after.split(".");
        const expected = signature(encoded),
          supplied = Buffer.from(mac, "base64url");
        if (
          extra ||
          expected.length !== supplied.length ||
          !timingSafeEqual(expected, supplied)
        )
          throw new Error();
        cursor = conversationHistoryCursorSchema.parse(
          JSON.parse(Buffer.from(encoded, "base64url").toString()),
        );
        if (cursor.owner !== account.id || cursor.query !== queryHash)
          throw new Error();
      } catch {
        throw new GroveError(
          "invalid_cursor",
          "History changed. Search again to continue.",
          400,
        );
      }
    }
    const literal = `%${input.query.replace(/[\\%_]/g, "\\$&")}%`;
    const query = trx("conversations as c")
      .select("c.id", "c.title", "c.scope", "c.version", "c.updatedAt")
      .select(
        trx.raw(
          `to_char(c.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at`,
        ),
      )
      .select(
        trx.raw(
          `(SELECT count(*)::integer FROM conversation_turns t WHERE t.conversation_id=c.id) AS turn_count`,
        ),
      )
      .select(
        trx.raw(
          `coalesce(
        (SELECT left(t.question,240) FROM conversation_turns t WHERE t.conversation_id=c.id AND t.question ILIKE ? ORDER BY t.position DESC LIMIT 1),
        (SELECT left(t.question,240) FROM conversation_turns t WHERE t.conversation_id=c.id ORDER BY t.position DESC LIMIT 1), '') AS preview`,
          [literal],
        ),
      )
      .orderBy("c.updatedAt", "desc")
      .orderBy("c.id", "desc")
      .limit(31);
    if (input.query)
      query.where((q) =>
        q
          .whereILike("c.title", literal)
          .orWhereExists(
            trx("conversation_turns as t")
              .select(trx.raw("1"))
              .whereRaw("t.conversation_id=c.id")
              .whereILike("t.question", literal),
          ),
      );
    if (cursor)
      query.whereRaw("(c.updated_at,c.id)<(?::timestamptz,?::uuid)", [
        cursor.at,
        cursor.id,
      ]);
    const rows = await query;
    const last = rows[29];
    const encoded =
      last &&
      Buffer.from(
        JSON.stringify({
          owner: account.id,
          query: queryHash,
          id: last.id,
          at: last.cursorAt,
        }),
      ).toString("base64url");
    return {
      items: rows.slice(0, 30).map(({ cursorAt: _cursor, ...row }) => ({
        ...row,
        updatedAt: new Date(row.updatedAt).toISOString(),
      })),
      nextCursor:
        rows.length > 30
          ? `${encoded}.${signature(encoded!).toString("base64url")}`
          : null,
    };
  });
}
