// Tests for the scene_images glyph and the render worker's use of it. No network and no keys: the glyph runs against a
// fake sandbox with canned provider replies, and the worker talks to a fake platform API that forwards to the glyph.
//   node glyphs/scene-images.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { generateSceneImages, prepareUserImages, treatUserImage } from "../scripts/render/images.mjs";

const { handler } = createRequire(import.meta.url)("./scene-images.cjs");

// A fake sandbox: ctx.http answers from `replies` (matched by URL fragment), ctx.content_s3 is a Map.
function sandbox({ secrets = {}, settings = {}, replies = [] } = {}) {
  const store = new Map();
  const calls = [];
  return {
    store,
    calls,
    ctx: {
      params: { secrets, settings },
      log: () => undefined,
      lib: { buffer: Buffer },
      content_s3: {
        putObject: async (key, body) => void store.set(key, Buffer.from(body)),
        getObject: async (key) => {
          if (!store.has(key)) throw new Error("NoSuchKey");
          return store.get(key);
        }
      },
      http: {
        post: async (url, body, headers) => {
          calls.push({ url, body, headers });
          const hit = replies.find((r) => url.includes(r.match));
          if (!hit) return { status: 404, body: "{}" };
          return typeof hit.reply === "function" ? hit.reply(body) : hit.reply;
        }
      }
    }
  };
}
const gemini = (parts) => ({ status: 200, body: JSON.stringify({ candidates: [{ content: { parts } }] }) });
const answer = { kind: "photo", has_text: false, treatment: "focus", subject: { x: 0.55, y: 0.3, w: 0.2, h: 0.3 }, reason: "the red subject" };

let n = 0;
const test = async (name, fn) => {
  await fn();
  n += 1;
  console.log(`ok  ${name}`);
};

await test("no key: every action says so instead of throwing", async () => {
  const { ctx } = sandbox();
  assert.match((await handler({ action: "generate_image", id: "a", prompt: "a cat" }, ctx)).error, /no_key/);
  assert.match((await handler({ action: "look", image_base64: "AAAA", canvas_width: 1920, canvas_height: 1080 }, ctx)).error, /no_key/);
  const wp = await handler({ action: "write_prompts", scenes: [{ id: "s", narration: "x y z" }] }, ctx);
  assert.equal(wp.ok, true);
  assert.deepEqual(wp.prompts, {});
  assert.equal((await handler({ action: "nope" }, ctx)).ok, false);
});

await test("generate_image keeps a 4 MB picture in the store and get_chunk returns it in slices", async () => {
  const picture = Buffer.alloc(4_000_000);
  for (let i = 0; i < picture.length; i++) picture[i] = (i * 31 + 7) % 251;
  const sb = sandbox({
    secrets: { GEMINI_API_KEY: "k" },
    settings: { IMAGE_RESOLUTION: "1K" },
    replies: [{ match: "gemini-3.1-flash-image:generateContent", reply: gemini([{ inlineData: { mimeType: "image/png", data: picture.toString("base64") } }]) }]
  });
  const made = await handler({ action: "generate_image", id: "proj-slide", prompt: "a red bicycle", aspect_ratio: "9:16" }, sb.ctx);
  assert.equal(made.ok, true);
  assert.equal(made.key, "scene-images/proj-slide");
  assert.equal(made.chunks, 3);
  assert.equal(made.bytes, 4_000_000);
  assert.equal(sb.calls[0].headers["x-goog-api-key"], "k");
  assert.deepEqual(sb.calls[0].body.generationConfig.imageConfig, { aspectRatio: "9:16", imageSize: "1K" });
  const back = [];
  for (let i = 0; i < made.chunks; i++) back.push(Buffer.from((await handler({ action: "get_chunk", key: made.key, index: i }, sb.ctx)).data_base64, "base64"));
  assert.ok(Buffer.concat(back).equals(picture));
  assert.equal((await handler({ action: "get_chunk", key: made.key, index: 3 }, sb.ctx)).ok, false);
});

await test("get_chunk only reads the scene-images folder", async () => {
  const sb = sandbox();
  sb.store.set("secret/thing", Buffer.from("x"));
  for (const key of ["secret/thing", "scene-images/../secret/thing", "scene-images/a/b", ""]) assert.equal((await handler({ action: "get_chunk", key, index: 0 }, sb.ctx)).ok, false, key);
});

await test("a Gemini refusal or a missing image is reported, not thrown", async () => {
  const sb = sandbox({ secrets: { GEMINI_API_KEY: "k" }, replies: [{ match: "generateContent", reply: { status: 200, body: JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }) } }] });
  assert.match((await handler({ action: "generate_image", id: "a", prompt: "x" }, sb.ctx)).error, /SAFETY/);
  const sb2 = sandbox({ secrets: { GEMINI_API_KEY: "k" }, replies: [{ match: "generateContent", reply: { status: 429, body: JSON.stringify({ error: { message: "quota" } }) } }] });
  assert.match((await handler({ action: "generate_image", id: "a", prompt: "x" }, sb2.ctx)).error, /429: quota/);
});

