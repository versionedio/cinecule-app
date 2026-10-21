import { useState } from "react";
import { Play } from "lucide-react";
import { BACKGROUNDS, DesignChoices, FONT_STYLES, LAYOUT_MIXES, NO_CHOICES, PICTURE_AMOUNTS, THEMES } from "@/render/theme";
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

  return (
    <div className="chat-in mt-3 space-y-4" style={{ animationDelay: "500ms" }}>
      <DesignPreview choices={c} />

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
