\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
\pset footer off
COPY (
 SELECT n.nspname AS schema_name, c.relname AS table_name,
        con.conname AS constraint_name,
        CASE con.contype WHEN 'p' THEN 'PRIMARY KEY' WHEN 'f' THEN 'FOREIGN KEY'
         WHEN 'u' THEN 'UNIQUE' WHEN 'c' THEN 'CHECK' WHEN 'x' THEN 'EXCLUSION'
         WHEN 't' THEN 'CONSTRAINT TRIGGER' ELSE con.contype::text END AS constraint_type,
        pg_get_constraintdef(con.oid, true) AS definition,
        con.condeferrable AS deferrable,con.condeferred AS initially_deferred,
        con.convalidated AS validated
 FROM pg_constraint con
 JOIN pg_class c ON c.oid=con.conrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname NOT IN ('databasechangelog','databasechangeloglock')
 ORDER BY c.relname,con.contype,con.conname
) TO STDOUT WITH CSV HEADER