await test("write_prompts returns a style and one prompt per scene that needs one", async () => {
  const sb = sandbox({
    secrets: { GEMINI_API_KEY: "k" },
    replies: [{ match: "gemini-flash-latest", reply: (body) => gemini([{ text: body.systemInstruction.parts[0].text.startsWith("You are the art director") ? "Plain realistic photographs in natural light." : `"A golden retriever on a lawn, looking at the camera, soft daylight."` }]) }]
  });
  const out = await handler({ action: "write_prompts", theme: "forest", outline: "1. x\n2. y", scenes: [{ id: "a", narration: "Dogs love to play." }, { id: "b", narration: "Cats sleep.", described: true }, { id: "c", narration: "" }] }, sb.ctx);
  assert.equal(out.style, "Plain realistic photographs in natural light.");
  assert.deepEqual(Object.keys(out.prompts), ["a"]);
  assert.equal(out.prompts.a, "A golden retriever on a lawn, looking at the camera, soft daylight.");
});

await test("look: Kimi (fenced JSON, no temperature) and Gemini", async () => {
  const kimi = sandbox({
    secrets: { KIMI_API_KEY: "kk" },
    replies: [{ match: "/chat/completions", reply: { status: 200, body: JSON.stringify({ choices: [{ message: { content: "Sure:\n```json\n" + JSON.stringify(answer) + "\n```" } }] }) } }]
  });
  const a = await handler({ action: "look", image_base64: "AAAA", narration: "the red thing", canvas_width: 1080, canvas_height: 1920 }, kimi.ctx);
  assert.deepEqual([a.ok, a.provider, a.answer.treatment], [true, "kimi", "focus"]);
  assert.equal(kimi.calls[0].headers.Authorization, "Bearer kk");
  assert.equal("temperature" in kimi.calls[0].body, false);
  assert.match(kimi.calls[0].body.messages[1].content[1].text, /tall \(portrait\)/);
  const g = sandbox({ secrets: { GEMINI_API_KEY: "g", KIMI_API_KEY: "kk" }, replies: [{ match: "generateContent", reply: gemini([{ text: JSON.stringify(answer) }]) }] });
  assert.equal((await handler({ action: "look", image_base64: "AAAA", canvas_width: 1920, canvas_height: 1080 }, g.ctx)).provider, "gemini");
  const forced = sandbox({ secrets: { GEMINI_API_KEY: "g", KIMI_API_KEY: "kk" }, settings: { VISION_PROVIDER: "kimi" }, replies: [{ match: "/chat/completions", reply: { status: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }) } }] });
  assert.equal((await handler({ action: "look", image_base64: "AAAA", canvas_width: 1920, canvas_height: 1080 }, forced.ctx)).provider, "kimi");
  assert.equal((await handler({ action: "look", image_base64: "x".repeat(3_000_001), canvas_width: 1920, canvas_height: 1080 }, g.ctx)).ok, false);
});

// ----- the worker, talking to the glyph through a fake platform API (JSON in and out, as over HTTP) -----
const fakeApi = (sb) => ({
  post: async (url, body) => {
    assert.match(url, /^\/glyphs\/[0-9a-f-]{36}\/invoke$/);
    return { result: JSON.parse(JSON.stringify(await handler(JSON.parse(JSON.stringify(body.input)), sb.ctx))) };
  }
});
const quiet = { log: () => undefined, warn: () => undefined };

