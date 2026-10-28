import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * Pictures for a render: generated pictures for picture scenes, and the viewer's own pictures.
 *
 * No provider key is used here, or anywhere on GitHub. Everything that needs one (writing the picture prompts,
 * generating a picture, looking at a viewer's picture) is done by the `scene_images` glyph in nostackai, which reads the
 * tenant's own Secrets. This file only talks to that glyph through the platform API, the same way the audio step does.
 * Its source and settings are in glyphs/scene-images.cjs.
 *
 * A picture that cannot be made FAILS THE RENDER, with a message saying which scene and why. There is no fallback to
 * line icons or an empty frame: a video with a missing picture is worse than no video. The one thing that is not fatal is
 * the model's advice on how to show a viewer's picture: if it can't be had, the picture is simply shown whole.
 */

// Default id of the scene_images glyph; override with GLYPH_SCENE_IMAGES_ID if it is ever recreated.
const SCENE_IMAGES_GLYPH_ID = process.env.GLYPH_SCENE_IMAGES_ID || "9b70e18c-59d8-4a7d-b31e-e743df0942eb";

// An HTML attribute's value, whichever way the storyboard quoted it: name="x", name='x' or name = "x".
const attr = (html, name) => {
  const m = html.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return (m?.[1] ?? m?.[2] ?? "").trim();
};

const themeOfHtml = (html) => String(html ?? "").match(/data-theme\s*=\s*(?:"([^"]*)"|'([^']*)')/)?.slice(1, 3).find(Boolean)?.trim().toLowerCase();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

/** Runs one action of the scene_images glyph and returns its result ({ ok, ... }). Throws only if the call itself failed. */
async function callGlyph(api, input) {
  const res = await api.post(`/glyphs/${SCENE_IMAGES_GLYPH_ID}/invoke`, { input });
  const out = res?.result;
  if (!out || typeof out !== "object") throw new Error("the scene_images glyph returned nothing");
  return out;
}

/** fetch with a timeout, retrying the temporary failures (overloaded or unavailable: 500, 502, 503, 504). */
async function fetchRetry(url, init, { tries = 4, timeoutMs = 90_000 } = {}) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (![500, 502, 503, 504].includes(res.status) || attempt === tries) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      last = e;
      if (attempt === tries) throw e;
    }
    await sleep(2000 * attempt); // 2 s, 4 s, 6 s
  }
  throw last;
}

