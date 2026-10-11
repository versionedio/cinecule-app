import type { WordTiming } from "./director";
import { normalizeToken } from "./director";

/**
 * Clip art for PICTURE scenes. The storyboard names one icon per picture scene on purpose
 * (`data-art="dog"`); nothing is guessed from stray spoken words.
 *
 * - The art library is bundled (Lucide icons, ISC license); nothing is drawn or invented at render time.
 * - A picture scene shows that one icon, large, drawn on stroke by stroke. Words scenes show no art.
 * - A name that matches no icon is looked up through hand-picked synonyms; if that fails too, the
 *   decision is logged and the scene falls back to the strongest literal match in its narration.
 */

interface CatalogEntry { t: string[]; b: string }
export type Catalog = Record<string, CatalogEntry>;

let catalogPromise: Promise<Catalog> | null = null;
/** The icon catalog, loaded on first use as its own chunk. */
export const loadCatalog = (): Promise<Catalog> => (catalogPromise ??= import("./art-catalog.json").then((m) => m.default as unknown as Catalog));

// Singularise lightly so "cats" finds "cat" and "homes" finds "home".
const key = (word: string): string => {
  const w = normalizeToken(word);
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
};

// Words that match icons by accident ("time" -> clock for every sentence) or say nothing visual.
const GENERIC = new Set(("the a an and or of to in on at for is are was were it its with as by that this from be has have had up more most many much some also just very " +
  "around about today year time times part made make like well even still over into such only other than then when which while their there they them these those been being would could should " +
  "after before between through during each every both first last long high low small large big good new old same own way ways thing things lot lots one two three four five six seven eight nine ten " +
  "thousand million billion hundred early late often usually well able known called called well since until").split(/\s+/));

// Lucide is a UI icon set, so its tags describe interface functions ("change" -> pen, "important" ->
// exclamation mark), not subjects. They are deliberately NOT used. An icon is chosen only when a spoken
// word IS its name, or is one of these hand-picked synonyms. Anything else gets no art.
const SCORE = { NAME: 10, ALIAS: 8 };
export const MIN_SCORE = 8;

const ALIASES: Record<string, string> = {
  kitten: "cat", feline: "cat", kitty: "cat", tomcat: "cat",
  puppy: "dog", canine: "dog",
  sparrow: "bird", robin: "bird", songbird: "bird",
  tuna: "fish", salmon: "fish",
  rodent: "rat", mice: "mouse",
  night: "moon", nighttime: "moon", moonlight: "moon", lunar: "moon",
  sunshine: "sun", daylight: "sun", sunny: "sun",
  dawn: "sunrise", sunrise: "sunrise", morning: "sunrise",
  dusk: "sunset", sunset: "sunset", twilight: "sunset", evening: "sunset",
  sleep: "bed", sleeps: "bed", sleeping: "bed", slept: "bed", nap: "bed", naps: "bed",
  vision: "eye", sight: "eye", eyesight: "eye",
  hearing: "ear", hear: "ear",
  love: "heart", affection: "heart", heartbeat: "heart-pulse",
  intelligence: "brain", intelligent: "brain", smart: "brain", mind: "brain",
  world: "globe", worldwide: "globe", global: "globe", planet: "globe", earth: "globe",
  farm: "wheat", farms: "wheat", farmer: "wheat", farmers: "wheat", grain: "wheat", crop: "wheat", crops: "wheat", agriculture: "wheat",
  paw: "paw-print", paws: "paw-print", pawprint: "paw-print",
  home: "house", homes: "house", household: "house",
  village: "house", villages: "house",
  city: "building-2", cities: "building-2",
  food: "utensils", meal: "utensils", meals: "utensils", feed: "utensils",
  water: "droplet", drink: "droplet",
  tooth: "smile", teeth: "smile",
  money: "coins", coin: "coins",
  idea: "lightbulb", ideas: "lightbulb"
};

export interface ArtIndex {
  catalog: Catalog;
  byWord: Map<string, { name: string; score: number }[]>;
}

export function buildIndex(catalog: Catalog): ArtIndex {
  const byWord = new Map<string, { name: string; score: number }[]>();
  const add = (word: string, name: string, score: number) => {
    if (!word) return;
    const list = byWord.get(word) ?? [];
    list.push({ name, score });
    byWord.set(word, list);
  };
  // Single-word icon names match the spoken word itself ("cat", "fish", "moon", "house").
  for (const name of Object.keys(catalog)) {
    if (!name.includes("-")) add(key(name), name, SCORE.NAME);
  }
  for (const [word, name] of Object.entries(ALIASES)) {
    if (catalog[name]) add(key(word), name, SCORE.ALIAS);
  }
  return { catalog, byWord };
}

