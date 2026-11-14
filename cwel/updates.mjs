import fs from "node:fs";
const read = (name) => fs.readFileSync(new URL(name, import.meta.url), "utf8");
const { id, update_url } = JSON.parse(read("fork.json"));
const upstream = read("../manifest.json").match(/"version":\s*"([^"]+)"/)[1];
const released = (() => {
  try {
    return Object.values(JSON.parse(read("../updates.json")).addons)[0].updates[0].version;
  } catch {
    return "";
  }
})();
const [, base, revision] = released.match(/^(.*)\.(\d+)$/) ?? [];
const next = process.argv[2] === "next";
if (!next && base !== upstream) {
  console.error(`updates.json is at ${released || "nothing"}, upstream is ${upstream}; run cwel/bump.sh`);
  process.exit(1);
}
const version = next ? `${upstream}.${base === upstream ? Number(revision) + 1 : 1}` : released;
const repo = update_url.split("/raw/")[0];
const name = repo.split("/").pop();
const update_link = `${repo}/releases/download/v${version}/${name}-${version}.xpi`;
console.log(JSON.stringify({ addons: { [id]: { updates: [{ version, update_link }] } } }, null, 2));
