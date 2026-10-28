/**
 * The slide design system. The storyboard AI does not write colours, fonts or sizes: it picks one THEME
 * for the film (from its topic and tone) and one LAYOUT per scene, and this stylesheet draws them. That
 * keeps every slide readable and consistent, and lets one film look different from the next.
 *
 * What the layouts are built on (research, not decoration):
 *  - Less on-screen text, and never a copy of the narration: Mayer's redundancy and coherence principles
 *    (large effects in the multimedia-learning literature). Cards hold short KEY PHRASES.
 *  - Cue what matters: the signaling principle (meta-analysis of 29 studies, d ~ 0.38). The accent colour
 *    is used only to mark the key words (<em>) and to point, never as ornament; a 2024 study of 78 students
 *    found colour cues help retention, while too much colour raises mental load.
 *  - Put text next to what it labels: the spatial contiguity principle.
 *  - Shorter, informal videos hold attention better (Guo, Kim and Rubin, 2014, 6.9 million sessions).
 *
 * What is NOT claimed: that a given colour or font is "most effective" for a topic. No solid evidence
 * shows that. Palettes vary by topic as a style choice; every palette is checked for readable contrast
 * (see scripts/check-themes.mjs), and one palette is used for a whole film (coherence).
 */

export interface Theme {
  name: string;
  /** What the storyboard AI is told this theme suits (a style choice, not a measured effect). */
  suits: string;
  bg: string;
  bg2: string;
  surface: string;
  fg: string;
  muted: string;
  accent: string;
  light: boolean;
  headFont: string;
  headWeight: number;
  bodyFont: string;
  /** Google Fonts family specs for this pairing. */
  fonts: string[];
  radius: number;
}

export const THEMES: Theme[] = [
  { name: "midnight", suits: "technology, AI, software, general explainers (the default)", bg: "#0b0e14", bg2: "#16203a", surface: "#161b27", fg: "#f2f4f8", muted: "#a9b3c4", accent: "#f2b54a", light: false, headFont: "Inter", headWeight: 800, bodyFont: "Inter", fonts: ["Inter:wght@400;600;800"], radius: 14 },
  { name: "ember", suits: "stories, culture, food, energy, entertainment", bg: "#15100e", bg2: "#2b1710", surface: "#211915", fg: "#f7efe9", muted: "#c2b0a4", accent: "#ff7a4d", light: false, headFont: "Poppins", headWeight: 700, bodyFont: "Inter", fonts: ["Poppins:wght@600;700", "Inter:wght@400;600"], radius: 22 },
  { name: "forest", suits: "nature, health, sustainability, outdoors, animals", bg: "#0c1511", bg2: "#13301f", surface: "#15241b", fg: "#eef6f0", muted: "#a8c0b0", accent: "#7fd18b", light: false, headFont: "Merriweather", headWeight: 900, bodyFont: "Source Sans 3", fonts: ["Merriweather:wght@700;900", "Source+Sans+3:wght@400;600"], radius: 10 },
  { name: "ocean", suits: "science, travel, water, finance, anything that should feel calm and trustworthy", bg: "#08131c", bg2: "#0d2f42", surface: "#102230", fg: "#eaf6fb", muted: "#9fbac8", accent: "#4fd1d9", light: false, headFont: "Montserrat", headWeight: 800, bodyFont: "Inter", fonts: ["Montserrat:wght@700;800", "Inter:wght@400;600"], radius: 16 },
  { name: "paper", suits: "history, education, literature, editorial or reflective topics (a light theme)", bg: "#f7f1e6", bg2: "#ece0c8", surface: "#ffffff", fg: "#1d1a16", muted: "#5a5348", accent: "#b3261e", light: true, headFont: "Playfair Display", headWeight: 800, bodyFont: "Source Sans 3", fonts: ["Playfair+Display:wght@700;800", "Source+Sans+3:wght@400;600"], radius: 6 },
  { name: "slate", suits: "business, policy, reports, professional or corporate topics (a light theme)", bg: "#f3f5f9", bg2: "#dfe6f2", surface: "#ffffff", fg: "#141a2a", muted: "#4f5d78", accent: "#3b4cca", light: true, headFont: "Manrope", headWeight: 800, bodyFont: "Inter", fonts: ["Manrope:wght@700;800", "Inter:wght@400;600"], radius: 12 },
  { name: "plum", suits: "art, design, fashion, creativity, lifestyle", bg: "#160d1b", bg2: "#2a1436", surface: "#211429", fg: "#f8eefb", muted: "#bfa9c8", accent: "#ff8fc2", light: false, headFont: "DM Serif Display", headWeight: 400, bodyFont: "DM Sans", fonts: ["DM+Serif+Display", "DM+Sans:wght@400;600"], radius: 18 }
];

