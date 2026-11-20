// Catalog/snapshot mechanism carried forward from inspect/window-postgres.
// Deliberately retains full function, grant, RLS, type/operator and row coverage.
import { need, hashJSON, sha } from "./operator-control.mjs";
import { Buffer } from "node:buffer";
export const queries = {
  history: `SELECT id,name,batch,migration_time FROM public.knex_migrations ORDER BY id`,
  roles: `SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname`,
  memberships: `SELECT parent.rolname AS parent,child.rolname AS member,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles child ON child.oid=m.member ORDER BY 1,2`,
  tables: `SELECT n.nspname,c.relname,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S') ORDER BY c.relname`,
  columns: `SELECT table_name,column_name,ordinal_position,data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`,
  functions: `SELECT p.oid::regprocedure::text AS signature,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text,md5(pg_get_functiondef(p.oid)) AS definition_md5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'grove_%' ORDER BY 1`,
  policies: `SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`,
  extensions: `SELECT extname,extversion FROM pg_extension ORDER BY extname`,
};
export const extraQueries = {
  semanticColumns: `SELECT c.relname,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,a.attstorage,a.attcompression,a.attacl::text,a.attoptions,a.attfdwoptions,coll.collname AS collation,pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum LEFT JOIN pg_collation coll ON coll.oid=a.attcollation WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,
  indexes: `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`,
  constraints: `SELECT c.relname,con.conname,con.contype,con.convalidated,con.condeferrable,con.condeferred,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,con.conname`,
  triggers: `SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
  defaultPrivileges: `SELECT pg_get_userbyid(defaclrole) AS role,n.nspname,defaclobjtype,defaclacl::text FROM pg_default_acl a LEFT JOIN pg_namespace n ON n.oid=a.defaclnamespace ORDER BY role,n.nspname,defaclobjtype`,
  effectiveTableAcls: `SELECT c.relname,ARRAY(SELECT acl::text FROM unnest(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) acl ORDER BY acl::text COLLATE "C") AS effective_acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S') ORDER BY c.relname`,
  database: `SELECT pg_get_userbyid(datdba) AS owner,encoding,datcollate,datctype,datlocprovider,datlocale,ARRAY(SELECT acl::text FROM unnest(coalesce(datacl,acldefault('d',datdba))) acl ORDER BY acl::text COLLATE "C") AS effective_acl FROM pg_database WHERE datname=current_database()`,
  schema: `SELECT nspname,pg_get_userbyid(nspowner) AS owner,ARRAY(SELECT acl::text FROM unnest(coalesce(nspacl,acldefault('n',nspowner))) acl ORDER BY acl::text COLLATE "C") AS effective_acl FROM pg_namespace WHERE nspname='public'`,
  extensionOwners: `SELECT extname,pg_get_userbyid(extowner) AS owner FROM pg_extension ORDER BY extname`,
  allPublicFunctions: `SELECT p.oid::regprocedure::text AS signature,pg_get_userbyid(p.proowner) AS owner,p.prokind,p.prosecdef,p.proleakproof,p.provolatile,p.proparallel,p.proconfig,p.proacl::text,md5(pg_get_functiondef(p.oid)) AS definition_md5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p','w') ORDER BY 1`,
  types: `SELECT t.typname,pg_get_userbyid(t.typowner) AS owner,t.typtype,t.typcategory,t.typacl::text,t.typnotnull,t.typdefault FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' ORDER BY t.typname`,
  operators: `SELECT o.oid::regoperator::text AS signature,pg_get_userbyid(o.oprowner) AS owner,o.oprcanmerge,o.oprcanhash,o.oprcode::regprocedure::text AS code FROM pg_operator o JOIN pg_namespace n ON n.oid=o.oprnamespace WHERE n.nspname='public' ORDER BY 1`,
  operatorClasses: `SELECT o.opcname AS name,a.amname AS method,pg_get_userbyid(o.opcowner) AS owner,o.opcdefault,o.opcintype::regtype::text AS input_type FROM pg_opclass o JOIN pg_namespace n ON n.oid=o.opcnamespace JOIN pg_am a ON a.oid=o.opcmethod WHERE n.nspname='public' ORDER BY o.opcname,a.amname`,
  operatorFamilies: `SELECT o.opfname AS name,a.amname AS method,pg_get_userbyid(o.opfowner) AS owner FROM pg_opfamily o JOIN pg_namespace n ON n.oid=o.opfnamespace JOIN pg_am a ON a.oid=o.opfmethod WHERE n.nspname='public' ORDER BY o.opfname,a.amname`,
  aggregates: `SELECT p.oid::regprocedure::text AS signature,pg_get_userbyid(p.proowner) AS owner,p.proacl::text,a.aggtransfn::regprocedure::text AS transition,a.aggfinalfn::regprocedure::text AS final,a.aggcombinefn::regprocedure::text AS combine,a.aggtranstype::regtype::text AS transition_type,a.agginitval FROM pg_aggregate a JOIN pg_proc p ON p.oid=a.aggfnoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1`,
};
export const mediaSql = `SELECT kind,object_key,sha256,bytes FROM (
  SELECT 'media' AS kind,object_key,sha256,bytes FROM public.media_objects WHERE status='ready'
  UNION ALL SELECT 'import',object_key,sha256,bytes FROM public.document_import_files WHERE original_ready
  UNION ALL SELECT 'conversation',object_key,sha256,bytes FROM public.conversation_documents WHERE object_key IS NOT NULL
  ) inventory ORDER BY kind,object_key,sha256,bytes`;
