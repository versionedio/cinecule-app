import type { RenderData } from "./timeline";

/**
 * A tiny built-in project for exercising the renderer without credentials:
 * `/render/fixture`. Covers a transition, camera moves, three effect types
 * and a cursor path with a click.
 */
const frame = (bg: string, body: string) =>
  `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px;background:${bg};color:#fff;font-family:system-ui,sans-serif;padding:80px;box-sizing:border-box">${body}</div>`;

const base = { project_id: "fixture", active: true } as const;

export const FIXTURE: RenderData = {
  project: { id: "fixture", name: "Fixture", canvas_aspect_ratio: "16:9" },
  slides: [
    {
      ...base, id: "sl1", name: "Slide 1", sort_order: 0, duration: 4, transition: "fade", transition_duration: 0.6, narration_text: "",
      html_content: frame("#0b0b10", `<h1 id="s1-title" style="font-size:96px;margin:0">The Domestic Cat</h1><p id="s1-sub" style="font-size:40px;margin:0;color:#f2b54a">A fixture slide for the renderer</p>`)
    },
    {
      ...base, id: "sl2", name: "Slide 2", sort_order: 1, duration: 4, transition: "slide-left", transition_duration: 0.6, narration_text: "",
      html_content: frame("#10131c", `<h2 style="font-size:64px;margin:0">Three facts</h2><div style="display:flex;gap:40px"><div id="s2-card-1" style="background:#1a1a2e;padding:48px;border-radius:20px;font-size:40px">7500 BCE</div><div id="s2-card-2" style="background:#1a1a2e;padding:48px;border-radius:20px;font-size:40px">600 million</div><div id="s2-card-3" style="background:#1a1a2e;padding:48px;border-radius:20px;font-size:40px">13 years</div></div>`)
    },
    {
      ...base, id: "sl3", name: "Slide 3", sort_order: 2, duration: 3, transition: "zoom-in", transition_duration: 0.6, narration_text: "",
      html_content: frame("#14100c", `<h1 id="s3-title" style="font-size:88px;margin:0">Thanks for watching</h1>`)
    }
  ],
  interactions: [
    { ...base, id: "i1", slide_id: "sl1", target_text: "The Domestic Cat", target_selector: "#s1-title", action: "glow-orange", trigger: "timed", time_offset: 0.8, duration: 2 },
    { ...base, id: "i2", slide_id: "sl2", target_text: "7500 BCE", target_selector: "#s2-card-1", action: "spotlight", trigger: "timed", time_offset: 0.8, duration: 1.4 },
    { ...base, id: "i3", slide_id: "sl2", target_text: "600 million", target_selector: "#s2-card-2", action: "scale-pop", trigger: "timed", time_offset: 2.4, duration: 1.2 }
  ],
  shots: [
    { ...base, id: "c1", slide_id: "sl1", label: "open", start_time: 0, end_time: 1, x_percent: 50, y_percent: 50, zoom: 1, transition_duration: 0.4, easing: "smooth", shot_type: "establishing" },
    { ...base, id: "c2", slide_id: "sl1", label: "push", start_time: 1, end_time: 3.5, target_selector: "#s1-title", x_percent: 50, y_percent: 42, zoom: 1.4, transition_duration: 0.9, easing: "cinematic", shot_type: "push-in" },
    { ...base, id: "c3", slide_id: "sl2", label: "open", start_time: 0, end_time: 1, x_percent: 50, y_percent: 50, zoom: 1, transition_duration: 0.4, easing: "smooth", shot_type: "establishing" },
    { ...base, id: "c4", slide_id: "sl2", label: "card 1", start_time: 0.6, end_time: 2.2, target_selector: "#s2-card-1", x_percent: 30, y_percent: 58, zoom: 1.5, transition_duration: 0.8, easing: "easeInOut", shot_type: "focus" },
    { ...base, id: "c5", slide_id: "sl2", label: "card 2", start_time: 2.2, end_time: 3.8, target_selector: "#s2-card-2", x_percent: 55, y_percent: 58, zoom: 1.5, transition_duration: 0.8, easing: "easeInOut", shot_type: "pan" }
  ] as RenderData["shots"],
  cues: [
    { ...base, id: "e1", slide_id: "sl1", interaction_id: "i1", label: "title glow", start_time: 0.8, duration: 2, target_selector: "#s1-title", effect: "glow" },
    { ...base, id: "e2", slide_id: "sl2", interaction_id: "i2", label: "card spotlight", start_time: 0.8, duration: 1.4, target_selector: "#s2-card-1", effect: "spotlight" },
    { ...base, id: "e3", slide_id: "sl2", interaction_id: "i3", label: "card pop", start_time: 2.4, duration: 1.2, target_selector: "#s2-card-2", effect: "scale-pop" },
    { ...base, id: "e4", slide_id: "sl3", interaction_id: "", label: "underline", start_time: 0.6, duration: 1.8, target_selector: "#s3-title", effect: "underline" }
  ] as RenderData["cues"],
  points: [
    { ...base, id: "p1", slide_id: "sl2", time: 0, x_percent: 50, y_percent: 50, duration_ms: 0, click: false, point_role: "anchor-start", sequence_index: 0 },
    { ...base, id: "p2", slide_id: "sl2", interaction_id: "i2", time: 1.0, x_percent: 28, y_percent: 62, duration_ms: 600, click: true, point_role: "arrive", sequence_index: 1 },
    { ...base, id: "p3", slide_id: "sl2", interaction_id: "i3", time: 2.6, x_percent: 55, y_percent: 62, duration_ms: 700, click: false, point_role: "arrive", sequence_index: 2 }
  ] as RenderData["points"]
} as RenderData;
