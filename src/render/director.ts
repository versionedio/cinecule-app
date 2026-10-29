import type { EffectType, InteractionAction, ShotEasing } from "@/config/entities";
import { ActiveEffect, clamp, easeOut } from "./timeline";

/**
 * Deterministic "director": decides what the camera and the emphasis effects actually do.
 *
 * Plan -> validate -> execute. The storyboard AI only PROPOSES what is worth emphasising (an element
 * and the words it relates to). This module is the validator/compiler: it checks every proposal against
 * what is really spoken (word timings) and what is really on screen (measured elements), enforces hard
 * rules, and drops whatever fails. Nothing is placed "somewhere plausible": a proposal either matches
 * the narration or it is rejected. Every decision is returned with a reason so a render is auditable.
 *
 * Pure functions of their input, so the same project always produces the same video.
 */

export interface WordTiming { w: string; s: number; e: number }
export type Intensity = "subtle" | "medium" | "dramatic";

export interface Box { x: number; y: number; w: number; h: number }
export interface Measured {
  box: Box;
  /** Visible text of the element, in reading order, one entry per word. */
  tokens: string[];
  /** Box of each word in `tokens` (same order), so an emphasis can hug just the words that are spoken. */
  wordBoxes?: Box[];
}
export interface Proposal {
  id: string;
  selector: string;
  /** The words the storyboard says this relates to (used when the element itself has no text). */
  text: string;
  action: InteractionAction | string;
}

export interface DirectorInput {
  duration: number;
  canvas: { width: number; height: number };
  words: WordTiming[];
  proposals: Proposal[];
  measure: (selector: string) => Measured | null;
  intensity: Intensity;
  /** Things that must stay on screen while the camera moves (clip art in the margins). */
  keepVisible?: Box[];
}

export interface PlannedShot {
  start_time: number;
  transition_duration: number;
  x_percent: number;
  y_percent: number;
  zoom: number;
  easing: ShotEasing;
}

export interface FollowToken { index: number; s: number; e: number }

export interface PlannedEffect {
  key: string;
  kind: "highlight" | "follow";
  effect: EffectType;
  selector: string;
  start: number;
  end: number;
  /** Per on-screen word timing, only for "follow". */
  follow?: FollowToken[];
  /** One box per line of the spoken words: the emphasis is drawn on these, never on the whole element. */
  lines?: Box[];
}

export interface Decision {
  id: string;
  selector: string;
  status: "kept" | "dropped";
  reason: string;
}

export interface ScenePlan {
  shots: PlannedShot[];
  effects: PlannedEffect[];
  decisions: Decision[];
}

// ---- Rules. Each number is a guardrail, not a style choice. ----
export const RULES = {
  SETTLE: 0.6, // no camera moves while a scene is still arriving
  END_REST: 0.7, // the camera is back at rest this long before the scene ends (transition clears)
  MIN_ZOOM_GAP: 2.2, // cool-down between the end of one zoom and the start of the next
  MIN_FX_GAP: 0.4, // calm between two highlights: one thing moves at a time
  MAX_ZOOMS: 4, // camera focus moves per scene
  MAX_FX: 5, // emphasised things per scene
  MAX_FOLLOW: 1, // read-along is a feature moment, not the default look
  MIN_ZOOM: 1.12, // below this a zoom is invisible, so skip it
  ZOOM_CAP: { subtle: 1.18, medium: 1.35, dramatic: 1.55 } as Record<Intensity, number>,
  MAX_ZOOM_AREA: 0.4, // never zoom into something already filling >40% of the frame
  FIT_MARGIN: 1.35, // the zoomed view shows the whole target with some context around it
  LEAD: 0.15, // an emphasis starts just before its word
  HOLD_AFTER: 0.45, // and lingers just after it
  MATCH_MIN: 0.5, // share of a target's content words that must be spoken together
  MAX_SPAN: 6.0, // a spoken phrase longer than this is not one "moment"
  FOLLOW_MIN_TOKENS: 5 // read-along only for text of at least this many matched words
};

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "is", "are", "was", "were", "it", "its", "with", "as", "by", "that", "this", "from", "be", "has", "have", "had", "up"]);

export const normalizeToken = (word: string) => word.toLowerCase().replace(/[^a-z0-9]+/g, "");
// Cheap stemming so "cats"/"cat" and "hunting"/"hunt" count as the same spoken word.
const stem = (t: string) => (t.length > 4 ? t.replace(/(ing|ed|es|s)$/, "") : t);
export const keyOf = (word: string) => stem(normalizeToken(word));

