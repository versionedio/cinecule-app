import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clapperboard, CheckCircle2, AlertTriangle, ArrowRight, Sparkles, Eye } from "lucide-react";
import { entityService } from "@/services/entityService";
import { ENTITY_NAMES, Project } from "@/config/entities";
import PipelineTimeline from "@/components/common/PipelineTimeline";
import RenderProgress from "@/components/common/RenderProgress";
import EntityNotConfigured, { entityMissing } from "@/components/common/EntityGate";
import { useAuth } from "@/hooks/useAuth";
import { useCountUp } from "@/hooks/useCountUp";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

// Statuses where the pipeline is actively working. ready_to_render is waiting on the user, not on the system.
const IN_PRODUCTION = ["generating_content", "generating_voice", "generating_direction", "rendering"];
const REFRESH_MS = 8000;

function Stat({
  label,
  value,
  icon: Icon,
  tone,
  delay
}: {
  label: string;
  value: number;
  icon: typeof Clapperboard;
  tone: "primary" | "success" | "destructive" | "accent";
  delay: number;
}) {
  const shown = useCountUp(value);
  const tones = {
    primary: "text-primary bg-primary/10",
    accent: value ? "text-primary bg-primary/10" : "text-muted bg-surface-raised",
    success: "text-success bg-success/10",
    destructive: value ? "text-destructive bg-destructive/10" : "text-muted bg-surface-raised"
  } as const;

  return (
    <Card className="flex-1 motion-safe:animate-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <CardContent className="flex items-center gap-4">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-[4px]", tones[tone])}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-widest text-muted">{label}</p>
          <p className="font-display text-3xl font-semibold tabular-nums">{shown}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Every page of the user's projects. (The old call asked for ?facets=status, an Enterprise-only
  // option that returns an empty list on this plan, so the dashboard counted nothing.)
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const all = await entityService.listAll<Project>(ENTITY_NAMES.project, {}, signal);
      setProjects(all);
      setMissing(false);
      setError("");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (entityMissing(e)) setMissing(true);
      else setError(e instanceof Error ? e.message : "Couldn't load your projects.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const active = projects.filter((p) => IN_PRODUCTION.includes(p.status));

  // Keep numbers honest: refresh while anything is running, and whenever the tab regains focus.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") load();
    };
    const timer = active.length > 0 ? window.setInterval(refresh, REFRESH_MS) : undefined;
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [active.length, load]);

  const review = projects.filter((p) => p.status === "ready_to_render");
  const done = projects.filter((p) => p.status === "ready").length;
  const failed = projects.filter((p) => p.status === "failed").length;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const unavailable = !!error && projects.length === 0;

  return (
    <div>
      <p className="motion-safe:animate-fade-up text-[11px] uppercase tracking-widest text-primary-text">{today}</p>
      <h1 className="motion-safe:animate-fade-up mb-6 mt-2 font-display text-4xl font-semibold">
        {profile?.fn ? `Good day, ${profile.fn}` : "Good day"}
      </h1>

      {missing && <EntityNotConfigured entity={ENTITY_NAMES.project} />}
      {error && (
        <Alert severity="error" className="mb-6">
          {error} The numbers below may be out of date.
        </Alert>
      )}

      <div className="hr mb-8" />
      <div className="mb-8 flex flex-col gap-3 sm:flex-row">
        <Stat label="In production" value={active.length} icon={Clapperboard} tone="primary" delay={80} />
        <Stat label="Ready to render" value={review.length} icon={Eye} tone="accent" delay={120} />
        <Stat label="Completed" value={done} icon={CheckCircle2} tone="success" delay={160} />
        <Stat label="Failed" value={failed} icon={AlertTriangle} tone="destructive" delay={200} />
      </div>

      {active.length > 0 && (
        <>
          <h2 className="mb-3 font-display text-lg font-semibold">Now in production</h2>
          <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-2">
            {active.map((p, i) => (
              <Card
                key={p.id}
                className="motion-safe:animate-fade-up cursor-pointer transition-colors hover:border-primary/50"
                style={{ animationDelay: `${260 + i * 60}ms` }}
                onClick={() => navigate(`/projects/${p.id}`)}
              >
                <CardContent>
                  <p className="mb-2.5 font-display font-semibold">{p.name}</p>
                  <PipelineTimeline status={p.status} />
                  {p.status === "rendering" && <RenderProgress projectId={p.id} compact onFinished={() => load()} />}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {review.length > 0 && (
        <>
          <h2 className="mb-3 font-display text-lg font-semibold">Waiting for you</h2>
          <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-2">
            {review.map((p) => (
              <Card key={p.id} className="cursor-pointer transition-colors hover:border-primary/50" onClick={() => navigate(`/projects/${p.id}`)}>
                <CardContent className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display font-semibold">{p.name}</p>
                    <p className="text-sm text-muted">Review it, then start the render.</p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {loaded && !missing && !unavailable && active.length === 0 && review.length === 0 && (
        <Card
          className="motion-safe:animate-fade-up flex flex-col items-center gap-3 border-dashed py-12 text-center"
          style={{ animationDelay: "260ms" }}
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-[4px] bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="font-display font-semibold">Nothing in production right now</p>
            <p className="mt-1 text-sm text-muted">
              {projects.length === 0
                ? "Add a content source and the pipeline takes it from there."
                : "Start a project's pipeline to see it move through the stages here."}
            </p>
          </div>
          <Button size="sm" onClick={() => navigate("/projects/new")}>
            New project
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Card>
      )}
    </div>
  );
}
