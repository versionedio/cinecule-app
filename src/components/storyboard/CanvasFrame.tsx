import { ReactNode } from "react";
import { CanvasAspectRatio } from "@/config/entities";

const ASPECT: Record<Exclude<CanvasAspectRatio, "custom">, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1
};

/**
 * Letterboxing container — the port's stand-in for storyboard-presenter's
 * StageFrame.tsx. Simplified from that source's ResizeObserver-driven pixel
 * fit to a CSS aspect-ratio box, since the child iframe here renders at
 * responsive size rather than a fixed canonical resolution scaled down.
 */
export function CanvasFrame({
  aspectRatio,
  customWidth = 1920,
  customHeight = 1080,
  children
}: {
  aspectRatio: CanvasAspectRatio;
  customWidth?: number;
  customHeight?: number;
  children: ReactNode;
}) {
  const ratio = aspectRatio === "custom" ? customWidth / customHeight : ASPECT[aspectRatio];

  return (
    <div className="flex items-center justify-center rounded-[4px] border border-border bg-[#0c0b0a] p-4">
      <div className="w-full overflow-hidden rounded-[3px] border border-border/60 bg-background shadow-sm" style={{ aspectRatio: ratio, maxHeight: "70vh" }}>
        {children}
      </div>
    </div>
  );
}
