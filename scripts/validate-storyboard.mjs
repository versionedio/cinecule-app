// Checks an AI-written storyboard against the rules in the storyboard prompt (design system, text limits,
// scene mix). Use it on the first real outputs to see how well the model follows the prompt.
//   node scripts/validate-storyboard.mjs slides.json [--pictures none|few|many] [--theme forest] [--bg glow] [--font editorial] [--length 30|45|60|90] [--format vertical|square]
// slides.json is the slides_json array (or the JSON string the model returned) as saved by the storyboard step.
import fs from "node:fs";
import { chromium } from "playwright";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const file = process.argv[2];
if (!file || file.startsWith("--")) { console.error("usage: node scripts/validate-storyboard.mjs slides.json [--pictures none|few|many] [--theme x] [--bg x] [--font x] [--length 30|45|60|90] [--format vertical|square]"); process.exit(2); }

const THEMES = ["midnight", "ember", "forest", "ocean", "paper", "slate", "plum"];
const BGS = ["plain", "gradient", "glow"];
const FONTS = ["editorial", "clean", "bold"];
const LAYOUTS = ["cc-title", "cc-points", "cc-stat", "cc-split", "cc-quote", "cc-closing", "cc-picture", "cc-photo"];

let raw = JSON.parse(fs.readFileSync(file, "utf8"));
if (typeof raw === "string") raw = JSON.parse(raw);
const slides = Array.isArray(raw) ? raw : raw.slides ?? raw.slides_json ?? [];
const issues = [];
const bad = (i, msg) => issues.push(`scene ${i + 1}: ${msg}`);
const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;