export const DEFAULT_THEME = "midnight";
export const LAYOUTS = ["cc-title", "cc-points", "cc-stat", "cc-split", "cc-quote", "cc-closing", "cc-picture", "cc-photo"] as const;

/** Font pairings a user can pick instead of the theme's own (data-font on the slide). */
export interface FontStyle {
  id: string;
  label: string;
  description: string;
  head?: string;
  headWeight?: number;
  body?: string;
  fonts?: string[];
}
export const FONT_STYLES: FontStyle[] = [
  { id: "theme", label: "Match the theme", description: "Each theme's own font pairing" },
  { id: "editorial", label: "Editorial serif", description: "Serif headlines, calm and literary", head: "Playfair Display", headWeight: 800, body: "Source Sans 3", fonts: ["Playfair+Display:wght@700;800", "Source+Sans+3:wght@400;600"] },
  { id: "clean", label: "Clean sans", description: "Neutral and modern", head: "Inter", headWeight: 800, body: "Inter", fonts: ["Inter:wght@400;600;800"] },
  { id: "bold", label: "Bold display", description: "Heavy, friendly headlines", head: "Poppins", headWeight: 700, body: "Inter", fonts: ["Poppins:wght@600;700", "Inter:wght@400;600"] }
];

export interface Choice {
  id: string;
  label: string;
  description: string;
}
export const BACKGROUNDS: Choice[] = [
  { id: "plain", label: "Plain", description: "One flat color, the calmest" },
  { id: "gradient", label: "Gradient", description: "A soft blend of two shades" },
  { id: "glow", label: "Glow", description: "A subtle light behind the text" }
];
export const LAYOUT_MIXES: Choice[] = [
  { id: "balanced", label: "Balanced", description: "A mix of cards, numbers, comparisons and quotes" },
  { id: "text", label: "Text-led", description: "Mostly title-and-cards slides" },
  { id: "visual", label: "Visual-led", description: "More big numbers, quotes and pictures" },
  { id: "minimal", label: "Minimal", description: "One short phrase per slide" }
];
export const PICTURE_AMOUNTS: Choice[] = [
  { id: "none", label: "None", description: "Words only" },
  { id: "few", label: "A few", description: "About one scene in five" },
  { id: "many", label: "Plenty", description: "About one scene in three" }
];

/**
 * How long the film runs. A film's length is the sum of its scenes' durations, and the narrator has to finish inside
 * each scene, so a target length is really three numbers: how many scenes, how long each lasts, and how many words the
 * narration of each may have. They are fixed here so the AI is told exact figures instead of a vague "about 30 seconds".
 */
export interface LengthChoice extends Choice {
  seconds: number;
  scenes: number;
  /** Seconds per scene; scenes * each === seconds. */
  each: number;
}
// Spoken narration runs at roughly 2.5 words a second; 2.2 leaves a little room so a line never spills into the next scene.
export const WORDS_PER_SECOND = 2.2;
export const LENGTHS: LengthChoice[] = [
  { id: "30", label: "30 seconds", description: "Short and punchy: 6 scenes of 5 seconds. The length of a TikTok or Reels ad", seconds: 30, scenes: 6, each: 5 },
  { id: "45", label: "45 seconds", description: "9 scenes of 5 seconds", seconds: 45, scenes: 9, each: 5 },
  { id: "60", label: "1 minute", description: "10 scenes of 6 seconds", seconds: 60, scenes: 10, each: 6 },
  { id: "90", label: "90 seconds", description: "10 scenes of 9 seconds", seconds: 90, scenes: 10, each: 9 }
];

/** The shape of the picture. Vertical is for TikTok, Reels and Shorts. */
export interface FormatChoice extends Choice {
  /** The project's canvas_aspect_ratio. */
  ratio: "16:9" | "9:16" | "1:1";
  width: number;
  height: number;
}
export const FORMATS: FormatChoice[] = [
  { id: "wide", label: "Wide 16:9", description: "Landscape, for YouTube, websites and presentations", ratio: "16:9", width: 1920, height: 1080 },
  { id: "vertical", label: "Vertical 9:16", description: "Portrait, for TikTok, Reels and Shorts", ratio: "9:16", width: 1080, height: 1920 },
  { id: "square", label: "Square 1:1", description: "Square, for feeds", ratio: "1:1", width: 1080, height: 1080 }
];

