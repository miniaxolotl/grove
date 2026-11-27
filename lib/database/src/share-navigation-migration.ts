import type { Knex } from "knex";

export const shareNavigation = {
  name: "20261127_052_share_navigation",
  async up(db: Knex) {
    // Reuse the current (lifecycle-filtered) scope instead of maintaining a second
    // recursive permission implementation. Keep the old seven-argument API intact.
    const { rows } = await db.raw(
      "SELECT pg_get_functiondef('grove_public_share(text,text,uuid,uuid,uuid,integer,integer)'::regprocedure) AS definition",
    );
    const definition: string = rows[0].definition;
    const scope =
      /WITH RECURSIVE scope\(id\) AS \([\s\S]*?SELECT array_agg\(id\) INTO permitted FROM scope;/;
    const block = definition.match(scope)?.[0];
    if (!block) throw new Error("Public share scope definition changed");
    await db.raw(`CREATE FUNCTION grove_share_notebooks(owner_id uuid, root_id uuid, descendants boolean)
      RETURNS uuid[] LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE permitted uuid[]; BEGIN
      ${block.replaceAll("link.project_id", "root_id").replaceAll("link.include_descendants", "descendants")}
      RETURN permitted; END $$;
      REVOKE ALL ON FUNCTION grove_share_notebooks(uuid,uuid,boolean) FROM PUBLIC;`);
    await db.raw(
      definition.replace(
        block,
        "SELECT grove_share_notebooks(owner_id, link.project_id, link.include_descendants) INTO permitted;",
      ),
    );
    await db.raw(`
      CREATE FUNCTION grove_public_navigation(secret_digest text, note_id uuid, notebook_id uuid, query_text text, after_id uuid)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE checked jsonb; link public_shares; permitted uuid[]; folder_id uuid; folder jsonb;
        previous jsonb; following jsonb; results jsonb;
      BEGIN
        IF query_text IS NULL OR length(query_text)>100 THEN RETURN NULL; END IF;
        -- This call takes the same account/share locks and checks expiry, account
        -- lifecycle, admission and selected-note access before projecting anything.
        checked := grove_public_share(secret_digest, CASE WHEN note_id IS NOT NULL THEN 'note' WHEN notebook_id IS NOT NULL THEN 'notebook' ELSE 'root' END,
          coalesce(note_id,notebook_id), NULL, NULL, NULL, 1);
        IF checked IS NULL OR checked->'limited' IS NOT NULL THEN RETURN checked; END IF;
        IF checked->>'kind' <> 'notebook' THEN RETURN NULL; END IF;
        SELECT * INTO link FROM public_shares WHERE id=(checked->>'shareId')::uuid;
        permitted := grove_share_notebooks(link.account_id,link.project_id,link.include_descendants);
        folder_id := coalesce(notebook_id,link.project_id);
        IF note_id IS NOT NULL THEN
          SELECT project_id INTO folder_id FROM memories WHERE account_id=link.account_id AND id=note_id;
        END IF;
          SELECT jsonb_build_object('id',p.id,'name',p.name,'parentId',
            CASE WHEN p.parent_id=ANY(permitted) THEN p.parent_id ELSE NULL END) INTO folder
            FROM projects p WHERE p.account_id=link.account_id AND p.id=folder_id AND p.id=ANY(permitted);
        IF note_id IS NOT NULL THEN
          SELECT jsonb_build_object('id',m.id,'title',left(regexp_replace(split_part(trim(m.content),E'\\n',1),'^#{1,6}\\s+',''),110),'updatedAt',m.updated_at)
            INTO previous FROM memories m WHERE m.account_id=link.account_id AND m.project_id=folder_id AND m.id<note_id
              AND m.deleted_at IS NULL AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp()) ORDER BY m.id DESC LIMIT 1;
          SELECT jsonb_build_object('id',m.id,'title',left(regexp_replace(split_part(trim(m.content),E'\\n',1),'^#{1,6}\\s+',''),110),'updatedAt',m.updated_at)
            INTO following FROM memories m WHERE m.account_id=link.account_id AND m.project_id=folder_id AND m.id>note_id
              AND m.deleted_at IS NULL AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp()) ORDER BY m.id LIMIT 1;
        END IF;
        SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'title',n.title,'updatedAt',n.updated_at,'notebookName',n.name) ORDER BY n.id),'[]'::jsonb)
          INTO results FROM (
            SELECT m.id,left(regexp_replace(split_part(trim(m.content),E'\\n',1),'^#{1,6}\\s+',''),110) AS title,m.updated_at,p.name
            FROM memories m JOIN projects p ON p.account_id=m.account_id AND p.id=m.project_id
            WHERE m.account_id=link.account_id AND m.project_id=ANY(permitted) AND m.deleted_at IS NULL
              AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp())
              AND (after_id IS NULL OR m.id>after_id)
              AND query_text<>'' AND position(lower(query_text) IN lower(left(regexp_replace(split_part(trim(m.content),E'\\n',1),'^#{1,6}\\s+',''),110)))>0
            ORDER BY m.id LIMIT 31
          ) n;
        RETURN jsonb_build_object('folder',folder,'previous',previous,'next',following,'results',results,
          'shareId',link.id,'shareVersion',link.version);
      END $$;
      REVOKE ALL ON FUNCTION grove_public_navigation(text,uuid,uuid,text,uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_public_navigation(text,uuid,uuid,text,uuid) TO grove_runtime;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