const runTool = (cmd, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} failed (${code}): ${err.slice(-300)}`))));
  });

// ---------------------------------------------------------------------------------------------------------------------
// Generated pictures for picture scenes
// ---------------------------------------------------------------------------------------------------------------------

/** The picture scenes in a project: [{ slideId, subjects, narration, described, basePrompt, prompt }]. */
export function pictureScenes(slides, style) {
  const scenes = [];
  for (const slide of slides) {
    const html = String(slide.html_content ?? "");
    const subjects = attr(html, "data-art").split(",").map((s) => s.trim().replace(/-/g, " ")).filter(Boolean);
    if (subjects.length === 0) continue;
    const described = attr(html, "data-image");
    const subject = subjects.join(" and ");
    const prompt = described || `A clear, simple photograph of ${/^[aeiou]/i.test(subject) ? "an" : "a"} ${subject} on a plain background`;
    scenes.push({
      slideId: slide.id,
      projectId: slide.project_id,
      subjects,
      narration: String(slide.narration_text ?? "").trim(),
      described: Boolean(described), // the storyboard already gave an exact description; keep it
      basePrompt: prompt,
      prompt: `${prompt}. ${style}`
    });
  }
  return scenes;
}

/** The picture the glyph made, fetched back from it in slices (it is too large for one response) and saved to `outBase`. */
async function fetchGeneratedPicture(api, made, outBase) {
  const parts = [];
  for (let i = 0; i < made.chunks; i++) {
    const chunk = await callGlyph(api, { action: "get_chunk", key: made.key, index: i });
    if (!chunk.ok) throw new Error(`could not read the picture back (${chunk.error})`);
    parts.push(Buffer.from(chunk.data_base64, "base64"));
  }
  const bytes = Buffer.concat(parts);
  if (made.bytes && bytes.length !== made.bytes) throw new Error(`the picture came back incomplete (${bytes.length} of ${made.bytes} bytes)`);
  const file = `${outBase}${EXT[made.mime] ?? ".png"}`;
  fs.writeFileSync(file, bytes);
  return file;
}

const sceneNumber = (slides, slideId) => slides.findIndex((sl) => sl.id === slideId) + 1;

/**
 * One image per picture scene, in parallel. Returns { slideId: "/__gen/<file>" }, one for every picture scene, or throws
 * naming the scenes whose picture could not be made (each is tried twice first).
 * `api` is the platform client; it is required, since the glyph is what makes the pictures.
 * `aspectRatio` is the shape of this render: "16:9", "9:16" or "1:1". IMAGE_STYLE is a plain (non-secret) style suffix.
 */
export async function generateSceneImages({ slides, dir, api, aspectRatio = "16:9", log = console, env = process.env }) {
  const style = env.IMAGE_STYLE || "Clear, simple, realistic photograph with one subject, a plain uncluttered background and soft natural light. No text, no watermark, no logos.";
  const scenes = pictureScenes(slides, style);
  if (scenes.length === 0) {
    // Say so: a silent skip is what made missing pictures hard to diagnose.
    const marked = slides.filter((sl) => String(sl.html_content ?? "").includes("data-art")).length;
    log.log(`No picture scenes to generate (${slides.length} slides, ${marked} mention data-art).`);
    return {};
  }
  if (!api) throw new Error(`The film has ${scenes.length} picture scene(s), but there is no platform connection to make them.`);
  log.log(`Generating ${scenes.length} picture(s) through the scene_images glyph (${aspectRatio}).`);
  fs.mkdirSync(dir, { recursive: true });
  const photos = {};

  // The glyph's text model reads each scene's own narration and writes the picture description, so what is shown matches
  // what is said. If that fails, the plain subject prompt is used.
  let written = { style: "", prompts: {} };
  try {
    const outline = slides.map((sl, i) => `${i + 1}. ${String(sl.narration_text ?? "").trim().slice(0, 220)}`).filter((l) => l.length > 4).join("\n");
    const theme = slides.map((sl) => themeOfHtml(sl.html_content)).find(Boolean);
    const out = await callGlyph(api, {
      action: "write_prompts",
      outline,
      theme,
      scenes: scenes.map((sc) => ({ id: sc.slideId, number: slides.findIndex((sl) => sl.id === sc.slideId) + 1, narration: sc.narration, described: sc.described }))
    });
    if (out.ok) written = { style: out.style || "", prompts: out.prompts || {} };
    else log.warn(`Could not write picture descriptions (${out.error}); using the plain subject.`);
    if (written.style) log.log(`Visual style for the film: ${written.style}`);
  } catch (e) {
    log.warn(`Could not write picture descriptions; using the plain subject. ${e?.message || e}`);
  }

  const failures = [];
  await Promise.all(
    scenes.map(async (scene) => {
      const prompt = written.prompts[scene.slideId] ? `${written.prompts[scene.slideId]} ${style}` : scene.prompt;
      log.log(`Prompt for ${scene.slideId} (${scene.subjects.join(", ")}): ${prompt}`);
      let lastError = "";
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const made = await callGlyph(api, { action: "generate_image", id: `${scene.projectId || "film"}-${scene.slideId}`, prompt, aspect_ratio: aspectRatio });
          if (!made.ok) throw new Error(made.error);
          const file = await fetchGeneratedPicture(api, made, path.join(dir, scene.slideId));
          photos[scene.slideId] = `/__gen/${path.basename(file)}`;
          log.log(`Picture for ${scene.slideId} (${scene.subjects.join(", ")}): ${path.basename(file)}`);
          return;
        } catch (e) {
          lastError = String(e?.message || e);
          log.warn(`Picture for ${scene.slideId} (${scene.subjects.join(", ")}) failed, attempt ${attempt} of 2. ${lastError}`);
          // A missing key or an unusable prompt will not be different the second time.
          if (/no_key|bad prompt|bad id/.test(lastError)) break;
        }
      }
      failures.push(`scene ${sceneNumber(slides, scene.slideId)} (${scene.subjects.join(" and ")}): ${lastError}`);
    })
  );
  if (failures.length) throw new Error(`Could not make ${failures.length === 1 ? "a picture" : `${failures.length} pictures`}: ${failures.sort().join("; ")}`.slice(0, 380));
  return photos;
}

// ---------------------------------------------------------------------------------------------------------------------
// The viewer's own pictures
//
// A scene whose root carries data-image-source="<contentsource id>" shows a picture the viewer attached. It is shown
// either WHOLE (nothing cut off, on a blurred copy of itself where the shape differs from the frame) or CROPPED to its
// main subject. A model that can see the picture, and knows what the narrator says over it, makes the call (the glyph's
// `look` action); plain rules below then overrule it wherever cutting would lose something (screenshots, charts, text,
// a subject that fills the frame, a crop that would have to be blown up too far). With no answer from the glyph, the
// picture is simply shown whole.
// ---------------------------------------------------------------------------------------------------------------------

// Only photographs and illustrations can lose their edges without losing meaning.
const CROPPABLE = new Set(["photo", "illustration"]);
const MAX_UPLOAD = 25 * 1024 * 1024;
const MAX_UPSCALE = 2.5; // a crop blown up more than this (canvas pixels per source pixel) would look soft
const MIN_GAIN = 0.8; // a crop that keeps more than this share of the picture is not worth making
const MARGIN = 0.12; // breathing room around the subject, as a share of its size

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The scenes that show the viewer's own picture: [{ slideId, sourceId, narration }]. */
export function userImageScenes(slides) {
  const out = [];
  for (const slide of slides) {
    const sourceId = attr(String(slide.html_content ?? ""), "data-image-source");
    if (sourceId) out.push({ slideId: slide.id, sourceId, narration: String(slide.narration_text ?? "").trim() });
  }
  return out;
}

/**
 * The part of the picture to show: the subject box (fractions of the picture) plus breathing room, widened or heightened
 * to the frame's shape and kept inside the picture. Returns fractions of the picture, plus the size in source pixels.
 */
export function cropRect({ width: W, height: H, box, canvas }) {
  const frame = canvas.width / canvas.height;
  let bw = box.w * W;
  let bh = box.h * H;
  const cx = box.x * W + bw / 2;
  const cy = box.y * H + bh / 2;
  bw *= 1 + 2 * MARGIN;
  bh *= 1 + 2 * MARGIN;
  let rw = bw;
  let rh = bh;
  if (rw / rh < frame) rw = rh * frame;
  else rh = rw / frame;
  const fit = Math.min(1, W / rw, H / rh);
  rw *= fit;
  rh *= fit;
  const x = clamp(cx - rw / 2, 0, W - rw);
  const y = clamp(cy - rh / 2, 0, H - rh);
  return { x: x / W, y: y / H, w: rw / W, h: rh / H, sourceWidth: rw, sourceHeight: rh };
}

const validBox = (b) =>
  b && [b.x, b.y, b.w, b.h].every((n) => typeof n === "number" && Number.isFinite(n)) && b.w >= 0.08 && b.h >= 0.08 && b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.001 && b.y + b.h <= 1.001;

/**
 * The final treatment, from what the model said and the picture's real size. Pure, so it can be tested without a model.
 * `answer` is { kind, has_text, treatment, subject: {x,y,w,h}, reason }; null when there was no answer.
 */
export function decideTreatment({ answer, size, canvas }) {
  const aspect = size.width / size.height;
  const whole = (reason) => ({ treatment: "whole", aspect, reason });
  if (!answer) return whole("no analysis; shown whole");
  const kind = String(answer.kind ?? "").toLowerCase();
  if (answer.treatment !== "focus") return whole(answer.reason ? `shown whole: ${answer.reason}` : "shown whole");
  if (!CROPPABLE.has(kind)) return whole(`a ${kind || "this kind of picture"} is never cropped`);
  if (answer.has_text) return whole("it has text that cropping could cut");
  if (!validBox(answer.subject)) return whole("no usable subject box");
  const rect = cropRect({ width: size.width, height: size.height, box: answer.subject, canvas });
  if (rect.w * rect.h > MIN_GAIN) return whole("the subject already fills most of the picture");
  const upscale = canvas.width / rect.sourceWidth;
  if (upscale > MAX_UPSCALE) return whole(`the crop would be blown up ${upscale.toFixed(1)}x and look soft`);
  const eps = 0.005;
  const s = answer.subject;
  if (s.x < rect.x - eps || s.y < rect.y - eps || s.x + s.w > rect.x + rect.w + eps || s.y + s.h > rect.y + rect.h + eps) return whole("the frame is too narrow to hold the whole subject");
  return { treatment: "focus", aspect, crop: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, reason: `cropped to the subject${answer.reason ? `: ${answer.reason}` : ""}` };
}

/** A picture's pixel size, read with ffprobe (installed with ffmpeg). */
async function probeSize(file) {
  const out = await runTool("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file]);
  const [width, height] = out.trim().split("x").map(Number);
  if (!(width > 0 && height > 0)) throw new Error("could not read the picture's size");
  return { width, height };
}

/** Saves the picture beside the render. Anything a browser cannot show is converted to PNG. */
async function downloadUserImage(url, dir, name) {
  const res = await fetchRetry(url, {}, { timeoutMs: 60_000 });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/")) throw new Error(`not a picture (${type || "no content type"})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_UPLOAD) throw new Error(`picture is ${(bytes.length / 1e6).toFixed(0)} MB, over the ${MAX_UPLOAD / 1e6} MB limit`);
  const ext = EXT[type];
  if (ext) {
    const file = path.join(dir, `${name}${ext}`);
    fs.writeFileSync(file, bytes);
    return file;
  }
  const raw = path.join(dir, `${name}.src`);
  fs.writeFileSync(raw, bytes);
  const png = path.join(dir, `${name}.png`);
  await runTool("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-frames:v", "1", png]);
  return png;
}