/** What the viewer chose before the film was made; every field may be "decide" (left to the AI). */
export interface DesignChoices {
  theme: string;
  background: string;
  font: string;
  layout: string;
  pictures: string;
  /** "decide" or one of LENGTHS. */
  length: string;
  /** The first shape chosen: one of FORMATS ("wide" unless chosen). It sets the film's own shape and the example shown. */
  format: string;
  /** Every shape to render, in the order chosen (always at least `format`). More than one makes one video per shape. */
  formats: string[];
  /** "decide" (the standard voice) or an ElevenLabs voice id from src/config/voices.ts. */
  voice: string;
}
export const NO_CHOICES: DesignChoices = { theme: "decide", background: "decide", font: "theme", layout: "balanced", pictures: "decide", length: "decide", format: "wide", formats: ["wide"], voice: "decide" };

/** The canvas the chosen format asks for. */
export const formatOf = (id: string): FormatChoice => FORMATS.find((f) => f.id === id) ?? FORMATS[0];

/** Every shape chosen, once each and in the order chosen; "wide" when none is. */
export function chosenFormats(c: Pick<DesignChoices, "format" | "formats">): FormatChoice[] {
  const ids = (c.formats?.length ? c.formats : [c.format]).filter((id, i, all) => FORMATS.some((f) => f.id === id) && all.indexOf(id) === i);
  return (ids.length ? ids : ["wide"]).map(formatOf);
}

/** The shapes to render, as the project's render_aspect_ratios text ("16:9,9:16"); "" for a single shape, which needs no list. */
export function renderRatiosText(c: Pick<DesignChoices, "format" | "formats">): string {
  const shapes = chosenFormats(c);
  return shapes.length > 1 ? shapes.map((f) => f.ratio).join(",") : "";
}

/**
 * The choices as plain text for the storyboard step (saved on the project). The storyboard prompt tells the
 * AI to follow these exactly. Returns "" when nothing was chosen, so the film is styled automatically.
 */
export function designChoicesText(c: DesignChoices): string {
  const lines: string[] = [];
  if (c.theme !== "decide") lines.push(`- Theme: ${c.theme} (use data-theme="${c.theme}" on every scene)`);
  if (c.background !== "decide") lines.push(`- Background: ${c.background} (use data-bg="${c.background}" on every scene)`);
  if (c.font !== "theme") lines.push(`- Font style: ${c.font} (use data-font="${c.font}" on every scene)`);
  if (c.layout !== "balanced") lines.push(`- Layout mix: ${c.layout} (${LAYOUT_MIXES.find((m) => m.id === c.layout)?.description ?? ""})`);
  if (c.pictures !== "decide") lines.push(`- Picture scenes: ${c.pictures} (${PICTURE_AMOUNTS.find((m) => m.id === c.pictures)?.description ?? ""})`);
  const len = LENGTHS.find((l) => l.id === c.length);
  if (len) {
    const words = Math.floor(len.each * WORDS_PER_SECOND);
    lines.push(
      `- Length: the finished film runs exactly ${len.seconds} seconds. Write exactly ${len.scenes} scenes (scene 1 is the title, the last scene is the closing), ` +
        `each with "duration": ${len.each}, so the durations add up to ${len.seconds}. Each scene's narration_text is AT MOST ${words} words ` +
        `(about ${WORDS_PER_SECOND} spoken words a second), so the narrator finishes inside the scene instead of running into the next. ` +
        `Count the words of every narration_text before you answer and shorten any that is over. Keep the story whole: a hook, one idea per scene, a close.`
    );
  }
  // One storyboard serves every chosen shape, so its text is written to fit the narrowest one.
  const shapes = chosenFormats(c);
  const fmt = shapes.find((f) => f.id === "vertical") ?? shapes.find((f) => f.id === "square") ?? shapes[0];
  if (shapes.length > 1) {
    lines.push(`- Formats: the same film is rendered in ${shapes.map((f) => f.label).join(" and ")}, so write it once for all of them.`);
  }
  if (fmt.id === "vertical") {
    lines.push(`- Format: vertical 9:16 for TikTok, Reels and Shorts. The screen is narrow, so headings are at most 5 words and each card or column at most 6 words.`);
  } else if (fmt.id === "square") {
    lines.push(`- Format: square 1:1. Keep headings at most 6 words and each card or column at most 7 words.`);
  }
  return lines.length ? `DESIGN CHOICES FROM THE USER (follow exactly; anything not listed is yours to decide):\n${lines.join("\n")}` : "";
}

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};

