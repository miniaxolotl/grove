import type { Knex } from "knex";

export const publicSharing = {
  name: "20261021_011_public_sharing",
  async up(db: Knex) {
    await db.raw(`
      CREATE TABLE public_shares (
        id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id),
        memory_id uuid, project_id uuid, include_descendants boolean NOT NULL DEFAULT false,
        token_digest text UNIQUE CHECK (token_digest ~ '^[0-9a-f]{64}$'),
        token_ciphertext text, version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(account_id, id), UNIQUE(account_id, memory_id), UNIQUE(account_id, project_id),
        FOREIGN KEY(account_id, memory_id) REFERENCES memories(account_id, id) ON DELETE CASCADE,
        FOREIGN KEY(account_id, project_id) REFERENCES projects(account_id, id) ON DELETE CASCADE,
        CHECK (num_nonnulls(memory_id, project_id) = 1),
        CHECK (memory_id IS NULL OR NOT include_descendants),
        CHECK ((revoked_at IS NULL AND token_digest IS NOT NULL AND token_ciphertext IS NOT NULL)
          OR (revoked_at IS NOT NULL AND token_digest IS NULL AND token_ciphertext IS NULL))
      );
      CREATE TABLE public_share_operations (
        account_id uuid NOT NULL, id uuid NOT NULL, fingerprint text NOT NULL,
        share_id uuid NOT NULL, version integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id, id),
        FOREIGN KEY(account_id, share_id) REFERENCES public_shares(account_id, id) ON DELETE CASCADE
      );
      CREATE TABLE public_share_rates (
        bucket text NOT NULL, minute timestamptz NOT NULL, count integer NOT NULL,
        PRIMARY KEY(bucket, minute)
      );
      REVOKE ALL ON public_share_rates FROM PUBLIC;
      CREATE FUNCTION grove_share_admit(bucket_name text) RETURNS boolean
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      DECLARE hits integer;
      BEGIN
        IF bucket_name <> 'global' AND bucket_name !~ '^[0-9a-f-]{36}$' THEN RETURN false; END IF;
        DELETE FROM public_share_rates WHERE minute < date_trunc('minute', now()) - interval '1 minute';
        INSERT INTO public_share_rates(bucket, minute, count)
          VALUES(bucket_name, date_trunc('minute', now()), 1)
          ON CONFLICT(bucket, minute) DO UPDATE SET count = LEAST(public_share_rates.count + 1, 1201)
          RETURNING count INTO hits;
        RETURN hits <= CASE WHEN bucket_name = 'global' THEN 1200 ELSE 240 END;
      END $$;
      REVOKE ALL ON FUNCTION grove_share_admit(text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_share_admit(text) TO grove_runtime;
    `);
    for (const table of ["public_shares", "public_share_operations"]) {
      await db.raw("ALTER TABLE ?? ENABLE ROW LEVEL SECURITY", [table]);
      await db.raw(
        `CREATE POLICY tenant ON ?? USING (account_id = NULLIF(current_setting('grove.account_id', true), '')::uuid)
        WITH CHECK (account_id = NULLIF(current_setting('grove.account_id', true), '')::uuid)`,
        [table],
      );
      await db.raw(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ?? TO grove_runtime",
        [table],
      );
      await db.raw("GRANT SELECT, DELETE ON ?? TO grove_worker", [table]);
    }
    // Like grove_key, this narrow capability entrypoint is owned by the migration
    // role. It projects content itself; it never returns an owner identity/grant.
    await db.raw(`
      CREATE FUNCTION grove_public_share(
        secret_digest text, requested_kind text, requested_id uuid,
        after_id uuid, cursor_share uuid, cursor_version integer, page_size integer
      ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      DECLARE link public_shares; owner_id uuid; permitted uuid[]; selected uuid;
        root_name text; notebook_name text; note memories; result jsonb; page jsonb; children jsonb;
      BEGIN
        IF page_size IS NULL OR page_size < 1 OR page_size > 100
          OR requested_kind NOT IN ('root', 'note', 'notebook') THEN RETURN NULL; END IF;
        SELECT account_id INTO owner_id FROM public_shares WHERE token_digest = secret_digest AND revoked_at IS NULL;
        IF owner_id IS NULL THEN RETURN NULL; END IF;
        -- Match the service's lock order. Revocation, moves and deletion all take
        -- the account write lock, so a completed revocation precedes later reads.
        PERFORM 1 FROM accounts WHERE id = owner_id AND status = 'active' FOR SHARE;
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT * INTO link FROM public_shares WHERE account_id = owner_id
          AND token_digest = secret_digest AND revoked_at IS NULL FOR SHARE;
        IF NOT FOUND THEN RETURN NULL; END IF;
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
              AND m.id::text IN (SELECT lower(matches[1]) FROM regexp_matches(note.content,
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
