import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Interaction, InteractionAction, interactionSelector } from "@/config/entities";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const ACTIONS: InteractionAction[] = [
  "highlight", "glow-green", "glow-orange", "spotlight",
  "scale-pop", "draw-outline", "sweep-highlight", "dim-rest"
];

const selectCls =
  "flex h-10 w-full rounded-[4px] border border-border bg-transparent px-3 text-sm text-foreground focus-visible:outline-none focus-visible:border-primary";

export function InteractionInspector({
  focusedSelector,
  interaction,
  onSave,
  onDelete,
  onFocus,
  slideInteractions
}: {
  focusedSelector: string | null;
  interaction: Interaction | null;
  onSave: (data: Partial<Interaction>) => void;
  onDelete: (id: string) => void;
  onFocus: (selector: string | null) => void;
  slideInteractions: Interaction[];
}) {
  const [action, setAction] = useState<InteractionAction>("highlight");
  const [trigger, setTrigger] = useState<"click" | "timed">("timed");
  const [timeOffset, setTimeOffset] = useState(1);
  const [duration, setDuration] = useState(3);
  const [label, setLabel] = useState("");

  useEffect(() => {
    setAction(interaction?.action ?? "highlight");
    setTrigger(interaction?.trigger ?? "timed");
    setTimeOffset(interaction?.time_offset ?? 1);
    setDuration(interaction?.duration ?? 3);
    setLabel(interaction?.label ?? "");
  }, [interaction?.id, focusedSelector]);

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <h2 className="mb-3 font-display text-sm font-semibold">Interactions</h2>

      {focusedSelector ? (
        <div className="mb-4 rounded-[4px] border border-primary/40 bg-primary/5 p-3">
          <p className="mb-2 truncate text-[11px] text-muted">{focusedSelector}</p>
          <div className="flex flex-col gap-3">
            <Field label="Effect">
              <select className={selectCls} value={action} onChange={(e) => setAction(e.target.value as InteractionAction)}>
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </Field>
            <Field label="Trigger">
              <select className={selectCls} value={trigger} onChange={(e) => setTrigger(e.target.value as "click" | "timed")}>
                <option value="timed">Timed</option>
                <option value="click">Click</option>
              </select>
            </Field>
            {trigger === "timed" && (
              <Field label="Time offset (s)">
                <Input type="number" step={0.1} value={timeOffset} onChange={(e) => setTimeOffset(Number(e.target.value))} />
              </Field>
            )}
            <Field label="Duration (s)">
              <Input type="number" step={0.1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </Field>
            <Field label="Label">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  onSave({
                    id: interaction?.id,
                    // An existing interaction keeps the words it was timed against; only new ones take the selector as text.
                    ...(interaction ? {} : { target_text: focusedSelector }),
                    target_selector: focusedSelector,
                    action,
                    trigger,
                    time_offset: timeOffset,
                    duration,
                    label
                  })
                }
              >
                {interaction ? "Save" : "Create interaction"}
              </Button>
              {interaction && (
                <Button size="sm" variant="destructive" onClick={() => onDelete(interaction.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onFocus(null)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p className="mb-4 text-sm text-muted">Click an element in the preview to add or edit an interaction.</p>
      )}

      <div className="flex flex-col gap-1">
        {slideInteractions.map((i) => (
          <button
            key={i.id}
            onClick={() => onFocus(interactionSelector(i))}
            className="flex items-center justify-between rounded-[3px] px-2 py-1.5 text-left text-sm hover:bg-surface-raised"
          >
            <span className="truncate">{i.label || i.target_text}</span>
            <span className="shrink-0 text-[11px] text-muted">{i.action}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
