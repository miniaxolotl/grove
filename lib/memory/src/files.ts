import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { GroveError, type Principal } from "@lib/shared/contracts";
import {
  fileSearchSchema,
  fileCursorSchema,
  filePositionSchema,
  fileLocationsSchema,
  type FilePage,
  type FileLocations,
  type FileStorage,
} from "@lib/shared/files";
import type { MemoryService } from "./index.ts";

// Read projections under existing tenant RLS, not an alternate source reader.
// No keys, hashes, content or staging bytes leave this module. A conversion may
// reuse a chat original: collapse that alias and merge saved-note locations.
const inventory = `WITH
  notes AS (
    SELECT m.id,m.version,m.project_id,m.status,coalesce(nullif(left(split_part(m.content,chr(10),1),120),''),'Untitled note') AS title,p.name AS project_name
    FROM memories m LEFT JOIN projects p ON p.id=m.project_id AND p.account_id=m.account_id
    WHERE m.deleted_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>now())
  ),
  imports AS (
    SELECT f.id,f.batch_id,f.filename,f.bytes,f.status,f.original_ready,f.object_key,b.created_at,b.expires_at FROM document_import_files f
    JOIN document_import_batches b ON b.account_id=f.account_id AND b.id=f.batch_id
    WHERE (f.original_ready AND EXISTS(SELECT 1 FROM document_import_notes n JOIN notes m ON m.id=n.memory_id WHERE n.file_id=f.id))
      OR (NOT f.original_ready AND f.staging IS NOT NULL AND b.expires_at>now() AND b.status IN ('uploading','preparing','ready','applying'))
  ),
  chats AS (
    SELECT d.id,d.conversation_id,d.filename,d.bytes,d.status,d.accepted,d.object_key,d.removed_at,d.created_at,d.expires_at,c.title AS chat_title,c.id AS live_chat FROM conversation_documents d
    LEFT JOIN conversations c ON c.account_id=d.account_id AND c.id=d.conversation_id AND c.deleted_at IS NULL
    WHERE (d.removed_at IS NULL AND c.id IS NOT NULL AND (d.accepted OR (d.staging IS NOT NULL AND d.expires_at>now())))
      OR (d.accepted AND (EXISTS(SELECT 1 FROM conversation_document_bindings b JOIN notes m ON m.id=b.memory_id WHERE b.document_id=d.id)
        OR EXISTS(SELECT 1 FROM imports f WHERE f.object_key=d.object_key AND f.original_ready)))
  ),
  media AS (
    SELECT o.id,o.memory_id,o.mime,o.bytes,o.status,o.created_at FROM media_objects o JOIN notes m ON m.id=o.memory_id
  ),
  files AS (
    SELECT 'chat'::text AS source,d.id,'document'::text AS kind,d.filename,d.bytes,d.status,
      CASE WHEN d.accepted THEN 'retained' ELSE 'staged' END AS state,d.created_at,CASE WHEN d.accepted THEN NULL ELSE d.expires_at END AS expires_at FROM chats d
    UNION ALL
    SELECT 'import',f.id,'document',f.filename,f.bytes,f.status,CASE WHEN f.original_ready THEN 'retained' ELSE 'staged' END,f.created_at,
      CASE WHEN f.original_ready THEN NULL ELSE f.expires_at END FROM imports f
      WHERE NOT EXISTS(SELECT 1 FROM chats d WHERE d.accepted AND d.object_key=f.object_key)
    UNION ALL
    SELECT 'media',o.id,CASE WHEN o.mime='audio/wav' THEN 'recording' ELSE 'image' END,
      CASE WHEN o.mime='audio/wav' THEN 'Recording ' ELSE 'Image ' END||left(o.id::text,8)||'.'||CASE o.mime WHEN 'audio/wav' THEN 'wav' WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/webp' THEN 'webp' ELSE 'png' END,
      o.bytes,o.status,CASE WHEN o.status='ready' THEN 'retained' ELSE 'reserved' END,o.created_at,NULL::timestamptz FROM media o
  ),
  raw_locations AS (
    SELECT 'chat'::text AS source,d.id,'chat:'||d.conversation_id::text AS key,coalesce(nullif(d.chat_title,''),'Untitled chat') AS title,
      NULL::uuid AS memory_id,NULL::uuid AS project_id,NULL::text AS project_name,d.conversation_id,NULL::uuid AS batch_id,
      false AS archived,false AS historical,CASE WHEN d.accepted THEN '/conversations/'||d.conversation_id||'/documents/'||d.id||'/original' ELSE NULL END AS download_path
      FROM chats d WHERE d.removed_at IS NULL AND d.live_chat IS NOT NULL
    UNION ALL
    SELECT 'chat',d.id,'note:'||m.id::text,m.title,m.id,m.project_id,m.project_name,NULL,NULL,m.status='archived',false,
      '/memories/'||m.id||'/document-sources/'||d.id||'/original'
      FROM chats d JOIN conversation_document_bindings b ON b.document_id=d.id JOIN notes m ON m.id=b.memory_id WHERE d.accepted
    UNION ALL
    SELECT CASE WHEN d.id IS NULL THEN 'import' ELSE 'chat' END,coalesce(d.id,f.id),'note:'||m.id::text,m.title,m.id,m.project_id,m.project_name,NULL,NULL,m.status='archived',false,
      '/import-batches/'||f.batch_id||'/files/'||f.id||'/original'
      FROM imports f LEFT JOIN chats d ON d.accepted AND d.object_key=f.object_key
      JOIN document_import_notes n ON n.file_id=f.id JOIN notes m ON m.id=n.memory_id WHERE f.original_ready
    UNION ALL
    SELECT 'import',f.id,'import:'||f.batch_id::text,'Unconfirmed import',NULL,NULL,NULL,NULL,f.batch_id,false,false,NULL
      FROM imports f WHERE NOT f.original_ready
    UNION ALL
    SELECT 'media',o.id,'note:'||m.id::text,m.title,m.id,m.project_id,m.project_name,NULL,NULL,m.status='archived',
      coalesce(b.version<>m.version,false),CASE WHEN o.status='ready' AND b.version IS NOT NULL THEN '/memories/'||m.id||'/media/'||o.id||chr(63)||'version='||b.version ELSE NULL END
      FROM media o JOIN notes m ON m.id=o.memory_id
      LEFT JOIN LATERAL(SELECT max(version) AS version FROM media_revision_bindings b WHERE b.media_id=o.id AND b.memory_id=m.id) b ON true
  ),
  locations AS (
    SELECT DISTINCT ON(source,id,key) * FROM raw_locations ORDER BY source,id,key,download_path NULLS LAST
  )`;
