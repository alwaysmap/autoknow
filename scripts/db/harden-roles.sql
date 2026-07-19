-- Least-privilege runtime role — the enforcement that makes DB corruption from the app
-- path IMPOSSIBLE, not merely discouraged. Run ONCE per instance, deliberately, as a
-- privileged role (schema owner / a cloudsqlsuperuser member). Idempotent.
--
-- After this:
--   * the runtime `app` role can read/write ROWS (SELECT/INSERT/UPDATE/DELETE) but CANNOT
--     change SCHEMA — no CREATE/ALTER/DROP/TRUNCATE. So `prisma db push`, `DROP TABLE`,
--     `ALTER COLUMN`, `TRUNCATE`, etc. run with the app's credentials fail with
--     "permission denied". An agent holding DATABASE_URL simply cannot corrupt the schema.
--   * only the `migrator` role has DDL; its credentials live only in Secret Manager,
--     reachable only by the CI service account, and are used solely by `prisma migrate deploy`.
--
-- Prereq: a `migrator` SQL user exists (Terraform: google_sql_user.migrator).

-- 1. migrator owns the schema and every existing object (so migrations can ALTER them).
GRANT "migrator" TO CURRENT_USER;          -- temporary membership, to reassign ownership
REASSIGN OWNED BY "app" TO "migrator";
REVOKE "migrator" FROM CURRENT_USER;
ALTER SCHEMA public OWNER TO "migrator";

-- 2. app: connect + row-level DML only, no schema rights.
REVOKE ALL ON SCHEMA public FROM "app";
GRANT USAGE ON SCHEMA public TO "app";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "app";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "app";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "app";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "app";

-- 3. Tables/sequences future migrations create auto-grant DML to app (no manual step later).
ALTER DEFAULT PRIVILEGES FOR ROLE "migrator" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "app";
ALTER DEFAULT PRIVILEGES FOR ROLE "migrator" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO "app";
