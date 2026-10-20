// Renders one export asset to MP4:
//   Chromium steps the /render page frame by frame -> ffmpeg (with the voiceover clips placed at each
//   slide's start) -> upload -> render_complete.
//
//   node scripts/render/render.mjs --asset <exportasset id> [--dry-run --out file.mp4] [--debug] [--no-art]   (--debug burns timing info into the frames; --no-art turns off picture-scene icons)
//   node scripts/render/render.mjs --fixture [--res 1920x1080] [--fps 30] [--max-seconds 6]   (no login, no upload)
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { client, login } from "./lib.mjs";
import { generateSceneImages } from "./images.mjs";

const DIST = path.resolve("dist");
// There is no upload limit on the current plan, so videos are encoded for quality, not size.
// Set MAX_UPLOAD_BYTES (e.g. 10485760) to bring the size cap back if a plan ever has one again.
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 0;
const TARGET_BYTES = Math.floor(MAX_UPLOAD_BYTES * 0.9);
const AUDIO_KBPS = MAX_UPLOAD_BYTES ? 96 : 160;
// Default id of the get_voiceover_audio glyph; override with GLYPH_AUDIO_ID if it is ever recreated.
const AUDIO_GLYPH_ID = process.env.GLYPH_AUDIO_ID || "e94f67d5-30a9-476e-b830-4849cb359083";
const TOKEN_KEY = "cinecule.token";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    out[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return out;
}

