import fs from "node:fs";
const read = (name) => fs.readFileSync(new URL(name, import.meta.url), "utf8");
const file = process.argv[2];
const fork = JSON.parse(read("fork.json"));
const updates = JSON.parse(read("../updates.json")).addons[fork.id].updates[0];
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
manifest.name = fork.name;
manifest.version = updates.version;
Object.assign(manifest.browser_specific_settings.gecko, {
  id: fork.id,
  update_url: fork.update_url,
});
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
