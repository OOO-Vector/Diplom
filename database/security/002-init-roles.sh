
#!/bin/sh
set -eu

: "${DB_APP_PASSWORD:?DB_APP_PASSWORD must be set}"

psql \
  -v ON_ERROR_STOP=1 \
  -v app_password="$DB_APP_PASSWORD" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'SQL'

-- Create read-only role
SELECT 'CREATE ROLE app_read NOLOGIN'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'app_read'
)
\gexec

-- Create write role
SELECT 'CREATE ROLE app_write NOLOGIN'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'app_write'
)
\gexec

-- Create application login role
SELECT format(
    'CREATE ROLE team_ai_app LOGIN PASSWORD %L',
    :'app_password'
)
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'team_ai_app'
)
\gexec

-- Configure role inheritance
GRANT app_read TO app_write;
GRANT app_write TO team_ai_app;

SQL

echo "Database application roles initialized."
