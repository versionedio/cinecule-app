import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { entityService } from "@/services/entityService";
import {
  CameraShot, CursorTimelinePoint, ENTITY_NAMES, GeneratedHtml, Interaction, Project, VideoEffectCue
} from "@/config/entities";
import {
  ActiveEffect, RenderData, SlideTiming, buildSlideTimings, cameraAt, cameraTransform, canvasSize,
  clamp, cursorAt, easeOut, effectsAt, slideStateAt
} from "@/render/timeline";
import { FIXTURE } from "@/render/fixture";

/**
 * Headless video render surface. Not a user-facing page: the render script
 * opens it in Chromium, waits for `window.__render.ready`, then calls
 * `setTime(t)` and screenshots once per frame. Everything is drawn from `t`
 * alone (no real-time animation), so frames are repeatable.
 */

export interface RenderInfo {
  width: number;
  height: number;
  duration: number;
  slides: { id: string; start: number; end: number }[];
}

declare global {
  interface Window {
    __render?: { ready: Promise<RenderInfo>; setTime: (t: number) => void };
  }
}

const ACCENT = "#f2b54a";
// Slide HTML may carry its own CSS animation; freeze it so a frame depends only on `t`.
const FREEZE_CSS = "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}html,body{margin:0;height:100%;overflow:hidden}";

async function loadData(projectId: string): Promise<RenderData> {
  const q = { project_id: projectId, pagesize: 100 };
  const [project, slides, interactions, shots, cues, points] = await Promise.all([
    entityService.get<Project>(ENTITY_NAMES.project, projectId),
    entityService.list<GeneratedHtml>(ENTITY_NAMES.generatedHtml, q),
    entityService.list<Interaction>(ENTITY_NAMES.interaction, q),
    entityService.list<CameraShot>(ENTITY_NAMES.cameraShot, q),
    entityService.list<VideoEffectCue>(ENTITY_NAMES.videoEffectCue, q),
    entityService.list<CursorTimelinePoint>(ENTITY_NAMES.cursorTimelinePoint, q)
  ]);
  return {
    project,
    slides: slides.data ?? [],
    interactions: interactions.data ?? [],
    shots: shots.data ?? [],
    cues: cues.data ?? [],
    points: points.data ?? []
  };
}

interface Layer {
  timing: SlideTiming;
  root: HTMLDivElement;
  camera: HTMLDivElement;
  frame: HTMLIFrameElement;
  cursor: HTMLDivElement;
  ripple: HTMLDivElement;
  loaded: Promise<void>;
  shots: CameraShot[];
  points: CursorTimelinePoint[];
  interactions: Interaction[];
  cues: VideoEffectCue[];
  // Inline styles of elements an effect touched, so each frame starts clean.
  original: Map<HTMLElement, string | null>;
}

function safeQuery(doc: Document, selector: string): HTMLElement | null {
  try {
    return doc.querySelector<HTMLElement>(selector);
  } catch {
    return null;
  }
}

/**
 * The director AI placed shots and cursor points as guessed percentages, but it can't see the
 * layout, so zooming toward those guesses crops real text. Once a slide has loaded we know where
 * its elements actually are: aim each shot at its element's box (zoomed no further than lets the
 * whole element fit) and send the cursor to real elements only.
 */
function resolveAgainstLayout(layer: Layer, interactions: Interaction[], width: number, height: number) {
  const doc = layer.frame.contentDocument;
  if (!doc?.body) return;
  const rectOf = (selector: string | undefined) => {
    const el = selector ? safeQuery(doc, selector) : null;
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? r : null;
  };
  const MARGIN = 1.25; // keep a little air around the focused element

  layer.shots = layer.shots.map((shot) => {
    const r = rectOf(shot.target_selector);
    if (!r) return { ...shot, zoom: Math.min(Number(shot.zoom) || 1, 1.15) }; // unknown target: stay near full frame
    const fit = Math.min(width / (r.width * MARGIN), height / (r.height * MARGIN));
    return {
      ...shot,
      x_percent: ((r.left + r.width / 2) / width) * 100,
      y_percent: ((r.top + r.height / 2) / height) * 100,
      zoom: Math.max(1, Math.min(Number(shot.zoom) || 1, fit))
    };
  });

  const resolved: CursorTimelinePoint[] = [];
  for (const p of layer.points) {
    const linked = interactions.find((i) => i.id === p.interaction_id);
    const r = rectOf(p.selector) ?? rectOf(linked?.target_selector);
    if (!r) continue; // no real target, no cursor point
    // Aim at the lower right of the element so the pointer doesn't sit on top of the words.
    resolved.push({ ...p, x_percent: ((r.left + r.width * 0.72) / width) * 100, y_percent: ((r.top + r.height * 0.72) / height) * 100 });
  }
  layer.points = resolved;
}

