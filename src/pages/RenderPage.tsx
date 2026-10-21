import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { entityService } from "@/services/entityService";
import { ENTITY_NAMES, GeneratedHtml, Interaction, Project } from "@/config/entities";
import {
  ActiveEffect, RenderData, SlideTiming, buildSlideTimings, cameraAt, cameraTransform, canvasSize,
  clamp, easeOut, slideStateAt
} from "@/render/timeline";
import { Box, Decision, Intensity, Measured, PlannedEffect, PlannedReveal, Proposal, ScenePlan, WordTiming, planEffectsAt, planReveals, planScene, revealProgress } from "@/render/director";
import { FIXTURE, fixtureThemed } from "@/render/fixture";
import { themeHead } from "@/render/theme";
import { ArtIndex, buildIndex, findArtSlots, insertArt, loadCatalog, pickArt, resolveSubject } from "@/render/art";

/**
 * Headless video render surface. Not a user-facing page: the render script opens it in Chromium,
 * waits for `window.__render.ready`, then calls `setTime(t)` and screenshots once per frame.
 * Everything is drawn from `t` alone (no real-time animation), so frames are repeatable.
 *
 * What zooms and highlights actually happen is decided by the deterministic director
 * (src/render/director.ts) from the real word timings and the real measured layout.
 */

export interface RenderInfo {
  width: number;
  height: number;
  duration: number;
  slides: { id: string; start: number; end: number }[];
  /** Every proposal the director kept or dropped, with the reason. */
  decisions: (Decision & { scene: string })[];
}

declare global {
  interface Window {
    __render?: { ready: Promise<RenderInfo>; setTime: (t: number) => void };
  }
}

// The accent of older, self-styled slides; themed slides supply their own (--accent-rgb).
const ACCENT = "242,181,74";
// Slide HTML may carry its own CSS animation; freeze it so a frame depends only on `t`.
const FREEZE_CSS = "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}html,body{margin:0;height:100%;overflow:hidden}";

function parseWords(json: unknown): WordTiming[] {
  try {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    return Array.isArray(parsed) ? parsed.filter((w) => w && typeof w.w === "string" && Number.isFinite(w.s)) : [];
  } catch {
    return [];
  }
}

/** Pictures the render script generated for this render, if any. Anywhere else the request just fails. */
async function loadPhotos(): Promise<Record<string, string>> {
  try {
    const res = await fetch("/__gen/photos.json");
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return {};
    const json = await res.json();
    return json && typeof json === "object" ? (json as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function loadData(projectId: string): Promise<RenderData> {
  const q = { project_id: projectId, pagesize: 100 };
  const [project, slides, interactions, audio] = await Promise.all([
    entityService.get<Project>(ENTITY_NAMES.project, projectId),
    entityService.list<GeneratedHtml>(ENTITY_NAMES.generatedHtml, q),
    entityService.list<Interaction>(ENTITY_NAMES.interaction, q),
    entityService.list<{ slide_id: string; words_json?: string }>("audio", { ...q, kind: "voiceover" })
  ]);
  return {
    project,
    slides: slides.data ?? [],
    interactions: (interactions.data ?? []).filter((i) => i.active !== false),
    audio: (audio.data ?? []).map((a) => ({ slide_id: a.slide_id, words: parseWords(a.words_json) }))
  };
}

interface Layer {
  timing: SlideTiming;
  index: number;
  root: HTMLDivElement;
  // Slow always-on drift underneath everything, so no scene is ever frozen.
  ambient: HTMLDivElement;
  camera: HTMLDivElement;
  frame: HTMLIFrameElement;
  loaded: Promise<void>;
  plan: ScenePlan;
  words: WordTiming[];
  // Blocks of content that arrive when the narrator reaches them.
  reveals: { el: HTMLElement; plan: PlannedReveal }[];
  // Clip art, placed in free space and arriving with the word it illustrates.
  arts: { el: HTMLElement; start: number; shapes: SVGElement[]; photo?: boolean }[];
  // The slide's accent colour as "r,g,b", so highlights and icons match its theme.
  accent: string;
  // The generated picture of a picture scene, so its loading can be awaited before any frame is drawn.
  photoImg?: HTMLImageElement;
  // A picture scene: one big icon drawn on, no text.
  hero: boolean;
  // Inline styles of elements an effect touched, so each frame starts clean.
  original: Map<HTMLElement, string | null>;
  // The words of each read-along target, wrapped in spans so they can be lit one at a time.
  followSpans: Map<string, HTMLElement[]>;
}

function safeQuery(doc: Document, selector: string): HTMLElement | null {
  try {
    return doc.querySelector<HTMLElement>(selector);
  } catch {
    return null;
  }
}

/** Text nodes of an element in reading order. */
function textNodes(el: HTMLElement): Text[] {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n.nodeValue ?? "").trim()) nodes.push(n as Text);
  }
  return nodes;
}