/** The glyph's answer about one picture, from a small copy of it (the full file stays here); null if it can't say. */
async function askAboutPicture({ api, imagePath, narration, canvas, label, log }) {
  try {
    const small = `${imagePath}.look.jpg`;
    await runTool("ffmpeg", ["-y", "-loglevel", "error", "-i", imagePath, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "4", small]);
    const out = await callGlyph(api, { action: "look", image_base64: fs.readFileSync(small).toString("base64"), narration, canvas_width: canvas.width, canvas_height: canvas.height });
    if (!out.ok) throw new Error(out.error);
    log.log(`Looked at the picture for ${label} with ${out.provider}.`);
    return out.answer ?? null;
  } catch (e) {
    log.warn(`Could not analyse the picture for ${label}; showing it whole. ${e?.message || e}`);
    return null;
  }
}

/**
 * Decides how one saved picture is shown (whole or cropped) and returns what the render page needs to draw it.
 * `answer` stands in for the model's answer (the fixture's --user-image-answer); `api` null means no model is asked.
 */
export async function treatUserImage({ file, narration, canvas, label, api = null, log = console, answer: given = null }) {
  const size = await probeSize(file);
  const answer = given ?? (api ? await askAboutPicture({ api, imagePath: file, narration, canvas, label, log }) : null);
  const decision = decideTreatment({ answer, size, canvas });
  log.log(`Viewer's picture for ${label}: ${size.width}x${size.height}, ${decision.treatment}. ${decision.reason}`);
  return { url: `/__gen/${path.basename(file)}`, ...decision };
}