function serveDist(genDir) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    // Generated pictures live outside dist, in a per-render folder.
    if (genDir && pathname.startsWith("/__gen/")) {
      const gen = path.join(genDir, path.basename(pathname));
      if (!fs.existsSync(gen)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": types[path.extname(gen)] || (path.extname(gen) === ".jpg" ? "image/jpeg" : path.extname(gen) === ".webp" ? "image/webp" : "application/octet-stream") });
      return fs.createReadStream(gen).pipe(res);
    }
    let file = path.join(DIST, pathname);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, port: server.address().port })));
}

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`))));
  });

// Optional render-page switches: ?debug=1 burns timing info into frames, ?art=0 turns off picture-scene icons.
function renderQuery({ debug, art }) {
  const q = [debug ? "debug=1" : "", art ? "" : "art=0"].filter(Boolean).join("&");
  return q ? `?${q}` : "";
}

// The director keeps or rejects every emphasis the storyboard proposes; log why, so a render is auditable.
function printDecisions(decisions = []) {
  if (decisions.length === 0) return console.log("Director: no emphasis proposals.");
  const kept = decisions.filter((d) => d.status === "kept").length;
  console.log(`Director: kept ${kept}, dropped ${decisions.length - kept} of ${decisions.length} proposals.`);
  for (const d of decisions) console.log(`  ${d.status === "kept" ? "+" : "-"} ${d.scene} ${d.selector || d.id}: ${d.reason}`);
}

/** audioClips: [{ file, start }] with `start` in seconds from the beginning of the video. */
async function renderVideo({ url, token, resolution, fps, audioClips, outFile, maxSeconds, onProgress = () => {} }) {
  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--force-color-profile=srgb"] });
  try {
    // Canvas size comes from the page, so open it once at a default size to learn it.
    let context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    if (token) await context.addInitScript(([k, v]) => localStorage.setItem(k, v), [TOKEN_KEY, token]);
    let page = await context.newPage();
    page.on("pageerror", (e) => console.error("[page]", e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__render, null, { timeout: 60_000 });
    const info = await page.evaluate(() => window.__render.ready);
    await context.close();

    // Render at the canvas's logical size and let deviceScaleFactor produce the requested resolution.
    const [resW, resH] = resolution.split("x").map(Number);
    const scale = Math.max(resW, resH) / Math.max(info.width, info.height);
    context = await browser.newContext({ viewport: { width: info.width, height: info.height }, deviceScaleFactor: scale });
    if (token) await context.addInitScript(([k, v]) => localStorage.setItem(k, v), [TOKEN_KEY, token]);
    page = await context.newPage();
    page.on("pageerror", (e) => console.error("[page]", e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__render, null, { timeout: 60_000 });
    const scene = await page.evaluate(() => window.__render.ready);
    printDecisions(scene.decisions);

    const duration = maxSeconds ? Math.min(info.duration, maxSeconds) : info.duration;
    const frames = Math.max(1, Math.round(duration * fps));
    const clips = (await audioClips(info)).filter((c) => c.start < duration);

    const args = ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-"];
    clips.forEach((c) => args.push("-i", c.file));
    const filters = ["[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[v]"];
    if (clips.length) {
      clips.forEach((c, i) => filters.push(`[${i + 1}:a]aresample=44100,adelay=${Math.round(c.start * 1000)}|${Math.round(c.start * 1000)}[a${i}]`));
      filters.push(`${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0:duration=longest[aout]`);
    }
    args.push("-filter_complex", filters.join(";"), "-map", "[v]");
    if (clips.length) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`);
    // Quality-based. Only when a size cap is configured is the video bitrate limited to fit it.
    const cap = MAX_UPLOAD_BYTES ? (() => { const kbps = Math.max(250, Math.floor((TARGET_BYTES * 8) / 1000 / duration - AUDIO_KBPS)); return ["-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`]; })() : [];
    args.push("-c:v", "libx264", "-preset", process.env.X264_PRESET || "medium", "-crf", MAX_UPLOAD_BYTES ? "20" : "18", ...cap, "-r", String(fps), "-t", String(duration), "-movflags", "+faststart", outFile);

    const ff = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
    let ffErr = "";
    ff.stderr.on("data", (d) => (ffErr += d));
    const closed = new Promise((resolve) => ff.on("close", resolve));
    ff.stdin.on("error", () => undefined); // surfaced through the exit code below

    console.log(`Rendering ${frames} frames (${duration.toFixed(1)}s @ ${fps} fps) at ${resolution}, scale ${scale.toFixed(2)}.`);
    const started = Date.now();
    let lastLog = -1;
    let lastReport = 0;
    // Frames are 8-88% of the whole job; encoding and upload make up the rest. The tail estimate is
    // deliberately generous so the countdown reaches zero a little late rather than hitting it early.
    const TAIL_SEC = 30;
    for (let f = 0; f < frames; f++) {
      await page.evaluate((t) => window.__render.setTime(t), f / fps);
      const buf = await page.screenshot({ type: "jpeg", quality: 95, animations: "disabled" });
      if (!ff.stdin.write(buf)) await once(ff.stdin, "drain");
      if (Date.now() - lastReport > 4000 && f > 0) {
        lastReport = Date.now();
        const perFrame = (Date.now() - started) / 1000 / f;
        onProgress({ stage: "Rendering frames", pct: 8 + (f / frames) * 80, eta: Math.round((frames - f) * perFrame + TAIL_SEC) });
      }
      const pct = Math.floor((f / frames) * 20) * 5;
      if (pct !== lastLog) {
        lastLog = pct;
        console.log(`  ${pct}%  (${f}/${frames}, ${((Date.now() - started) / 1000).toFixed(0)}s)`);
      }
    }
    ff.stdin.end();
    onProgress({ stage: "Finishing video", pct: 90, eta: 25 });
    const code = await closed;
    if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${ffErr.slice(-500)}`);
    return { duration, frames, info };
  } finally {
    await browser.close();
  }
}

async function runFixture(args) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "render-fixture-"));
  const outFile = path.resolve(args.out || "render-fixture.mp4");
  // --photo <file> stands in for a generated picture on the fixture's picture scene (no image key needed).
  const genDir = path.join(tmp, "gen");
  if (args.photo && typeof args.photo === "string") {
    fs.mkdirSync(genDir, { recursive: true });
    const name = `slp${path.extname(args.photo) || ".png"}`;
    fs.copyFileSync(args.photo, path.join(genDir, name));
    fs.writeFileSync(path.join(genDir, "photos.json"), JSON.stringify({ slp: `/__gen/${name}` }));
  }
  const { server, port } = await serveDist(genDir);
  try {
    const res = await renderVideo({
      url: `http://localhost:${port}/render/fixture${renderQuery({ debug: Boolean(args.debug), art: !args["no-art"] })}`,
      resolution: args.res || "1920x1080",
      fps: Number(args.fps) || 30,
      maxSeconds: args["max-seconds"] ? Number(args["max-seconds"]) : undefined,
      outFile,
      // One tone per slide, starting with the slide, to prove clip placement.
      audioClips: async (info) => {
        const clips = [];
        for (const [i, s] of info.slides.entries()) {
          const file = path.join(tmp, `tone-${i}.mp3`);
          await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=${330 + 110 * i}:duration=${Math.max(0.5, s.end - s.start - 0.5)}`, file]);
          clips.push({ file, start: s.start });
        }
        return clips;
      },
    });
    console.log(`Wrote ${outFile} (${res.duration.toFixed(1)}s).`);
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Uploads the video as free-form content and publishes it, returning a public URL that works on any
 * domain. The response shapes are read defensively, and what came back is printed if a step is missing,
 * so a mismatch is obvious in the run log.
 */
async function uploadPublicVideo(api, file, size, name) {
  const qs = new URLSearchParams({ contentType: "video/mp4", fileExtension: "mp4", contentLength: String(size), filename: name, name }).toString();
  const up = await api.get(`/content/uploadurl?${qs}`);
  const uploadUrl = up?.uploadUrl ?? up?.url;
  if (!uploadUrl) throw new Error(`content/uploadurl returned no upload address (got keys: ${Object.keys(up ?? {}).join(", ") || "none"})`);
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: await fs.openAsBlob(file) });
  if (!put.ok) throw new Error(`content upload failed (${put.status})`);
  const contentId = up?.contentId ?? up?.id ?? up?.content?.id;
  if (!contentId) throw new Error(`content/uploadurl returned no content id (got keys: ${Object.keys(up ?? {}).join(", ")})`);
  const pub = await api.post(`/content/${contentId}/publish`);
  const publicUrl = pub?.publicUrl;
  if (!publicUrl) throw new Error(`publish returned no public link (got keys: ${Object.keys(pub ?? {}).join(", ") || "none"})`);
  return publicUrl;
}

// dryRun: render to `out` and stop — no upload, no status changes (the asset is only read).
async function runAsset(assetId, { dryRun = false, out, debug = false, art = true } = {}) {
  const token = await login();
  const api = client(token);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
  const outFile = out ? path.resolve(out) : path.join(tmp, "video.mp4");
  const complete = (body) => api.post("/logicblocks/render_complete", { exportasset_id: assetId, ...body });
  // Progress is best-effort: a failed update must never fail the render itself.
  const report = async ({ stage, pct, eta }) => {
    if (dryRun) return;
    try {
      await api.put(`/update/exportasset/${assetId}`, { stage, progress_pct: Math.round(Math.min(99, pct)), eta_sec: Math.max(0, Math.round(eta)) });
    } catch (e) {
      console.warn("progress update failed:", e.message);
    }
  };
  let server;

  try {
    const asset = await api.get(`/item/exportasset/${assetId}`);
    const projectId = asset.project_id;
    const resolution = asset.resolution || "1920x1080";
    const fps = Number(asset.frame_rate) || 30;
    console.log(`Asset ${assetId}: project ${projectId}, ${resolution} @ ${fps} fps`);
    await report({ stage: "Preparing", pct: 3, eta: 120 });

    // Voiceover clips, fetched as base64 through the get_voiceover_audio glyph endpoint.
    const audios = await api.list("audio", { project_id: projectId, kind: "voiceover" });
    const clipFiles = new Map();
    for (const a of audios) {
      const r = await api.post(`/glyphs/${AUDIO_GLYPH_ID}/invoke`, { input: { audio_id: a.id } });
      const b64 = r?.result?.audio_base64;
      if (!b64) throw new Error(`No audio returned for audio ${a.id}`);
      const file = path.join(tmp, `${a.slide_id}.mp3`);
      fs.writeFileSync(file, Buffer.from(b64, "base64"));
      clipFiles.set(a.slide_id, file);
    }
    console.log(`Fetched ${clipFiles.size} voiceover clip(s).`);

    // Real pictures for picture scenes (skipped, with icons as the fallback, when no image key is set: GEMINI_API_KEY or ELEVENLABS_IMAGE_KEY).
    await report({ stage: "Creating pictures", pct: 5, eta: 110 });
    const genDir = path.join(tmp, "gen");
    const slides = await api.list("generatedhtml", { project_id: projectId });
    const photos = await generateSceneImages({ slides, dir: genDir });
    if (Object.keys(photos).length > 0) fs.writeFileSync(path.join(genDir, "photos.json"), JSON.stringify(photos));
    await report({ stage: "Starting the render", pct: 8, eta: 100 });

    const served = await serveDist(genDir);
    server = served.server;
    const result = await renderVideo({
      url: `http://localhost:${served.port}/render/${projectId}${renderQuery({ debug, art })}`,
      token,
      resolution,
      fps,
      outFile,
      onProgress: report,
      audioClips: (info) => info.slides.filter((s) => clipFiles.has(s.id)).map((s) => ({ file: clipFiles.get(s.id), start: s.start }))
    });

    if (dryRun) {
      console.log(`Dry run: wrote ${outFile} (${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB); nothing uploaded or changed.`);
      return;
    }

    // Upload through the platform's presigned URL for exportasset.file_key.
    let size = fs.statSync(outFile).size;
    if (MAX_UPLOAD_BYTES && size > MAX_UPLOAD_BYTES) {
      // Still over the plan limit: re-encode the finished file at a lower video bitrate.
      await report({ stage: "Compressing", pct: 93, eta: 40 });
      const squeezed = outFile.replace(/\.mp4$/, "") + ".small.mp4";
      const kbps = Math.max(200, Math.floor(((TARGET_BYTES * 8) / 1000 / result.duration - AUDIO_KBPS) * 0.9));
      await run("ffmpeg", ["-y", "-loglevel", "error", "-i", outFile, "-c:a", "copy", "-c:v", "libx264", "-preset", "medium", "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`, "-movflags", "+faststart", squeezed]);
      fs.renameSync(squeezed, outFile);
      size = fs.statSync(outFile).size;
      if (size > MAX_UPLOAD_BYTES) throw new Error(`Video is ${(size / 1e6).toFixed(1)} MB, over the ${(MAX_UPLOAD_BYTES / 1e6).toFixed(1)} MB upload limit even after compressing.`);
    }
    await report({ stage: "Uploading", pct: 94, eta: 12 });
    // A video must play on any device. Files in an entity file field are private and need cookies that
    // other devices (Safari, Firefox, phones) block, so the video goes up as published content with a
    // public link. If that path fails for any reason, fall back to the private upload so a render never fails here.
    let videoUrl;
    let fileKey;
    try {
      videoUrl = await uploadPublicVideo(api, outFile, size, `video-${assetId}.mp4`);
      console.log(`Published publicly: ${videoUrl}`);
    } catch (e) {
      console.warn(`Public upload failed (${e?.message || e}); falling back to the private upload. The video will only play in browsers signed in to nostackai.`);
      const up = await api.get(`/uploadurl/exportasset/file_key?contentType=video/mp4&fileExtension=mp4&contentLength=${size}`);
      const put = await fetch(up.uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: await fs.openAsBlob(outFile) });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      videoUrl = up.cdnUrl;
      fileKey = up.s3Key;
    }
    await api.put(`/update/exportasset/${assetId}`, { ...(fileKey ? { file_key: fileKey } : {}), cdn_url: videoUrl, stage: "Done", progress_pct: 100, eta_sec: 0 });
    await complete({ success: true, cdn_url: videoUrl, duration_sec: Number(result.duration.toFixed(2)) });
    console.log(`Done: ${(size / 1e6).toFixed(1)} MB at ${videoUrl}`);
  } catch (e) {
    console.error("Render failed:", e);
    if (!dryRun) await complete({ success: false, error_message: String(e?.message || e).slice(0, 400) }).catch((err) => console.error("Could not report failure:", err.message));
    process.exitCode = 1;
  } finally {
    server?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.fixture) await runFixture(args);
else if (args.asset) await runAsset(args.asset, { dryRun: Boolean(args["dry-run"]), out: typeof args.out === "string" ? args.out : undefined, debug: Boolean(args.debug), art: !args["no-art"] });
else {
  console.error("Usage: render.mjs --asset <id> | --fixture [--res WxH] [--fps N] [--max-seconds N] [--out file]");
  process.exit(2);
}
