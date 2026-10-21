#start bash & locate files
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Explicit URLs override PGHOST/PGDATABASE and never load .env.
#choose and rebuild test database
readonly TEST_DB=roomie_test
export DATABASE_URL="postgresql://localhost:5432/$TEST_DB"
dropdb --maintenance-db=postgresql://localhost:5432/postgres --if-exists "$TEST_DB"
createdb --maintenance-db=postgresql://localhost:5432/postgres "$TEST_DB"

#chreate schema and load sample data
"$DIR/migrate.sh"
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction -q -f "$DIR/seeds/seed.sql"

#run test and report results
failures=0
for t in "$DIR"/tests/*.sql; do
  if psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -f "$DIR/test_helpers.sql" -f "$t"; then
    echo "PASS: ${t##*/}"
  else
    echo "FAIL: ${t##*/}" >&2
    failures=$((failures + 1))
  fi
done
[[ "$failures" -eq 0 ]]

# rebuilds only roomie_test and runs the suite
