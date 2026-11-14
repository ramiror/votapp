#!/usr/bin/env bash
# Actualiza a la última versión de la rama actual y reinicia.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
npm ci --omit=dev --no-audit --no-fund --loglevel=error
systemctl restart votapp
systemctl --no-pager --lines=5 status votapp
