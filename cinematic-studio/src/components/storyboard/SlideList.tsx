import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { GeneratedHtml } from "@/config/entities";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SlideList({
  slides,
  activeSlideId,
  onSelect,
  onReorder,
  onAdd,
  onDelete
}: {
  slides: GeneratedHtml[];
  activeSlideId: string | null;
  onSelect: (id: string) => void;
  onReorder: (id: string, direction: "up" | "down") => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border p-3">
        <h2 className="font-display text-sm font-semibold">Slides</h2>
        <Button size="sm" variant="ghost" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {slides.map((s, i) => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={cn(
              "flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2.5 transition-colors",
              s.id === activeSlideId ? "bg-primary/10" : "hover:bg-surface-raised"
            )}
          >
            <span className="w-5 shrink-0 text-[11px] tabular-nums text-muted">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{s.name || `Slide ${i + 1}`}</p>
              <p className="text-[11px] text-muted">{s.duration ?? 6}s · {s.transition ?? "fade"}</p>
            </div>
            <div className="flex shrink-0 gap-0.5" onClick={(e) => e.stopPropagation()}>
              <button
                className="rounded-[3px] p-1 text-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-30"
                disabled={i === 0}
                onClick={() => onReorder(s.id, "up")}
                aria-label="Move up"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                className="rounded-[3px] p-1 text-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-30"
                disabled={i === slides.length - 1}
                onClick={() => onReorder(s.id, "down")}
                aria-label="Move down"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                className="rounded-[3px] p-1 text-muted hover:bg-destructive/10 hover:text-destructive-text"
                onClick={() => onDelete(s.id)}
                aria-label="Delete slide"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        {slides.length === 0 && <p className="p-3 text-sm text-muted">No slides yet — add one to begin.</p>}
      </div>
    </div>
  );
}
