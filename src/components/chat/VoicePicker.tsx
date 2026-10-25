import { useEffect, useRef, useState } from "react";
import { Check, Pause, Play } from "lucide-react";
import { VOICES } from "@/config/voices";
import { cn } from "@/lib/utils";

/**
 * Choose the narration voice, and hear each one first. "decide" leaves it to the standard voice. Only one sample
 * plays at a time, and playing one never changes the choice: picking a voice is a separate click on its row.
 */
export default function VoicePicker({ value, onChange }: { value: string; onChange: (voiceId: string) => void }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  };
  useEffect(() => stop, []); // leaving the page stops whatever is playing

  const toggle = (id: string, src: string) => {
    if (playing === id) return stop();
    stop();
    setFailed(null);
    const el = new Audio(src);
    el.onended = () => setPlaying((p) => (p === id ? null : p));
    el.onerror = () => {
      setFailed(id);
      setPlaying(null);
    };
    audio.current = el;
    setPlaying(id);
    void el.play().catch(() => {
      setFailed(id);
      setPlaying(null);
    });
  };

  const row = (selected: boolean) =>
    cn(
      "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
      selected ? "border-primary bg-primary/15" : "border-white/15 bg-white/[0.04] hover:border-white/30"
    );

  return (
    <div className="space-y-1.5" role="radiogroup" aria-label="Narration voice">
      <button type="button" role="radio" aria-checked={value === "decide"} onClick={() => onChange("decide")} className={row(value === "decide")}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center text-muted">{value === "decide" ? <Check className="h-4 w-4 text-primary-text" /> : null}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm">Standard voice</span>
          <span className="block text-xs text-muted">What every film uses unless you pick one</span>
        </span>
      </button>
      {VOICES.map((v) => {
        const selected = value === v.id;
        const isPlaying = playing === v.id;
        return (
          <div key={v.id} className={row(selected)}>
            <button
              type="button"
              onClick={() => toggle(v.id, v.sample)}
              aria-label={`${isPlaying ? "Stop" : "Play"} a sample of ${v.name}`}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors",
                isPlaying ? "border-primary bg-primary text-primary-foreground" : "border-white/25 text-primary-text hover:bg-white/10"
              )}
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button type="button" role="radio" aria-checked={selected} onClick={() => onChange(v.id)} className="min-w-0 flex-1 text-left">
              <span className="block text-sm">
                {v.name}
                {failed === v.id && <span className="ml-2 text-xs text-destructive-text">Couldn't play the sample</span>}
              </span>
              <span className="block truncate text-xs text-muted">{v.tagline}</span>
            </button>
            {selected && <Check className="h-4 w-4 shrink-0 text-primary-text" />}
          </div>
        );
      })}
    </div>
  );
}
