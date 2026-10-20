import fs from "node:fs";
import path from "node:path";

/**
 * Real pictures for picture scenes, generated at render time.
 *
 * A picture scene's slide carries `data-art="cat"` (what it is about) and optionally
 * `data-image="a fluffy orange kitten..."` (an exact description). For each such scene one image is
 * generated, saved next to the render, and shown instead of the line icons. Anything that goes wrong
 * (no key, plan limits, a failed generation) skips that scene, and the renderer falls back to its icons,
 * so a picture can never make a render fail.
 *
 * Two providers are supported, chosen by which key is present (or IMAGE_PROVIDER=gemini|elevenlabs):
 *   - Gemini (GEMINI_API_KEY): one request, the image comes back inline. Needs billing enabled on the Google
 *     project; the free tier has no image quota.
 *   - ElevenLabs (ELEVENLABS_IMAGE_KEY): asynchronous (create, poll until completed, download, because the
 *     result link expires after about an hour). Needs a Pro plan.
 * Only the two small generate functions below are provider-specific.
 */

const API = "https://api.elevenlabs.io/v1/flows/image";
const POLL_MS = 3000; // the API asks for at least 2 s between polls
const MAX_WAIT_MS = 150_000;

const attr = (html, name) => html.match(new RegExp(`${name}="([^"]*)"`))?.[1]?.trim() ?? "";