const unavailable = () =>
  new GroveError("not_found", "File is unavailable", 404);

export class Files {
  constructor(private service: MemoryService) {}
  private signature(encoded: string) {
    return createHmac("sha256", this.service.cursorSecret)
      .update(`files:${encoded}`)
      .digest();
  }
  private cursor(after: string | undefined, owner: string, binding: string) {
    if (!after) return "";
    try {
      const [encoded, mac, extra] = after.split("."),
        expected = this.signature(encoded),
        supplied = Buffer.from(mac, "base64url");
      if (
        extra ||
        expected.length !== supplied.length ||
        !timingSafeEqual(expected, supplied)
      )
        throw new Error();
      const cursor = fileCursorSchema.parse(
        JSON.parse(Buffer.from(encoded, "base64url").toString()),
      );
      if (cursor.owner !== owner || cursor.binding !== binding)
        throw new Error();
      return cursor.key;
    } catch {
      throw new GroveError(
        "invalid_cursor",
        "Files changed. Start again to continue.",
        400,
      );
    }
  }
  private next(owner: string, binding: string, key: string) {
    const encoded = Buffer.from(
      JSON.stringify({ owner, binding, key }),
    ).toString("base64url");
    return `${encoded}.${this.signature(encoded).toString("base64url")}`;
  }
  async search(principal: Principal, raw: unknown): Promise<FilePage> {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const { after, ...input } = fileSearchSchema.parse(raw);
      const binding = createHash("sha256")
          .update(JSON.stringify(input))
          .digest("hex"),
        cursor = this.cursor(after, account.id, binding);
      const filters: string[] = [],
        values: (string | number)[] = [];
      const order =
        input.sort === "name"
          ? 'lower(f.filename) COLLATE "C"'
          : input.sort === "size"
            ? "f.bytes"
            : "f.created_at";
      const ascending = input.sort === "name";
      const sortValue =
        input.sort === "name"
          ? "lower(f.filename)"
          : input.sort === "size"
            ? "f.bytes::text"
            : `to_char(f.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
      if (cursor) {
        const position = filePositionSchema.parse(JSON.parse(cursor));
        const cast =
          input.sort === "name"
            ? '? COLLATE "C"'
            : input.sort === "size"
              ? "?::integer"
              : "?::timestamptz";
        filters.push(
          `(${order}${ascending ? ">" : "<"}${cast} OR (${order}=${cast} AND (f.source,f.id)>(?,?::uuid)))`,
        );
        values.push(
          position.value,
          position.value,
          position.source,
          position.id,
        );
      }
      if (input.query) {
        filters.push(
          "(f.filename ILIKE ? OR EXISTS(SELECT 1 FROM locations l WHERE l.source=f.source AND l.id=f.id AND (l.title ILIKE ? OR l.project_name ILIKE ?)))",
        );
        const literal = `%${input.query.replace(/[\\%_]/g, "\\$&")}%`;
        values.push(literal, literal, literal);
      }
      if (input.kind) {
        filters.push("f.kind=?");
        values.push(input.kind);
      }
      if (input.view === "temporary") filters.push("f.state='staged'");
      if (input.view === "attention") filters.push("f.status='failed'");
      if (input.view === "chat_only")
        filters.push(
          "EXISTS(SELECT 1 FROM locations l WHERE l.source=f.source AND l.id=f.id AND l.conversation_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM locations l WHERE l.source=f.source AND l.id=f.id AND l.memory_id IS NOT NULL)",
        );
      if (input.view === "unfiled")
        filters.push(
          "EXISTS(SELECT 1 FROM locations l WHERE l.source=f.source AND l.id=f.id AND l.memory_id IS NOT NULL AND l.project_id IS NULL)",
        );
      if (input.view === "history")
        filters.push(
          "EXISTS(SELECT 1 FROM locations l WHERE l.source=f.source AND l.id=f.id AND l.historical)",
        );
      for (const [field, value] of [
        ["memory_id", input.memoryId],
        ["project_id", input.projectId],
        ["conversation_id", input.conversationId],
      ]) {
        if (value) {
          filters.push(
            `EXISTS(SELECT 1 FROM locations l WHERE l.source=f.source AND l.id=f.id AND l.${field}=?::uuid)`,
          );
          values.push(value);
        }
      }
      const { rows } = await trx.raw(
        `${inventory} SELECT f.id,f.source,f.kind,f.filename,f.bytes,f.status,f.state,${sortValue} AS "sortValue",
        f.created_at AS "createdAt",f.expires_at AS "expiresAt",(SELECT count(*)::integer FROM locations l WHERE l.source=f.source AND l.id=f.id) AS "locationCount"
        FROM files f WHERE ${filters.length ? filters.join(" AND ") : "true"} ORDER BY ${order} ${ascending ? "ASC" : "DESC"},f.source,f.id LIMIT 31`,
        values,
      );
      return {
        items: rows
          .slice(0, 30)
          .map(
            ({
              sortValue: _sort,
              ...row
            }: FilePage["items"][number] & { sortValue: string }) => ({
              ...row,
              createdAt: new Date(row.createdAt).toISOString(),
              expiresAt: row.expiresAt
                ? new Date(row.expiresAt).toISOString()
                : null,
            }),
          ),
        nextCursor:
          rows.length > 30
            ? this.next(
                account.id,
                binding,
                JSON.stringify({
                  value: rows[29].sortValue,
                  source: rows[29].source,
                  id: rows[29].id,
                }),
              )
            : null,
      };
    });
  }
  async locations(principal: Principal, raw: unknown): Promise<FileLocations> {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const { after, source, id } = fileLocationsSchema.parse(raw),
        binding = `locations:${source}:${id}`,
        cursor = this.cursor(after, account.id, binding);
      const { rows: exists } = await trx.raw(
        `${inventory} SELECT 1 FROM files WHERE source=? AND id=?`,
        [source, id],
      );
      if (!exists.length) throw unavailable();
      const { rows } = await trx.raw(
        `${inventory} SELECT key,title,memory_id AS "memoryId",project_id AS "projectId",project_name AS "projectName",conversation_id AS "conversationId",batch_id AS "batchId",archived,historical,download_path AS "downloadPath"
        FROM locations WHERE source=? AND id=? AND key>? ORDER BY key LIMIT 31`,
        [source, id, cursor],
      );
      return {
        items: rows.slice(0, 30),
        nextCursor:
          rows.length > 30
            ? this.next(account.id, binding, rows[29].key)
            : null,
      };
    });
  }
  async storage(principal: Principal): Promise<FileStorage> {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const quota = await trx("accounts")
        .where({ id: account.id })
        .first("mediaBytes", "mediaAttempts");
      const { rows } = await trx.raw(`${inventory} SELECT
        coalesce((SELECT sum(octet_length(staging)) FROM conversation_documents),0)+coalesce((SELECT sum(octet_length(staging)) FROM document_import_files),0) AS staging,
        coalesce(sum(bytes) FILTER(WHERE state='retained' AND EXISTS(SELECT 1 FROM locations l WHERE l.source=files.source AND l.id=files.id AND l.download_path IS NOT NULL)),0) AS visible,count(*)::integer AS files FROM files`);
      return {
        budgetBytes: Number(quota.mediaBytes),
        byteLimit: 1024 * 1024 * 1024,
        attempts: quota.mediaAttempts,
        attemptLimit: 1000,
        stagingBytes: Number(rows[0].staging),
        stagingLimit: 75 * 1024 * 1024,
        visibleBytes: Number(rows[0].visible),
        fileCount: rows[0].files,
      };
    });
  }
}
