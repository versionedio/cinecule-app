import type { RenderData } from "./timeline";
import type { WordTiming } from "./director";

/**
 * A small built-in project for exercising the renderer and the director without credentials:
 * `/render/fixture`. Narration is synthesised with realistic word timings (about 2.6 words/second).
 * It deliberately includes emphasis proposals that must be DROPPED (their words are never spoken),
 * so a regression that lets irrelevant highlights through shows up immediately.
 */
function narrate(text: string, startAt = 0.4): WordTiming[] {
  const out: WordTiming[] = [];
  let t = startAt;
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const e = t + 0.14 + 0.045 * w.length;
    out.push({ w, s: Math.round(t * 100) / 100, e: Math.round(e * 100) / 100 });
    t = e + 0.07;
  }
  return out;
}

const frame = (bg: string, body: string) =>
  `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:48px;background:${bg};color:#fff;font-family:system-ui,sans-serif;padding:120px;box-sizing:border-box">${body}</div>`;
const column = (bg: string, body: string) =>
  `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:40px;background:${bg};color:#fff;font-family:system-ui,sans-serif;padding:120px 120px 120px 150px;box-sizing:border-box">${body}</div>`;
const row = (id: string, text: string) => `<div id="${id}" style="font-size:50px;padding:18px 28px;border-radius:18px;background:#161a24;width:1100px">${text}</div>`;

const base = { project_id: "fixture", active: true } as const;
const proposal = (id: string, slide_id: string, selector: string, text: string, action: string) =>
  ({ ...base, id, slide_id, target_text: text, target_selector: selector, action, trigger: "timed", time_offset: 0, duration: 2 }) as unknown as RenderData["interactions"][number];

export const FIXTURE: RenderData = {
  project: { id: "fixture", name: "Fixture", canvas_aspect_ratio: "16:9", director_camera_intensity: "medium" } as RenderData["project"],
  slides: [
    {
      ...base, id: "sl1", name: "Scene 1", sort_order: 0, duration: 7.5, transition: "fade", transition_duration: 0.6, narration_text: "",
      html_content: frame("#0b0b10", `<h1 id="s1-title" style="font-size:110px;margin:0">The Domestic Cat</h1><p id="s1-sub" style="font-size:48px;margin:0;color:#f2b54a">Quarterly revenue by region</p>`)
    },
    {
      ...base, id: "sl2", name: "Scene 2", sort_order: 1, duration: 12.5, transition: "slide-left", transition_duration: 0.6, narration_text: "",
      html_content: column("#10131c", `<h2 id="s2-title" style="font-size:84px;margin:0">Cats and people</h2>${row("s2-item-1", "Tamed in the Near East around 7500 BCE")}${row("s2-item-2", "Roughly 600 million cats live worldwide")}${row("s2-item-3", "Average lifespan about 13 years")}`)
    },
    {
      ...base, id: "sl4", name: "Scene 3b", sort_order: 2, duration: 9.5, transition: "fade", transition_duration: 0.6, narration_text: "",
      html_content: column("#0f1218", `<h2 id="s4-title" style="font-size:84px;margin:0">Hunters of the twilight</h2>${row("s4-item-1", "Hunt at dawn and dusk")}${row("s4-item-2", "Sleep twelve to sixteen hours a day")}`)
    },
    {
      ...base, id: "sl5", name: "Scene 3c", sort_order: 3, duration: 8, transition: "slide-right", transition_duration: 0.6, narration_text: "",
      html_content: column("#12100f", `<h2 id="s5-title" style="font-size:84px;margin:0">Why it matters</h2>${row("s5-item-1", "Many things change over time")}`)
    },
    {
      ...base, id: "sl3", name: "Scene 3", sort_order: 4, duration: 6, transition: "zoom-in", transition_duration: 0.6, narration_text: "",
      html_content: frame("#14100c", `<h1 id="s3-title" style="font-size:100px;margin:0">Thanks for watching</h1>`)
    }
  ] as unknown as RenderData["slides"],
  interactions: [
    // kept: spoken together at the start of the scene
    proposal("i1", "sl1", "#s1-title", "The Domestic Cat", "glow-orange"),
    // DROPPED: this text is never spoken, so highlighting it would be arbitrary
    proposal("i2", "sl1", "#s1-sub", "Quarterly revenue by region", "highlight"),
    // kept: a full sentence, long enough for the read-along
    proposal("i3", "sl2", "#s2-item-1", "Tamed in the Near East around 7500 BCE", "highlight"),
    // kept: spoken a few seconds later; the director must not whip the camera back and forth
    proposal("i4", "sl2", "#s2-item-2", "Roughly 600 million cats live worldwide", "scale-pop"),
    // DROPPED: never spoken
    proposal("i5", "sl2", "#s2-item-3", "Average lifespan about 13 years", "highlight"),
    proposal("i7", "sl4", "#s4-item-1", "Hunt at dawn and dusk", "highlight"),
    proposal("i6", "sl3", "#s3-title", "Thanks for watching", "glow-green")
  ],
  audio: [
    { slide_id: "sl1", words: narrate("The domestic cat is a small carnivorous mammal that has lived beside people for thousands of years.") },
    {
      slide_id: "sl2",
      words: narrate("Cats were tamed in the Near East around 7500 BCE, drawn to early farms by rodents. Today roughly 600 million cats live worldwide, in homes and on streets alike.", 0.5)
    },
    {
      slide_id: "sl4",
      words: narrate("Cats see well in dim light, so they hunt at dawn and dusk, then sleep for twelve to sixteen hours a day, curled up in a warm spot.", 0.4)
    },
    // Deliberately vague narration: the right outcome here is NO art, not a random icon.
    { slide_id: "sl5", words: narrate("Many things change over time, and it is often more important than it first seems for the people involved.", 0.4) },
    { slide_id: "sl3", words: narrate("Thanks for watching, and see you next time.", 0.6) }
  ]
};
