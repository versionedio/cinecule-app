/**
 * Config-driven entity metadata (JDD). The generic pages read this.
 * Matches the live nostackai schema exported from the console —
 * entity names come back lowercase with no separators (project,
 * generatedhtml, script, voiceover, finalvideo), and custom field
 * names save as snake_case (project_id, html_content, ...) regardless
 * of what was typed into the entity builder's "Input name" box —
 * confirmed via the API Studio test console's placeholder request body.
 */

// Live pipeline per entities.json (confirmed 2026-08-10): draft ->
// generating_content (AI writes slides/interactions from content sources) ->
// generating_voice (TTS per slide) -> generating_direction (auto camera
// shots/effect cues) -> ready_to_render (open for manual edits) -> rendering
// -> ready (export asset live) / failed. archived is a terminal side-state.
export const PIPELINE_STAGES = [
  { status: "draft", label: "Draft" },
  { status: "generating_content", label: "Content" },
  { status: "generating_voice", label: "Voice" },
  { status: "generating_direction", label: "Direction" },
  { status: "ready_to_render", label: "Review" },
  { status: "rendering", label: "Render" },
  { status: "ready", label: "Ready" }
] as const;

export type ProjectStatus = (typeof PIPELINE_STAGES)[number]["status"] | "failed" | "archived";

export type VideoType =
  | "marketing" | "explainer" | "tutorial" | "product-demo"
  | "social-short" | "educational" | "narrative" | "other";

export type CanvasAspectRatio = "16:9" | "9:16" | "1:1" | "custom";
export type CameraIntensity = "subtle" | "medium" | "dramatic";
export type CursorSpeed = "fast" | "average" | "slow";

