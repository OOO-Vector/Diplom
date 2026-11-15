-- Run ONCE (safe to re-run) as the PostgreSQL administrative account.
-- Role names are cluster-global. Login password is set separately with psql \password.
DO $bootstrap$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_read') THEN
        CREATE ROLE app_read NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_write') THEN
        CREATE ROLE app_write NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'team_ai_app') THEN
        CREATE ROLE team_ai_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    END IF;
END;
$bootstrap$;

GRANT app_read TO app_write;
GRANT app_write TO team_ai_app;
-- Password: use interactive psql command: \password team_ai_app