/** The icon a storyboard-chosen subject ("dog", "paw print", "puppy") stands for, or null. */
export function resolveSubject(index: ArtIndex, subject: string): string | null {
  const raw = subject.toLowerCase().trim().replace(/[\s_]+/g, "-");
  if (!raw) return null;
  if (index.catalog[raw]) return raw;
  const hits = index.byWord.get(key(raw.replace(/-/g, " "))) ?? index.byWord.get(key(raw));
  if (hits && hits.length) return hits.slice().sort((a, b) => b.score - a.score)[0].name;
  return ALIASES[raw] && index.catalog[ALIASES[raw]] ? ALIASES[raw] : null;
}

export interface ArtPick { name: string; word: string; start: number; score: number }

/** Best icon for each spoken word, then the strongest few, spaced apart and never repeated. */
export function pickArt(index: ArtIndex, words: WordTiming[], opts: { max?: number; minGap?: number; exclude?: Set<string> } = {}): ArtPick[] {
  const { max = 2, minGap = 2.5, exclude } = opts;
  const candidates: ArtPick[] = [];
  for (const w of words) {
    const k = key(w.w);
    if (k.length < 3 || GENERIC.has(k)) continue;
    const hits = index.byWord.get(k);
    if (!hits) continue;
    // Prefer the strongest hit; among equals the shorter, plainer name ("cat" over "cat-face").
    const best = hits.slice().sort((a, b) => b.score - a.score || a.name.length - b.name.length)[0];
    if (best.score >= MIN_SCORE && !exclude?.has(best.name)) candidates.push({ name: best.name, word: w.w, start: w.s, score: best.score });
  }
  candidates.sort((a, b) => b.score - a.score || a.start - b.start);
  const chosen: ArtPick[] = [];
  for (const c of candidates) {
    if (chosen.length >= max) break;
    if (chosen.some((p) => p.name === c.name || Math.abs(p.start - c.start) < minGap)) continue;
    chosen.push(c);
  }
  return chosen.sort((a, b) => a.start - b.start);
}

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Where a picture scene's icons go: one icon centred, or two the same size side by side with an
 * even gap, the pair centred as a whole.
 */
export function findArtSlots(doc: Document, count: number): Rect[] {
  const hero = doc.querySelector<HTMLElement>("[data-art]");
  if (!hero || count < 1) return [];
  const r = hero.getBoundingClientRect();
  if (r.width <= 120 || r.height <= 120) return [];
  const n = Math.min(2, count);
  const gap = n === 2 ? r.width * 0.06 : 0;
  const size = Math.min(r.height * (n === 1 ? 0.78 : 0.6), (r.width * 0.9 - gap * (n - 1)) / n);
  const total = size * n + gap * (n - 1);
  const y = r.top + (r.height - size) / 2;
  const x0 = r.left + (r.width - total) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * (size + gap), y, w: size, h: size }));
}

const ACCENT = "242,181,74";

/** Insert the icon, hand-drawn looking, into the slide. Returns the element so it can be revealed. */
export function insertArt(doc: Document, index: ArtIndex, pick: ArtPick, rect: Rect, n: number): HTMLElement {
  if (!doc.getElementById("__wobble-defs")) {
    const defs = doc.createElement("div");
    defs.id = "__wobble-defs";
    defs.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
    // A fixed seed keeps the wobble identical on every frame and every render.
    defs.innerHTML =
      '<svg width="0" height="0"><filter id="__wobble" x="-12%" y="-12%" width="124%" height="124%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="11" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G"/></filter></svg>';
    doc.body.appendChild(defs);
  }
  const wrap = doc.createElement("div");
  wrap.id = `__art-${n}`;
  wrap.setAttribute("style", `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;pointer-events:none;`);
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="${rect.w}" height="${rect.h}" fill="none" stroke="rgb(${ACCENT})" stroke-width="${rect.w > 400 ? 1.1 : 1.5}" stroke-linecap="round" stroke-linejoin="round" style="filter:url(#__wobble)">${index.catalog[pick.name].b}</svg>`;
  // Every stroke is normalised to length 1 so the renderer can draw it on by sliding one dash offset.
  wrap.querySelectorAll("path,line,polyline,polygon,circle,rect,ellipse").forEach((el) => el.setAttribute("pathLength", "1"));
  doc.body.appendChild(wrap);
  return wrap;
}
