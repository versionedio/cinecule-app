import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_THEME, DesignChoices, themeHead } from "@/render/theme";
import { cn } from "@/lib/utils";

interface Sample {
  key: string;
  label: string;
  inner: string;
  layout: string;
}

// Generic example content: the point is the look, not the words.
const SAMPLES: Record<string, Sample> = {
  title: { key: "title", label: "Title", layout: "cc-title", inner: `<h1 class="cc-h">Your film, <em>in this look</em></h1><p class="cc-sub">A short line about what's coming</p>` },
  points: { key: "points", label: "Key points", layout: "cc-points", inner: `<h2 class="cc-h">What <em>matters</em></h2><div class="cc-card">A <em>key phrase</em> that sticks</div><div class="cc-card">Short and <em>easy to scan</em></div><div class="cc-card">Never the whole sentence</div>` },
  points2: { key: "points2", label: "Key points 2", layout: "cc-points", inner: `<h2 class="cc-h">Three <em>ideas</em></h2><div class="cc-card">First, the <em>core idea</em></div><div class="cc-card">Then the <em>evidence</em></div>` },
  stat: { key: "stat", label: "Big number", layout: "cc-stat", inner: `<p class="cc-label">A number worth knowing</p><div class="cc-num">9,500</div><p class="cc-cap">years of <em>history</em> in one figure</p>` },
  split: { key: "split", label: "Compare", layout: "cc-split", inner: `<h2 class="cc-h">Before vs <em>after</em></h2><div class="cc-cols"><div class="cc-col"><p class="cc-label">Before</p><p>Slow and <em>manual</em></p></div><div class="cc-col"><p class="cc-label">After</p><p>Fast and <em>clear</em></p></div></div>` },
  quote: { key: "quote", label: "Quote", layout: "cc-quote", inner: `<p class="cc-q">Say it simply and <em>let it land</em>.</p><p class="cc-by">Someone wise</p>` },
  picture: { key: "picture", label: "Picture", layout: "cc-picture", inner: `<div style="position:absolute;inset:0;background:linear-gradient(135deg,var(--bg2),rgba(var(--accent-rgb),.55))"></div><p class="cc-label" style="position:absolute;left:150px;bottom:110px;color:var(--fg)">A generated picture fills the scene</p>` },
  closing: { key: "closing", label: "Closing", layout: "cc-closing", inner: `<h2 class="cc-h">One line to <em>remember</em></h2>` },
  phrase: { key: "phrase", label: "One phrase", layout: "cc-closing", inner: `<h2 class="cc-h">One short <em>phrase</em></h2>` }
};

/** Which example slides to show for the chosen layout mix and picture amount. */
function samplesFor(c: DesignChoices): Sample[] {
  const base: Record<string, string[]> = {
    balanced: ["title", "points", "stat"],
    text: ["title", "points", "points2"],
    visual: ["stat", "quote", "split"],
    minimal: ["title", "phrase", "closing"]
  };
  let keys = [...(base[c.layout] ?? base.balanced)];
  if (c.pictures === "none") keys = keys.filter((k) => k !== "picture");
  else if ((c.pictures === "few" || c.pictures === "many") && !keys.includes("picture")) keys.push("picture");
  return keys.map((k) => SAMPLES[k]);
}

/**
 * A live example of the chosen look: real slides drawn by the same stylesheet the renderer uses, so what you
 * see here is what the film will look like. Updates as soon as any option changes.
 */
export default function DesignPreview({ choices }: { choices: DesignChoices }) {
  const theme = choices.theme === "decide" ? DEFAULT_THEME : choices.theme;
  const bg = choices.background === "decide" ? "gradient" : choices.background;
  const font = choices.font === "theme" ? "" : ` data-font="${choices.font}"`;
  const samples = useMemo(() => samplesFor(choices), [choices.layout, choices.pictures]);
  const [active, setActive] = useState(0);
  const current = Math.min(active, samples.length - 1);

  const html = useMemo(
    () =>
      samples
        .map((s, i) => `<div class="cc ${s.layout}" data-sample="${i}" data-theme="${theme}" data-bg="${bg}"${font}>${s.inner}</div>`)
        .join(""),
    [samples, theme, bg, font]
  );
  const srcDoc = useMemo(
    () => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}</style>${themeHead(html)}</head><body>${html}</body></html>`,
    [html]
  );

  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / 1920);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Show only the chosen example; switching tabs changes visibility without reloading the frame.
  const show = () => {
    const doc = frame.current?.contentDocument;
    doc?.querySelectorAll<HTMLElement>("[data-sample]").forEach((el) => {
      el.style.display = el.dataset.sample === String(current) ? "" : "none";
    });
  };
  useEffect(show);

  return (
    <div className="sticky top-2 z-10 rounded-xl border border-white/15 bg-black/70 p-2 backdrop-blur-md">
      <div ref={box} className="relative aspect-video w-full overflow-hidden rounded-lg border border-white/10">
        <iframe
          ref={frame}
          title="Example of the chosen look"
          srcDoc={srcDoc}
          onLoad={show}
          className="absolute left-0 top-0 border-0"
          style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: "0 0" }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {samples.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setActive(i)}
              className={cn("rounded-full px-2.5 py-0.5 text-xs transition-colors", i === current ? "bg-primary/20 text-primary-text" : "text-muted hover:text-foreground")}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted">
          {choices.theme === "decide" ? "Example only: the AI will pick a theme to suit your topic" : "Example of your choices"}
        </p>
      </div>
    </div>
  );
}