function resetEffects(layer: Layer) {
  for (const [el, style] of layer.original) {
    if (style === null) el.removeAttribute("style");
    else el.setAttribute("style", style);
  }
  layer.original.clear();
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
  const raise = () => {
    touch(layer, el);
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    el.style.zIndex = "1000";
  };
  const box = (pad: number) => `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;`;
  const grow = easeOut(fx.elapsed / 0.5);

  switch (fx.effect) {
    case "spotlight":
      overlay(doc, `${box(14)}border-radius:18px;box-shadow:0 0 0 4000px rgba(0,0,0,${0.68 * e});z-index:999;`);
      raise();
      break;
    case "dim-background":
      overlay(doc, `inset:0;background:rgba(0,0,0,${0.55 * e});z-index:999;`);
      raise();
      break;
    case "blur-rest":
      overlay(doc, `inset:0;background:rgba(0,0,0,${0.25 * e});backdrop-filter:blur(${9 * e}px);z-index:999;`);
      raise();
      break;
    case "scale-pop": {
      touch(layer, el);
      if (getComputedStyle(el).display === "inline") el.style.display = "inline-block";
      anchorToElement(el);
      el.style.transform = `scale(${1 + 0.1 * Math.sin(Math.PI * clamp(fx.progress, 0, 1))})`;
      break;
    }
    case "glow":
      // drop-shadow follows the actual shape (letters or a card's outline), unlike a rectangular box-shadow.
      touch(layer, el);
      el.style.filter = `drop-shadow(0 0 ${14 * e}px rgba(242,181,74,${0.95 * e})) drop-shadow(0 0 ${34 * e}px rgba(242,181,74,${0.6 * e}))`;
      break;
    case "underline":
      overlay(doc, `left:${r.left}px;top:${r.bottom + 6}px;width:${r.width * grow}px;height:6px;border-radius:3px;background:${ACCENT};opacity:${e};z-index:999;`);
      break;
    case "circle":
      overlay(doc, `${box(18)}border:5px solid ${ACCENT};border-radius:50%;opacity:${e};clip-path:inset(0 ${100 * (1 - grow)}% 0 0);z-index:999;`);
      break;
    case "wipe-reveal":
      overlay(doc, `${box(8)}background:rgba(242,181,74,${0.38 * e});border-radius:10px;clip-path:inset(0 ${100 * (1 - grow)}% 0 0);z-index:999;`);
      break;
    case "kinetic-text":
      touch(layer, el);
      if (getComputedStyle(el).display === "inline") el.style.display = "inline-block";
      anchorToElement(el);
      el.style.transform = `scale(${1 + 0.14 * Math.sin(Math.PI * clamp(fx.progress, 0, 1))})`;
      el.style.letterSpacing = `${3 * e}px`;
      break;
    default:
      break;
  }
}

const CURSOR_SVG =
  '<svg width="34" height="34" viewBox="0 0 24 24" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))"><path d="M4 2l15 9-6.5 1.6L9.6 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';

