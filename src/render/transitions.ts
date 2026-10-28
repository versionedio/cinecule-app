/**
 * How one scene hands over to the next. Everything here is a pure function of progress (0 to 1), so a frame depends
 * only on the time it is drawn at, and the same film renders the same way every time.
 *
 * The stored transition names (fade, slide-left, ...) are unchanged, so existing films and the editor keep working;
 * what each name draws is what changed. The look follows what editors do to make a cut feel seamless:
 *  - Eased motion, steep at the start and end. A linear move or dissolve reads as mechanical.
 *  - Both scenes move: a push carries the old scene out as the new one comes in, at the same speed, instead of
 *    sliding a new slide over a motionless old one.
 *  - Motion blur along the direction of travel, strongest at peak speed, so fast moves hide the cut.
 *  - Short. Seamless transitions are fractions of a second, and vertical video wants them shorter still.
 */

export interface Pose {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  /** Blur along the direction of travel, in px (an SVG filter, since CSS has no directional blur). */
  blurX: number;
  blurY: number;
  /** Plain all-round blur, in px (used for zooms). */
  blur: number;
  /** Which scene is drawn on top. */
  z: number;
  /** A CSS clip-path that masks the scene (for wipes and iris reveals); empty for none. */
  clip: string;
}

export interface Frames {
  out: Pose;
  in: Pose;
  /** A white flash laid over both scenes, 0 (none) to 1 (full white). */
  flash?: number;
}

export interface TransitionDef {
  /** The stored name. */
  id: string;
  /** What the editor shows. */
  label: string;
  description: string;
  /** How long it takes unless the scene asks for less. */
  seconds: number;
  /** The longest it may take, whatever a scene asks for. */
  maxSeconds: number;
  frames: (q: number, w: number, h: number, index: number) => Frames;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
/** 0 until `from`, 1 from `to`, a smooth ramp between. */
const ramp = (p: number, from: number, to: number) => clamp01((p - from) / (to - from));

const cubicInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
// Steeper than cubic: almost still at both ends, very fast in the middle. This is the speed ramp that makes a push feel physical.
const expoInOut = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2);

/** How fast an easing is moving at `q`, 0 (still) to 1 (its fastest). Blur follows this, so it peaks mid-move and vanishes at rest. */
const speedCache = new Map<(p: number) => number, number>();
function speed(ease: (p: number) => number, q: number): number {
  let peak = speedCache.get(ease);
  if (peak === undefined) {
    peak = 0;
    for (let i = 0; i <= 200; i++) peak = Math.max(peak, Math.abs(ease(Math.min(1, i / 200 + 0.0025)) - ease(i / 200)) / 0.0025);
    speedCache.set(ease, peak);
  }
  const h = 0.0025;
  const v = Math.abs(ease(clamp01(q + h)) - ease(clamp01(q - h))) / (2 * h);
  return peak > 0 ? clamp01(v / peak) : 0;
}

const still = (z: number): Pose => ({ opacity: 1, x: 0, y: 0, scale: 1, blurX: 0, blurY: 0, blur: 0, z, clip: "" });

/** Soft dissolve: an eased crossfade with a slight focus pull and settle, so it never looks like two flat images mixing. */
const dissolve: TransitionDef = {
  id: "fade",
  label: "Soft dissolve",
  description: "An eased crossfade with a gentle focus pull",
  seconds: 0.5,
  maxSeconds: 0.8,
  frames: (q) => {
    const e = cubicInOut(q);
    return {
      out: { ...still(1), scale: lerp(1, 0.985, e), blur: 6 * Math.sin(Math.PI * e) },
      in: { ...still(2), opacity: e, scale: lerp(1.035, 1, e), blur: 8 * (1 - e) }
    };
  }
};

/** Push: the new scene shoves the old one out, both moving together at the same speed, with directional motion blur. */
function push(id: string, label: string, dir: 1 | -1): TransitionDef {
  return {
    id,
    label,
    description: dir === 1 ? "The new scene pushes the old one out to the left" : "The new scene pushes the old one out to the right",
    seconds: 0.5,
    maxSeconds: 0.7,
    frames: (q, w) => {
      const e = expoInOut(q);
      const blurX = 34 * (w / 1920) * speed(expoInOut, q);
      return {
        out: { ...still(1), x: -dir * w * e, blurX },
        in: { ...still(2), x: dir * w * (1 - e), blurX }
      };
    }
  };
}

/** Zoom-through: the old scene rushes past the camera as the new one settles in, like moving through space. */
const zoomThrough: TransitionDef = {
  id: "zoom-in",
  label: "Zoom through",
  description: "The old scene rushes past the camera as the new one settles in",
  seconds: 0.5,
  maxSeconds: 0.7,
  frames: (q) => {
    const e = expoInOut(q);
    const v = speed(expoInOut, q);
    return {
      out: { ...still(1), scale: lerp(1, 1.55, e), opacity: 1 - ramp(q, 0.3, 0.8), blur: 26 * v },
      in: { ...still(2), scale: lerp(0.72, 1, e), opacity: ramp(q, 0.15, 0.65), blur: 26 * v }
    };
  }
};

