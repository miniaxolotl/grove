// Synthetic upstream for real Next server-rendered routes. Never imported by the app.
import { createServer } from "node:http";

const ids = {
  root: "00000000-0000-4000-a000-000000000001",
  child: "00000000-0000-4000-a000-000000000002",
  one: "00000000-0000-4000-a000-000000000011",
  two: "00000000-0000-4000-a000-000000000012",
  private: "00000000-0000-4000-a000-000000000099",
};
const content = `# A shared idea\n\nGive good ideas room to grow. **Keep the useful details.**\n\n## Next steps\n\n- [x] Write it down\n- [ ] Try it out\n\n[Private note](/app/memories/${ids.private})\n\n[Another shared note](/app/memories/${ids.two})\n\n![Reference](https://images.example.test/private-pixel)\n\n<script>window.sharedUnsafe = true</script>\n\n[Unsafe](javascript:alert(1))`;
const states = new Map();
const send = (res, status, data) =>
  res
    .writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    })
    .end(JSON.stringify(data));
createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/health") return send(res, 200, { ready: true });
  if (url.pathname.startsWith("/_fixture/") && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    states.set(url.pathname.slice("/_fixture/".length), JSON.parse(body));
    return send(res, 200, { success: true });
  }
  const match = url.pathname.match(
    /^\/public\/shares\/(gsh_[A-Za-z0-9_-]{43})(?:\/(notes|notebooks)\/([0-9a-f-]+))?$/,
  );
  if (!match) return send(res, 404, { success: false });
  const [, token, kind, id] = match;
  const state = states.get(token) || {};
  if (state.revoked || token === `gsh_${"Z".repeat(43)}` || id === ids.private)
    return send(res, 404, { success: false });
  if (state.failed) return send(res, 503, { success: false });
  if (state.malformed)
    return res
      .writeHead(200, { "Content-Type": "application/json" })
      .end("UPSTREAM_PRIVATE_CONTENT_CANARY");
  if (state.invalidSchema)
    return send(res, 200, {
      success: true,
      data: { content: "UPSTREAM_PRIVATE_CONTENT_CANARY" },
    });
  const book = token === `gsh_${"B".repeat(43)}`;
  if (!book && (kind === "notebooks" || (id && id !== ids.one)))
    return send(res, 404, { success: false });
  const note = {
    id: id || ids.one,
    title:
      id === ids.two ? "Another shared note" : state.title || "A shared idea",
    content:
      id === ids.two
        ? "# Another shared note\n\nOne more useful thought."
        : state.content || content,
    updatedAt: "2026-10-21T12:00:00.000Z",
    linkedNoteIds: book ? [ids.two] : [],
  };
  const data = {
    kind: book ? "notebook" : "note",
    root: {
      id: book ? ids.root : ids.one,
      name: book ? "Ideas for autumn" : note.title,
    },
    notebook:
      book && kind !== "notes"
        ? {
            id: id || ids.root,
            name: id === ids.child ? "Reading list" : "Ideas for autumn",
          }
        : null,
    note: !book || kind === "notes" ? note : null,
    notebooks: book && !kind ? [{ id: ids.child, name: "Reading list" }] : [],
    notes:
      book && kind !== "notes" && id !== ids.child
        ? [
            {
              id: url.searchParams.has("cursor") ? ids.two : ids.one,
              title: url.searchParams.has("cursor")
                ? "Another shared note"
                : "A shared idea",
              updatedAt: note.updatedAt,
            },
          ]
        : [],
    nextCursor:
      book && !kind && !url.searchParams.has("cursor") ? "fixture-next" : null,
  };
  send(res, 200, { success: true, data });
}).listen(Number(process.env.SHARING_TEST_PORT || 4378), "127.0.0.1");
