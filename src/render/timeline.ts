import type {
  CameraShot, CanvasAspectRatio, CursorTimelinePoint, EffectType, GeneratedHtml,
  Interaction, InteractionAction, Project, ShotEasing, VideoEffectCue
} from "@/config/entities";

/**
 * Pure, DOM-free timeline maths for the video renderer. Everything is a
 * function of time `t`, so a frame can be produced for any instant and the
 * same input always gives the same pixels — which is what frame-by-frame
 * capture needs (real-time CSS animation would not be repeatable).
 */

export interface RenderData {
  project: Pick<Project, "id" | "name" | "canvas_aspect_ratio" | "custom_canvas_width" | "custom_canvas_height">;
  slides: GeneratedHtml[];
  interactions: Interaction[];
  shots: CameraShot[];
  cues: VideoEffectCue[];
  points: CursorTimelinePoint[];
}

export interface SlideTiming {
  slide: GeneratedHtml;
  start: number;
  end: number;
}

export interface Camera {
  x: number; // percent of canvas width the camera is centred on
  y: number;
  zoom: number;
}

export const REST_CAMERA: Camera = { x: 50, y: 50, zoom: 1 };
// The slide's own padding is where the next slide transitions in, so a transition never outlasts it.
export const MAX_TRANSITION_SEC = 0.8;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

export const EASING: Record<ShotEasing, (p: number) => number> = {
  smooth: (p) => 0.5 - Math.cos(Math.PI * p) / 2,
  easeInOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  snap: (p) => 1 - Math.pow(1 - p, 4),
  cinematic: (p) => (p < 0.5 ? 8 * p * p * p * p : 1 - Math.pow(-2 * p + 2, 4) / 2)
};
export const easeOut = (p: number) => 1 - Math.pow(1 - clamp(p, 0, 1), 3);

export function canvasSize(project: RenderData["project"]): { width: number; height: number } {
  const ratio: CanvasAspectRatio = project.canvas_aspect_ratio;
  if (ratio === "9:16") return { width: 1080, height: 1920 };
  if (ratio === "1:1") return { width: 1080, height: 1080 };
  if (ratio === "custom" && project.custom_canvas_width && project.custom_canvas_height) {
    return { width: Number(project.custom_canvas_width), height: Number(project.custom_canvas_height) };
  }
  return { width: 1920, height: 1080 };
}

export function buildSlideTimings(slides: GeneratedHtml[]): { timings: SlideTiming[]; duration: number } {
  const ordered = slides.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  let cursor = 0;
  const timings = ordered.map((slide) => {
    const start = cursor;
    cursor += Math.max(0.5, Number(slide.duration) || 6);
    return { slide, start, end: cursor };
  });
  return { timings, duration: cursor };
}

/** Which slide is on screen at `t`, plus the next slide while it is transitioning in. */
export function slideStateAt(timings: SlideTiming[], t: number) {
  if (timings.length === 0) return { index: -1, local: 0, incoming: null as null | { index: number; progress: number } };
  let index = timings.findIndex((s) => t >= s.start && t < s.end);
  if (index < 0) index = t < 0 ? 0 : timings.length - 1;
  const current = timings[index];
  const next = timings[index + 1];
  let incoming: null | { index: number; progress: number } = null;
  if (next && next.slide.transition && next.slide.transition !== "none") {
    const dur = clamp(Number(next.slide.transition_duration) || 0.6, 0.1, MAX_TRANSITION_SEC);
    if (t >= current.end - dur) incoming = { index: index + 1, progress: clamp((t - (current.end - dur)) / dur, 0, 1) };
  }
  return { index, local: clamp(t - current.start, 0, current.end - current.start), incoming };
}

/** Camera state at local slide time: each shot eases from where the previous one left the camera. */
export function cameraAt(shots: CameraShot[], local: number): Camera {
  const ordered = shots.slice().sort((a, b) => a.start_time - b.start_time);
  let cur: Camera = { ...REST_CAMERA };
  for (const s of ordered) {
    if (s.start_time > local) break;
    const dur = Math.max(0.05, Number(s.transition_duration) || 0.8);
    const target: Camera = { x: clamp(Number(s.x_percent), 0, 100), y: clamp(Number(s.y_percent), 0, 100), zoom: clamp(Number(s.zoom) || 1, 1, 4) };
    if (local >= s.start_time + dur) {
      cur = target;
    } else {
      const e = (EASING[s.easing] ?? EASING.smooth)(clamp((local - s.start_time) / dur, 0, 1));
      return { x: lerp(cur.x, target.x, e), y: lerp(cur.y, target.y, e), zoom: lerp(cur.zoom, target.zoom, e) };
    }
  }
  return cur;
}

