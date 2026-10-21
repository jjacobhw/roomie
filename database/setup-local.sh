#!/usr/bin/env bash
# Sets up a local Roomie dev database on macOS, Linux, or Windows (through WSL):
#   install Postgres -> running service -> your own database login -> roomie_dev -> .env -> migrations + seed.
# Safe to re-run; every step skips itself if it's already done.
#
# Usage (from anywhere in the repo):  ./database/setup-local.sh
#
# Every platform ends up with the same DATABASE_URL (postgresql://localhost/roomie_dev),
# so .env, migrate.sh, test.sh and the backend don't need to know which OS they're on.
set -euo pipefail

DB_NAME="roomie_dev"
DATABASE_URL="postgresql://localhost/${DB_NAME}"
MIN_PG_MAJOR=13          # gen_random_uuid() is built in from 13 onward
MAC_FORMULA="postgresql@17"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_USER="$(id -un)"

step() { printf '\n==> %s\n' "$*"; }
die()  { printf '\nError: %s\n' "$*" >&2; exit 1; }

# --- 1. Detect the platform -------------------------------------------------
case "$(uname -s)" in
  Darwin) PLATFORM=mac ;;
  Linux)  PLATFORM=linux ;;
  MINGW*|MSYS*|CYGWIN*)
    die "Native Windows isn't supported. Install WSL (in PowerShell: wsl --install), open the Ubuntu terminal, clone the repo there, and re-run this script." ;;
  *) die "Unsupported OS: $(uname -s)" ;;
esac

if [[ "${PLATFORM}" == linux ]]; then
  if   command -v apt-get >/dev/null 2>&1; then PKG=apt
  elif command -v dnf     >/dev/null 2>&1; then PKG=dnf
  elif command -v pacman  >/dev/null 2>&1; then PKG=pacman
  else die "No supported package manager found (apt, dnf or pacman). Install Postgres ${MIN_PG_MAJOR}+ yourself and re-run."
  fi
  command -v sudo >/dev/null 2>&1 || die "sudo is required to install and start Postgres."
fi
echo "Platform: ${PLATFORM}${PKG:+ (${PKG})}"

# Starts the Postgres service on Linux, with or without systemd (WSL often has none).
linux_start() {
  if [[ -d /run/systemd/system ]]; then
    sudo systemctl enable --now postgresql >/dev/null
  elif command -v pg_ctlcluster >/dev/null 2>&1; then   # Debian/Ubuntu without systemd
    sudo service postgresql start >/dev/null
  else
    die "Can't start Postgres without systemd here. Start it manually and re-run."
  fi
}

# --- 2. Install Postgres ----------------------------------------------------
step "Installing Postgres (skipped if already installed)"
if [[ "${PLATFORM}" == mac ]]; then
  command -v brew >/dev/null 2>&1 \
    || die "Homebrew is not installed. Install it from https://brew.sh, open a new terminal, and re-run this script."
  if brew list --versions "${MAC_FORMULA}" >/dev/null 2>&1; then
    echo "${MAC_FORMULA} is already installed."
  else
    brew install "${MAC_FORMULA}"
  fi
  PG_BIN="$(brew --prefix "${MAC_FORMULA}")/bin"
  export PATH="${PG_BIN}:${PATH}"
else
  if command -v psql >/dev/null 2>&1 && command -v pg_isready >/dev/null 2>&1; then
    echo "Postgres client tools are already installed."
  else
    case "${PKG}" in
      apt)    sudo apt-get update -q && sudo apt-get install -y -q postgresql postgresql-contrib ;;
      dnf)    sudo dnf install -y postgresql-server postgresql-contrib ;;
      pacman) sudo pacman -S --needed --noconfirm postgresql ;;
    esac
  fi
  # Fedora and Arch don't create a data directory on install.
  case "${PKG}" in
    dnf)    [[ -f /var/lib/pgsql/data/PG_VERSION ]] || sudo postgresql-setup --initdb ;;
    pacman) [[ -f /var/lib/postgres/data/PG_VERSION ]] \
              || sudo -u postgres initdb -D /var/lib/postgres/data >/dev/null ;;
  esac
fi

# --- 3. Start Postgres ------------------------------------------------------
step "Starting Postgres"
if [[ "${PLATFORM}" == mac ]]; then
  # Another Homebrew Postgres on port 5432 would block this one.
  others="$(brew services list | awk -v want="${MAC_FORMULA}" '$1 ~ /^postgresql/ && $1 != want && $2 == "started" {print $1}')"
  if [[ -n "${others}" ]]; then
    echo "These Postgres services are running and would block port 5432:"
    echo "${others}" | sed 's/^/  - /'
    read -r -p "Stop them so ${MAC_FORMULA} can start? Their data is kept. [y/N] " reply
    [[ "${reply}" =~ ^[Yy]$ ]] || die "Stop the other Postgres services yourself (brew services stop <name>) and re-run."
    while read -r svc; do brew services stop "${svc}"; done <<< "${others}"
  fi
  brew services start "${MAC_FORMULA}" >/dev/null