function measure(doc: Document, selector: string): Measured | null {
  const el = safeQuery(doc, selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  const tokens: string[] = [];
  const wordBoxes: Box[] = [];
  const range = doc.createRange();
  for (const node of textNodes(el)) {
    const text = node.nodeValue ?? "";
    for (const m of text.matchAll(/\S+/g)) {
      tokens.push(m[0]);
      range.setStart(node, m.index ?? 0);
      range.setEnd(node, (m.index ?? 0) + m[0].length);
      const wr = range.getBoundingClientRect();
      wordBoxes.push({ x: wr.left, y: wr.top, w: wr.width, h: wr.height });
    }
  }
  return { box: { x: r.left, y: r.top, w: r.width, h: r.height }, tokens, wordBoxes };
}

/** Wrap every word of the element in a span (same order the director counted them). */
function wrapWords(el: HTMLElement): HTMLElement[] {
  const doc = el.ownerDocument;
  const spans: HTMLElement[] = [];
  for (const node of textNodes(el)) {
    const frag = doc.createDocumentFragment();
    for (const part of (node.nodeValue ?? "").split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        frag.appendChild(doc.createTextNode(part));
      } else {
        const span = doc.createElement("span");
        span.textContent = part;
        frag.appendChild(span);
        spans.push(span);
      }
    }
    node.parentNode?.replaceChild(frag, node);
  }
  return spans;
}

function resetEffects(layer: Layer) {
  for (const [el, style] of layer.original) {
    if (style === null) el.removeAttribute("style");
    else el.setAttribute("style", style);
  }
  layer.original.clear();
  for (const spans of layer.followSpans.values()) spans.forEach((s) => s.removeAttribute("style"));
  layer.frame.contentDocument?.getElementById("__fx")?.replaceChildren();
}

function touch(layer: Layer, el: HTMLElement) {
  if (!layer.original.has(el)) layer.original.set(el, el.getAttribute("style"));
}

function overlay(doc: Document, css: string): HTMLDivElement {
  const div = doc.createElement("div");
  div.setAttribute("style", `position:fixed;pointer-events:none;${css}`);
  doc.getElementById("__fx")?.appendChild(div);
  return div;
}

// SVG children scale around the whole canvas by default; fill-box makes them scale around themselves.
function anchorToElement(el: HTMLElement) {
  el.style.transformOrigin = "center";
  if (el.namespaceURI === "http://www.w3.org/2000/svg") el.style.transformBox = "fill-box";
}

function applyEffect(layer: Layer, fx: ActiveEffect) {
  const doc = layer.frame.contentDocument;
  if (!doc?.body) return;
  const el = safeQuery(doc, fx.selector);
  if (!el) return;
  const e = fx.envelope;
  const r = el.getBoundingClientRect();
  const grow = easeOut(fx.elapsed / 0.5);
  // Drawn emphasis hugs the spoken words (one box per line); only if unknown does it fall back to the element.
  const rects = fx.lines && fx.lines.length > 0 ? fx.lines.map((l) => ({ left: l.x, top: l.y, right: l.x + l.w, bottom: l.y + l.h, width: l.w, height: l.h })) : [r];
  const boxOf = (q: { left: number; top: number; width: number; height: number }, pad: number) => `left:${q.left - pad}px;top:${q.top - pad}px;width:${q.width + pad * 2}px;height:${q.height + pad * 2}px;`;

  switch (fx.effect) {
    case "scale-pop":
      touch(layer, el);
      if (getComputedStyle(el).display === "inline") el.style.display = "inline-block";
      anchorToElement(el);
      el.style.transform = `scale(${1 + 0.1 * Math.sin(Math.PI * clamp(fx.progress, 0, 1))})`;
      break;
    case "glow":
      // drop-shadow follows the actual shape (letters or a card's outline), unlike a rectangular box-shadow.
      touch(layer, el);
      el.style.filter = `drop-shadow(0 0 ${12 * e}px rgba(${layer.accent},${0.9 * e})) drop-shadow(0 0 ${28 * e}px rgba(${layer.accent},${0.55 * e}))`;
      break;
    case "underline":
      rects.forEach((q) => overlay(doc, `left:${q.left}px;top:${q.bottom + 4}px;width:${q.width * grow}px;height:6px;border-radius:3px;background:rgb(${layer.accent});opacity:${e};z-index:999;`));
      break;
    case "circle":
      rects.forEach((q) => overlay(doc, `${boxOf(q, 18)}border:5px solid rgb(${layer.accent});border-radius:${q.width > q.height * 3 ? "999px" : "50%"};opacity:${e};clip-path:inset(0 ${100 * (1 - grow)}% 0 0);z-index:999;`));
      break;
    case "wipe-reveal":
      rects.forEach((q) => overlay(doc, `${boxOf(q, 6)}background:rgba(${layer.accent},${0.34 * e});border-radius:8px;clip-path:inset(0 ${100 * (1 - grow)}% 0 0);z-index:999;`));
      break;
    default:
      break;
  }
}

