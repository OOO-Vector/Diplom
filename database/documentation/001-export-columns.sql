\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
\pset footer off
COPY (
WITH cols AS (
 SELECT n.nspname AS schema_name, c.relname AS table_name, a.attnum AS ordinal_position,
        a.attname AS column_name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
        NOT a.attnotnull AS is_nullable, pg_get_expr(d.adbin, d.adrelid) AS default_value,
        col_description(c.oid, a.attnum) AS column_comment,
        c.oid AS table_oid
 FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname NOT IN ('databasechangelog','databasechangeloglock')
), keys AS (
 SELECT con.conrelid AS table_oid, a.attnum, 
        bool_or(con.contype='p') AS is_primary_key,
        bool_or(con.contype='u') AS is_unique_key,
        string_agg(DISTINCT CASE WHEN con.contype='f' THEN con.conname END, '; ') AS foreign_keys
 FROM pg_constraint con
 JOIN LATERAL unnest(con.conkey) AS k(attnum) ON true
 JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.attnum
 WHERE con.contype IN ('p','u','f')
 GROUP BY con.conrelid,a.attnum
)
SELECT cols.schema_name,cols.table_name,cols.ordinal_position,cols.column_name,cols.data_type,
       CASE WHEN cols.is_nullable THEN 'YES' ELSE 'NO' END AS nullable,
       COALESCE(cols.default_value,'') AS default_value,
       CASE WHEN COALESCE(keys.is_primary_key,false) THEN 'YES' ELSE 'NO' END AS primary_key,
       CASE WHEN COALESCE(keys.is_unique_key,false) THEN 'YES' ELSE 'NO' END AS unique_constraint_column,
       COALESCE(keys.foreign_keys,'') AS foreign_key_constraints,
       COALESCE(cols.column_comment,'') AS column_comment
FROM cols LEFT JOIN keys ON keys.table_oid=cols.table_oid AND keys.attnum=cols.ordinal_position
ORDER BY cols.table_name,cols.ordinal_position
) TO STDOUT WITH CSV HEADER
