import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { CameraShot, ShotEasing, ShotType } from "@/config/entities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SHOT_TYPES: ShotType[] = ["establishing", "focus", "push-in", "pull-back", "pan", "final-hold"];
const EASINGS: ShotEasing[] = ["smooth", "easeInOut", "snap", "cinematic"];
const selectCls =
  "h-8 rounded-[3px] border border-border bg-transparent px-2 text-xs text-foreground focus-visible:outline-none focus-visible:border-primary";

type Draft = Omit<CameraShot, "id" | "project_id" | "slide_id">;

const BLANK: Draft = {
  label: "New shot", start_time: 0, end_time: 3, x_percent: 50, y_percent: 50, zoom: 1.15,
  easing: "smooth", shot_type: "focus"
};

export function CameraShotPanel({
  shots,
  onCreate,
  onUpdate,
  onDelete
}: {
  shots: CameraShot[];
  onCreate: (draft: Draft) => void;
  onUpdate: (id: string, patch: Partial<CameraShot>) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(BLANK);

  return (
    <div className="p-4">
      <h2 className="mb-3 font-display text-sm font-semibold">Camera shots</h2>
      <div className="flex flex-col gap-2">
        {shots.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-[3px] border border-border p-2 text-xs">
            <Input
              className="h-8 w-28 text-xs"
              value={s.label}
              onChange={(e) => onUpdate(s.id, { label: e.target.value })}
            />
            <select className={selectCls} value={s.shot_type} onChange={(e) => onUpdate(s.id, { shot_type: e.target.value as ShotType })}>
              {SHOT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className={selectCls} value={s.easing} onChange={(e) => onUpdate(s.id, { easing: e.target.value as ShotEasing })}>
              {EASINGS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Input className="h-8 w-16 text-xs" type="number" step={0.1} value={s.start_time} onChange={(e) => onUpdate(s.id, { start_time: Number(e.target.value) })} title="Start (s)" />
            <Input className="h-8 w-16 text-xs" type="number" step={0.1} value={s.end_time} onChange={(e) => onUpdate(s.id, { end_time: Number(e.target.value) })} title="End (s)" />
            <Input className="h-8 w-16 text-xs" type="number" step={1} value={s.x_percent} onChange={(e) => onUpdate(s.id, { x_percent: Number(e.target.value) })} title="X%" />
            <Input className="h-8 w-16 text-xs" type="number" step={1} value={s.y_percent} onChange={(e) => onUpdate(s.id, { y_percent: Number(e.target.value) })} title="Y%" />
            <Input className="h-8 w-16 text-xs" type="number" step={0.05} value={s.zoom} onChange={(e) => onUpdate(s.id, { zoom: Number(e.target.value) })} title="Zoom" />
            <button className="ml-auto rounded-[3px] p-1 text-muted hover:text-destructive-text" onClick={() => onDelete(s.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {shots.length === 0 && <p className="text-sm text-muted">No camera shots for this slide yet.</p>}
      </div>
      <Button size="sm" variant="ghost" className="mt-2" onClick={() => { onCreate(draft); setDraft(BLANK); }}>
        <Plus className="h-4 w-4" />
        Add shot
      </Button>
    </div>
  );
}