/** Light the words of a sentence one at a time as they are spoken; words already said stay softly marked. */
function applyFollow(layer: Layer, planned: PlannedEffect, fx: ActiveEffect, local: number) {
  const spans = layer.followSpans.get(planned.key);
  if (!spans || !planned.follow) return;
  const e = fx.envelope;
  for (const tok of planned.follow) {
    const span = spans[tok.index];
    if (!span) continue;
    if (local >= tok.s && local < tok.e) {
      span.style.cssText = `background:rgba(${layer.accent},${0.55 * e});border-radius:6px;box-shadow:0 0 0 5px rgba(${layer.accent},${0.55 * e});`;
    } else if (local >= tok.e) {
      span.style.cssText = `background:rgba(${layer.accent},${0.2 * e});border-radius:6px;box-shadow:0 0 0 5px rgba(${layer.accent},${0.2 * e});`;
    }
  }
}

function buildLayer(host: HTMLElement, timing: SlideTiming, index: number, width: number, height: number): Layer {
  const id = timing.slide.id;
  const root = document.createElement("div");
  root.style.cssText = `position:absolute;inset:0;width:${width}px;height:${height}px;visibility:hidden;`;
  const ambient = document.createElement("div");
  ambient.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;transform-origin:50% 50%;`;
  const camera = document.createElement("div");
  camera.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;transform-origin:0 0;`;
  const frame = document.createElement("iframe");
  frame.setAttribute("title", timing.slide.name || id);
  frame.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;border:0;background:#fff;`;
  // Listen before srcdoc is set: a fresh iframe's blank document already reads "complete", so
  // readyState can't be trusted, and a late listener could miss the real load.
  const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><script src="https://cdn.tailwindcss.com"></script><style>${FREEZE_CSS}</style>${themeHead(timing.slide.html_content || "")}</head><body>${timing.slide.html_content || ""}<div id="__fx"></div></body></html>`;
  camera.appendChild(frame);
  ambient.appendChild(camera);
  root.appendChild(ambient);
  host.appendChild(root);
  return { timing, index, root, ambient, camera, frame, loaded, plan: { shots: [], effects: [], decisions: [] }, words: [], reveals: [], arts: [], hero: false, accent: ACCENT, original: new Map(), followSpans: new Map() };
}

/** Once a slide has loaded, let the director decide what really happens in it. */
function planLayer(layer: Layer, data: RenderData, width: number, height: number, art: ArtIndex | null) {
  const doc = layer.frame.contentDocument;
  if (!doc?.body) return;
  const slide = layer.timing.slide;
  const themed = doc.querySelector("[data-theme]");
  const themeAccent = themed ? getComputedStyle(themed).getPropertyValue("--accent-rgb").trim() : "";
  if (themeAccent) layer.accent = themeAccent;
  const words = data.audio.find((a) => a.slide_id === slide.id)?.words ?? [];
  const proposals: Proposal[] = data.interactions
    .filter((i) => i.slide_id === slide.id)
    .map((i) => ({ id: i.id, selector: i.target_selector ?? "", text: i.target_text ?? "", action: i.action }));

  // Every major block that is actually spoken is a candidate too, not just what the storyboard proposed,
  // so the camera has real moments to move to. The director still drops anything not spoken.
  const blocks = findBlocks(doc, width, height);
  const proposed = new Set(proposals.map((p) => p.selector));
  for (const el of blocks) {
    if (el.id.endsWith("-art")) continue; // the empty slot reserved for clip art has nothing to say
    if (!proposed.has(`#${el.id}`)) proposals.push({ id: `auto:${el.id}`, selector: `#${el.id}`, text: "", action: "auto" });
  }

  // Picture scenes: the storyboard names one or two icons (data-art="dog,bone"); they are drawn large,
  // evenly sized and centred, and nothing else is on screen.
  const artDecisions: Decision[] = [];
  const heroEl = doc.querySelector<HTMLElement>("[data-art]");
  const photoUrl = data.photos?.[slide.id];
  if (heroEl && photoUrl) {
    // A real picture, full frame, replaces the icons.
    layer.hero = true;
    const img = doc.createElement("img");
    img.id = "__art-photo";
    img.setAttribute("style", "position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;opacity:0;pointer-events:none;");
    img.src = photoUrl;
    doc.body.appendChild(img);
    layer.photoImg = img;
    layer.arts.push({ el: img, start: 0.2, shapes: [], photo: true });
    artDecisions.push({ id: "art:photo", selector: "", status: "kept", reason: `picture scene shows a generated picture (${photoUrl})` });
  } else if (heroEl) {
    layer.hero = true;
    const subject = heroEl.getAttribute("data-art") ?? "";
    const names: string[] = [];
    for (const part of subject.split(",")) {
      const name = art ? resolveSubject(art, part) : null;
      if (name && !names.includes(name)) names.push(name);
      else if (part.trim()) artDecisions.push({ id: `art:${part.trim()}`, selector: "", status: "dropped", reason: `"${part.trim()}" is not an icon in the library` });
    }
    if (art && names.length === 0) {
      const literal = pickArt(art, words, { max: 1 })[0]?.name;
      if (literal) names.push(literal);
    }
    const rects = findArtSlots(doc, names.length);
    if (art && rects.length > 0) {
      rects.forEach((rect, i) => {
        const start = 0.3 + i * 0.7;
        const el = insertArt(doc, art, { name: names[i], word: subject, start, score: 10 }, rect, i, layer.accent);
        layer.arts.push({ el, start, shapes: Array.from(el.querySelectorAll<SVGElement>("path,line,polyline,polygon,circle,rect,ellipse")) });
        artDecisions.push({ id: `art:${names[i]}`, selector: "", status: "kept", reason: `picture scene icon ${i + 1} of ${rects.length}: ${names[i]}` });
      });
    } else {
      artDecisions.push({ id: "art", selector: "", status: "dropped", reason: `picture scene has no usable icon for "${subject}"` });
    }
  }

  layer.plan = planScene({
    duration: layer.timing.end - layer.timing.start,
    canvas: { width, height },
    words,
    proposals,
    measure: (selector) => measure(doc, selector),
    intensity: (data.project.director_camera_intensity ?? "medium") as Intensity
  });
  layer.plan.decisions.push(...artDecisions);

  layer.words = words;
  for (const fx of layer.plan.effects) {
    if (fx.kind !== "follow") continue;
    const el = safeQuery(doc, fx.selector);
    if (el) layer.followSpans.set(fx.key, wrapWords(el));
  }

  // Blocks of content arrive when the narrator reaches them (or with the scene if never mentioned).
  const revealPlan = planReveals(
    blocks.map((el) => ({ selector: el.id, tokens: textNodes(el).flatMap((n) => (n.nodeValue ?? "").split(/\s+/).filter(Boolean)) })),
    words,
    layer.timing.end - layer.timing.start
  );
  layer.reveals = blocks.map((el, i) => ({ el, plan: revealPlan[i] }));

}

