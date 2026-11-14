#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[ -z "$(git status --porcelain)" ] || { echo "working tree is dirty" >&2; exit 1; }
next=$(node cwel/updates.mjs next)
v=$(node -e 'console.log(Object.values(JSON.parse(process.argv[1]).addons)[0].updates[0].version)' "$next")
! git rev-parse "v$v" >/dev/null 2>&1 || { echo "v$v already tagged" >&2; exit 1; }
echo "$next" > updates.json
git add updates.json
git commit -qm "release $v"
git tag -a "v$v" -m "v$v"
echo "tagged v$v; push with: git push --follow-tags"
