import { useEffect, useRef, useState } from "react";

/** Animates a number from 0 to `value` on mount/change. Skips the tween (jumps straight
 * to the final value) under prefers-reduced-motion, per the ui-ux-pro-max a11y checklist. */
export function useCountUp(value: number, durationMs = 700) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setDisplay(value);
      prev.current = value;
      return;
    }

    const from = prev.current;
    const delta = value - from;
    if (delta === 0) return;
    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + delta * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else prev.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return display;
}