export interface Project {
  id: string;
  name: string; // platform's auto base field — doubles as the project title
  article_content?: string; // legacy quick-entry; prefer ContentSource rows
  video_type: VideoType;
  status: ProjectStatus;
  canvas_aspect_ratio: CanvasAspectRatio;
  // The shapes to render, comma separated ("16:9,9:16"); one video is made per shape. Empty: one, in canvas_aspect_ratio.
  render_aspect_ratios?: string;
  custom_canvas_width?: number;
  custom_canvas_height?: number;
  director_camera_intensity?: CameraIntensity;
  director_auto_generate_effects?: boolean;
  director_zoom_hold_after_effect_sec?: number;
  director_camera_move_duration_sec?: number;
  cursor_speed?: CursorSpeed;
  user_id?: string; // owner index field — auto-stamped by the platform on create only under this exact name
  active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type ContentSourceType = "text" | "url" | "pdf" | "image" | "query";
export type ContentSourceStatus = "draft" | "processing" | "processed" | "failed";

export interface ContentSource {
  id: string;
  name?: string;
  project_id: string;
  source_type: ContentSourceType;
  title?: string;
  url?: string;
  raw_text?: string;
  file_key?: string;
  // Not on the entity yet — needs adding in the console (create + update +
  // get + list field-projection screens, per the per-endpoint propagation
  // quirk in ISSUES.md #13/#21b). file_key alone only holds the bare S3 key
  // (e.g. "abc123_source"), not a fetchable URL — ai_call's image context
  // field needs a real https:// URL, confirmed live: passing file_key
  // directly got rejected by the vision provider as "unsupported image
  // url". file_url should store uploadEntityFile's returned cdnUrl instead.
  file_url?: string;
  summary?: string;
  status: ContentSourceStatus;
  created_at?: string;
}

export type ShotEasing = "smooth" | "easeInOut" | "snap" | "cinematic";
export type ShotType = "establishing" | "focus" | "push-in" | "pull-back" | "pan" | "final-hold";

export interface CameraShot {
  id: string;
  name?: string;
  project_id: string;
  slide_id: string;
  label: string;
  start_time: number;
  end_time: number;
  target_selector?: string;
  x_percent: number;
  y_percent: number;
  zoom: number;
  transition_duration?: number;
  easing: ShotEasing;
  shot_type: ShotType;
  created_at?: string;
}

export type EffectType =
  | "spotlight" | "dim-background" | "scale-pop" | "glow" | "underline"
  | "circle" | "wipe-reveal" | "blur-rest" | "kinetic-text" | "none";

export interface VideoEffectCue {
  id: string;
  name?: string;
  project_id: string;
  slide_id: string;
  interaction_id?: string;
  label: string;
  start_time: number;
  duration: number;
  target_selector?: string;
  effect: EffectType;
  created_at?: string;
}

export type CursorPointSource = "tap" | "selector" | "manual" | "animation-auto" | "slide-boundary-hold";
export type CursorPointRole =
  | "anchor-start" | "arrive" | "hold" | "anchor-after-final-effect"
  | "anchor-end" | "boundary-hold" | "manual";

export interface CursorTimelinePoint {
  id: string;
  name?: string;
  project_id: string;
  slide_id?: string;
  interaction_id?: string;
  time: number;
  x_percent: number;
  y_percent: number;
  duration_ms: number;
  click?: boolean;
  label?: string;
  source?: CursorPointSource;
  selector?: string;
  point_role?: CursorPointRole;
  sequence_index?: number;
  created_at?: string;
}

export type ExportAssetType = "config-json" | "standalone-html" | "video" | "image";
export type ExportAssetStatus = "created" | "processing" | "ready" | "failed";

export interface ExportAsset {
  id: string;
  name?: string;
  project_id: string;
  asset_type: ExportAssetType;
  file_key?: string;
  cdn_url?: string;
  status: ExportAssetStatus;
  resolution?: string;
  // The shape this render was made in. Empty: the film's own shape.
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  frame_rate?: number;
  duration_sec?: number;
  // Reported by the render worker while the asset is "processing".
  progress_pct?: number;
  eta_sec?: number;
  stage?: string;
  created_at?: string;
}

export type TransitionType = "fade" | "slide-left" | "slide-right" | "zoom-in" | "zoom-out" | "flip" | "wipe" | "iris" | "flash" | "none";

export interface GeneratedHtml {
  id: string;
  name?: string;
  project_id: string;
  html_content: string;
  sort_order: number;
  duration: number;
  transition: TransitionType;
  transition_duration: number;
  narration_text?: string;
  created_at?: string;
}

export type InteractionAction =
  | "highlight" | "glow-green" | "glow-orange" | "spotlight"
  | "scale-pop" | "draw-outline" | "sweep-highlight" | "dim-rest";

export interface Interaction {
  id: string;
  name?: string;
  slide_id: string;
  project_id: string;
  // The words the narration speaks for this emphasis — used to time it. Rows
  // saved by the editor before target_selector existed hold a CSS selector here.
  target_text: string;
  // "#id" of the slide element to emphasise (generated slides give every
  // emphasised element an id). Preferred over target_text when locating it.
  target_selector?: string;
  action: InteractionAction;
  trigger: "click" | "timed";
  time_offset: number;
  duration?: number;
  label?: string;
  sort_order?: number;
  // false when the director rejected the proposal; kept for the editor but not rendered.
  active?: boolean;
  created_at?: string;
}

/** The selector to try first for an interaction, covering rows from before target_selector existed. */
export const interactionSelector = (i: Pick<Interaction, "target_selector" | "target_text">) =>
  i.target_selector || i.target_text;

export interface Voiceover {
  id: string;
  name?: string;
  project_id: string;
  slide_id?: string; // absent = whole-project track (legacy); set = per-slide clip (current pipeline)
  audio_file: string; // s3 field — url or key depending on the configured view
  voice_style?: string;
  created_at?: string;
}

export interface FinalVideo {
  id: string;
  name?: string;
  project_id: string;
  video_file: string; // s3 field — url or key depending on the configured view
  resolution?: string;
  frame_rate?: number;
  youtube_url?: string;
  created_at?: string;
}

export const ENTITY_NAMES = {
  project: "project",
  generatedHtml: "generatedhtml",
  interaction: "interaction",
  voiceover: "voiceover",
  finalVideo: "finalvideo",
  contentSource: "contentsource",
  cameraShot: "camerashot",
  videoEffectCue: "videoeffectcue",
  cursorTimelinePoint: "cursortimelinepoint",
  exportAsset: "exportasset"
} as const;
// "script" removed — the standalone script-generation stage was retired,
// narration now lives on generatedhtml.narration_text (see logicblocks.json).
// "finalvideo" is deprecated in place — exportasset replaces it.

export const RESOLUTIONS = ["1920x1080", "2560x1440", "3840x2160"];
export const FPS_OPTIONS = ["30", "60"];

// Matches the src/index.css Classical tokens: primary/accent (gold) for
// active generation stages, success (green) for ready, destructive (brick
// red) for failed, muted for draft/archived.
export const STATUS_COLORS: Record<string, string> = {
  draft: "#8d867a",
  generating_content: "#c99b4e",
  generating_voice: "#c99b4e",
  generating_direction: "#c99b4e",
  ready_to_render: "#c99b4e",
  rendering: "#c99b4e",
  ready: "#3f9d5f",
  failed: "#c2503a",
  archived: "#8d867a"
};

// Shown under the pipeline timeline while a stage is actively running.
export const STAGE_LOADING_MESSAGES: Partial<Record<ProjectStatus, string>> = {
  generating_content: "Writing the storyboard with AI…",
  generating_voice: "Synthesizing the voiceover…",
  generating_direction: "Computing camera shots and effect cues…",
  rendering: "Rendering the final video — this can take a while…"
};
