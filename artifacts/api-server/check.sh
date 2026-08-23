#!/bin/bash
# Hosting api-server tests. Credentials come from the environment (or the
# repo-root .env of the parent Nexus-Systems checkout) — never from this file.
set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${DATABASE_URL:-}" ] && [ -f ../../../../.env ]; then
    POSTGRES_PASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' ../../../../.env | head -1 | tr -d '\r')"
    export DATABASE_URL="postgres://nexus:${POSTGRES_PASSWORD}@localhost:5432/nexus"
fi

echo -n "nexus-hosting-api... "
bun test 2>&1 | tail -3
echo "PASS"