// Dark full-screen overlays (spotlight, dim, blur) pull focus away from the content, so the director only uses calm effects.
const CALM_EFFECT: Record<string, EffectType> = {
  highlight: "wipe-reveal",
  "glow-green": "glow",
  "glow-orange": "glow",
  spotlight: "glow",
  "scale-pop": "scale-pop",
  "draw-outline": "circle",
  "sweep-highlight": "underline",
  "dim-rest": "underline"
};

interface Match { score: number; first: number; last: number; matched: number[] }

/** Best place in the narration where `target` (content words) is spoken. */
function findSpoken(target: string[], words: WordTiming[]): Match | null {
  const keys = words.map((w) => keyOf(w.w));
  const wanted = Array.from(new Set(target));
  if (wanted.length === 0) return null;
  const span = Math.min(keys.length, wanted.length * 2 + 4);
  let best: Match | null = null;
  for (let i = 0; i + 1 <= keys.length; i++) {
    const matched: number[] = [];
    const used = new Set<string>();
    for (let j = i; j < Math.min(keys.length, i + span); j++) {
      if (wanted.includes(keys[j]) && !used.has(keys[j])) {
        used.add(keys[j]);
        matched.push(j);
      }
    }
    if (matched.length === 0) continue;
    const score = matched.length / wanted.length;
    if (!best || score > best.score + 1e-9) best = { score, first: matched[0], last: matched[matched.length - 1], matched };
  }
  return best;
}

function contentKeys(tokens: string[]): string[] {
  const keys = tokens.map(keyOf).filter(Boolean);
  const content = keys.filter((k) => !STOP.has(k));
  return content.length > 0 ? content : keys;
}

/** Map every on-screen word to the moment it is spoken, in order; unspoken words are interpolated. */
function buildFollow(tokens: string[], words: WordTiming[], from: number, to: number): FollowToken[] | null {
  const times: ({ s: number; e: number } | null)[] = tokens.map(() => null);
  let cursor = from;
  tokens.forEach((token, i) => {
    const key = keyOf(token);
    if (!key) return;
    for (let j = cursor; j <= Math.min(to, cursor + 4); j++) {
      if (keyOf(words[j].w) === key) {
        times[i] = { s: words[j].s, e: words[j].e };
        cursor = j + 1;
        return;
      }
    }
  });
  const known = times.filter(Boolean).length;
  if (known < RULES.FOLLOW_MIN_TOKENS) return null;
  // Interpolate runs of words that were not matched, spreading them evenly between their spoken
  // neighbours, so the read-along never jumps ahead or stalls.
  let i = 0;
  while (i < times.length) {
    if (times[i]) { i++; continue; }
    let j = i;
    while (j < times.length && !times[j]) j++;
    const runLen = j - i;
    const prev = i > 0 ? times[i - 1] : null;
    const next = j < times.length ? times[j] : null;
    const left = prev ? prev.e : next ? next.s - 0.3 * runLen : 0;
    const right = next ? next.s : left + 0.3 * runLen;
    const slot = Math.max(0.05, (right - left) / runLen);
    for (let k = 0; k < runLen; k++) times[i + k] = { s: left + slot * k, e: left + slot * (k + 1) };
    i = j;
  }
  return times.map((t, index) => ({ index, s: t!.s, e: Math.max(t!.e, t!.s + 0.05) }));
}

/** A smooth 0..1 fade in and out around [start, end]. */
const FADE_IN = 0.25;
const FADE_OUT = 0.3;
export function planEffectsAt(effects: PlannedEffect[], t: number): ActiveEffect[] {
  return effects
    .filter((fx) => t >= fx.start && t <= fx.end)
    .map((fx) => {
      const elapsed = t - fx.start;
      const duration = fx.end - fx.start;
      const envelope = easeOut(clamp(Math.min(elapsed / FADE_IN, (duration - elapsed) / FADE_OUT), 0, 1));
      return { key: fx.key, effect: fx.effect, selector: fx.selector, progress: elapsed / duration, envelope, elapsed, lines: fx.lines };
    });
}

export interface RevealBlock { selector: string; tokens: string[] }
export interface PlannedReveal { selector: string; start: number; duration: number; synced: boolean }

export const REVEAL = {
  DURATION: 0.55, // how long a block takes to settle into place
  LEAD: 0.35, // it starts arriving just before the narrator reaches it
  EARLIEST: 0.15,
  GAP: 0.12, // the least time between one block arriving and the next
  AFTER_PREVIOUS: 0.45, // a block the narration never mentions arrives this long after the one before it
  MATCH_MIN: 0.34 // a looser bar than emphasis: a slightly early or late entrance is harmless
};