const themeVars = (t: Theme) =>
  `.cc[data-theme="${t.name}"]{--bg:${t.bg};--bg2:${t.bg2};--surface:${t.surface};--fg:${t.fg};--muted:${t.muted};--accent:${t.accent};--accent-rgb:${rgb(t.accent)};--accent-ink:${t.light ? "#ffffff" : "#10131a"};` +
  `--head:'${t.headFont}',${t.light ? "Georgia,serif" : "system-ui,sans-serif"};--head-w:${t.headWeight};--body:'${t.bodyFont}',system-ui,-apple-system,'Segoe UI',Arial,sans-serif;--radius:${t.radius}px}`;

/** Layout rules shared by every theme. Sizes are for the 1920x1080 canvas. */
const BASE_CSS = `
.cc{position:absolute;inset:0;box-sizing:border-box;padding:110px 150px;display:flex;flex-direction:column;justify-content:center;gap:44px;overflow:hidden;background:var(--bg);color:var(--fg);font-family:var(--body);font-size:54px;line-height:1.25;font-variant-numeric:lining-nums;font-feature-settings:"lnum" 1}
.cc[data-bg="gradient"]{background:linear-gradient(135deg,var(--bg) 0%,var(--bg2) 100%)}
.cc[data-bg="glow"]{background:radial-gradient(ellipse 70% 60% at 85% 8%,rgba(var(--accent-rgb),.20),transparent 60%),radial-gradient(ellipse 60% 50% at 5% 100%,var(--bg2),transparent 70%),var(--bg)}
.cc *{box-sizing:border-box;margin:0}
.cc-h{font-family:var(--head);font-weight:var(--head-w);font-size:92px;line-height:1.06;letter-spacing:-.01em;max-width:1500px;text-wrap:balance}
.cc-sub{font-size:50px;color:var(--muted);max-width:1400px}
.cc em,.cc b,.cc strong{font-style:normal;font-weight:inherit;color:var(--accent)}
.cc-card{background:var(--surface);border-left:10px solid var(--accent);border-radius:var(--radius);padding:30px 44px;font-size:56px;line-height:1.2;max-width:1500px;overflow-wrap:anywhere}
.cc-label{font-size:38px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.cc-title{gap:36px}
.cc-title .cc-h{font-size:132px}
.cc-title::before{content:"";width:150px;height:12px;border-radius:6px;background:var(--accent);margin-bottom:8px}
.cc-points{gap:34px}
.cc-points .cc-h{font-size:88px;margin-bottom:10px}
.cc-stat{align-items:flex-start;gap:20px}
.cc-num{font-family:var(--head);font-weight:var(--head-w);font-size:330px;line-height:.95;color:var(--accent);letter-spacing:-.02em}
.cc-cap{font-size:62px;max-width:1400px}
.cc-split{gap:48px}
.cc-split .cc-h{font-size:82px}
.cc-cols{display:grid;grid-template-columns:1fr 1fr;gap:56px}
.cc-col{background:var(--surface);border-top:10px solid var(--accent);border-radius:var(--radius);padding:38px 44px;display:flex;flex-direction:column;gap:18px;font-size:56px;overflow-wrap:anywhere}
.cc-quote{gap:36px}
.cc-quote::before{content:"\\201C";font-family:var(--head);font-size:300px;line-height:.5;height:130px;color:var(--accent);opacity:.9}
.cc-q{font-family:var(--head);font-weight:var(--head-w);font-size:84px;line-height:1.14;max-width:1550px;text-wrap:balance}
.cc-by{font-size:46px;color:var(--muted)}
.cc-closing{align-items:flex-start}
.cc-closing .cc-h{font-size:118px}
.cc-closing::after{content:"";width:220px;height:12px;border-radius:6px;background:var(--accent)}
.cc-picture,.cc-photo{padding:0}
/* Square and vertical canvases (1080 wide): tighter padding, smaller type, columns stacked. */
@media (max-aspect-ratio:1/1){
.cc{padding:110px 80px;gap:36px;font-size:54px}
.cc-h{font-size:96px;max-width:none}
.cc-sub{font-size:52px;max-width:none}
.cc-card{font-size:58px;max-width:none;padding:28px 38px}
.cc-label{font-size:36px}
.cc-title .cc-h{font-size:124px}
.cc-points .cc-h{font-size:92px}
.cc-num{font-size:290px}
.cc-cap{font-size:62px;max-width:none}
.cc-split .cc-h{font-size:86px}
.cc-cols{grid-template-columns:1fr;gap:30px}
.cc-col{font-size:56px;padding:32px 38px}
.cc-quote::before{font-size:260px;height:110px}
.cc-q{font-size:78px;max-width:none}
.cc-by{font-size:46px}
.cc-closing .cc-h{font-size:112px}
.cc-picture,.cc-photo{padding:0}
}
/* Vertical only: keep words clear of the caption and buttons TikTok, Reels and Shorts draw over the bottom and right. */
@media (max-aspect-ratio:3/4){
.cc{padding:220px 150px 400px 80px}
.cc-picture,.cc-photo{padding:0}
}
`;

