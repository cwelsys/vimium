#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${WEB_EXT_API_KEY:?}" "${WEB_EXT_API_SECRET:?}" "${FORGEJO_TOKEN:?}"
[ "$(node cwel/updates.mjs)" = "$(cat updates.json)" ] || { echo "updates.json does not match upstream's version; run cwel/bump.sh" >&2; exit 1; }
link=$(node -e 'const u=JSON.parse(require("fs").readFileSync("updates.json","utf8"));console.log(Object.values(u.addons)[0].updates[0].update_link)')
tag=$(echo "$link" | sed -E 's|.*/releases/download/([^/]+)/.*|\1|')
[ "${CI_COMMIT_TAG:-$(git describe --tags --exact-match)}" = "$tag" ] || { echo "this commit is not tagged $tag" >&2; exit 1; }
xpi=${link##*/}
api=$(echo "$link" | sed -E 's|^(https://[^/]+)/([^/]+/[^/]+)/releases/.*|\1/api/v1/repos/\2|')
cwel/build.sh
rm -rf web-ext-artifacts
npx --yes web-ext sign --source-dir dist/cwel --artifacts-dir web-ext-artifacts --channel unlisted
cp web-ext-artifacts/*.xpi "$xpi"
id=$(curl -fsS -H "Authorization: token $FORGEJO_TOKEN" -H "Content-Type: application/json" -d "{\"tag_name\":\"$tag\",\"name\":\"$tag\"}" "$api/releases" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).id)')
curl -fsS -H "Authorization: token $FORGEJO_TOKEN" -F "attachment=@$xpi" "$api/releases/$id/assets?name=$xpi" >/dev/null
echo "released $link"
