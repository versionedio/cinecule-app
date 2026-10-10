import { Plus, Trash2 } from "lucide-react";
import { CursorTimelinePoint } from "@/config/entities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Project-wide cursor keyframe list — the port's stand-in for storyboard-
 * presenter's CursorTimelinePanel.tsx. Ported: manual add/edit/delete of
 * points sorted by global time. Not ported (scoped out, see
 * PROJECT_PLAN.md): tap-to-place capture and the auto-follow generator,
 * both of which depend on the off-screen DOM-target resolver this app
 * doesn't have yet.
 */
export function CursorTimelinePanel({
  points,
  activeSlideId,
  onCreate,
  onUpdate,
  onDelete
}: {
  points: CursorTimelinePoint[];
  activeSlideId: string | null;
  onCreate: () => void;
  onUpdate: (id: string, patch: Partial<CursorTimelinePoint>) => void;
  onDelete: (id: string) => void;
}) {
  const sorted = [...points].sort((a, b) => a.time - b.time);

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold">Cursor timeline</h2>
        <Button size="sm" variant="ghost" onClick={onCreate} disabled={!activeSlideId}>
          <Plus className="h-4 w-4" />
          Add point
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {sorted.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-[3px] border border-border p-2 text-xs">
            <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-muted">{p.source ?? "manual"}</span>
            <Input className="h-8 w-24 text-xs" value={p.label ?? ""} placeholder="label" onChange={(e) => onUpdate(p.id, { label: e.target.value })} />
            <Input className="h-8 w-16 text-xs" type="number" step={0.1} value={p.time} onChange={(e) => onUpdate(p.id, { time: Number(e.target.value) })} title="Time (s)" />
            <Input className="h-8 w-16 text-xs" type="number" step={0.5} value={p.x_percent} onChange={(e) => onUpdate(p.id, { x_percent: Number(e.target.value) })} title="X%" />
            <Input className="h-8 w-16 text-xs" type="number" step={0.5} value={p.y_percent} onChange={(e) => onUpdate(p.id, { y_percent: Number(e.target.value) })} title="Y%" />
            <Input className="h-8 w-20 text-xs" type="number" step={50} value={p.duration_ms} onChange={(e) => onUpdate(p.id, { duration_ms: Number(e.target.value) })} title="Travel ms" />
            <label className="flex items-center gap-1 text-[11px] text-muted">
              <input type="checkbox" checked={!!p.click} onChange={(e) => onUpdate(p.id, { click: e.target.checked })} />
              click
            </label>
            <button className="ml-auto rounded-[3px] p-1 text-muted hover:text-destructive-text" onClick={() => onDelete(p.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {sorted.length === 0 && <p className="text-sm text-muted">No cursor points yet.</p>}
      </div>
    </div>
  );
}
