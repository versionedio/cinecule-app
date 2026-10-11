#!/usr/bin/env bash
# Thin launcher for the shared release flow. The real script lives in the
# nostackai-playground-app-ci-cd repo at scripts/release.sh; this committed
# launcher lets the status-bar buttons call it with a short command.
R="${NOSTACKAI_RELEASE:-${NOSTACKAI_REPO_BASE:-$HOME/GitHub}/nostackai-playground-app-ci-cd/scripts/release.sh}"
if [ ! -x "$R" ]; then
  echo "✗ release.sh not found at: $R"
  echo "  Clone versionedio/nostackai-playground-app-ci-cd into ~/GitHub (or set NOSTACKAI_REPO_BASE)."
  exit 1
fi
exec "$R" cinecule "$@"
