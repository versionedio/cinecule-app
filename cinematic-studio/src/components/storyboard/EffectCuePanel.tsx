import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { EffectType, VideoEffectCue } from "@/config/entities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const EFFECTS: EffectType[] = [
  "spotlight", "dim-background", "scale-pop", "glow", "underline",
  "circle", "wipe-reveal", "blur-rest", "kinetic-text", "none"
];
const selectCls =
  "h-8 rounded-[3px] border border-border bg-transparent px-2 text-xs text-foreground focus-visible:outline-none focus-visible:border-primary";

type Draft = Omit<VideoEffectCue, "id" | "project_id" | "slide_id">;

const BLANK: Draft = { label: "New cue", start_time: 0, duration: 1, effect: "glow" };

export function EffectCuePanel({
  cues,
  onCreate,
  onUpdate,
  onDelete
}: {
  cues: VideoEffectCue[];
  onCreate: (draft: Draft) => void;
  onUpdate: (id: string, patch: Partial<VideoEffectCue>) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(BLANK);

  return (
    <div className="p-4">
      <h2 className="mb-3 font-display text-sm font-semibold">Effect cues</h2>
      <div className="flex flex-col gap-2">
        {cues.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-[3px] border border-border p-2 text-xs">
            <Input className="h-8 w-28 text-xs" value={c.label} onChange={(e) => onUpdate(c.id, { label: e.target.value })} />
            <select className={selectCls} value={c.effect} onChange={(e) => onUpdate(c.id, { effect: e.target.value as EffectType })}>
              {EFFECTS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Input className="h-8 w-16 text-xs" type="number" step={0.1} value={c.start_time} onChange={(e) => onUpdate(c.id, { start_time: Number(e.target.value) })} title="Start (s)" />
            <Input className="h-8 w-16 text-xs" type="number" step={0.1} value={c.duration} onChange={(e) => onUpdate(c.id, { duration: Number(e.target.value) })} title="Duration (s)" />
            <Input
              className="h-8 flex-1 min-w-[100px] text-xs"
              placeholder="target selector"
              value={c.target_selector ?? ""}
              onChange={(e) => onUpdate(c.id, { target_selector: e.target.value })}
            />
            <button className="ml-auto rounded-[3px] p-1 text-muted hover:text-destructive-text" onClick={() => onDelete(c.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {cues.length === 0 && <p className="text-sm text-muted">No effect cues for this slide yet.</p>}
      </div>
      <Button size="sm" variant="ghost" className="mt-2" onClick={() => { onCreate(draft); setDraft(BLANK); }}>
        <Plus className="h-4 w-4" />
        Add cue
      </Button>
    </div>
  );
}