export const query = (db, sql) =>
  typeof db.raw === "function" ? db.raw(sql) : db.query(sql);
export const quote = (value) => {
  need(/^[a-z][a-z0-9_]*$/.test(value), "IDENTIFIER_REJECTED");
  return '"' + value + '"';
};
const json = (value) => JSON.parse(JSON.stringify(value));
export async function readSnapshot(db, projection) {
  const metadata = {},
    extras = {},
    rowsets = {};
  for (const [key, sql] of Object.entries(queries))
    metadata[key] = json((await query(db, sql)).rows);
  for (const [key, sql] of Object.entries(extraQueries))
    extras[key] = json((await query(db, sql)).rows);
  const tables = (
    await query(
      db,
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows.map((r) => r.tablename);
  const columns =
    projection ?? metadata.columns.filter((c) => tables.includes(c.table_name));
  for (const table of [...new Set(columns.map((c) => c.table_name))].sort()) {
    const names = columns
      .filter((c) => c.table_name === table)
      .map((c) => quote(c.column_name))
      .join(",");
    rowsets[table] = (
      await query(
        db,
        `SELECT count(*)::integer AS count,md5(coalesce(string_agg(h,',' ORDER BY h),'')) AS row_fingerprint FROM (SELECT md5(row_to_json(t)::text) h FROM (SELECT ${names} FROM public.${quote(table)}) t) s`,
      )
    ).rows[0];
  }
  const media = (await query(db, mediaSql)).rows;
  return {
    metadata,
    extras,
    tables,
    columns,
    rowsets,
    mediaHash: hashJSON(media),
    mediaCount: media.length,
    catalogHash: hashJSON({
      metadata: { ...metadata, history: undefined },
      extras,
    }),
    rowsetsHash: hashJSON(rowsets),
  };
}
export function semanticRows(key, rows) {
  if (key === "tables") return rows.map(({ relacl: _relacl, ...r }) => r);
  if (key === "semanticColumns")
    return rows.map(({ attoptions, ...r }) => ({
      ...r,
      attoptions: (attoptions ?? [])
        .filter((o) => !/^pg_attver=\d+$/.test(o))
        .sort(),
    }));
  return rows;
}
export function compareRestored(before, after) {
  need(
    hashJSON(after.rowsets) === hashJSON(before.rowsets) &&
      after.mediaHash === before.mediaHash,
    "RESTORE_ROWS_DRIFT",
  );
  for (const group of ["metadata", "extras"])
    for (const key of Object.keys(before[group]))
      need(
        hashJSON(semanticRows(key, after[group][key])) ===
          hashJSON(semanticRows(key, before[group][key])),
        "RESTORE_CATALOG_DRIFT",
      );
  return true;
}
export function verifyOriginals(custody, inventory) {
  need(
    Array.isArray(custody.originals) && custody.originals.length <= 10000,
    "ORIGINAL_CUSTODY_REJECTED",
  );
  const objects = new Map();
  for (const o of custody.originals) {
    need(
      typeof o.object_key === "string" && typeof o.data === "string",
      "ORIGINAL_CUSTODY_REJECTED",
    );
    const bytes = Buffer.from(o.data, "base64");
    need(
      bytes.length === Number(o.bytes) &&
        sha(bytes) === o.sha256 &&
        !objects.has(o.object_key),
      "ORIGINAL_CUSTODY_REJECTED",
    );
    objects.set(o.object_key, o);
  }
  for (const row of inventory) {
    const o = objects.get(row.object_key);
    need(
      o && o.sha256 === row.sha256 && Number(o.bytes) === Number(row.bytes),
      "ORIGINAL_CUSTODY_INCOMPLETE",
    );
  }
  return inventory.length;
}
