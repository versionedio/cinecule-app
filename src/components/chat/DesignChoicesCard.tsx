import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { BACKGROUNDS, DesignChoices, FONT_STYLES, FORMATS, LAYOUT_MIXES, LENGTHS, NO_CHOICES, PICTURE_AMOUNTS, THEMES } from "@/render/theme";
import DesignPreview from "@/components/chat/DesignPreview";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Chip({ selected, onClick, title, children }: { selected: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={selected}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
        selected ? "border-primary bg-primary/15 text-foreground" : "border-white/15 bg-white/[0.04] text-muted hover:border-white/30 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs uppercase tracking-widest text-muted">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/**
 * The quick "how should it look?" questions shown in the chat before a film starts. Every group defaults to
 * "you decide", so skipping (or pressing Start untouched) leaves the styling to the AI as before.
 */
export default function DesignChoicesCard({ onSubmit, onSkip, busy }: { onSubmit: (choices: DesignChoices) => void; onSkip: () => void; busy: boolean }) {
  const [c, setC] = useState<DesignChoices>(NO_CHOICES);
  const set = (patch: Partial<DesignChoices>) => setC((prev) => ({ ...prev, ...patch }));

  // The example sits at the top of the card. If a choice is made further down while it is out of view, bring it
  // back into view so the change is visible straight away (nothing floats over the options).
  const previewBox = useRef<HTMLDivElement>(null);
  const firstRun = useRef(true);
  useEffect(() => {
    const el = previewBox.current;
    if (!el) return;
    if (firstRun.current) {
      // When the card first appears the chat has scrolled to the bottom (the card is taller than the screen), which
      // leaves the example out of view. Show it first; that also stops the chat from auto-scrolling past it.
      firstRun.current = false;
      const t = window.setTimeout(() => el.scrollIntoView({ block: "start", behavior: "smooth" }), 650);
      return () => window.clearTimeout(t);
    }
    const r = el.getBoundingClientRect();
    if (r.top < 70 || r.bottom > window.innerHeight - 10) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [c]);

  return (
    <div className="chat-in mt-3 space-y-4" style={{ animationDelay: "500ms" }}>
      <div ref={previewBox} className="scroll-mt-28">
        <DesignPreview choices={c} />
      </div>

      <Group label="Theme">
        <Chip selected={c.theme === "decide"} onClick={() => set({ theme: "decide" })} title="The AI picks a theme that suits the topic">You decide</Chip>
        {THEMES.map((t) => (
          <Chip key={t.name} selected={c.theme === t.name} onClick={() => set({ theme: t.name })} title={t.suits}>
            <span className="inline-flex -space-x-1" aria-hidden>
              <span className="h-3.5 w-3.5 rounded-full border border-white/30" style={{ background: t.bg }} />
              <span className="h-3.5 w-3.5 rounded-full border border-white/30" style={{ background: t.accent }} />
            </span>
            <span className="capitalize">{t.name}</span>
          </Chip>
        ))}
      </Group>

      <Group label="Background">
        <Chip selected={c.background === "decide"} onClick={() => set({ background: "decide" })}>You decide</Chip>
        {BACKGROUNDS.map((b) => (
          <Chip key={b.id} selected={c.background === b.id} onClick={() => set({ background: b.id })} title={b.description}>{b.label}</Chip>
        ))}
      </Group>

      <Group label="Fonts">
        {FONT_STYLES.map((f) => (
          <Chip key={f.id} selected={c.font === f.id} onClick={() => set({ font: f.id })} title={f.description}>{f.label}</Chip>
        ))}
      </Group>

      <Group label="Layout mix">
        {LAYOUT_MIXES.map((m) => (
          <Chip key={m.id} selected={c.layout === m.id} onClick={() => set({ layout: m.id })} title={m.description}>{m.label}</Chip>
        ))}
      </Group>

      <Group label="Pictures">
        <Chip selected={c.pictures === "decide"} onClick={() => set({ pictures: "decide" })}>You decide</Chip>
        {PICTURE_AMOUNTS.map((m) => (
          <Chip key={m.id} selected={c.pictures === m.id} onClick={() => set({ pictures: m.id })} title={m.description}>{m.label}</Chip>
        ))}
      </Group>

      <Group label="Length">
        <Chip selected={c.length === "decide"} onClick={() => set({ length: "decide" })} title="The AI picks a length that suits the topic">You decide</Chip>
        {LENGTHS.map((l) => (
          <Chip key={l.id} selected={c.length === l.id} onClick={() => set({ length: l.id })} title={l.description}>{l.label}</Chip>
        ))}
      </Group>

      <Group label="Format">
        {FORMATS.map((f) => (
          <Chip key={f.id} selected={c.format === f.id} onClick={() => set({ format: f.id })} title={f.description}>{f.label}</Chip>
        ))}
      </Group>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button onClick={() => onSubmit(c)} disabled={busy}>
          <Play className="h-4 w-4" />
          Start with these
        </Button>
        <Button variant="outline" onClick={onSkip} disabled={busy}>
          Skip, you decide
        </Button>
      </div>
    </div>
  );
}