/** Pull-back: the old scene recedes and fades to reveal the next, which settles in from slightly too close. */
const pullBack: TransitionDef = {
  id: "zoom-out",
  label: "Pull back",
  description: "The old scene recedes to reveal the next",
  seconds: 0.5,
  maxSeconds: 0.7,
  frames: (q) => {
    const e = expoInOut(q);
    const v = speed(expoInOut, q);
    return {
      out: { ...still(3), scale: lerp(1, 0.7, e), opacity: 1 - ramp(q, 0.25, 0.85), blur: 22 * v },
      in: { ...still(2), scale: lerp(1.3, 1, e), blur: 22 * v }
    };
  }
};

/** Whip pan: a very fast pan with heavy motion blur that hides the cut. Alternates direction scene by scene. */
const whip: TransitionDef = {
  id: "flip",
  label: "Whip pan",
  description: "A very fast pan that hides the cut behind motion blur",
  seconds: 0.35,
  maxSeconds: 0.45,
  frames: (q, w, _h, index) => {
    const dir = index % 2 === 0 ? 1 : -1;
    const e = expoInOut(q);
    const blurX = 80 * (w / 1920) * speed(expoInOut, q);
    return {
      out: { ...still(1), x: -dir * w * e, blurX },
      in: { ...still(2), x: dir * w * (1 - e), blurX }
    };
  }
};

/** Mask wipe: a slanted edge sweeps across and reveals the next scene behind it. Good for a change of topic. */
const wipe: TransitionDef = {
  id: "wipe",
  label: "Slanted wipe",
  description: "A slanted edge sweeps across and reveals the next scene",
  seconds: 0.5,
  maxSeconds: 0.7,
  frames: (q) => {
    const e = expoInOut(q);
    const slant = 14; // percent of the width the edge leans
    const edge = e * (100 + slant);
    return {
      // The old scene only grows a touch (never shifts or shrinks), so no black ever shows at its edges.
      out: { ...still(1), scale: lerp(1, 1.04, e) },
      in: { ...still(2), scale: lerp(1.06, 1, e), clip: `polygon(0% 0%, ${edge.toFixed(2)}% 0%, ${(edge - slant).toFixed(2)}% 100%, 0% 100%)` }
    };
  }
};

/** Iris: the next scene opens as a circle from the centre while the old one drifts slightly closer. */
const iris: TransitionDef = {
  id: "iris",
  label: "Iris reveal",
  description: "The next scene opens from the centre as a circle",
  seconds: 0.55,
  maxSeconds: 0.7,
  frames: (q, w, h) => {
    const e = cubicInOut(q);
    const radius = e * Math.hypot(w, h) * 0.52;
    return {
      out: { ...still(1), scale: lerp(1, 1.05, e), blur: 5 * Math.sin(Math.PI * e) },
      in: { ...still(2), scale: lerp(1.12, 1, e), clip: `circle(${radius.toFixed(1)}px at 50% 50%)` }
    };
  }
};

/** Flash: a quick bright dip with the cut hidden at the peak. Use sparingly: it is the loudest of the set. */
const flash: TransitionDef = {
  id: "flash",
  label: "Flash cut",
  description: "A quick bright flash that hides the cut (use sparingly)",
  seconds: 0.3,
  maxSeconds: 0.35,
  frames: (q) => {
    const cutAt = q >= 0.5;
    return {
      out: { ...still(1), opacity: cutAt ? 0 : 1, scale: lerp(1, 1.05, Math.min(1, q * 2)) },
      in: { ...still(2), opacity: cutAt ? 1 : 0, scale: lerp(1.05, 1, Math.max(0, q * 2 - 1)) },
      // A bell that peaks exactly at the cut and is gone at both ends.
      flash: Math.pow(Math.sin(Math.PI * q), 2) * 0.9
    };
  }
};

export const TRANSITIONS: TransitionDef[] = [dissolve, push("slide-left", "Push left", 1), push("slide-right", "Push right", -1), zoomThrough, pullBack, whip, wipe, iris, flash];

const BY_ID = new Map(TRANSITIONS.map((t) => [t.id, t]));

/** A hard cut has no transition at all. */
export const CUT_ID = "none";
export const isCut = (kind: string | undefined) => !kind || kind === CUT_ID;

/** What the editor offers, in order: the transitions, then a plain cut. */
export const TRANSITION_CHOICES: { id: string; label: string; description: string }[] = [
  ...TRANSITIONS.map(({ id, label, description }) => ({ id, label, description })),
  { id: CUT_ID, label: "Hard cut", description: "No transition: cuts straight to the next scene" }
];

/** An unknown name falls back to the dissolve rather than to nothing. */
export const transitionOf = (kind: string | undefined): TransitionDef => BY_ID.get(String(kind)) ?? dissolve;

/** How long this scene's transition runs: what it asked for, but never longer than the kind allows. */
export function transitionSeconds(kind: string | undefined, requested: number | undefined): number {
  const def = transitionOf(kind);
  const want = Number(requested);
  return Math.min(def.maxSeconds, Math.max(0.2, Number.isFinite(want) && want > 0 ? want : def.seconds));
}

export function transitionFrames(kind: string | undefined, q: number, w: number, h: number, index: number): Frames {
  return transitionOf(kind).frames(clamp01(q), w, h, index);
}