/**
 * Downloads the viewer's pictures and decides how each is shown. Returns { slideId: { url, treatment, aspect, crop? } },
 * one for every scene, or throws naming the scenes whose picture is missing, not this film's, or unreadable.
 */
export async function prepareUserImages({ slides, projectId, api, dir, canvas, log = console }) {
  const scenes = userImageScenes(slides);
  if (scenes.length === 0) return {};
  fs.mkdirSync(dir, { recursive: true });
  const out = {};
  const failures = [];
  await Promise.all(
    scenes.map(async (scene) => {
      try {
        const source = await api.get(`/item/contentsource/${encodeURIComponent(scene.sourceId)}`);
        // A scene can only show a picture attached to THIS film; the id comes from storyboard HTML that an owner can edit.
        if (!source || source.project_id !== projectId || source.source_type !== "image" || !source.file_url) throw new Error("that source is not a picture attached to this film");
        const file = await downloadUserImage(source.file_url, dir, `user-${scene.slideId}`);
        out[scene.slideId] = await treatUserImage({ file, narration: scene.narration, canvas, label: scene.slideId, api, log });
      } catch (e) {
        log.warn(`No viewer's picture for ${scene.slideId}. ${e?.message || e}`);
        failures.push(`scene ${sceneNumber(slides, scene.slideId)}: ${String(e?.message || e)}`);
      }
    })
  );
  if (failures.length) throw new Error(`Could not use ${failures.length === 1 ? "the viewer's picture" : `${failures.length} of the viewer's pictures`}: ${failures.sort().join("; ")}`.slice(0, 380));
  return out;
}
