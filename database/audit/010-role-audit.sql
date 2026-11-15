\pset pager off
\echo === ROLE ATTRIBUTES ===
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole
FROM pg_roles
WHERE rolname IN ('app_read', 'app_write', 'team_ai_app', 'team_ai_admin')
ORDER BY rolname;

\echo === ROLE MEMBERSHIP ===
SELECT member.rolname AS member, granted.rolname AS granted_role
FROM pg_auth_members m
JOIN pg_roles member ON member.oid = m.member
JOIN pg_roles granted ON granted.oid = m.roleid
WHERE member.rolname IN ('app_write', 'team_ai_app')
ORDER BY member.rolname, granted.rolname;

\echo === EFFECTIVE PRIVILEGES FOR APP LOGIN ===
SELECT
    has_schema_privilege('team_ai_app', 'public', 'USAGE') AS schema_usage,
    has_schema_privilege('team_ai_app', 'public', 'CREATE') AS schema_create,
    has_table_privilege('team_ai_app', 'public.projects', 'SELECT') AS projects_select,
    has_table_privilege('team_ai_app', 'public.projects', 'INSERT') AS projects_insert,
    has_table_privilege('team_ai_app', 'public.projects', 'DELETE') AS projects_delete,
    has_table_privilege('team_ai_app', 'public.projects', 'TRUNCATE') AS projects_truncate,
    has_table_privilege('team_ai_app', 'public.databasechangelog', 'SELECT') AS liquibase_history_select,
    has_table_privilege('team_ai_app', 'public.databasechangeloglock', 'UPDATE') AS liquibase_lock_update;

\echo === TOTAL DOMAIN TABLES NOT ACCESSIBLE FOR SELECT OR DML ===
WITH domain_tables AS (
    SELECT c.oid, c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
      AND c.relname NOT IN ('databasechangelog','databasechangeloglock')
)
SELECT relname, has_table_privilege('team_ai_app', oid, 'SELECT') AS can_select,
       has_table_privilege('team_ai_app', oid, 'INSERT') AS can_insert,
       has_table_privilege('team_ai_app', oid, 'UPDATE') AS can_update,
       has_table_privilege('team_ai_app', oid, 'DELETE') AS can_delete
FROM domain_tables
WHERE NOT (has_table_privilege('team_ai_app', oid, 'SELECT')
  AND has_table_privilege('team_ai_app', oid, 'INSERT')
  AND has_table_privilege('team_ai_app', oid, 'UPDATE')
  AND has_table_privilege('team_ai_app', oid, 'DELETE'))
ORDER BY relname;
