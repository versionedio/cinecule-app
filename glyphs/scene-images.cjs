// scene_images: the render worker's picture and vision calls, kept in nostackai so no provider key lives on GitHub.
//
// This file is the source of the `scene_images` glyph (id 9b70e18c-59d8-4a7d-b31e-e743df0942eb). It is published to
// nostackai with the MCP update_glyph + publish_glyph tools; edit it here first so the code is versioned, then publish.
// The render worker (scripts/render/images.mjs) calls it through POST /glyphs/<id>/invoke. Tests: glyphs/scene-images.test.mjs.
//
// Keys and settings are the TENANT'S, set in the console (Tenant Management -> Secrets / General), never in this code:
//   Secrets:  GEMINI_API_KEY   writes picture prompts, generates pictures, and can look at a viewer's picture
//             KIMI_API_KEY     can look at a viewer's picture instead (a Kimi model that accepts images)
//   General:  IMAGE_MODEL (default gemini-3.1-flash-image), IMAGE_RESOLUTION (default 2K), DESCRIBE_MODEL (default
//             gemini-flash-latest), VISION_PROVIDER (gemini | kimi; default: Gemini when its key is set, else Kimi),
//             KIMI_VISION_MODEL (default kimi-k3), KIMI_BASE_URL (default https://api.moonshot.ai/v1)
// The org's Allowed Domains (outbound) must include generativelanguage.googleapis.com and api.moonshot.ai.
//
// Actions (request.action), every one returns { ok, ... } and never throws, so a failed picture can't fail a render:
//   write_prompts   { scenes: [{ id, narration, described }], outline, theme }  -> { ok, style, prompts: { id: text } }
//   generate_image  { id, prompt, aspect_ratio }                                -> { ok, key, mime, bytes, chunks }
//   get_chunk       { key, index }                                              -> { ok, index, chunks, data_base64 }
//   look            { image_base64, narration, canvas_width, canvas_height }    -> { ok, provider, answer }
// A picture can be several megabytes, more than one response should carry, so generate_image keeps it in the tenant's
// content store and get_chunk hands it back in slices. (The sandbox has no timers and http.get cannot send headers.)

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_PROMPT = 4000;
const MAX_LOOK_BASE64 = 3000000;
const CHUNK_BYTES = 1500000;
const ASPECTS = ["16:9", "9:16", "1:1"];
const KEY_PREFIX = "scene-images/";
const KEY_RE = /^scene-images\/[A-Za-z0-9_.-]{1,160}$/;

// The colour mood each slide theme calls for, so a film's pictures sit well next to its slides.
const THEME_MOOD = {
  midnight: "deep midnight blues and dark tones with small warm golden highlights",
  ember: "warm ember oranges, amber light and deep brown shadows, a dusk feel",
  forest: "deep forest greens and soft natural daylight, earthy and fresh",
  ocean: "teal and deep sea blues with clear, cool light",
  paper: "warm cream and soft neutral tones, gentle diffused daylight, slightly muted and editorial",
  slate: "cool grey-blue tones with clean, bright, even light",
  plum: "rich plum purples and soft pinks with moody, glowing light"
};

const DESCRIBE_INSTRUCTIONS = `You write the image prompt for ONE scene of a narrated video. The picture fills the screen while the narrator says the scene's narration, so a viewer should understand at a glance what it shows and why.

KEEP IT DIRECT AND SIMPLE
- Show the actual thing the narration talks about: the animal, place, object or person doing the thing, plainly and literally. If the narration names something, that is the picture.
- If the narration is about an idea, process or feeling with nothing to point at, pick the single most ordinary, easily recognised everyday object or situation that goes with it (a person at a laptop, a hand holding a phone, a key in a lock, a road ahead). No metaphors, no symbolism, no surreal, dreamlike or conceptual imagery, no glowing abstract shapes, no light trails, no floating objects.
- Judge by THIS scene's narration, not the film's overall topic. Do not show something that is only mentioned in passing.

Your prompt is ONE plain sentence or two, 15 to 35 words, that names:
1. ONE main subject, specific and familiar (for example "a golden retriever", "a red bicycle", "a woman typing on a laptop").
2. What it is doing, or where it is, in a simple everyday setting with a plain, uncluttered background.
3. A natural, even light.
Use ordinary concrete words. One subject only, centred, in a clear realistic photograph. No collage, no dramatic camera tricks, no heavy mood or colour effects.
Never include text, letters, numbers, logos, screens showing text, charts or user interfaces, and no recognisable real people.

EXAMPLES
Narration: "Retractable claws stay razor-sharp, and night vision works at one-sixth of the light a human needs."
Prompt: A grey tabby cat sitting on a garden wall at dusk, looking straight at the camera, with a soft blurred hedge behind it.
Narration: "The platform handled the data, the workflows and the storage, so I could focus on the product."
Prompt: A person working at a tidy desk with a laptop, in a bright, simple home office.

Reply with ONLY the prompt.`;

