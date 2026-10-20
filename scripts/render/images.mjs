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

// An HTML attribute's value, whichever way the storyboard quoted it: name="x", name='x' or name = "x".
const attr = (html, name) => {
  const m = html.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return (m?.[1] ?? m?.[2] ?? "").trim();
};

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
    scenes.push({
      slideId: slide.id,
      subjects,
      narration: String(slide.narration_text ?? "").trim(),
      described: Boolean(described), // the storyboard already gave an exact description; keep it
      basePrompt: prompt,
      prompt: `${prompt}. ${style}`
    });
  }
  return scenes;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const res = await fetchRetry(`${base}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig } })
  }, { timeoutMs: 120_000 });
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

const DESCRIBE_INSTRUCTIONS = `You write the image prompt for ONE scene of a narrated video. The picture appears on screen while the narrator says the scene's narration, so it must clearly relate to what is being said at that moment.

How to choose what to show:
- If the narration is about something concrete (an animal, place, object, person doing something), show that thing itself, literally.
- If the narration is abstract (a process, idea, feature, feeling, lesson), show a clear, concrete real-world scene or visual metaphor that stands for the idea, not a literal picture of the words. Pick ONE strong subject.
- Judge by THIS scene's narration, not the film's overall topic. Do not show something that is only mentioned in passing.

Write the prompt as a single photograph: the subject, setting, lighting and mood. Keep the subject centred with some empty space around it, wide 16:9 framing, uncluttered.
Never include text, letters, numbers, logos, screenshots, charts or user interfaces, and no recognisable real people.
Under 60 words. Reply with ONLY the prompt.`;

/** An image prompt written for one scene by a text model that reads the scene's own narration. */
export async function describeScene({ apiKey, baseUrl, model, filmOutline, narration }) {
  const base = baseUrl || "https://generativelanguage.googleapis.com/v1beta";
  const res = await fetchRetry(`${base}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: DESCRIBE_INSTRUCTIONS }] },
      contents: [{ parts: [{ text: `The whole film, scene by scene (for context only):\n${filmOutline}\n\nTHIS scene's narration:\n"${narration}"\n\nWrite the image prompt for this scene.` }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 1024 }
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`describe ${res.status}: ${String(json?.error?.message ?? JSON.stringify(json)).split("\n")[0].slice(0, 200)}`);
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim().replace(/^["'`]+|["'`]+$/g, "");
  if (text.length < 15) throw new Error("describe returned no usable prompt");
  return text;
}

/**
 * One image per picture scene, in parallel. Returns { slideId: "/__gen/<file>" } for the scenes that worked.
 * Settings come from the environment: IMAGE_PROVIDER, IMAGE_MODEL, IMAGE_RESOLUTION, IMAGE_QUALITY, IMAGE_STYLE.
 */
export async function generateSceneImages({ slides, dir, log = console, env = process.env }) {
  const style = env.IMAGE_STYLE || "Photorealistic, soft natural light, shallow depth of field, rich detail, no text, no watermark, no logos.";
  const scenes = pictureScenes(slides, style);
  if (scenes.length === 0) {
    // Say so: a silent skip is what made missing pictures hard to diagnose.
    const marked = slides.filter((sl) => String(sl.html_content ?? "").includes("data-art")).length;
    log.log(`No picture scenes to generate (${slides.length} slides, ${marked} mention data-art).`);
    return {};
  }
  const provider = imageProvider(env);
  if (!provider) {
    log.log(`Picture scenes found (${scenes.length}) but no image key is set; the icons will be used.`);
    return {};
  }
  log.log(`Generating ${scenes.length} picture(s) with ${provider.name} (${provider.model}).`);
  fs.mkdirSync(dir, { recursive: true });
  const photos = {};

  // A text model reads each scene's own narration and writes the picture description, so what is shown
  // matches what is said. Needs a Gemini key; without one (or if it fails) the plain subject prompt is used.
  const geminiKey = env.GEMINI_API_KEY;
  const describeModel = env.DESCRIBE_MODEL || "gemini-flash-latest";
  const filmOutline = slides.map((sl, i) => `${i + 1}. ${String(sl.narration_text ?? "").trim().slice(0, 220)}`).filter((l) => l.length > 4).join("\n");
  await Promise.all(
    scenes.map(async (scene) => {
      try {
        let prompt = scene.prompt;
        if (!scene.described && geminiKey && scene.narration) {
          try {
            prompt = `${await describeScene({ apiKey: geminiKey, baseUrl: env.GEMINI_BASE_URL, model: describeModel, filmOutline, narration: scene.narration })} ${style}`;
          } catch (e) {
            log.warn(`Could not write a description for ${scene.slideId}; using the plain subject. ${e?.message || e}`);
          }
        }
        log.log(`Prompt for ${scene.slideId} (${scene.subjects.join(", ")}): ${prompt}`);
        const file = await generateImage({ provider, prompt, outBase: path.join(dir, scene.slideId) });
        photos[scene.slideId] = `/__gen/${path.basename(file)}`;
        log.log(`Picture for ${scene.slideId} (${scene.subjects.join(", ")}): ${path.basename(file)}`);
      } catch (e) {
        log.warn(`No picture for ${scene.slideId} (${scene.subjects.join(", ")}); using icons. ${e?.message || e}`);
      }
    })
  );
  return photos;
}
