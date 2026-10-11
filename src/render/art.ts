import type { WordTiming } from "./director";
import { normalizeToken } from "./director";

/**
 * Clip art for scenes, chosen and placed by rules instead of by guesswork.
 *
 * - The art library is bundled (Lucide icons, ISC license) and searched by tag; nothing is drawn or
 *   invented at render time.
 * - An icon is used only when a word that is actually SPOKEN in the scene matches its name or one
 *   of its tags strongly. A weak or ambiguous match gets no art at all.
 * - It is placed only in free space (or a slot the layout reserved), never over text.
 * - It arrives when its word is said, like every other block of content.
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
 * Space for a piece of art that no text occupies: a slot the layout reserved (an element whose id
 * ends in "-art"), otherwise the first free spot among the margins and sides, largest size first.
 */
export function findArtSlot(doc: Document, canvas: { width: number; height: number }, occupied: Rect[]): { rect: Rect; reserved: boolean } | null {
  const reserved = doc.querySelector<HTMLElement>("[id$='-art']");
  if (reserved) {
    const r = reserved.getBoundingClientRect();
    if (r.width > 120 && r.height > 120) {
      const size = Math.min(r.width, r.height, 420);
      return { rect: { x: r.left + (r.width - size) / 2, y: r.top + (r.height - size) / 2, w: size, h: size }, reserved: true };
    }
  }
  const { width: W, height: H } = canvas;
  const hits = (a: Rect, b: Rect, pad: number) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
  for (const size of [300, 240, 190]) {
    const m = 70;
    const slots: Rect[] = [
      { x: W - m - size, y: (H - size) / 2, w: size, h: size }, // right, middle
      { x: m, y: (H - size) / 2, w: size, h: size }, // left, middle
      { x: W - m - size, y: m, w: size, h: size }, // top right
      { x: W - m - size, y: H - m - size, w: size, h: size }, // bottom right
      { x: m, y: m, w: size, h: size }, // top left
      { x: m, y: H - m - size, w: size, h: size } // bottom left
    ];
    const free = slots.find((s) => !occupied.some((o) => hits(s, o, 36)));
    if (free) return { rect: free, reserved: false };
  }
  return null;
}

/** Boxes of everything on screen that carries text, so art never covers it. */
export function occupiedBoxes(doc: Document): Rect[] {
  const boxes: Rect[] = [];
  doc.body.querySelectorAll<HTMLElement>("*").forEach((el) => {
    if (el.id === "__fx" || el.closest("#__fx") || el.closest("[id^='__art']")) return;
    const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.nodeValue ?? "").trim());
    if (!hasOwnText) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) boxes.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  });
  return boxes;
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
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="${rect.w}" height="${rect.h}" fill="none" stroke="rgb(${ACCENT})" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="filter:url(#__wobble)">${index.catalog[pick.name].b}</svg>`;
  doc.body.appendChild(wrap);
  return wrap;
}