/** The picture scenes in a project: [{ slideId, subjects, prompt }]. */
export function pictureScenes(slides, style) {
  const scenes = [];
  for (const slide of slides) {
    const html = String(slide.html_content ?? "");
    const subjects = attr(html, "data-art").split(",").map((s) => s.trim().replace(/-/g, " ")).filter(Boolean);
    if (subjects.length === 0) continue;
    const described = attr(html, "data-image");
    const subject = subjects.join(" and ");
    const prompt = described || `A beautiful photograph of ${/^[aeiou]/i.test(subject) ? "an" : "a"} ${subject}`;
    scenes.push({ slideId: slide.id, subjects, prompt: `${prompt}. ${style}` });
  }
  return scenes;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createGeneration(apiKey, body) {
  const res = await fetch(API, { method: "POST", headers: { "xi-api-key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`create ${res.status}: ${JSON.stringify(json.detail ?? json).slice(0, 300)}`);
  if (!json.id) throw new Error(`create returned no id (keys: ${Object.keys(json).join(", ")})`);
  return json.id;
}

async function waitForGeneration(apiKey, id) {
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    await sleep(POLL_MS);
    const res = await fetch(`${API}/${id}`, { headers: { "xi-api-key": apiKey } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`poll ${res.status}: ${JSON.stringify(json.detail ?? json).slice(0, 300)}`);
    if (json.status === "completed") {
      if (!json.content_url) throw new Error("completed without a content_url");
      return json;
    }
    if (json.status === "failed") throw new Error(`generation failed: ${json.failure_reason ?? ""} ${json.error_message ?? ""}`.trim());
    if (Date.now() > deadline) throw new Error(`still ${json.status} after ${MAX_WAIT_MS / 1000}s`);
  }
}

const EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

async function generateWithElevenLabs({ apiKey, prompt, outBase, model, resolution, quality, aspectRatio }) {
  const id = await createGeneration(apiKey, {
    model_id: model,
    prompt,
    aspect_ratio: aspectRatio,
    ...(resolution ? { resolution } : {}),
    ...(quality ? { quality } : {})
  });
  const done = await waitForGeneration(apiKey, id);
  const img = await fetch(done.content_url);
  if (!img.ok) throw new Error(`download ${img.status}`);
  const file = `${outBase}${EXT[done.content_mime_type] ?? ".png"}`;
  fs.writeFileSync(file, Buffer.from(await img.arrayBuffer()));
  return file;
}

async function generateWithGemini({ apiKey, prompt, outBase, model, resolution, aspectRatio, baseUrl }) {
  const base = baseUrl || "https://generativelanguage.googleapis.com/v1beta";
  // imageSize (1K/2K/4K) exists on the Gemini 3 image models only.
  const imageConfig = { aspectRatio, ...(resolution && !/^gemini-2\.5/.test(model) ? { imageSize: resolution } : {}) };
  const res = await fetch(`${base}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig } })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`gemini ${res.status}: ${String(json?.error?.message ?? JSON.stringify(json)).split("\n")[0].slice(0, 240)}`);
  const parts = (json.candidates ?? []).flatMap((c) => c.content?.parts ?? []);
  const inline = parts.map((p) => p.inlineData ?? p.inline_data).find((x) => x?.data);
  if (!inline) {
    const why = json.promptFeedback?.blockReason ?? json.candidates?.[0]?.finishReason ?? "no image in the response";
    throw new Error(`gemini returned no image (${why})`);
  }
  const file = `${outBase}${EXT[inline.mimeType ?? inline.mime_type] ?? ".png"}`;
  fs.writeFileSync(file, Buffer.from(inline.data, "base64"));
  return file;
}

/** Which provider and key to use, from the environment; null when neither key is set. */
export function imageProvider(env = process.env) {
  const wanted = env.IMAGE_PROVIDER;
  if ((wanted === "gemini" || !wanted) && env.GEMINI_API_KEY) return { name: "gemini", apiKey: env.GEMINI_API_KEY, baseUrl: env.GEMINI_BASE_URL, model: env.IMAGE_MODEL || "gemini-3.1-flash-image", resolution: env.IMAGE_RESOLUTION || "2K" };
  if ((wanted === "elevenlabs" || !wanted) && env.ELEVENLABS_IMAGE_KEY) return { name: "elevenlabs", apiKey: env.ELEVENLABS_IMAGE_KEY, model: env.IMAGE_MODEL || "gpt-image-2", resolution: env.IMAGE_RESOLUTION || "2K", quality: env.IMAGE_QUALITY || "medium" };
  return null;
}

/** Generates one image with the chosen provider and saves it to `outBase` plus the right extension. */
export async function generateImage({ provider, prompt, outBase, aspectRatio = "16:9" }) {
  const args = { ...provider, prompt, outBase, aspectRatio };
  return provider.name === "gemini" ? generateWithGemini(args) : generateWithElevenLabs(args);
}

/**
 * One image per picture scene, in parallel. Returns { slideId: "/__gen/<file>" } for the scenes that worked.
 * Settings come from the environment: IMAGE_PROVIDER, IMAGE_MODEL, IMAGE_RESOLUTION, IMAGE_QUALITY, IMAGE_STYLE.
 */
export async function generateSceneImages({ slides, dir, log = console, env = process.env }) {
  const style = env.IMAGE_STYLE || "Photorealistic, soft natural light, shallow depth of field, rich detail, no text, no watermark, no logos.";
  const scenes = pictureScenes(slides, style);
  if (scenes.length === 0) return {};
  const provider = imageProvider(env);
  if (!provider) {
    log.log(`Picture scenes found (${scenes.length}) but no image key is set; the icons will be used.`);
    return {};
  }
  log.log(`Generating ${scenes.length} picture(s) with ${provider.name} (${provider.model}).`);
  fs.mkdirSync(dir, { recursive: true });
  const photos = {};
  await Promise.all(
    scenes.map(async (scene) => {
      try {
        const file = await generateImage({ provider, prompt: scene.prompt, outBase: path.join(dir, scene.slideId) });
        photos[scene.slideId] = `/__gen/${path.basename(file)}`;
        log.log(`Picture for ${scene.slideId} (${scene.subjects.join(", ")}): ${path.basename(file)}`);
      } catch (e) {
        log.warn(`No picture for ${scene.slideId} (${scene.subjects.join(", ")}); using icons. ${e?.message || e}`);
      }
    })
  );
  return photos;
}
