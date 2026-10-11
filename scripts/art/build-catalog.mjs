// Builds src/render/art-catalog.json from an installed copy of lucide-static (ISC license).
//   node scripts/art/build-catalog.mjs <path to node_modules/lucide-static>
// Each entry: { t: search tags, b: the icon's inner SVG markup (24x24 viewBox, stroke-based) }.
import fs from "node:fs";
import path from "node:path";

const src = process.argv[2];
if (!src) {
  console.error("Usage: build-catalog.mjs <path to lucide-static>");
  process.exit(2);
}
const tags = JSON.parse(fs.readFileSync(path.join(src, "tags.json"), "utf8"));
const catalog = {};
for (const file of fs.readdirSync(path.join(src, "icons"))) {
  if (!file.endsWith(".svg")) continue;
  const name = file.replace(/\.svg$/, "");
  const svg = fs.readFileSync(path.join(src, "icons", file), "utf8");
  const inner = svg.slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, svg.lastIndexOf("</svg>")).replace(/\s*\n\s*/g, "").trim();
  if (inner) catalog[name] = { t: tags[name] ?? [], b: inner };
}
const out = path.resolve("src/render/art-catalog.json");
fs.writeFileSync(out, JSON.stringify(catalog));
console.log(`${Object.keys(catalog).length} icons -> ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