const browser = await chromium.launch();
const page = await browser.newPage();
const info = [];
for (const [i, s] of slides.entries()) {
  const html = String(s.html_content ?? "");
  await page.setContent(`<body>${html}</body>`);
  const d = await page.evaluate(() => {
    const roots = [...document.body.children];
    const root = roots[0];
    const txt = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
    return {
      rootCount: roots.length,
      cls: root ? [...root.classList] : [],
      theme: root?.dataset.theme, bg: root?.dataset.bg, font: root?.dataset.font, art: root?.dataset.art, imageSource: root?.dataset.imageSource,
      styleAttrs: document.querySelectorAll("[style]").length - (root?.hasAttribute("style") ? 0 : 0),
      banned: [...document.querySelectorAll("svg,img,script,link,iframe,canvas")].map((e) => e.tagName.toLowerCase()),
      headings: [...document.querySelectorAll(".cc-h,.cc-q")].map(txt),
      cards: [...document.querySelectorAll(".cc-card,.cc-col")].map((e) => txt(e.querySelector("p:not(.cc-label)") ?? e)),
      ems: [...document.querySelectorAll(".cc-h,.cc-card,.cc-col,.cc-cap,.cc-q")].map((e) => e.querySelectorAll("em").length),
      otherEmphasis: document.querySelectorAll("b,strong,i,u,mark").length,
      ids: [...document.querySelectorAll("[id]")].map((e) => e.id),
      text: txt(document.body)
    };
  });
  const layout = d.cls.find((c) => LAYOUTS.includes(c));
  info.push({ i, layout, ...d });
  if (d.rootCount !== 1) bad(i, `expected ONE root element, found ${d.rootCount}`);
  if (!d.cls.includes("cc")) bad(i, `root is missing class "cc"`);
  if (!layout) bad(i, `root has no known layout class (has: ${d.cls.join(" ") || "none"})`);
  if (!THEMES.includes(d.theme)) bad(i, `data-theme "${d.theme}" is not one of the themes`);
  if (!BGS.includes(d.bg)) bad(i, `data-bg "${d.bg}" is not plain, gradient or glow`);
  if (d.font && !FONTS.includes(d.font)) bad(i, `data-font "${d.font}" is not editorial, clean or bold`);
  if (d.styleAttrs > 0 && layout !== "cc-picture" && layout !== "cc-photo") bad(i, `${d.styleAttrs} inline style attribute(s); the stylesheet should supply all styling`);
  if (d.banned.length) bad(i, `contains ${[...new Set(d.banned)].join(", ")}, which are not allowed`);
  if (!String(s.narration_text ?? "").trim()) bad(i, "narration_text is empty, so the scene would be silent");
  if (layout === "cc-picture") {
    if (d.text) bad(i, "a picture scene must have no text on screen");
    if (!d.art) bad(i, "a picture scene needs data-art");
    if ((s.interactions ?? []).length) bad(i, "a picture scene must have no interactions");
  } else if (layout === "cc-photo") {
    // The viewer's own picture: nothing but the frame, named by the id of the source they attached.
    if (d.text) bad(i, "a viewer's-picture scene must have no text on screen");
    if (!d.imageSource) bad(i, "a viewer's-picture scene needs data-image-source");
    if ((s.interactions ?? []).length) bad(i, "a viewer's-picture scene must have no interactions");
    if (i === 0 || i === slides.length - 1) bad(i, "the first and last scenes are not viewer's-picture scenes");
  } else {
    d.headings.forEach((h) => words(h) > 7 && layout !== "cc-quote" && bad(i, `heading has ${words(h)} words (max 7): "${h}"`));
    d.cards.forEach((c) => words(c) > 8 && bad(i, `card/column has ${words(c)} words (max 8): "${c}"`));
    if (layout === "cc-points" && d.cards.length > 3) bad(i, `${d.cards.length} cards (max 3)`);
    if (d.otherEmphasis) bad(i, "uses b, strong, i, u or mark; only <em> is allowed for emphasis");
    if (!d.ems.some((n) => n >= 1)) bad(i, "no <em> key words marked");
    if (d.ems.some((n) => n > 3)) bad(i, "more than 3 <em> words in one text");
    // The screen should show key phrases, never the narration itself.
    const narr = String(s.narration_text ?? "").toLowerCase();
    for (const t of [...d.cards, ...d.headings]) if (words(t) >= 6 && narr.includes(t.toLowerCase().replace(/[.!?]$/, ""))) bad(i, `on-screen text copies the narration: "${t}"`);
  }
  for (const id of d.ids) if (!id.startsWith(`s${i + 1}-`)) bad(i, `id "${id}" is not prefixed with s${i + 1}-`);
  for (const it of s.interactions ?? []) {
    const m = String(it.target_selector ?? "").match(/^#(.+)$/);
    if (!m || !d.ids.includes(m[1])) bad(i, `interaction targets "${it.target_selector}", which is not an id in the scene`);
  }
}
await browser.close();

// Across the film.
const themes = new Set(info.map((x) => x.theme)); if (themes.size > 1) issues.push(`film: more than one theme used (${[...themes].join(", ")})`);
const bgs = new Set(info.map((x) => x.bg)); if (bgs.size > 1) issues.push(`film: more than one background used (${[...bgs].join(", ")})`);
const fonts = new Set(info.map((x) => x.font ?? "-")); if (fonts.size > 1) issues.push(`film: data-font is not the same on every scene`);
if (info[0]?.layout !== "cc-title") issues.push(`film: scene 1 should be cc-title (is ${info[0]?.layout})`);
if (info.at(-1)?.layout !== "cc-closing") issues.push(`film: the last scene should be cc-closing (is ${info.at(-1)?.layout})`);
info.forEach((x, i) => { if (i > 0 && x.layout && x.layout === info[i - 1].layout) issues.push(`scene ${i + 1}: same layout (${x.layout}) as the scene before`); if (i > 0 && x.layout === "cc-title") issues.push(`scene ${i + 1}: cc-title is only for scene 1`); });
const pics = info.filter((x) => x.layout === "cc-picture").length;
const want = arg("pictures");
if (want === "none" && pics) issues.push(`film: ${pics} picture scene(s) but the user chose none`);
if (want === "few" && pics > Math.ceil(info.length / 3)) issues.push(`film: ${pics} picture scenes is more than "a few" for ${info.length} scenes`);
if (want === "many" && pics < Math.floor(info.length / 5)) issues.push(`film: only ${pics} picture scene(s) but the user chose plenty`);
for (const [k, v] of [["theme", arg("theme")], ["bg", arg("bg")], ["font", arg("font")]]) if (v && !info.every((x) => (k === "font" ? x.font : x[k]) === v)) issues.push(`film: the user chose ${k}=${v} but not every scene uses it`);

// A chosen length is three exact numbers (same table as LENGTHS in src/render/theme.ts): the scene count, how long each
// scene lasts, and how many words its narration may have, so the narrator finishes inside the scene.
const LENGTHS = { "30": { scenes: 6, each: 5 }, "45": { scenes: 9, each: 5 }, "60": { scenes: 10, each: 6 }, "90": { scenes: 10, each: 9 } };
const WORDS_PER_SECOND = 2.2;
const lengthWanted = arg("length");
if (lengthWanted) {
  const L = LENGTHS[lengthWanted];
  if (!L) issues.push(`film: --length must be one of ${Object.keys(LENGTHS).join(", ")}`);
  else {
    const total = slides.reduce((t, sl) => t + (Number(sl.duration) || 0), 0);
    if (slides.length !== L.scenes) issues.push(`film: ${slides.length} scenes, but a ${lengthWanted}-second film has exactly ${L.scenes}`);
    if (total !== Number(lengthWanted)) issues.push(`film: the durations add up to ${total}s, not ${lengthWanted}s`);
    const maxWords = Math.floor(L.each * WORDS_PER_SECOND);
    slides.forEach((sl, i) => {
      if (Number(sl.duration) !== L.each) bad(i, `duration is ${sl.duration}s, expected ${L.each}s`);
      const w = words(String(sl.narration_text ?? ""));
      if (w > maxWords) bad(i, `narration has ${w} words, more than the ${maxWords} that fit in ${L.each}s`);
    });
  }
}
// Narrow canvases leave less room for text.
const shape = arg("format");
if (shape === "vertical" || shape === "square") {
  const maxHead = shape === "vertical" ? 5 : 6, maxCard = shape === "vertical" ? 6 : 7;
  info.forEach((x, i) => {
    x.headings.forEach((h) => x.layout !== "cc-quote" && words(h) > maxHead && bad(i, `heading has ${words(h)} words (max ${maxHead} on a ${shape} canvas): "${h}"`));
    x.cards.forEach((c) => words(c) > maxCard && bad(i, `card/column has ${words(c)} words (max ${maxCard} on a ${shape} canvas): "${c}"`));
  });
}

console.log(`${slides.length} scenes | theme ${[...themes].join("/")} | layouts: ${info.map((x) => (x.layout ?? "?").replace("cc-", "")).join(", ")} | pictures: ${pics}`);
if (issues.length === 0) console.log("OK: the storyboard follows every rule.");
else { console.log(`${issues.length} issue(s):`); for (const m of issues) console.log(" - " + m); }
process.exit(issues.length ? 1 : 0);
