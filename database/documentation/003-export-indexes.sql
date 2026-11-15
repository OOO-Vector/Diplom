\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
\pset footer off
COPY (
 SELECT n.nspname AS schema_name,c.relname AS table_name, idx.relname AS index_name,
        i.indisprimary AS is_primary, i.indisunique AS is_unique,
        i.indisvalid AS is_valid,pg_get_indexdef(i.indexrelid) AS definition
 FROM pg_index i
 JOIN pg_class c ON c.oid=i.indrelid
 JOIN pg_class idx ON idx.oid=i.indexrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname NOT IN ('databasechangelog','databasechangeloglock')
 ORDER BY c.relname,idx.relname
) TO STDOUT WITH CSV HEADER
