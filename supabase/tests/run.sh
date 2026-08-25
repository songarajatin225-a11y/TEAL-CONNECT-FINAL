#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Apply the migrations to a throwaway database and run the row-level security
# tests against them.
#
#   supabase/tests/run.sh
#
# Needs a PostgreSQL 15 or newer that the current user can create databases on.
# Override the connection with the usual libpq variables (PGHOST, PGUSER, …).
#
# The database is dropped and recreated on every run: the tests insert
# fixtures, so reusing one would fail on the second run with counts that
# include the first run's rows.
# ---------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="${TEAL_TEST_DB:-teal_leadconnect_test}"
PSQL="${PSQL:-psql}"

echo "==> recreating $DB"
$PSQL -X -q -d postgres -c "drop database if exists $DB" -c "create database $DB"

echo "==> applying migrations"
$PSQL -X -q -v ON_ERROR_STOP=1 -d "$DB" \
  -f "$HERE/00_supabase_stub.sql" \
  -f "$HERE/../migrations/0001_schema.sql" \
  -f "$HERE/../migrations/0002_rls.sql" \
  -f "$HERE/../migrations/0003_functions.sql" >/dev/null

echo "==> running row-level security tests"
# Assertions report through RAISE NOTICE, which psql writes to stderr. The
# successful selects themselves are noise, so keep the notices and drop the
# empty result rows.
$PSQL -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/rls_test.sql" 2>&1 \
  | grep -vE '^(-+|[[:space:]]*|\(1 row\)|[[:space:]]*become[[:space:]]*)$' \
  | sed -e 's/^psql:[^ ]*: NOTICE:  //' -e 's/^NOTICE:  //'

echo
echo "==> dropping $DB"
$PSQL -X -q -d postgres -c "drop database if exists $DB"