/** CSS transform (origin 0 0) that puts the camera's focus point at the centre without exposing the canvas edge. */
export function cameraTransform(cam: Camera, width: number, height: number): string {
  const z = cam.zoom;
  const tx = clamp(width / 2 - z * (cam.x / 100) * width, width - z * width, 0);
  const ty = clamp(height / 2 - z * (cam.y / 100) * height, height - z * height, 0);
  return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${z.toFixed(4)})`;
}

export interface CursorState {
  x: number; // percent
  y: number;
  click: number; // 0..1 ripple progress, 0 when idle
}

/** Cursor position at local slide time, or null when the slide has no cursor path. */
export function cursorAt(points: CursorTimelinePoint[], local: number): CursorState | null {
  const pts = points.slice().sort((a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0) || a.time - b.time);
  if (pts.length === 0) return null;
  let pos = { x: Number(pts[0].x_percent), y: Number(pts[0].y_percent) };
  let click = 0;
  for (let i = 1; i < pts.length; i++) {
    const to = pts[i];
    const from = pts[i - 1];
    // The point's duration is how long the move into it takes; a zero-length hold still glides briefly.
    const moveSec = Math.max(0.35, (Number(to.duration_ms) || 0) / 1000);
    const arrive = Number(to.time);
    const depart = Math.max(Number(from.time), arrive - moveSec);
    if (local >= arrive) {
      pos = { x: Number(to.x_percent), y: Number(to.y_percent) };
    } else if (local > depart) {
      const e = EASING.smooth(clamp((local - depart) / (arrive - depart), 0, 1));
      pos = { x: lerp(Number(from.x_percent), Number(to.x_percent), e), y: lerp(Number(from.y_percent), Number(to.y_percent), e) };
      break;
    } else {
      break;
    }
  }
  for (const p of pts) {
    if (p.click && local >= Number(p.time) && local <= Number(p.time) + 0.4) click = (local - Number(p.time)) / 0.4;
  }
  return { x: pos.x, y: pos.y, click };
}

// Fallback when an interaction has no director cue: reuse its own action as the effect.
const ACTION_TO_EFFECT: Record<InteractionAction, EffectType> = {
  highlight: "wipe-reveal",
  "glow-green": "glow",
  "glow-orange": "glow",
  spotlight: "spotlight",
  "scale-pop": "scale-pop",
  "draw-outline": "circle",
  "sweep-highlight": "wipe-reveal",
  "dim-rest": "dim-background"
};

export interface ActiveEffect {
  key: string;
  effect: EffectType;
  selector: string;
  progress: number; // 0..1 across the cue
  envelope: number; // 0..1 fade in/out
  elapsed: number;
}

export function effectsAt(cues: VideoEffectCue[], interactions: Interaction[], local: number): ActiveEffect[] {
  const defs: { key: string; effect: EffectType; selector: string; start: number; duration: number }[] = [];
  const cued = new Set<string>();
  for (const c of cues) {
    if (c.interaction_id) cued.add(c.interaction_id);
    const linked = interactions.find((i) => i.id === c.interaction_id);
    defs.push({
      key: c.id,
      effect: c.effect,
      selector: c.target_selector || linked?.target_selector || "",
      start: Number(c.start_time),
      duration: Math.max(0.3, Number(c.duration) || 1.5)
    });
  }
  for (const i of interactions) {
    if (cued.has(i.id)) continue;
    defs.push({ key: i.id, effect: ACTION_TO_EFFECT[i.action] ?? "none", selector: i.target_selector || "", start: Number(i.time_offset), duration: Math.max(0.3, Number(i.duration) || 1.5) });
  }
  const FADE_IN = 0.25;
  const FADE_OUT = 0.3;
  return defs
    .filter((d) => d.effect !== "none" && d.selector && local >= d.start && local <= d.start + d.duration)
    .map((d) => {
      const elapsed = local - d.start;
      const envelope = clamp(Math.min(elapsed / FADE_IN, (d.duration - elapsed) / FADE_OUT), 0, 1);
      return { key: d.key, effect: d.effect, selector: d.selector, progress: elapsed / d.duration, envelope: easeOut(envelope), elapsed };
    });
}