/**
 * The elements that arrive one by one: outermost elements with an id (the storyboard gives every
 * major block one). A container that fills most of the frame is looked through to the blocks inside it.
 */
function findBlocks(doc: Document, width: number, height: number): HTMLElement[] {
  const body = doc.body;
  const out: HTMLElement[] = [];
  const visit = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      const el = child as HTMLElement;
      if (el.id.startsWith("__") || el.hasAttribute("data-art")) continue; // the effects layer and clip art manage themselves
      if (el.id) {
        const r = el.getBoundingClientRect();
        const big = (r.width * r.height) / (width * height) > 0.7;
        if (big && el.querySelector("[id]")) visit(el);
        else if (r.width > 0 && r.height > 0) out.push(el);
      } else {
        visit(el);
      }
    }
  };
  visit(body);
  return out;
}

function poseLayer(layer: Layer, local: number, width: number, height: number, flat = false) {
  layer.camera.style.transform = flat ? "none" : cameraTransform(cameraAt(layer.plan.shots, local), width, height);

  // Slow drift: alternate scenes push in and pull out, with a small sideways glide. Small enough to
  // stay inside the slide's padding, so it can never crop content.
  const total = Math.max(1, layer.timing.end - layer.timing.start);
  const p = clamp(local / total, 0, 1);
  const dir = layer.hero || layer.index % 2 === 0 ? 1 : -1;
  const amp = layer.hero ? 0.09 : 0.04; // a picture scene has nothing to crop, so it can push in further
  const scale = dir > 0 ? 1 + amp * p : 1 + amp - amp * p;
  const glideX = (layer.index % 3 === 0 ? -1 : 1) * 0.012 * width * (p - 0.5);
  const glideY = (layer.index % 2 === 0 ? 1 : -1) * 0.006 * height * (p - 0.5);
  layer.ambient.style.transform = flat ? "none" : `translate(${glideX.toFixed(2)}px, ${glideY.toFixed(2)}px) scale(${scale.toFixed(4)})`;

  resetEffects(layer);
  // Picture: the icon is drawn on stroke by stroke, then idles gently.
  for (const { el, start, shapes, photo } of layer.arts) {
    if (photo) {
      // A picture fades in and then holds still; the slow push of the whole scene gives it life.
      el.style.opacity = easeOut(clamp((local - start) / 1.0, 0, 1)).toFixed(3);
      continue;
    }
    const draw = easeOut(clamp((local - start) / 1.6, 0, 1));
    for (const shape of shapes) {
      shape.style.strokeDasharray = "1 1";
      shape.style.strokeDashoffset = String((1 - draw).toFixed(4));
    }
    const bob = Math.sin((local / 3.2) * Math.PI * 2) * 5;
    const tilt = Math.sin((local / 4.1) * Math.PI * 2) * 1.5;
    el.style.opacity = draw > 0.01 ? "1" : "0";
    el.style.transform = `translateY(${bob.toFixed(1)}px) rotate(${tilt.toFixed(2)}deg) scale(${(0.94 + 0.06 * draw).toFixed(3)})`;
  }
  // Arrivals first: an element is hidden and lowered until its moment, then settles into place.
  for (const { el, plan } of layer.reveals) {
    const prog = revealProgress(plan, local);
    if (prog >= 1) continue;
    touch(layer, el);
    anchorToElement(el);
    el.style.opacity = String(prog);
    el.style.transform = `translateY(${((1 - prog) * 30).toFixed(1)}px) scale(${(0.97 + 0.03 * prog).toFixed(4)})`;
  }
  for (const fx of planEffectsAt(layer.plan.effects, local)) {
    const planned = layer.plan.effects.find((p) => p.key === fx.key);
    if (!planned) continue;
    if (planned.kind === "follow") applyFollow(layer, planned, fx, local);
    else applyEffect(layer, fx);
  }
}

