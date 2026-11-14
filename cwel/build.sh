#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
out=dist/cwel
rm -rf "$out"
mkdir -p "$out"
git ls-files -z | xargs -0 cp --parents -t "$out"
(cd "$out" && ${DENO:-deno} run -A make.js write-firefox-manifest)
node cwel/manifest.mjs "$out/manifest.json"
(
  cd "$out"
  rm -rf .[!.]* ./*.md CREDITS MIT-LICENSE.txt build_scripts cwel dist make.js deno.json deno.lock \
    dprint.json reload.html reload.js test_harnesses tests updates.json icons/*.png
)
echo "built $out"