else
  linux_start
fi
for _ in $(seq 1 20); do
  pg_isready -q -h localhost && break
  sleep 0.5
done
pg_isready -q -h localhost || die "Postgres did not start. Check its service logs."

# --- 4. A database login for you --------------------------------------------
# Homebrew already makes your Mac username a superuser with no password.
# Linux only lets the 'postgres' system user in, so create a login named after you
# and store its password in ~/.pgpass. psql, createdb and the Node 'pg' library all
# read ~/.pgpass, so DATABASE_URL never needs a password in it.
if [[ "${PLATFORM}" == linux ]]; then
  step "Creating a Postgres login for '${DB_USER}' (skipped if it exists)"
  as_pg() { sudo -u postgres psql -X -q -d postgres -v ON_ERROR_STOP=1 "$@"; }
  PGPASS="${HOME}/.pgpass"
  if grep -qs "^localhost:5432:\*:${DB_USER}:" "${PGPASS}" \
     && psql -X -h localhost -d postgres -Atc 'select 1' >/dev/null 2>&1; then
    echo "Login works already."
  else
    # pipefail is off inside $(...) here: head closing the pipe early is expected.
    pw="$(set +o pipefail; LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)"
    if as_pg -Atc "select 1 from pg_roles where rolname = '${DB_USER}'" | grep -q 1; then
      as_pg -c "ALTER ROLE \"${DB_USER}\" WITH LOGIN SUPERUSER PASSWORD '${pw}'"
    else
      as_pg -c "CREATE ROLE \"${DB_USER}\" WITH LOGIN SUPERUSER PASSWORD '${pw}'"
    fi
    touch "${PGPASS}" && chmod 600 "${PGPASS}"
    grep -v "^localhost:5432:\*:${DB_USER}:" "${PGPASS}" > "${PGPASS}.tmp" || true
    echo "localhost:5432:*:${DB_USER}:${pw}" >> "${PGPASS}.tmp"
    mv "${PGPASS}.tmp" "${PGPASS}" && chmod 600 "${PGPASS}"
    echo "Created login '${DB_USER}'; password saved in ~/.pgpass (only you can read it)."
  fi
fi

# Every psql call from here on goes over localhost, same as the app and test.sh.
export PGHOST=localhost
version="$(psql -X -d postgres -Atc 'show server_version_num')"
(( version / 10000 >= MIN_PG_MAJOR )) \
  || die "Postgres $(( version / 10000 )) is too old; Roomie needs ${MIN_PG_MAJOR} or newer."
echo "Running: Postgres $(psql -X -d postgres -Atc 'show server_version')"

# --- 5. Create the dev database ---------------------------------------------
step "Creating database '${DB_NAME}' (skipped if it exists)"
if psql -X -d postgres -Atc "select 1 from pg_database where datname = '${DB_NAME}'" | grep -q 1; then
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

# --- 7. Put Postgres on PATH for future shells (macOS only) -----------------
# Linux packages already put psql on PATH.
if [[ "${PLATFORM}" == mac ]]; then
  step "Adding ${MAC_FORMULA} to PATH"
  SHELL_RC="${HOME}/.zshrc"
  [[ "${SHELL:-}" == */bash ]] && SHELL_RC="${HOME}/.bash_profile"
  if grep -qs "${PG_BIN}" "${SHELL_RC}"; then
    echo "Already in ${SHELL_RC}."
  else
    printf '\n# Postgres 17 (Roomie)\nexport PATH="%s:$PATH"\n' "${PG_BIN}" >> "${SHELL_RC}"
    echo "Added to ${SHELL_RC}. Open a new terminal (or run: source ${SHELL_RC})."
  fi
fi

# --- 8. Migrations and seed data -------------------------------------------
step "Applying migrations and seed data"
if [[ -f "${REPO_ROOT}/database/migrate.sh" ]]; then
  DATABASE_URL="${DATABASE_URL}" bash "${REPO_ROOT}/database/migrate.sh"
else
  echo "database/migrate.sh not found yet; skipping migrations."
fi

SEED="${REPO_ROOT}/database/seeds/seed.sql"
if [[ -s "${SEED}" ]]; then
  psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 --single-transaction -q -f "${SEED}"
  echo "Loaded database/seeds/seed.sql."
else
  echo "database/seeds/seed.sql is empty; skipping seed data."
fi

step "Done. Connect with:  psql ${DATABASE_URL}"