/**
 * When each block of content should arrive. A block appears just before the narrator says it;
 * a block the narration never mentions arrives with the scene instead of staying hidden, so
 * nothing important is ever missing and nothing is ever left static.
 */
export function planReveals(blocks: RevealBlock[], words: WordTiming[], duration: number): PlannedReveal[] {
  const latest = Math.max(1, duration - 1.2);
  const plans: PlannedReveal[] = [];
  let prevStart = -REVEAL.AFTER_PREVIOUS + REVEAL.EARLIEST;
  for (const b of blocks) {
    const wanted = contentKeys(b.tokens);
    const match = words.length > 0 && wanted.length > 0 ? findSpoken(wanted, words) : null;
    let start: number;
    let synced = false;
    if (match && match.score >= REVEAL.MATCH_MIN) {
      start = clamp(words[match.first].s - REVEAL.LEAD, REVEAL.EARLIEST, latest);
      synced = true;
    } else {
      // Never mentioned: arrive in reading order, right after the block before it, never ahead of it.
      start = Math.min(latest, Math.max(REVEAL.EARLIEST, prevStart + REVEAL.AFTER_PREVIOUS));
    }
    plans.push({ selector: b.selector, start, duration: REVEAL.DURATION, synced });
    prevStart = start;
  }
  // Blocks arrive in reading order. If the narrator reaches a lower block before the one above it, the one above
  // comes in earlier (a little ahead of its words) rather than the lower one appearing first.
  for (let i = plans.length - 2; i >= 0; i--) {
    plans[i].start = clamp(Math.min(plans[i].start, plans[i + 1].start - REVEAL.GAP), REVEAL.EARLIEST, latest);
  }
  for (let i = 1; i < plans.length; i++) {
    plans[i].start = Math.min(latest, Math.max(plans[i].start, plans[i - 1].start + REVEAL.GAP));
  }
  return plans;
}

/** 0 -> 1 progress of a reveal at local time `t`, eased. */
export function revealProgress(r: PlannedReveal, t: number): number {
  return easeOut(clamp((t - r.start) / r.duration, 0, 1));
}

const ROTATION: EffectType[] = ["underline", "wipe-reveal", "circle", "glow", "scale-pop"];
// What the storyboard asked for is respected only when it names a specific look; the generic
// "highlight" it writes almost every time would otherwise make every scene the same.
const SPECIFIC = new Set(["glow-green", "glow-orange", "scale-pop", "draw-outline"]);