const fontOverrideCss = FONT_STYLES.filter((f) => f.head)
  .map((f) => `.cc[data-font="${f.id}"]{--head:'${f.head}',${f.id === "editorial" ? "Georgia,serif" : "system-ui,sans-serif"};--head-w:${f.headWeight};--body:'${f.body}',system-ui,-apple-system,'Segoe UI',Arial,sans-serif}`)
  .join("");

const fontHref = (families: string[]) => `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join("&")}&display=block`;

/** The font style a slide asks for (data-font), if it is one of the overrides. */
export function fontStyleOf(html: string): FontStyle | null {
  const id = html.match(/data-font\s*=\s*(?:"([^"]*)"|'([^']*)')/)?.slice(1, 3).find(Boolean)?.trim().toLowerCase();
  return FONT_STYLES.find((f) => f.id === id && f.head) ?? null;
}

/** The theme a slide asks for (its data-theme attribute, either quote style), or null for an older, self-styled slide. */
export function themeOf(html: string): Theme | null {
  const name = html.match(/data-theme\s*=\s*(?:"([^"]*)"|'([^']*)')/)?.slice(1, 3).find(Boolean)?.trim().toLowerCase();
  if (!name) return null;
  return THEMES.find((t) => t.name === name) ?? THEMES.find((t) => t.name === DEFAULT_THEME) ?? null;
}

/**
 * Markup for the <head> of a slide's iframe: the theme's fonts and the layout stylesheet. Empty for
 * older slides that style themselves, so they look exactly as before.
 */
export function themeHead(html: string): string {
  const t = themeOf(html);
  if (!t) return "";
  const override = fontStyleOf(html);
  const families = override?.fonts ?? t.fonts;
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${fontHref(families)}"><style>${themeVars(t)}${fontOverrideCss}${BASE_CSS}</style>`;
}

/** What the storyboard prompt should say about the themes, so the prompt and the stylesheet never drift apart. */
export function themeGuide(): string {
  return THEMES.map((t) => `${t.name} (${t.suits})`).join("; ");
}

/**
 * What someone picked, in plain words, for showing back to them in the chat. Unlike designChoicesText (instructions for
 * the AI), this is written for the person. `voiceName` is looked up by the caller, since voices live in their own config.
 */
export function designChoicesSummary(c: DesignChoices, voiceName?: string): string {
  const label = (list: { id: string; label: string }[], id: string) => list.find((x) => x.id === id)?.label ?? id;
  const lines = [
    `Theme: ${c.theme === "decide" ? "you decide" : c.theme[0].toUpperCase() + c.theme.slice(1)}`,
    `Background: ${c.background === "decide" ? "you decide" : label(BACKGROUNDS, c.background)}`,
    `Fonts: ${label(FONT_STYLES, c.font)}`,
    `Layout mix: ${label(LAYOUT_MIXES, c.layout)}`,
    `Pictures: ${c.pictures === "decide" ? "you decide" : label(PICTURE_AMOUNTS, c.pictures)}`,
    `Length: ${c.length === "decide" ? "you decide" : label(LENGTHS, c.length)}`,
    `Format: ${chosenFormats(c).map((f) => f.label).join(" + ")}`,
    `Narrator: ${voiceName ?? "standard voice"}`
  ];
  return lines.join("\n");
}
