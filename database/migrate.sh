# start Bash & stop on errors
#!/usr/bin/env bash
set -euo pipefail

# find script directory
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

#load and require database URL
if [[ -z "${DATABASE_URL:-}" && -f "$DIR/../.env" ]]; then
  set -a
  source "$DIR/../.env"
  set +a
fi
: "${DATABASE_URL:?DATABASE_URL is not set}"

#create migratio hisotry table
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

#find migration files in order
shopt -s nullglob
export LC_ALL=C
for file in "$DIR"/migrations/*.sql; do
  name="${file##*/}"
  # skip if already applied
  applied="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -v name="$name" <<'SQL'
SELECT count(*) FROM schema_migrations WHERE filename = :'name';
SQL
)"
  [[ "$applied" == 0 ]] || continue
  # apply and record migration atomically
  echo "Applying $name"
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction -v name="$name" -f "$file" -f - <<'SQL'
INSERT INTO schema_migrations (filename) VALUES (:'name');
SQL
done


# Aplies pending migrations transactionally and records them
