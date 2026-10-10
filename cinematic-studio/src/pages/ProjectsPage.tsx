import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { entityService } from "../services/entityService";
import { ENTITY_NAMES, Project } from "../config/entities";
import PipelineTimeline from "../components/PipelineTimeline";
import StatusChip from "../components/StatusChip";
import EntityNotConfigured, { entityMissing } from "../components/EntityGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");

  const load = async (signal?: AbortSignal) => {
    try {
      // /list/project with no `by` param returns only the signed-in user's own records.
      const res = await entityService.list<Project>(ENTITY_NAMES.project, { pagesize: 50 }, signal);
      setProjects(res.data ?? []);
      setMissing(false);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (entityMissing(e)) setMissing(true);
      else setError(e instanceof Error ? e.message : "Failed to load projects.");
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Projects</h1>
        <Button onClick={() => navigate("/projects/new")}>
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </div>

      {missing && <EntityNotConfigured entity={ENTITY_NAMES.project} />}
      {error && <p className="mb-4 text-sm text-destructive-text">{error}</p>}

      {!missing && projects.length === 0 && (
        <p className="text-muted">No projects yet. Add a content source, and the pipeline takes it from there.</p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((p, i) => (
          <Card
            key={p.id}
            className="motion-safe:animate-fade-up cursor-pointer transition-colors hover:border-primary/50"
            style={{ animationDelay: `${i * 50}ms` }}
            onClick={() => navigate(`/projects/${p.id}`)}
          >
            <CardContent>
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <p className="truncate font-display font-semibold">{p.name}</p>
                <StatusChip status={p.status} />
              </div>
              <PipelineTimeline status={p.status} compact />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