const FILM_STYLE_INSTRUCTIONS = `You are the art director of a narrated video. From the film's outline and a colour mood, write ONE short style direction (12 to 25 words) that every picture in the film will share: plain, clear, realistic photographs with a simple uncluttered background and natural light, tinted lightly towards the colour mood. Keep it simple and literal: nothing stylised, dramatic, surreal or abstract. Do not describe any subject. No text in images. Reply with ONLY the direction.`;

const LOOK_INSTRUCTIONS = `You help edit a narrated video. A viewer attached a picture of their own, and it will fill the screen while the narrator speaks. Look at the picture and decide how to show it.

Answer with JSON only:
{"kind": one of "photo" | "illustration" | "screenshot" | "chart" | "diagram" | "document" | "logo",
 "has_text": true if any readable text, numbers or labels are part of the picture,
 "subject": {"x": 0..1, "y": 0..1, "w": 0..1, "h": 0..1} a tight box around the main subject, as fractions of the picture's width and height measured from the top-left,
 "treatment": "whole" or "focus",
 "reason": one short sentence}

Choose "whole" (show all of it, nothing cut off) when:
- it is a screenshot, chart, diagram, document, logo or anything with text, since cutting it loses information;
- the narration is about the picture as a whole, or about several things in it;
- the subject already fills most of the picture;
- you are not sure. Showing everything is always safe.
Choose "focus" (crop to the subject) only when it is a photograph or illustration, ONE clear main subject takes up a fairly small part of a busy or empty picture, and the narration is about that subject. Cropping then removes distraction and makes the subject large.
Never invent a subject the narration does not talk about.`;

const secret = (ctx, name) => String((ctx.params && ctx.params.secrets && ctx.params.secrets[name]) || "").trim();
const setting = (ctx, name, fallback) => {
  const v = ctx.params && ctx.params.settings ? ctx.params.settings[name] : undefined;
  return v === undefined || v === null || String(v).trim() === "" ? fallback : String(v).trim();
};
const fail = (error) => ({ ok: false, error: String(error).slice(0, 300) });
const message = (e) => String((e && e.message) || e);
const okStatus = (res) => Boolean(res) && res.status >= 200 && res.status < 300;
const parse = (res) => {
  try {
    return JSON.parse(res.body);
  } catch (e) {
    return null;
  }
};
const reason = (res, json) => `${res ? res.status : "no response"}: ${String((json && json.error && json.error.message) || (res && res.body) || "").split("\n")[0].slice(0, 200)}`;

// A temporary failure (overloaded or unavailable) is tried once more at once; the sandbox has no timers to wait with.
async function post(ctx, url, body, headers) {
  let res = await ctx.http.post(url, body, headers);
  if (res && res.status >= 500 && res.status < 600) res = await ctx.http.post(url, body, headers);
  return res;
}