await test("worker: generates a picture scene through the glyph and saves it", async () => {
  const picture = Buffer.alloc(3_200_000, 9);
  const sb = sandbox({
    secrets: { GEMINI_API_KEY: "k" },
    replies: [
      { match: "gemini-flash-latest", reply: gemini([{ text: "A golden retriever on a lawn, looking at the camera, soft daylight." }]) },
      { match: "flash-image", reply: gemini([{ inlineData: { mimeType: "image/jpeg", data: picture.toString("base64") } }]) }
    ]
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-images-"));
  const slides = [
    { id: "s1", project_id: "p1", narration_text: "Welcome.", html_content: `<div class="cc cc-title" data-theme="forest"></div>` },
    { id: "s2", project_id: "p1", narration_text: "Dogs love to play.", html_content: `<div class="cc cc-picture" data-theme="forest" data-art="dog"></div>` }
  ];
  const photos = await generateSceneImages({ slides, dir, api: fakeApi(sb), aspectRatio: "9:16", log: quiet, env: {} });
  assert.deepEqual(Object.keys(photos), ["s2"]);
  assert.equal(photos.s2, "/__gen/s2.jpg");
  assert.ok(fs.readFileSync(path.join(dir, "s2.jpg")).equals(picture));
  const genCall = sb.calls.find((c) => c.url.includes("flash-image"));
  assert.match(genCall.body.contents[0].parts[0].text, /golden retriever.*plain uncluttered background/);
  assert.equal(genCall.body.generationConfig.imageConfig.aspectRatio, "9:16");
});

await test("worker: a picture that cannot be made FAILS the render (no icon fallback), naming the scene and why", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-images-"));
  const slides = [
    { id: "s1", project_id: "p1", narration_text: "Welcome.", html_content: `<div class="cc cc-title"></div>` },
    { id: "s2", project_id: "p1", narration_text: "Dogs.", html_content: `<div data-art="dog"></div>` }
  ];
  // No key in nostackai: fails at once (no second attempt for a missing key).
  const noKey = sandbox();
  await assert.rejects(generateSceneImages({ slides, dir, api: fakeApi(noKey), log: quiet, env: {} }), /Could not make a picture: scene 2 \(dog\): no_key/);
  // No platform connection at all.
  await assert.rejects(generateSceneImages({ slides, dir, api: null, log: quiet, env: {} }), /no platform connection/);
  // A refusal from the provider is tried twice, then fails.
  const refused = sandbox({ secrets: { GEMINI_API_KEY: "k" }, replies: [{ match: "flash-image", reply: { status: 429, body: JSON.stringify({ error: { message: "quota" } }) } }] });
  await assert.rejects(generateSceneImages({ slides, dir, api: fakeApi(refused), log: quiet, env: {} }), /scene 2 \(dog\): gemini 429: quota/);
  assert.equal(refused.calls.filter((c) => c.url.includes("flash-image")).length, 2, "the worker tries twice");
  // One of two pictures fails: the whole render fails, naming only the one that did.
  const mixed = sandbox({
    secrets: { GEMINI_API_KEY: "k" },
    replies: [{ match: "flash-image", reply: (body) => (/cat/.test(body.contents[0].parts[0].text) ? { status: 400, body: "{}" } : gemini([{ inlineData: { mimeType: "image/png", data: Buffer.alloc(10).toString("base64") } }])) }]
  });
  const two = [
    { id: "s2", project_id: "p1", narration_text: "Dogs.", html_content: `<div data-art="dog"></div>` },
    { id: "s3", project_id: "p1", narration_text: "Cats.", html_content: `<div data-art="cat"></div>` }
  ];
  await assert.rejects(generateSceneImages({ slides: two, dir, api: fakeApi(mixed), log: quiet, env: {} }), (e) => /scene 2 \(cat\)/.test(e.message) && !/dog/.test(e.message));
});

await test("worker: asks the glyph how to show a viewer's picture, and applies the guard rails", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-images-"));
  const file = path.join(dir, "user-s3.png");
  const ff = (await import("node:child_process")).spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=2400x1800:rate=1", "-frames:v", "1", file]);
  assert.equal(ff.status, 0);
  const sb = sandbox({ secrets: { KIMI_API_KEY: "kk" }, replies: [{ match: "/chat/completions", reply: { status: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }) } }] });
  const focus = await treatUserImage({ file, narration: "the red thing", canvas: { width: 1920, height: 1080 }, label: "s3", api: fakeApi(sb), log: quiet });
  assert.equal(focus.treatment, "focus");
  assert.ok(Math.abs(focus.crop.w * 2400 / (focus.crop.h * 1800) - 1920 / 1080) < 0.001, "the crop has the frame's shape");
  // The model says it's a screenshot: never cropped, whatever else it said.
  const shot = sandbox({ secrets: { KIMI_API_KEY: "kk" }, replies: [{ match: "/chat/completions", reply: { status: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...answer, kind: "screenshot" }) } }] }) } }] });
  assert.equal((await treatUserImage({ file, narration: "x", canvas: { width: 1920, height: 1080 }, label: "s3", api: fakeApi(shot), log: quiet })).treatment, "whole");
  // The glyph has no key: shown whole.
  assert.equal((await treatUserImage({ file, narration: "x", canvas: { width: 1920, height: 1080 }, label: "s3", api: fakeApi(sandbox()), log: quiet })).treatment, "whole");
  // No platform connection at all (the fixture): shown whole.
  assert.equal((await treatUserImage({ file, narration: "x", canvas: { width: 1920, height: 1080 }, label: "s3", log: quiet })).treatment, "whole");
});

await test("worker: a viewer's picture that is missing or not this film's FAILS the render", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-images-"));
  const slides = [{ id: "s2", project_id: "p1", narration_text: "Look.", html_content: `<div class="cc cc-photo" data-image-source="src9"></div>` }];
  const sources = {
    other: { id: "src9", project_id: "SOMEONE-ELSE", source_type: "image", file_url: "http://127.0.0.1:9/x.png" },
    notImage: { id: "src9", project_id: "p1", source_type: "pdf", file_url: "http://127.0.0.1:9/x.pdf" }
  };
  for (const [name, source] of Object.entries(sources)) {
    await assert.rejects(prepareUserImages({ slides, projectId: "p1", api: { get: async () => source }, dir, canvas: { width: 1920, height: 1080 }, log: quiet }), /Could not use the viewer's picture: scene 1: that source is not a picture attached to this film/, name);
  }
  await assert.rejects(prepareUserImages({ slides, projectId: "p1", api: { get: async () => { throw new Error("404"); } }, dir, canvas: { width: 1920, height: 1080 }, log: quiet }), /Could not use the viewer's picture: scene 1: 404/);
});

console.log(`\n${n} tests passed`);
