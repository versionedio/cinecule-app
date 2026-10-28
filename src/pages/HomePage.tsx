import { useNavigate } from "react-router-dom";
import {
  Clapperboard, Sparkles, FileStack, Wand2, Aperture, Film,
  ArrowRight, FileText, Link2, Image, HelpCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { cn } from "@/lib/utils";

const FEATURES = [
  {
    icon: FileStack,
    title: "Feed it anything",
    body: "Text, a URL, a PDF, an image, or just a query — every project pulls in whatever mix of sources the story needs."
  },
  {
    icon: Wand2,
    title: "AI writes the first draft",
    body: "Slides and narration are generated together, tuned to the video type — marketing, explainer, tutorial, or narrative."
  },
  {
    icon: Aperture,
    title: "Camera direction, automatically",
    body: "Zoom, pan, and highlight cues are generated from the draft — the same rules a human director would follow, applied by AI."
  },
  {
    icon: Film,
    title: "Zero-touch rendering",
    body: "A headless browser drives an in-page cursor and encodes the final MP4. No screen recording, no human in the loop."
  }
];

const STAGES = [
  { icon: FileText, label: "Source", tone: "text-muted" },
  { icon: Wand2, label: "Storyboard", tone: "text-primary" },
  { icon: Sparkles, label: "Voiceover", tone: "text-primary" },
  { icon: Aperture, label: "Direction", tone: "text-accent" },
  { icon: Film, label: "Render", tone: "text-accent" },
  { icon: Clapperboard, label: "Film", tone: "text-success" }
];

const STEPS = [
  {
    n: "01",
    title: "Add your source",
    body: "Paste an article, drop in a link, upload a PDF or image — or just describe what you want in a few words."
  },
  {
    n: "02",
    title: "Review the draft",
    body: "AI writes the slides, voiceover, and camera direction. Open the storyboard editor to fine-tune anything before it renders."
  },
  {
    n: "03",
    title: "Render",
    body: "One click. The pipeline bundles the project and renders a finished 4K video — fully automatic from here."
  }
];

const INPUT_KINDS = [
  { icon: FileText, label: "Text" },
  { icon: Link2, label: "URL" },
  { icon: FileStack, label: "PDF" },
  { icon: Image, label: "Image" },
  { icon: HelpCircle, label: "Query" }
];

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background">
        <div className="flex h-16 items-center justify-between px-4 md:px-16">
          <div className="flex items-center gap-2.5">
            <Clapperboard className="h-5 w-5 text-primary" />
            <span className="font-display text-lg font-semibold tracking-tight">Cinecule</span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle className="hidden sm:inline-flex" />
            <Button variant="ghost" size="sm" onClick={() => navigate("/login")}>
              Sign in
            </Button>
            <Button size="sm" onClick={() => navigate("/login?mode=register")}>
              Request access
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero — broadsheet */}
        <section className="px-4 pb-16 pt-16 md:px-16 md:pt-20">
        <div className="mx-auto max-w-6xl">
          <p className="motion-safe:animate-fade-up mb-5 text-[11px] uppercase tracking-widest text-primary-text">
            Article to 4K film · autonomous pipeline
          </p>
          <h1
            className="motion-safe:animate-fade-up max-w-[15ch] font-display text-5xl font-normal leading-[0.98] tracking-tight md:text-7xl"
            style={{ animationDelay: "60ms" }}
          >
            Every article already has a film in it.
          </h1>
          <div
            className="motion-safe:animate-fade-up mt-8 grid max-w-3xl grid-cols-1 gap-8 text-[15px] leading-relaxed text-foreground/80 sm:grid-cols-2"
            style={{ animationDelay: "120ms" }}
          >
            <p>
              Drop in a URL, a PDF, an image, a block of text, or a single question. The pipeline reads it, writes a
              storyboard and a narration script in one pass, then hands both to a director that decides where the
              camera looks and when.
            </p>
            <p>
              A headless-browser worker renders the result to MP4 at up to 3840&times;2160. Nothing to assemble, no
              timeline to babysit — though every shot, cue and cursor move stays editable if you disagree.
            </p>
          </div>
          <div
            className="motion-safe:animate-fade-up mt-8 flex flex-col gap-3 sm:flex-row"
            style={{ animationDelay: "180ms" }}
          >
            <Button size="lg" onClick={() => navigate("/login?mode=register")}>
              Request access
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate("/login")}>
              Sign in
            </Button>
          </div>

          <div className="hr my-14" />

          <div className="mb-3 flex flex-wrap gap-1.5">
            {INPUT_KINDS.map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1 rounded-[3px] border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted"
              >
                <Icon className="h-3 w-3" />
                {label}
              </span>
            ))}
          </div>
          <h2 className="mb-4 text-[11px] uppercase tracking-widest text-primary-text">How it works</h2>
          <div className="flex flex-col">
            {STAGES.map((s, i) => (
              <div key={s.label} className="flex items-center gap-5 border-b border-border py-4 last:border-0">
                <span className="w-8 shrink-0 font-display text-2xl tabular-nums text-primary-text">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <s.icon className={cn("h-4 w-4 shrink-0", s.tone)} />
                <span className="font-display font-semibold">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
        </section>

        {/* Features */}
        <section className="border-t border-border bg-surface px-4 py-16 md:px-16">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-2 font-display text-3xl font-normal">Every stage, handled</h2>
            <p className="mb-10 text-muted">From a raw source to a rendered film — no manual steps in between.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f, i) => (
                <Card
                  key={f.title}
                  className="motion-safe:animate-fade-up p-5 transition-colors hover:border-primary/50"
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[4px] border border-primary text-primary-text">
                    <f.icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-display font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-muted">{f.body}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Three-step overview */}
        <section id="how-it-works" className="px-4 py-16 md:px-16">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-2 font-display text-3xl font-normal">From source to finished film</h2>
            <p className="mb-10 text-muted">Three steps. One deliberate button.</p>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {STEPS.map((s) => (
                <div key={s.n} className="relative">
                  <span className="font-display text-4xl font-normal text-primary/30">{s.n}</span>
                  <h3 className="mt-2 font-display font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm text-muted">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="border-t border-border px-4 py-16 text-center md:px-16">
          <h2 className="font-display text-3xl font-normal">Put your video pipeline on autopilot.</h2>
          <p className="mt-2 text-muted">Bring an article. Leave with a film.</p>
          <div className="mt-6">
            <Button size="lg" onClick={() => navigate("/login?mode=register")}>
              Request early access
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-4 py-8 md:px-16">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
          <div className="flex items-center gap-2 text-sm text-muted">
            <Clapperboard className="h-4 w-4" />
            Cinecule
          </div>
          <p className="text-[11px] uppercase tracking-wide text-muted">the control room for the article-to-film pipeline</p>
        </div>
      </footer>
    </div>
  );
}
