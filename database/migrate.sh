#!/usr/bin/env bash
# Applies every database/migrations/*.sql file not yet recorded in schema_migrations,
# in filename order, one transaction per file.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${DIR}/.." && pwd)"

# Fall back to the root .env when DATABASE_URL isn't already set.
if [[ -z "${DATABASE_URL:-}" && -f "${ROOT}/.env" ]]; then
  set -a; source "${ROOT}/.env"; set +a
fi
: "${DATABASE_URL:?DATABASE_URL is not set}"

PSQL=(psql "${DATABASE_URL}" -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);"

shopt -s nullglob
for file in "${DIR}"/migrations/*.sql; do
  name="$(basename "${file}")"

  applied="$("${PSQL[@]}" -At -v name="${name}" <<'SQL'
SELECT 1 FROM schema_migrations WHERE filename = :'name';
SQL
)"
  if [[ -n "${applied}" ]]; then
    continue
  fi

  echo "Applying ${name}"
  # The migration and its bookkeeping row commit together or not at all.
  "${PSQL[@]}" --single-transaction -v name="${name}" -f "${file}" -f - <<'SQL'
INSERT INTO schema_migrations (filename) VALUES (:'name');
SQL
done

echo "Migrations up to date."