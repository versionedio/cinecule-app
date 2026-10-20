// Checks every slide theme for readable contrast (WCAG ratios). Run: node scripts/check-themes.mjs
// Body text must reach 7:1 against the background, secondary and accent text 4.5:1, on both ends of the
// gradient and on card surfaces. Exits non-zero if any theme fails.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "themes-"));
const out = path.join(tmp, "theme.mjs");
execFileSync("npx", ["--yes", "esbuild", "src/render/theme.ts", "--format=esm", `--outfile=${out}`, "--log-level=error"], { stdio: "inherit" });
const { THEMES } = await import(out);

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

let failed = 0;
for (const t of THEMES) {
  const checks = [
    ["text on background", t.fg, t.bg, 7], ["text on gradient end", t.fg, t.bg2, 7], ["text on card", t.fg, t.surface, 7],
    ["secondary on background", t.muted, t.bg, 4.5], ["secondary on gradient end", t.muted, t.bg2, 4.5], ["secondary on card", t.muted, t.surface, 4.5],
    ["accent on background", t.accent, t.bg, 4.5], ["accent on gradient end", t.accent, t.bg2, 4.5], ["accent on card", t.accent, t.surface, 4.5]
  ];
  const bad = checks.filter(([, f, b, min]) => ratio(f, b) < min);
  console.log(`${bad.length ? "FAIL" : "ok  "} ${t.name.padEnd(9)} ` + checks.map(([n, f, b]) => ratio(f, b).toFixed(1)).join(" "));
  for (const [n, f, b, min] of bad) { failed++; console.log(`      ${n}: ${ratio(f, b).toFixed(2)} (needs ${min})`); }
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
