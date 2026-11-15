TEAM AI ORCHESTRATOR — DATABASE DATA DICTIONARY EXPORT

From the repository root in Windows CMD:

mkdir database\documentation

docker exec -i team-ai-postgres psql -X -q -v ON_ERROR_STOP=1 -U team_ai_admin -d team_ai_db < database\documentation\001-export-columns.sql > database\documentation\columns.csv

docker exec -i team-ai-postgres psql -X -q -v ON_ERROR_STOP=1 -U team_ai_admin -d team_ai_db < database\documentation\002-export-constraints.sql > database\documentation\constraints.csv

docker exec -i team-ai-postgres psql -X -q -v ON_ERROR_STOP=1 -U team_ai_admin -d team_ai_db < database\documentation\003-export-indexes.sql > database\documentation\indexes.csv

docker exec -i team-ai-postgres psql -X -q -v ON_ERROR_STOP=1 -U team_ai_admin -d team_ai_db < database\documentation\004-export-relationships.sql > database\documentation\relationships.csv

Notes:
- Scripts only read pg_catalog metadata; no database objects are changed.
- CSV filenames are written on Windows by CMD redirection, not in the Docker container.
- If psql displays errors, do not use the resulting CSV; share the error for correction.
- PostgreSQL column comments may be empty until COMMENT ON COLUMN is added.
- Column-level uniqueness flag describes participation in some UNIQUE constraint, including composite ones; consult constraints.csv for details.