function transitionStyle(kind: string, q: number): { opacity: string; transform: string } {
  const e = easeOut(q);
  switch (kind) {
    case "slide-left": return { opacity: "1", transform: `translateX(${(1 - e) * 100}%)` };
    case "slide-right": return { opacity: "1", transform: `translateX(${-(1 - e) * 100}%)` };
    case "zoom-in": return { opacity: String(e), transform: `scale(${0.88 + 0.12 * e})` };
    case "zoom-out": return { opacity: String(e), transform: `scale(${1.12 - 0.12 * e})` };
    case "flip": return { opacity: String(e > 0.5 ? 1 : e * 2), transform: `perspective(1600px) rotateY(${(1 - e) * 90}deg)` };
    default: return { opacity: String(e), transform: "none" }; // fade
  }
}

export default function RenderPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const scrub = params.get("scrub") === "1";
  const debug = params.get("debug") === "1";
  // ?flat=1 holds the camera still, so a slide can be judged by eye (used by the theme gallery).
  const flat = params.get("flat") === "1";
  // Picture scenes need the icon library; ?art=0 turns it off.
  const artOn = params.get("art") !== "0";
  const [duration, setDuration] = useState(0);
  const setTimeRef = useRef<(t: number) => void>(() => undefined);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    const ready = (async (): Promise<RenderInfo> => {
      const data: RenderData = { ...(id === "fixture" ? (params.get("theme") ? fixtureThemed(params.get("theme")!, params.get("bg") ?? "gradient", params.get("font") ?? "theme") : FIXTURE) : await loadData(id)), photos: await loadPhotos() };
      const { width, height } = canvasSize(data.project);
      const { timings, duration: total } = buildSlideTimings(data.slides);
      if (timings.length === 0) throw new Error("This project has no slides to render.");

      host.style.cssText = `position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#000;`;
      host.replaceChildren();
      const layers = timings.map((t, i) => buildLayer(host, t, i, width, height));

      // Every slide must be fully loaded (and Tailwind applied) before layout is measured.
      await Promise.all(layers.map((l) => l.loaded));
      await Promise.all(layers.map((l) => l.frame.contentDocument?.fonts?.ready));
      await new Promise((r) => setTimeout(r, 800));
      let art: ArtIndex | null = null;
      try {
        if (artOn) art = buildIndex(await loadCatalog());
      } catch {
        /* no art library available: scenes simply render without clip art */
      }
      layers.forEach((l) => planLayer(l, data, width, height, art));
      // A generated picture must be decoded before any frame is drawn, or early frames would show it half-loaded.
      await Promise.all(layers.map((l) => l.photoImg?.decode?.().catch(() => undefined)));

      const setTime = (t: number) => {
        const state = slideStateAt(timings, t);
        layers.forEach((layer, i) => {
          const isCurrent = i === state.index;
          const isIncoming = state.incoming?.index === i;
          layer.root.style.visibility = isCurrent || isIncoming ? "visible" : "hidden";
          layer.root.style.zIndex = isIncoming ? "2" : "1";
          if (isCurrent) {
            layer.root.style.opacity = "1";
            layer.root.style.transform = "none";
            poseLayer(layer, state.local, width, height, flat);
          } else if (isIncoming && state.incoming) {
            const st = transitionStyle(layer.timing.slide.transition, state.incoming.progress);
            layer.root.style.opacity = st.opacity;
            layer.root.style.transform = st.transform;
            poseLayer(layer, 0, width, height, flat);
          }
        });
      };
      // Timing debug: burn the clock, the spoken word and the active effects into the frame.
      let hud: HTMLDivElement | null = null;
      if (debug) {
        hud = document.createElement("div");
        hud.style.cssText = "position:absolute;left:16px;top:16px;z-index:99999;padding:10px 14px;border-radius:8px;background:rgba(0,0,0,.72);color:#9ff;font:600 26px/1.35 ui-monospace,Menlo,monospace;white-space:pre;pointer-events:none;";
        host.appendChild(hud);
      }
      const setTimeWithHud = (t: number) => {
        setTime(t);
        if (!hud) return;
        const state = slideStateAt(timings, t);
        const layer = layers[state.index];
        if (!layer) return;
        const word = layer.words.find((w) => state.local >= w.s && state.local < w.e + 0.04);
        const active = planEffectsAt(layer.plan.effects, state.local).map((f) => `${f.key.slice(-6)}:${f.effect}`);
        const cam = cameraAt(layer.plan.shots, state.local);
        hud.textContent =
          `t ${t.toFixed(2)}s   ${layer.timing.slide.name} +${state.local.toFixed(2)}s\n` +
          `word  ${word ? `"${word.w}"  ${word.s.toFixed(2)}-${word.e.toFixed(2)}` : "-"}\n` +
          `fx    ${active.length ? active.join(", ") : "-"}\n` +
          `zoom  x${cam.zoom.toFixed(2)}`;
      };
      setTimeRef.current = setTimeWithHud;
      setTimeWithHud(0);
      setDuration(total);
      return {
        width,
        height,
        duration: total,
        slides: timings.map((t) => ({ id: t.slide.id, start: t.start, end: t.end })),
        decisions: layers.flatMap((l) => l.plan.decisions.map((d) => ({ ...d, scene: l.timing.slide.name || l.timing.slide.id })))
      };
    })();
    ready.catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));

    window.__render = { ready, setTime: (t) => setTimeRef.current(t) };
    return () => {
      cancelled = true;
      delete window.__render;
    };
  }, [id, debug, artOn, flat]);

  return (
    <div style={{ background: "#000", minHeight: "100vh" }}>
      <div ref={hostRef} />
      {error && <p style={{ color: "#f66", font: "16px monospace", padding: 16 }}>{error}</p>}
      {scrub && duration > 0 && (
        <input
          type="range" min={0} max={duration} step={0.05} defaultValue={0}
          onChange={(e) => setTimeRef.current(Number(e.target.value))}
          style={{ position: "fixed", left: 16, right: 16, bottom: 12, width: "calc(100% - 32px)", zIndex: 99999 }}
        />
      )}
    </div>
  );
}