async function askGemini(ctx, { apiKey, model, system, user, maxOutputTokens = 1024, temperature = 0.6 }) {
  const res = await post(
    ctx,
    `${GEMINI_BASE}/models/${model}:generateContent`,
    { systemInstruction: { parts: [{ text: system }] }, contents: [{ parts: [{ text: user }] }], generationConfig: { temperature, maxOutputTokens } },
    { "x-goog-api-key": apiKey, "Content-Type": "application/json" }
  );
  const json = parse(res);
  if (!okStatus(res)) throw new Error(`text model ${reason(res, json)}`);
  const parts = (json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
  return parts.map((p) => p.text || "").join("").trim().replace(/^["'`]+|["'`]+$/g, "");
}

// ---------------------------------------------------------------------------------------------------------------------
async function writePrompts(request, ctx) {
  const apiKey = secret(ctx, "GEMINI_API_KEY");
  if (!apiKey) return { ok: true, style: "", prompts: {}, note: "no GEMINI_API_KEY secret; plain prompts will be used" };
  const model = setting(ctx, "DESCRIBE_MODEL", "gemini-flash-latest");
  const scenes = (Array.isArray(request.scenes) ? request.scenes : []).slice(0, 12).filter((s) => s && typeof s.id === "string" && !s.described && String(s.narration || "").trim());
  const outline = String(request.outline || "").slice(0, 6000);
  const mood = THEME_MOOD[String(request.theme || "").toLowerCase()] || "natural, balanced colours with soft light";
  if (scenes.length === 0) return { ok: true, style: "", prompts: {} };

  let style = "";
  try {
    style = await askGemini(ctx, { apiKey, model, system: FILM_STYLE_INSTRUCTIONS, user: `Film outline:\n${outline}\n\nColour mood to follow: ${mood}\n\nWrite the visual style direction.`, maxOutputTokens: 600 });
    if (style.length < 15) style = "";
  } catch (e) {
    ctx.log(`film style failed: ${message(e)}`);
  }

  const prompts = {};
  await Promise.all(
    scenes.map(async (scene, i) => {
      try {
        const user =
          `The whole film, scene by scene (for context only):\n${outline}\n\nColour mood to lean towards: ${mood}\n` +
          (style ? `Shared visual style for every picture in this film: ${style}\n` : "") +
          `\nTHIS is scene ${Number(scene.number) || i + 1}. Its narration:\n"${String(scene.narration).slice(0, 600)}"\n\nWrite the image prompt for this scene.`;
        const text = await askGemini(ctx, { apiKey, model, system: DESCRIBE_INSTRUCTIONS, user });
        if (text.length >= 15) prompts[scene.id] = text;
      } catch (e) {
        ctx.log(`prompt for ${scene.id} failed: ${message(e)}`);
      }
    })
  );
  return { ok: true, style, prompts };
}

async function generateImage(request, ctx) {
  const apiKey = secret(ctx, "GEMINI_API_KEY");
  if (!apiKey) return fail("no_key: add a GEMINI_API_KEY secret for this tenant");
  const prompt = String(request.prompt || "").trim();
  if (!prompt || prompt.length > MAX_PROMPT) return fail("bad prompt");
  const aspect = ASPECTS.includes(request.aspect_ratio) ? request.aspect_ratio : "16:9";
  const id = String(request.id || "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 120);
  if (!id) return fail("bad id");
  const model = setting(ctx, "IMAGE_MODEL", "gemini-3.1-flash-image");
  const resolution = setting(ctx, "IMAGE_RESOLUTION", "2K");
  // imageSize (1K/2K/4K) exists on the Gemini 3 image models only.
  const imageConfig = { aspectRatio: aspect };
  if (resolution && !/^gemini-2\.5/.test(model)) imageConfig.imageSize = resolution;
  const res = await post(
    ctx,
    `${GEMINI_BASE}/models/${model}:generateContent`,
    { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig } },
    { "x-goog-api-key": apiKey, "Content-Type": "application/json" }
  );
  const json = parse(res);
  if (!okStatus(res)) return fail(`gemini ${reason(res, json)}`);
  const parts = ((json && json.candidates) || []).reduce((all, c) => all.concat((c.content && c.content.parts) || []), []);
  const inline = parts.map((p) => p.inlineData || p.inline_data).find((x) => x && x.data);
  if (!inline) {
    const why = (json && ((json.promptFeedback && json.promptFeedback.blockReason) || (json.candidates && json.candidates[0] && json.candidates[0].finishReason))) || "no image in the response";
    return fail(`gemini returned no image (${why})`);
  }
  const mime = String(inline.mimeType || inline.mime_type || "image/png");
  const bytes = ctx.lib.buffer.from(inline.data, "base64");
  const key = KEY_PREFIX + id;
  await ctx.content_s3.putObject(key, bytes, mime);
  return { ok: true, key, mime, bytes: bytes.length, chunks: Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES)) };
}

async function getChunk(request, ctx) {
  const key = String(request.key || "");
  if (!KEY_RE.test(key)) return fail("bad key");
  const index = Number(request.index);
  if (!Number.isInteger(index) || index < 0) return fail("bad index");
  let bytes;
  try {
    bytes = await ctx.content_s3.getObject(key);
  } catch (e) {
    return fail(`not found: ${message(e)}`);
  }
  const chunks = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
  if (index >= chunks) return fail("index past the end");
  return { ok: true, index, chunks, data_base64: bytes.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES).toString("base64") };
}

