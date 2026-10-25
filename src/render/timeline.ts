import type { CanvasAspectRatio, EffectType, GeneratedHtml, Interaction, Project, ShotEasing } from "@/config/entities";
import type { WordTiming } from "./director";
import { isCut, transitionSeconds } from "./transitions";


/**
 * Pure, DOM-free timeline maths for the video renderer. Everything is a
 * function of time `t`, so a frame can be produced for any instant and the
 * same input always gives the same pixels — which is what frame-by-frame
 * capture needs (real-time CSS animation would not be repeatable).
 */

export interface RenderData {
  project: Pick<Project, "id" | "name" | "canvas_aspect_ratio" | "custom_canvas_width" | "custom_canvas_height" | "director_camera_intensity">;
  slides: GeneratedHtml[];
  /** The storyboard's PROPOSALS for emphasis; the director decides which of them actually happen. */
  interactions: Interaction[];
  /** Word-by-word timing of each scene's narration. */
  audio: { slide_id: string; words: WordTiming[] }[];
  /** Generated pictures by slide id (a path the render server serves); a picture scene uses its picture instead of icons. */
  photos?: Record<string, string>;
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
  if (next && !isCut(next.slide.transition)) {
    // The kind decides how long it may take (a whip pan is far shorter than a dissolve), whatever the scene asked for.
    const dur = transitionSeconds(next.slide.transition, next.slide.transition_duration);
    if (t >= current.end - dur) incoming = { index: index + 1, progress: clamp((t - (current.end - dur)) / dur, 0, 1) };
  }
  return { index, local: clamp(t - current.start, 0, current.end - current.start), incoming };
}

/** The fields the camera needs from a shot; both stored CameraShots and the director's planned shots fit. */
export interface ShotLike {
  start_time: number;
  transition_duration?: number;
  x_percent: number;
  y_percent: number;
  zoom: number;
  easing?: ShotEasing;
}

/** Camera state at local slide time: each shot eases from where the previous one left the camera. */
export function cameraAt(shots: ShotLike[], local: number): Camera {
  const ordered = shots.slice().sort((a, b) => a.start_time - b.start_time);
  let cur: Camera = { ...REST_CAMERA };
  for (const s of ordered) {
    if (s.start_time > local) break;
    const dur = Math.max(0.05, Number(s.transition_duration) || 0.8);
    const target: Camera = { x: clamp(Number(s.x_percent), 0, 100), y: clamp(Number(s.y_percent), 0, 100), zoom: clamp(Number(s.zoom) || 1, 1, 4) };
    if (local >= s.start_time + dur) {
      cur = target;
    } else {
      const e = (EASING[s.easing ?? "smooth"] ?? EASING.smooth)(clamp((local - s.start_time) / dur, 0, 1));
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

export interface ActiveEffect {
  key: string;
  effect: EffectType;
  selector: string;
  progress: number; // 0..1 across the cue
  envelope: number; // 0..1 fade in/out
  elapsed: number;
  /** Where to draw a highlight: just the spoken words, one box per line. */
  lines?: { x: number; y: number; w: number; h: number }[];
}
