#!/usr/bin/env bash
# pre-push hook: fast checks for the side(s) changed since the base branch.
# CI runs the full suite; this only catches problems before they reach it.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
base=origin/master

if git rev-parse --verify --quiet "$base" >/dev/null &&
  ! git merge-base --is-ancestor "$base" HEAD; then
  echo "⚠ $base has new commits — rebase before opening/updating the PR (conventions.md › Branch)."
fi

changed=$(git diff --name-only "$(git merge-base "$base" HEAD 2>/dev/null || echo HEAD)" HEAD 2>/dev/null || true)

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

if grep -q '^qloud_backend/' <<<"$changed"; then
  echo "→ backend: mypy"
  (cd "$root/qloud_backend" && uv run --frozen mypy .)
  if port_open 5432 && port_open 6379 && port_open 4566; then
    echo "→ backend: pytest"
    (cd "$root/qloud_backend" && uv run --frozen pytest -q)
  else
    echo "⚠ backend: Postgres/Redis/LocalStack not running (docker compose up -d --wait) — skipping pytest; CI will run it."
  fi
fi

if grep -q '^qloud_frontend/' <<<"$changed"; then
  echo "→ frontend: typecheck + tests"
  (cd "$root/qloud_frontend" && pnpm typecheck && pnpm test)
fi