function buildLayer(host: HTMLElement, timing: SlideTiming, data: RenderData, width: number, height: number): Layer {
  const id = timing.slide.id;
  const root = document.createElement("div");
  root.style.cssText = `position:absolute;inset:0;width:${width}px;height:${height}px;visibility:hidden;`;
  const camera = document.createElement("div");
  camera.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;transform-origin:0 0;`;
  const frame = document.createElement("iframe");
  frame.setAttribute("title", timing.slide.name || id);
  frame.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;border:0;background:#fff;`;
  // Listen before srcdoc is set: a fresh iframe's blank document already reads "complete", so
  // readyState can't be trusted, and a late listener could miss the real load.
  const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><script src="https://cdn.tailwindcss.com"></script><style>${FREEZE_CSS}</style></head><body>${timing.slide.html_content || ""}<div id="__fx"></div></body></html>`;
  const cursor = document.createElement("div");
  cursor.style.cssText = "position:absolute;width:0;height:0;display:none;z-index:5;";
  cursor.innerHTML = `<div style="position:absolute;left:0;top:0">${CURSOR_SVG}</div>`;
  const ripple = document.createElement("div");
  ripple.style.cssText = `position:absolute;left:-30px;top:-30px;width:60px;height:60px;border-radius:50%;border:4px solid ${ACCENT};opacity:0;`;
  cursor.appendChild(ripple);
  camera.append(frame, cursor);
  root.appendChild(camera);
  host.appendChild(root);
  return {
    timing, root, camera, frame, cursor, ripple, loaded, original: new Map(),
    shots: data.shots.filter((s) => s.slide_id === id),
    points: data.points.filter((p) => p.slide_id === id),
    interactions: data.interactions.filter((i) => i.slide_id === id),
    cues: data.cues.filter((c) => c.slide_id === id)
  };
}

function poseLayer(layer: Layer, local: number, width: number, height: number) {
  layer.camera.style.transform = cameraTransform(cameraAt(layer.shots, local), width, height);

  resetEffects(layer);
  for (const fx of effectsAt(layer.cues, layer.interactions, local)) applyEffect(layer, fx);

  const cur = cursorAt(layer.points, local);
  if (!cur) {
    layer.cursor.style.display = "none";
    return;
  }
  layer.cursor.style.display = "block";
  // Appear just before the first thing it points at, not at the start of the slide.
  const firstArrive = Math.min(...layer.points.map((p) => Number(p.time)));
  layer.cursor.style.opacity = String(clamp((local - (firstArrive - 0.5)) / 0.4, 0, 1));
  layer.cursor.style.left = `${(cur.x / 100) * width}px`;
  layer.cursor.style.top = `${(cur.y / 100) * height}px`;
  layer.ripple.style.opacity = cur.click > 0 ? String(1 - cur.click) : "0";
  layer.ripple.style.transform = `scale(${0.4 + cur.click * 1.3})`;
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
  const [duration, setDuration] = useState(0);
  const setTimeRef = useRef<(t: number) => void>(() => undefined);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    const ready = (async (): Promise<RenderInfo> => {
      const data = id === "fixture" ? FIXTURE : await loadData(id);
      const { width, height } = canvasSize(data.project);
      const { timings, duration: total } = buildSlideTimings(data.slides);
      if (timings.length === 0) throw new Error("This project has no slides to render.");

      host.style.cssText = `position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#000;`;
      host.replaceChildren();
      const layers = timings.map((t) => buildLayer(host, t, data, width, height));

      // Every slide must be fully loaded (and Tailwind applied) before the first frame is captured.
      await Promise.all(layers.map((l) => l.loaded));
      await Promise.all(layers.map((l) => l.frame.contentDocument?.fonts?.ready));
      await new Promise((r) => setTimeout(r, 800));
      layers.forEach((l) => resolveAgainstLayout(l, data.interactions, width, height));

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
            poseLayer(layer, state.local, width, height);
          } else if (isIncoming && state.incoming) {
            const st = transitionStyle(layer.timing.slide.transition, state.incoming.progress);
            layer.root.style.opacity = st.opacity;
            layer.root.style.transform = st.transform;
            poseLayer(layer, 0, width, height);
          }
        });
      };
      setTimeRef.current = setTime;
      setTime(0);
      setDuration(total);
      return { width, height, duration: total, slides: timings.map((t) => ({ id: t.slide.id, start: t.start, end: t.end })) };
    })();
    ready.catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));

    window.__render = { ready, setTime: (t) => setTimeRef.current(t) };
    return () => {
      cancelled = true;
      delete window.__render;
    };
  }, [id]);

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
