-- ═══════════════════════════════════════════════════════════════
-- Rôle applicatif + Row Level Security (isolation multi-tenant)
-- ═══════════════════════════════════════════════════════════════
-- Le rôle `afrigest_app` est celui que l'application utilise à l'exécution.
-- Il n'est ni superuser ni BYPASSRLS : les policies s'appliquent toujours.
-- Son mot de passe/LOGIN est posé par `npm run db:app-role` (jamais dans le dépôt).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'afrigest_app') THEN
    CREATE ROLE afrigest_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO afrigest_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO afrigest_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO afrigest_app;
-- Les futures tables (phases suivantes) héritent des mêmes droits.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO afrigest_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO afrigest_app;

-- La table de migrations n'est pas accessible à l'application.
DO $$
BEGIN
  IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
    REVOKE ALL ON "_prisma_migrations" FROM afrigest_app;
  END IF;
END
$$;

-- Journal d'audit : append-only pour l'application.
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM afrigest_app;

-- ───────────────────────────────────────────────────────────────
-- Helper : active la RLS (FORCE) sur une table avec la policy standard.
--   tbl        table cible
--   key_col    colonne portant l'identifiant d'entreprise ("companyId", ou "id" pour Company)
--   allow_null lecture seule des lignes sans entreprise (ex. gabarits de rôles système)
--
-- Contexte posé par l'application dans CHAQUE transaction :
--   app.company_id  = UUID de l'entreprise active   (client tenant)
--   app.bypass_rls  = 'on'                          (client plateforme uniquement)
-- Sans contexte → aucune ligne visible, aucune écriture possible (fail-closed).
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION afg_enable_rls(tbl regclass, key_col text DEFAULT 'companyId', allow_null boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  cond text;
BEGIN
  cond := format(
    'current_setting(''app.bypass_rls'', true) = ''on'' OR %I = nullif(current_setting(''app.company_id'', true), '''')::uuid',
    key_col
  );
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format('CREATE POLICY tenant_isolation ON %s USING (%s) WITH CHECK (%s)', tbl, cond, cond);
  EXECUTE format('DROP POLICY IF EXISTS tenant_read_shared ON %s', tbl);
  IF allow_null THEN
    EXECUTE format('CREATE POLICY tenant_read_shared ON %s FOR SELECT USING (%I IS NULL)', tbl, key_col);
  END IF;
END
$fn$;

SELECT afg_enable_rls('"Company"', 'id');
SELECT afg_enable_rls('"CompanyMembership"');
SELECT afg_enable_rls('"Invitation"');
SELECT afg_enable_rls('"Role"');
SELECT afg_enable_rls('"RolePermission"');
SELECT afg_enable_rls('"Subscription"');
SELECT afg_enable_rls('"CompanyModule"');
SELECT afg_enable_rls('"UsageLimit"');
SELECT afg_enable_rls('"Branch"');
SELECT afg_enable_rls('"Site"');
SELECT afg_enable_rls('"Department"');
SELECT afg_enable_rls('"CostCenter"');
SELECT afg_enable_rls('"Notification"');
SELECT afg_enable_rls('"NotificationPreference"');
SELECT afg_enable_rls('"AuditLog"');

