\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
\pset footer off
COPY (
 SELECT src.relname AS source_table,con.conname AS fk_name,
  string_agg(a.attname, ', ' ORDER BY k.ord) AS source_columns,
  dst.relname AS referenced_table,
  string_agg(ta.attname, ', ' ORDER BY k.ord) AS referenced_columns,
  pg_get_constraintdef(con.oid, true) AS definition
 FROM pg_constraint con
 JOIN pg_class src ON src.oid=con.conrelid
 JOIN pg_class dst ON dst.oid=con.confrelid
 JOIN pg_namespace n ON n.oid=src.relnamespace
 JOIN LATERAL unnest(con.conkey,con.confkey) WITH ORDINALITY AS k(src_attnum,dst_attnum,ord) ON true
 JOIN pg_attribute a ON a.attrelid=src.oid AND a.attnum=k.src_attnum
 JOIN pg_attribute ta ON ta.attrelid=dst.oid AND ta.attnum=k.dst_attnum
 WHERE n.nspname='public' AND con.contype='f'
 GROUP BY src.relname,con.conname,dst.relname,con.oid
 ORDER BY src.relname,con.conname
) TO STDOUT WITH CSV HEADER
