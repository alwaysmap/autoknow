-- Create/refresh the least-privilege RUNTIME role `app_runtime`, the control that makes
-- schema corruption from the app path IMPOSSIBLE. Run as `app` (the schema owner /
-- migration role, which has CREATEROLE). Idempotent. Requires psql var :runtime_pw.
--
-- app_runtime is a plain SQL role — NOT a Cloud SQL API user, so it is not auto-added to
-- cloudsqlsuperuser and holds no DDL. It gets row DML only. After the runtime switches to
-- it, `prisma db push`, DROP/ALTER/TRUNCATE, etc. all fail with "permission denied".
-- `app` remains the owner and is used only by CI `prisma migrate deploy`.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime;
  END IF;
END$$;

ALTER ROLE app_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  PASSWORD :'runtime_pw';

-- Row DML only; explicitly no schema-create right.
GRANT USAGE ON SCHEMA public TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

-- Tables/sequences that future migrations (run as `app`) create auto-grant DML to
-- app_runtime, so no manual grant is needed after each migration.
ALTER DEFAULT PRIVILEGES FOR ROLE app IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
