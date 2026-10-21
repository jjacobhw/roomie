#!/usr/bin/env bash
# Sets up a local Roomie dev database on macOS:
#   Homebrew Postgres 17 -> running service -> roomie_dev database -> .env -> migrations + seed.
# Safe to re-run; every step skips itself if it's already done.
#
# Usage (from anywhere in the repo):  ./database/setup-local.sh
set -euo pipefail

PG_FORMULA="postgresql@17"
DB_NAME="roomie_dev"
DATABASE_URL="postgresql://localhost/${DB_NAME}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step() { printf '\n==> %s\n' "$*"; }
die()  { printf '\nError: %s\n' "$*" >&2; exit 1; }

# --- 1. Platform and Homebrew ---------------------------------------------
[[ "$(uname -s)" == "Darwin" ]] || die "This script is for macOS. On Linux, install Postgres 17 with your package manager and create the '${DB_NAME}' database."

if ! command -v brew >/dev/null 2>&1; then
  die "Homebrew is not installed. Install it from https://brew.sh, open a new terminal, and re-run this script."
fi

# --- 2. Install Postgres 17 -------------------------------------------------
step "Installing ${PG_FORMULA} (skipped if already installed)"
if brew list --versions "${PG_FORMULA}" >/dev/null 2>&1; then
  echo "${PG_FORMULA} is already installed."
else
  brew install "${PG_FORMULA}"
fi

PG_BIN="$(brew --prefix "${PG_FORMULA}")/bin"
export PATH="${PG_BIN}:${PATH}"

# --- 3. Make sure no other Homebrew Postgres holds port 5432 ----------------
step "Checking for other Postgres versions"
others="$(brew services list | awk -v want="${PG_FORMULA}" '$1 ~ /^postgresql/ && $1 != want && $2 == "started" {print $1}')"
if [[ -n "${others}" ]]; then
  echo "These Postgres services are running and would block port 5432:"
  echo "${others}" | sed 's/^/  - /'
  read -r -p "Stop them so ${PG_FORMULA} can start? Their data is kept. [y/N] " reply
  if [[ "${reply}" =~ ^[Yy]$ ]]; then
    while read -r svc; do brew services stop "${svc}"; done <<< "${others}"
  else
    die "Stop the other Postgres services yourself (brew services stop <name>) and re-run."
  fi
else
  echo "None running."
fi

# --- 4. Start Postgres 17 -------------------------------------------------
step "Starting ${PG_FORMULA}"
brew services start "${PG_FORMULA}" >/dev/null
for _ in $(seq 1 20); do
  pg_isready -q && break
  sleep 0.5
done
pg_isready -q || die "Postgres did not start. Check: brew services info ${PG_FORMULA}"
echo "Running: $(psql -d postgres -Atc 'show server_version')"

# --- 5. Create the dev database ---------------------------------------------
step "Creating database '${DB_NAME}' (skipped if it exists)"
if psql -d postgres -Atc "select 1 from pg_database where datname = '${DB_NAME}'" | grep -q 1; then
  echo "'${DB_NAME}' already exists."
else
  createdb "${DB_NAME}"
  echo "Created '${DB_NAME}'."
fi

# --- 6. .env at the repo root -----------------------------------------------
step "Configuring .env"
ENV_FILE="${REPO_ROOT}/.env"
if [[ -f "${ENV_FILE}" ]] && grep -q '^DATABASE_URL=' "${ENV_FILE}"; then
  echo ".env already sets DATABASE_URL; leaving it alone."
else
  echo "DATABASE_URL=${DATABASE_URL}" >> "${ENV_FILE}"
  echo "Added DATABASE_URL=${DATABASE_URL} to .env"
fi

# --- 7. Put Postgres 17 on PATH for future shells ---------------------------
step "Adding ${PG_FORMULA} to PATH"
SHELL_RC="${HOME}/.zshrc"
[[ "${SHELL:-}" == */bash ]] && SHELL_RC="${HOME}/.bash_profile"
if grep -qs "${PG_BIN}" "${SHELL_RC}"; then
  echo "Already in ${SHELL_RC}."
else
  printf '\n# Postgres 17 (Roomie)\nexport PATH="%s:$PATH"\n' "${PG_BIN}" >> "${SHELL_RC}"
  echo "Added to ${SHELL_RC}. Open a new terminal (or run: source ${SHELL_RC})."
fi

# --- 8. Migrations and seed data -------------------------------------------
step "Applying migrations and seed data"
if [[ -x "${REPO_ROOT}/database/migrate.sh" ]]; then
  DATABASE_URL="${DATABASE_URL}" "${REPO_ROOT}/database/migrate.sh"
else
  echo "database/migrate.sh not found yet; skipping migrations."
fi

SEED="${REPO_ROOT}/database/seeds/seed.sql"
if [[ -s "${SEED}" ]]; then
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 --single-transaction -q -f "${SEED}"
  echo "Loaded database/seeds/seed.sql."
else
  echo "database/seeds/seed.sql is empty; skipping seed data."
fi

step "Done. Connect with:  psql ${DB_NAME}"
