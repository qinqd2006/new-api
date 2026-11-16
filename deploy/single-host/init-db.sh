#!/usr/bin/env bash
set -euo pipefail
# Runs once, only against a newly initialized PostgreSQL volume. Never logs secrets.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE newapi LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER DATABASE newapi OWNER TO newapi;
ALTER SCHEMA public OWNER TO newapi;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
