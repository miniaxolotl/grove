import type { Knex } from "knex";

export const shareExpiration = {
  name: "20261022_012_share_expiration",
  async up(db: Knex) {
    // Existing links retain their capability and unlimited lifetime. Do not edit 011.
    await db.raw(`
      ALTER TABLE public_shares
        ADD COLUMN duration text CHECK (duration IN ('1h','4h','1d','1w','2w','1mo')),
        ADD COLUMN expires_at timestamptz,
        ADD CONSTRAINT public_shares_expiration CHECK ((duration IS NULL) = (expires_at IS NULL));

      CREATE OR REPLACE FUNCTION grove_public_share(
        secret_digest text, requested_kind text, requested_id uuid,
        after_id uuid, cursor_share uuid, cursor_version integer, page_size integer
      ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
      DECLARE link public_shares; owner_id uuid; permitted uuid[]; selected uuid;
        root_name text; notebook_name text; note memories; result jsonb; page jsonb; children jsonb;
      BEGIN
        IF page_size IS NULL OR page_size < 1 OR page_size > 100
          OR requested_kind IS NULL OR requested_kind NOT IN ('root', 'note', 'notebook') THEN RETURN NULL; END IF;
        SELECT account_id INTO owner_id FROM public_shares WHERE token_digest = secret_digest AND revoked_at IS NULL;
        IF owner_id IS NULL THEN RETURN NULL; END IF;
        -- Keep account-first locking. Wall-clock expiry must be checked AFTER a
        -- blocked reader acquires its locks, not against transaction-start now().
        PERFORM 1 FROM accounts WHERE id = owner_id AND status = 'active' FOR SHARE;
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT * INTO link FROM public_shares WHERE account_id = owner_id
          AND token_digest = secret_digest AND revoked_at IS NULL FOR SHARE;
        IF NOT FOUND THEN RETURN NULL; END IF;
        IF link.expires_at IS NOT NULL AND link.expires_at <= clock_timestamp() THEN RETURN NULL; END IF;
        IF NOT grove_share_admit(link.id::text) THEN RETURN jsonb_build_object('limited', true); END IF;
        IF cursor_share IS NOT NULL AND (cursor_share <> link.id OR cursor_version IS DISTINCT FROM link.version)
          THEN RETURN jsonb_build_object('stale', true); END IF;
        IF link.project_id IS NOT NULL THEN
          WITH RECURSIVE scope(id) AS (
            SELECT id FROM projects WHERE account_id = owner_id AND id = link.project_id
            UNION
            SELECT p.id FROM projects p JOIN scope s ON p.parent_id = s.id
              WHERE p.account_id = owner_id AND link.include_descendants
          ) SELECT array_agg(id) INTO permitted FROM scope;
          SELECT name INTO root_name FROM projects WHERE account_id = owner_id AND id = link.project_id;
          IF root_name IS NULL THEN RETURN NULL; END IF;
        ELSE
          SELECT * INTO note FROM memories WHERE account_id = owner_id AND id = link.memory_id
            AND status = 'active' AND (expires_at IS NULL OR expires_at > now());
          IF NOT FOUND THEN RETURN NULL; END IF;
          root_name := left(regexp_replace(split_part(trim(note.content), E'\\n', 1), '^#{1,6}\\s+', ''), 110);
        END IF;
        result := jsonb_build_object('shareId', link.id, 'shareVersion', link.version,
          'kind', CASE WHEN link.memory_id IS NULL THEN 'notebook' ELSE 'note' END,
          'root', jsonb_build_object('id', coalesce(link.project_id, link.memory_id), 'name', root_name),
          'notebook', NULL, 'note', NULL, 'notebooks', '[]'::jsonb, 'notes', '[]'::jsonb);
        IF requested_kind = 'note' OR (requested_kind = 'root' AND link.memory_id IS NOT NULL) THEN
          selected := CASE WHEN requested_kind = 'root' THEN link.memory_id ELSE requested_id END;
          SELECT * INTO note FROM memories WHERE account_id = owner_id AND id = selected
            AND (id = link.memory_id OR project_id = ANY(permitted))
            AND status = 'active' AND (expires_at IS NULL OR expires_at > now());
          IF NOT FOUND THEN RETURN NULL; END IF;
          SELECT coalesce(jsonb_agg(m.id), '[]'::jsonb) INTO page FROM memories m
            WHERE m.account_id = owner_id AND (m.id = link.memory_id OR m.project_id = ANY(permitted))
              AND m.status = 'active' AND (m.expires_at IS NULL OR m.expires_at > now())
              AND m.id IN (SELECT matches[1]::uuid FROM regexp_matches(note.content,
                '/app/memories/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})', 'g') AS matches);
          RETURN result || jsonb_build_object('note', jsonb_build_object('id', note.id,
            'title', left(regexp_replace(split_part(trim(note.content), E'\\n', 1), '^#{1,6}\\s+', ''), 110),
            'content', note.content, 'updatedAt', note.updated_at, 'linkedNoteIds', page));
        END IF;
        selected := CASE WHEN requested_kind = 'root' THEN link.project_id ELSE requested_id END;
        IF selected IS NULL OR NOT (selected = ANY(permitted)) OR permitted IS NULL THEN RETURN NULL; END IF;
        SELECT name INTO notebook_name FROM projects WHERE account_id = owner_id AND id = selected;
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.name, p.id), '[]'::jsonb)
          INTO children FROM projects p WHERE p.account_id = owner_id AND p.parent_id = selected AND p.id = ANY(permitted);
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id,
          'title', left(regexp_replace(split_part(trim(m.content), E'\\n', 1), '^#{1,6}\\s+', ''), 110),
          'updatedAt', m.updated_at) ORDER BY m.id), '[]'::jsonb) INTO page FROM (
            SELECT id, content, updated_at FROM memories WHERE account_id = owner_id AND project_id = selected
              AND status = 'active' AND (expires_at IS NULL OR expires_at > now())
              AND (after_id IS NULL OR id > after_id) ORDER BY id LIMIT page_size + 1
          ) m;
        RETURN result || jsonb_build_object('notebook', jsonb_build_object('id', selected, 'name', notebook_name),
          'notebooks', children, 'notes', page);
      END $$;
      REVOKE ALL ON FUNCTION grove_public_share(text,text,uuid,uuid,uuid,integer,integer) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_public_share(text,text,uuid,uuid,uuid,integer,integer) TO grove_runtime;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