/** Boxes of the on-screen words that are actually spoken, merged into one box per line. */
function spokenLines(m: Measured, words: WordTiming[], match: Match): Box[] {
  if (!m.wordBoxes || m.wordBoxes.length !== m.tokens.length) return [];
  const spoken = new Set(match.matched.map((j) => keyOf(words[j].w)));
  const idx = m.tokens.map((t, i) => (spoken.has(keyOf(t)) ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return [];
  const boxes = m.wordBoxes.slice(idx[0], idx[idx.length - 1] + 1);
  const lines: Box[] = [];
  for (const b of boxes) {
    const line = lines.find((l) => Math.abs(l.y + l.h / 2 - (b.y + b.h / 2)) < Math.min(l.h, b.h) * 0.5);
    if (!line) { lines.push({ ...b }); continue; }
    const x2 = Math.max(line.x + line.w, b.x + b.w);
    const y2 = Math.max(line.y + line.h, b.y + b.h);
    line.x = Math.min(line.x, b.x);
    line.y = Math.min(line.y, b.y);
    line.w = x2 - line.x;
    line.h = y2 - line.y;
  }
  return lines;
}

const unionBox = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
};

export function planScene(input: DirectorInput): ScenePlan {
  const { duration, canvas, words, proposals, measure, intensity, keepVisible = [] } = input;
  const decisions: Decision[] = [];
  const drop = (p: Proposal, reason: string) => decisions.push({ id: p.id, selector: p.selector, status: "dropped", reason });
  const restEnd = Math.max(RULES.SETTLE + 1, duration - RULES.END_REST);

  if (words.length === 0) {
    proposals.forEach((p) => drop(p, "no word timings for this scene"));
    return { shots: [], effects: [], decisions };
  }

  // 1. VALIDATE: the target must exist, and what it shows must actually be said.
  interface Candidate { p: Proposal; m: Measured; match: Match; start: number; end: number; area: number; score: number; lines: Box[]; focus: Box }
  const candidates: Candidate[] = [];
  for (const p of proposals) {
    const m = p.selector ? measure(p.selector) : null;
    if (!m) { drop(p, "target element not found in the scene"); continue; }
    const wanted = contentKeys(m.tokens.length > 0 ? m.tokens : p.text.split(/\s+/));
    const match = findSpoken(wanted, words);
    if (!match) { drop(p, "its words are never spoken"); continue; }
    if (match.score < RULES.MATCH_MIN) { drop(p, `only ${Math.round(match.score * 100)}% of its words are spoken together`); continue; }
    const first = words[match.first];
    const last = words[match.last];
    const start = first.s;
    const end = Math.min(last.e, start + RULES.MAX_SPAN);
    const lines = spokenLines(m, words, match);
    const focus = lines.length > 0 ? unionBox(lines) : m.box;
    candidates.push({ p, m, match, start, end, area: (focus.w * focus.h) / (canvas.width * canvas.height), score: match.score, lines, focus });
  }
  candidates.sort((a, b) => a.start - b.start);

  // 2. SEQUENCE: one thing at a time, in the order it is spoken, with calm between.
  const kept: (Candidate & { fxStart: number; fxEnd: number })[] = [];
  // The storyboard's own proposals get first pick of the timeline; auto-picked blocks fill what is left.
  const byPriority = candidates.slice().sort((x, y) => Number(y.p.action !== "auto") - Number(x.p.action !== "auto") || x.start - y.start);
  for (const c of byPriority) {
    if (kept.length >= RULES.MAX_FX) { drop(c.p, `more than ${RULES.MAX_FX} emphasised things in one scene`); continue; }
    const fxStart = Math.max(0.4, c.start - RULES.LEAD);
    const fxEnd = Math.min(restEnd, Math.max(c.end + RULES.HOLD_AFTER, fxStart + 1.2));
    if (fxEnd - fxStart < 0.8) { drop(c.p, "no room before the scene ends"); continue; }
    if (kept.some((k) => fxStart < k.fxEnd + RULES.MIN_FX_GAP && k.fxStart < fxEnd + RULES.MIN_FX_GAP)) { drop(c.p, "too close to another emphasis"); continue; }
    kept.push({ ...c, fxStart, fxEnd });
  }
  kept.sort((x, y) => x.start - y.start);

  // 3. CAMERA: calm, slow, tied to speech, with a cool-down so it never pumps in and out.
  const spanSec = Math.max(1, words[words.length - 1].e - words[0].s);
  const wps = clamp(words.length / spanSec, 1.6, 4); // words per second
  const zoomIn = clamp(2.2 / wps, 0.7, 1.4); // slower speech, slower zoom
  const zoomOut = Math.round(zoomIn * 0.65 * 100) / 100; // exits faster than entrances
  const cap = RULES.ZOOM_CAP[intensity] ?? RULES.ZOOM_CAP.medium;
  const shots: PlannedShot[] = [];
  const effects: PlannedEffect[] = [];
  let zooms = 0;
  let zoomRestAt = -Infinity; // when the previous zoom finished returning to wide
  let holdEnd = -Infinity; // when the current focus is released
  let focusOpen = false;
  let followLeft: number = RULES.MAX_FOLLOW;
  let rotation = 0;
  let lastLook: EffectType | null = null;
  const longest = kept.slice().sort((a, b) => b.m.tokens.length - a.m.tokens.length)[0];

  kept.forEach((c, i) => {
    const text = c.m.tokens.length;
    // Read-along only once per scene, for the longest sentence; everything else gets a distinct, short emphasis.
    const wantsFollow = followLeft > 0 && c === longest && text >= RULES.FOLLOW_MIN_TOKENS && c.match.matched.length >= RULES.FOLLOW_MIN_TOKENS;
    const follow = wantsFollow ? buildFollow(c.m.tokens, words, c.match.first, Math.min(words.length - 1, c.match.last + 2)) : null;
    if (follow) followLeft--;
    let look: EffectType = CALM_EFFECT[c.p.action] ?? "glow";
    if (!SPECIFIC.has(String(c.p.action))) {
      const spokenText = c.lines.length > 0 ? c.m.tokens.join(" ") : c.p.text;
      look = /\d/.test(spokenText) && c.focus.w < canvas.width * 0.5 ? "circle" : ROTATION[rotation++ % ROTATION.length];
      if (look === lastLook) look = ROTATION[rotation++ % ROTATION.length];
    }
    // A circle around text that wraps onto several lines draws overlapping pills; underline it instead.
    if (look === "circle" && c.lines.length > 1) look = "underline";
    lastLook = look;
    const effect: PlannedEffect = follow
      ? { key: c.p.id, kind: "follow", effect: "none", selector: c.p.selector, start: Math.max(0.4, follow[0].s - RULES.LEAD), end: Math.min(restEnd, follow[follow.length - 1].e + 0.7), follow }
      : { key: c.p.id, kind: "highlight", effect: look, selector: c.p.selector, start: c.fxStart, end: c.fxEnd, lines: c.lines };
    effects.push(effect);

    // Zoom only when it helps: a small enough target, a visible zoom, room to arrive and leave.
    // The camera frames the target together with anything that must stay visible (clip art),
    // and never zooms further than that framing allows.
    const boxes = [c.focus, ...keepVisible];
    const left = Math.min(...boxes.map((b) => b.x));
    const top = Math.min(...boxes.map((b) => b.y));
    const right = Math.max(...boxes.map((b) => b.x + b.w));
    const bottom = Math.max(...boxes.map((b) => b.y + b.h));
    const cx = (((left + right) / 2) / canvas.width) * 100;
    const cy = (((top + bottom) / 2) / canvas.height) * 100;
    const fitTarget = Math.min(canvas.width / (c.focus.w * RULES.FIT_MARGIN), canvas.height / (c.focus.h * RULES.FIT_MARGIN));
    const fitAll = Math.min(canvas.width / ((right - left) * 1.08), canvas.height / ((bottom - top) * 1.08));
    const zoom = Math.round(Math.min(cap, fitTarget, fitAll) * 100) / 100;
    const zStart = Math.max(RULES.SETTLE, effect.start - zoomIn * 0.85);

    let why = "";
    if (c.area > RULES.MAX_ZOOM_AREA) why = "already fills much of the frame";
    else if (zoom < RULES.MIN_ZOOM) why = "too large to zoom into usefully";
    else if (zooms >= RULES.MAX_ZOOMS) why = `more than ${RULES.MAX_ZOOMS} camera moves in one scene`;
    else if (!focusOpen && zStart < zoomRestAt + RULES.MIN_ZOOM_GAP) why = "camera was moving moments ago";
    else if (zStart + zoomIn + 0.5 > restEnd) why = "no room to settle before the scene ends";

    if (why) {
      decisions.push({ id: c.p.id, selector: c.p.selector, status: "kept", reason: `spoken ${c.start.toFixed(1)}-${c.end.toFixed(1)}s; ${effect.kind} ${effect.start.toFixed(1)}-${effect.end.toFixed(1)}s; no zoom: ${why}` });
      return;
    }

    // A focus released and re-entered within the cool-down becomes one sustained zoom that pans.
    const sustained = focusOpen && zStart < holdEnd + RULES.MIN_ZOOM_GAP;
    if (!sustained && focusOpen) {
      shots.push({ start_time: holdEnd, transition_duration: zoomOut, x_percent: 50, y_percent: 50, zoom: 1, easing: "smooth" });
      zoomRestAt = holdEnd + zoomOut;
    }
    shots.push({ start_time: zStart, transition_duration: zoomIn, x_percent: cx, y_percent: cy, zoom, easing: "smooth" });
    zooms++;
    focusOpen = true;
    holdEnd = Math.min(restEnd - zoomOut, Math.max(effect.end, zStart + zoomIn + 0.8));
    decisions.push({ id: c.p.id, selector: c.p.selector, status: "kept", reason: `spoken ${c.start.toFixed(1)}-${c.end.toFixed(1)}s; ${effect.kind} ${effect.start.toFixed(1)}-${effect.end.toFixed(1)}s; ${sustained ? "pan" : "zoom"} x${zoom} ${zStart.toFixed(1)}-${(zStart + zoomIn).toFixed(1)}s (speech ${wps.toFixed(1)} words/s)` });
    // If the next emphasis is too far away, release now so the camera isn't left zoomed for ages.
    const next = kept[i + 1];
    if (!next || next.fxStart > holdEnd + RULES.MIN_ZOOM_GAP) {
      shots.push({ start_time: holdEnd, transition_duration: zoomOut, x_percent: 50, y_percent: 50, zoom: 1, easing: "smooth" });
      zoomRestAt = holdEnd + zoomOut;
      focusOpen = false;
    }
  });
  if (focusOpen) {
    shots.push({ start_time: holdEnd, transition_duration: zoomOut, x_percent: 50, y_percent: 50, zoom: 1, easing: "smooth" });
  }

  // Effects without a recorded decision (kept without zoom handled above); make sure every kept one is logged once.
  const logged = new Set(decisions.filter((d) => d.status === "kept").map((d) => d.id));
  kept.forEach((c) => {
    if (!logged.has(c.p.id)) decisions.push({ id: c.p.id, selector: c.p.selector, status: "kept", reason: "highlight" });
  });

  return { shots, effects, decisions };
}
