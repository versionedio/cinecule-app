import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clapperboard, CheckCircle2, AlertTriangle, ArrowRight, Sparkles } from "lucide-react";
import { entityService } from "@/services/entityService";
import { ENTITY_NAMES, Project } from "@/config/entities";
import PipelineTimeline from "@/components/common/PipelineTimeline";
import EntityNotConfigured, { entityMissing } from "@/components/common/EntityGate";
import { useAuth } from "@/hooks/useAuth";
import { useCountUp } from "@/hooks/useCountUp";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  tone: "primary" | "success" | "destructive";
  delay: number;
}) {
  const shown = useCountUp(value);
  const tones = {
    primary: "text-primary bg-primary/10",
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
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    entityService
      .list<Project>(ENTITY_NAMES.project, { pagesize: 100, facets: "status" }, controller.signal)
      .then((r) => setProjects(r.data ?? []))
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (entityMissing(e)) setMissing(true);
      })
      .finally(() => setLoaded(true));
    return () => controller.abort();
  }, []);

  const active = projects.filter((p) => !["draft", "ready", "failed", "archived"].includes(p.status));
  const ready = projects.filter((p) => p.status === "ready").length;
  const failed = projects.filter((p) => p.status === "failed").length;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div>
      <p className="motion-safe:animate-fade-up text-[11px] uppercase tracking-widest text-primary-text">{today}</p>
      <h1 className="motion-safe:animate-fade-up mb-6 mt-2 font-display text-4xl font-semibold">
        {profile?.fn ? `Good day, ${profile.fn}` : "Good day"}
      </h1>

      {missing && <EntityNotConfigured entity={ENTITY_NAMES.project} />}

      <div className="hr mb-8" />
      <div className="mb-8 flex flex-col gap-3 sm:flex-row">
        <Stat label="In production" value={active.length} icon={Clapperboard} tone="primary" delay={80} />
        <Stat label="Published" value={ready} icon={CheckCircle2} tone="success" delay={140} />
        <Stat label="Failed" value={failed} icon={AlertTriangle} tone="destructive" delay={200} />
      </div>

      {active.length > 0 && (
        <>
          <h2 className="mb-3 font-display text-lg font-semibold">Now in production</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {loaded && !missing && active.length === 0 && (
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