// A model's reply as JSON, whether or not it wrapped it in a code fence or added a sentence around it.
function parseJsonReply(text) {
  const clean = String(text || "").replace(/```(?:json)?/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    const first = clean.indexOf("{");
    const last = clean.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(clean.slice(first, last + 1));
    throw new Error("the model did not reply with JSON");
  }
}

function visionProvider(ctx) {
  const wanted = setting(ctx, "VISION_PROVIDER", "");
  const gemini = secret(ctx, "GEMINI_API_KEY");
  const kimi = secret(ctx, "KIMI_API_KEY");
  if ((wanted === "gemini" || !wanted) && gemini) return { name: "gemini", apiKey: gemini, model: setting(ctx, "DESCRIBE_MODEL", "gemini-flash-latest") };
  if ((wanted === "kimi" || !wanted) && kimi) return { name: "kimi", apiKey: kimi, baseUrl: setting(ctx, "KIMI_BASE_URL", "https://api.moonshot.ai/v1"), model: setting(ctx, "KIMI_VISION_MODEL", "kimi-k3") };
  return null;
}

async function look(request, ctx) {
  const provider = visionProvider(ctx);
  if (!provider) return fail("no_key: add a GEMINI_API_KEY or KIMI_API_KEY secret for this tenant");
  const data = String(request.image_base64 || "");
  if (!data || data.length > MAX_LOOK_BASE64) return fail("bad picture");
  const width = Number(request.canvas_width);
  const height = Number(request.canvas_height);
  if (!(width > 0 && height > 0)) return fail("bad canvas");
  const shape = width === height ? "square" : width > height ? "wide (landscape)" : "tall (portrait)";
  const narration = String(request.narration || "").slice(0, 800);
  const user = `The picture fills a ${shape} video frame (${width}x${height}). The narrator says over it:\n"${narration || "(nothing specific)"}"\n\nDecide how to show it.`;
  try {
    if (provider.name === "kimi") {
      const res = await post(
        ctx,
        `${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`,
        {
          model: provider.model,
          // No temperature: some Kimi models only accept their own default and refuse any other value.
          max_tokens: 2000,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: LOOK_INSTRUCTIONS },
            { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${data}` } }, { type: "text", text: user }] }
          ]
        },
        { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" }
      );
      const json = parse(res);
      if (!okStatus(res)) return fail(`kimi ${reason(res, json)}`);
      return { ok: true, provider: "kimi", answer: parseJsonReply(json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) };
    }
    const res = await post(
      ctx,
      `${GEMINI_BASE}/models/${provider.model}:generateContent`,
      {
        systemInstruction: { parts: [{ text: LOOK_INSTRUCTIONS }] },
        contents: [{ parts: [{ inlineData: { mimeType: "image/jpeg", data } }, { text: user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 600, responseMimeType: "application/json" }
      },
      { "x-goog-api-key": provider.apiKey, "Content-Type": "application/json" }
    );
    const json = parse(res);
    if (!okStatus(res)) return fail(`gemini ${reason(res, json)}`);
    const parts = (json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
    return { ok: true, provider: "gemini", answer: parseJsonReply(parts.map((p) => p.text || "").join("")) };
  } catch (e) {
    return fail(message(e));
  }
}

const ACTIONS = { write_prompts: writePrompts, generate_image: generateImage, get_chunk: getChunk, look };

module.exports.handler = async function (request, ctx) {
  const run = ACTIONS[request && request.action];
  if (!run) return fail("unknown action");
  try {
    return await run(request, ctx);
  } catch (e) {
    ctx.log(`${request.action} failed: ${message(e)}`);
    return fail(message(e));
  }
};
