\set ON_ERROR_STOP on
\pset pager off
\echo '=== 1. DATABASE + VERSION ==='
SELECT current_database() AS database_name, current_user AS db_user, version() AS postgres_version;

\echo '=== 2. LIQUIBASE HISTORY ==='
SELECT orderexecuted, id, author, exectype, filename
FROM public.databasechangelog ORDER BY orderexecuted;

\echo '=== 3. DOMAIN TABLE COUNT (excluding Liquibase) ==='
SELECT count(*) AS domain_table_count
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p')
  AND c.relname NOT IN ('databasechangelog','databasechangeloglock');

\echo '=== 4. DOMAIN TABLES + ROW COUNTS (planner estimates) ==='
SELECT c.relname AS table_name, c.reltuples::bigint AS estimated_rows
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p')
 AND c.relname NOT IN ('databasechangelog','databasechangeloglock')
ORDER BY c.relname;

\echo '=== 5. TABLES WITHOUT PRIMARY KEY ==='
SELECT t.table_name
FROM information_schema.tables t
WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
 AND t.table_name NOT IN ('databasechangelog','databasechangeloglock')
 AND NOT EXISTS (
 SELECT 1 FROM pg_constraint co
 JOIN pg_class c ON c.oid=co.conrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=t.table_schema AND c.relname=t.table_name AND co.contype='p')
ORDER BY t.table_name;

\echo '=== 6. CONSTRAINT COUNTS BY TYPE ==='
SELECT CASE co.contype WHEN 'p' THEN 'primary_key' WHEN 'f' THEN 'foreign_key'
 WHEN 'u' THEN 'unique' WHEN 'c' THEN 'check' WHEN 'x' THEN 'exclusion'
 ELSE co.contype::text END AS constraint_type, count(*) AS total
FROM pg_constraint co JOIN pg_namespace n ON n.oid=co.connamespace
WHERE n.nspname='public' AND co.conrelid::regclass::text NOT IN ('databasechangelog','databasechangeloglock')
GROUP BY co.contype ORDER BY constraint_type;

\echo '=== 7. FOREIGN KEYS WITHOUT A LEADING-KEY INDEX ON REFERENCING TABLE (review candidates) ==='
WITH fk AS (
 SELECT co.conname, co.conrelid, co.conkey
 FROM pg_constraint co JOIN pg_namespace n ON n.oid=co.connamespace
 WHERE n.nspname='public' AND co.contype='f'
)
SELECT fk.conrelid::regclass AS table_name, fk.conname AS foreign_key,
 ARRAY(SELECT att.attname FROM unnest(fk.conkey) WITH ORDINALITY AS k(attnum, pos)
 JOIN pg_attribute att ON att.attrelid=fk.conrelid AND att.attnum=k.attnum ORDER BY k.pos) AS columns
FROM fk
WHERE NOT EXISTS (
 SELECT 1 FROM pg_index i
 WHERE i.indrelid=fk.conrelid AND i.indisvalid AND i.indisready
 AND i.indpred IS NULL
 AND (SELECT array_agg(k ORDER BY ord) FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS x(k,ord)
      WHERE ord<=cardinality(fk.conkey)) = fk.conkey
)
ORDER BY table_name, foreign_key;

\echo '=== 8. USER-DEFINED TRIGGERS ==='
SELECT tgrelid::regclass AS table_name, tgname, tgenabled, tgdeferrable, tginitdeferred
FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgrelid::regclass::text, tgname;

\echo '=== 9. VIEWS ==='
SELECT schemaname, viewname FROM pg_views WHERE schemaname='public' ORDER BY viewname;

\echo '=== 10. EXTENSIONS ==='
SELECT extname, extversion FROM pg_extension ORDER BY extname;

\echo '=== 11. INVALID INDEXES ==='
SELECT i.indrelid::regclass AS table_name, c.relname AS index_name,
 i.indisvalid, i.indisready
FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND (NOT i.indisvalid OR NOT i.indisready)
ORDER BY table_name, index_name;

\echo '=== 12. INCONSISTENT PROJECT OWNERSHIP ==='
SELECT p.id, p.name, count(pm.user_id) FILTER (WHERE pm.role='owner') AS owner_count
FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id
GROUP BY p.id,p.name HAVING count(pm.user_id) FILTER (WHERE pm.role='owner') <> 1;

\echo '=== AUDIT COMPLETE (READ ONLY) ==='
