import { useEffect, useRef, useState } from "react";
import { Check, Pause, Play } from "lucide-react";
import { MUSIC } from "@/config/music";
import { cn } from "@/lib/utils";

/**
 * Choose background music, and hear each track first. "none" is no music. Only one preview plays at a time, and playing
 * one never changes the choice: picking a track is a separate click on its row.
 */
export default function MusicPicker({ value, onChange }: { value: string; onChange: (musicId: string) => void }) {
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
    <div className="space-y-1.5" role="radiogroup" aria-label="Background music">
      <button type="button" role="radio" aria-checked={value === "none"} onClick={() => onChange("none")} className={row(value === "none")}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center text-muted">{value === "none" ? <Check className="h-4 w-4 text-primary-text" /> : null}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm">No music</span>
          <span className="block text-xs text-muted">Just the narrator</span>
        </span>
      </button>
      {MUSIC.map((m) => {
        const selected = value === m.id;
        const isPlaying = playing === m.id;
        return (
          <div key={m.id} className={row(selected)}>
            <button
              type="button"
              onClick={() => toggle(m.id, m.sample)}
              aria-label={`${isPlaying ? "Stop" : "Play"} a preview of ${m.name}`}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors",
                isPlaying ? "border-primary bg-primary text-primary-foreground" : "border-white/25 text-primary-text hover:bg-white/10"
              )}
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button type="button" role="radio" aria-checked={selected} onClick={() => onChange(m.id)} className="min-w-0 flex-1 text-left">
              <span className="block text-sm">
                {m.name}
                {failed === m.id && <span className="ml-2 text-xs text-destructive-text">Couldn't play the preview</span>}
              </span>
              <span className="block truncate text-xs text-muted">{m.tagline}</span>
            </button>
            {selected && <Check className="h-4 w-4 shrink-0 text-primary-text" />}
          </div>
        );
      })}
    </div>
  );
}
