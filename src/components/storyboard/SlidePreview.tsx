import { useEffect, useMemo, useRef } from "react";
import { GeneratedHtml, Interaction } from "@/config/entities";

/**
 * Sandboxed-iframe slide preview — the port's stand-in for storyboard-
 * presenter's SlideRenderer.tsx. Ported: the iframe-sandbox approach, the
 * effect-class application loop, and click-to-select for building new
 * interactions. Not ported (scoped out, see PROJECT_PLAN.md): tap-cursor
 * placement, word-level text-node targeting, and the auto-follow coordinate
 * resolver — this preview only supports CSS-selector targeting.
 */
const EFFECT_CLASS: Record<Interaction["action"], string> = {
  highlight: "sb-highlight",
  "glow-green": "sb-glow-green",
  "glow-orange": "sb-glow-orange",
  spotlight: "sb-spotlight",
  "scale-pop": "sb-scale-pop",
  "draw-outline": "sb-draw-outline",
  "sweep-highlight": "sb-sweep-highlight",
  "dim-rest": "sb-dim-rest"
};

const IFRAME_STYLE = `
  .sb-highlight { background: #c99b4e !important; color: #191816 !important; }
  .sb-glow-green { box-shadow: 0 0 0 3px #3f9d5f !important; }
  .sb-glow-orange { box-shadow: 0 0 0 3px #c99b4e !important; }
  .sb-spotlight { box-shadow: 0 0 0 4000px rgba(0,0,0,.6) !important; position: relative; z-index: 50; }
  .sb-scale-pop { transform: scale(1.08); transition: transform .2s; }
  .sb-draw-outline { outline: 2px solid #c99b4e !important; outline-offset: 2px; }
  .sb-sweep-highlight { background: linear-gradient(90deg, transparent, #c99b4e55, transparent) !important; }
  .sb-dim-rest { opacity: .35; }
  .sb-focused { outline: 2px dashed #c99b4e !important; outline-offset: 2px; cursor: pointer; }
`;

function selectorPath(el: Element, root: Element): string {
  if (el.id) return `#${el.id}`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== root) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    const idx = Array.from(parent.children).indexOf(node) + 1;
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${idx})`);
    node = parent;
  }
  return parts.join(" > ");
}

export function SlidePreview({
  slide,
  interactions,
  activeInteractionIds = [],
  focusedSelector,
  selectionMode = false,
  onElementSelected
}: {
  slide: GeneratedHtml;
  interactions: Interaction[];
  activeInteractionIds?: string[];
  focusedSelector?: string | null;
  selectionMode?: boolean;
  onElementSelected?: (payload: { selector: string; text: string }) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const srcDoc = useMemo(
    () => `<!doctype html><html><head><meta charset="utf-8">
      <script src="https://cdn.tailwindcss.com"></script>
      <style>${IFRAME_STYLE}</style>
    </head><body>${slide.html_content || ""}</body></html>`,
    [slide.id, slide.html_content]
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const apply = () => {
      const doc = iframe.contentDocument;
      if (!doc?.body) return;

      for (const inter of interactions) {
        const el = doc.querySelector(inter.target_text);
        if (!el) continue;
        const cls = EFFECT_CLASS[inter.action];
        el.classList.remove(...Object.values(EFFECT_CLASS));
        if (activeInteractionIds.includes(inter.id)) el.classList.add(cls);
      }

      doc.querySelectorAll(".sb-focused").forEach((el) => el.classList.remove("sb-focused"));
      if (focusedSelector) {
        const el = doc.querySelector(focusedSelector);
        el?.classList.add("sb-focused");
      }

      if (selectionMode) {
        const handler = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          const target = e.target as Element;
          if (!target || target === doc.body) return;
          onElementSelected?.({ selector: selectorPath(target, doc.body), text: target.textContent?.trim().slice(0, 60) ?? "" });
        };
        doc.body.addEventListener("click", handler, { capture: true });
        return () => doc.body.removeEventListener("click", handler, { capture: true });
      }
    };
    iframe.addEventListener("load", apply);
    apply();
    return () => iframe.removeEventListener("load", apply);
  }, [interactions, activeInteractionIds, focusedSelector, selectionMode, onElementSelected, srcDoc]);

  return (
    <iframe
      ref={iframeRef}
      title={slide.name || "Slide preview"}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-same-origin"
      className="h-full w-full border-0 bg-white"
    />
  );
}
