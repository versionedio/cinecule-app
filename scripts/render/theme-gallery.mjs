// Renders every layout of the slide design system in each theme, so a theme can be judged by eye.
//   node scripts/render/theme-gallery.mjs [--themes midnight,forest] [--bg plain|gradient|glow] [--font editorial] [--out dir]
// Needs `npm run build` first. Writes one contact sheet per theme (gallery-<theme>.png), 3 columns of 1280x720.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const themes = (arg("themes", "midnight,ember,forest,ocean,paper,slate,plum")).split(",");
const bg = arg("bg", "gradient");
const font = arg("font", "theme");
const outDir = path.resolve(arg("out", "theme-gallery"));
fs.mkdirSync(outDir, { recursive: true });

const DIST = path.resolve("dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  let file = path.join(DIST, pathname);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const run = (cmd, args) => new Promise((resolve, reject) => { const p = spawn(cmd, args, { stdio: "ignore" }); p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} exited ${c}`)))); });
const browser = await chromium.launch();
for (const theme of themes) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`http://localhost:${port}/render/fixture?theme=${theme}&bg=${bg}&font=${font}&flat=1`);
  await page.waitForFunction(() => window.__render, null, { timeout: 60_000 });
  const info = await page.evaluate(() => window.__render.ready);
  const files = [];
  for (const [i, s] of info.slides.entries()) {
    // Late enough that the scene's content has arrived, early enough to be before the next transition.
    await page.evaluate((t) => window.__render.setTime(t), s.start + Math.min(7, (s.end - s.start) - 1.2));
    const file = path.join(outDir, `${theme}-${i}.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
    files.push(file);
  }
  await page.close();
  const list = path.join(outDir, `${theme}.txt`);
  fs.writeFileSync(list, files.map((f) => `file '${f}'`).join("\n"));
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", "scale=640:-1,tile=3x3", "-frames:v", "1", path.join(outDir, `gallery-${theme}.png`)]);
  for (const f of files) fs.rmSync(f);
  fs.rmSync(list);
  console.log(`gallery-${theme}.png (${files.length} layouts)`);
}
await browser.close();
server.close();
