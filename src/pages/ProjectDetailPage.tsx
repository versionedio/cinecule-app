import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Clapperboard, Play, RotateCcw } from "lucide-react";
import { entityService } from "@/services/entityService";
import { startPipeline } from "@/services/pipelineService";
import { ENTITY_NAMES, ExportAsset, Project, STAGE_LOADING_MESSAGES } from "@/config/entities";
import PipelineTimeline from "@/components/common/PipelineTimeline";
import StatusChip from "@/components/common/StatusChip";
import RenderProgress from "@/components/common/RenderProgress";
import { entityMissing } from "@/components/common/EntityGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";

interface ChildRow {
  id: string;
  [key: string]: unknown;
}

function ChildTable({ entity, projectId, columns }: {
  entity: string;
  projectId: string;
  columns: { key: string; label: string }[];
}) {
  const [rows, setRows] = useState<ChildRow[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    // Field-filtered list: GET /list/{entity}?project_id={id} — snake_case,
    // matching the real saved field name (confirmed via the API Studio test console).
    entityService
      .list<ChildRow>(entity, { project_id: projectId, pagesize: 100 })
      .then((r) => setRows(r.data ?? []))
      .catch((e) =>
        setNote(entityMissing(e) ? `The "${entity}" entity isn't set up yet.` : "Couldn't load records.")
      );
  }, [entity, projectId]);

  if (note) return <p className="p-4 text-sm text-muted">{note}</p>;
  if (rows.length === 0)
    return <p className="p-4 text-sm text-muted">Nothing here yet — records appear as the pipeline runs.</p>;

  return (
    <Table>
      <TableHead>
        <TableRow>
          {columns.map((c) => (
            <TableHeadCell key={c.key}>{c.label}</TableHeadCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            {columns.map((c) => (
              <TableCell key={c.key}>{String(r[c.key] ?? "—")}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function ProjectDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [project, setProject] = useState<Project | null>(null);
  const [videoAsset, setVideoAsset] = useState<ExportAsset | null>(null);
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const autoStarted = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = () =>
    entityService
      .get<Project>(ENTITY_NAMES.project, id)
      .then(setProject)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load project."));

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    // Only poll while a stage is actively running — once the pipeline lands on
    // a terminal status (draft/ready/failed/archived) there's nothing left to
    // wait on, so stop hitting the API.
    if (!project || !STAGE_LOADING_MESSAGES[project.status]) return;
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [id, project?.status]);

  useEffect(() => {
    if (project?.status !== "ready") return;
    entityService
      .list<ExportAsset>(ENTITY_NAMES.exportAsset, { project_id: id, asset_type: "video", pagesize: 1 })
      .then((r) => setVideoAsset(r.data?.[0] ?? null))
      .catch(() => undefined);
  }, [project?.status, id]);

  const setStatus = async (status: string) => {
    setError("");
    try {
      await entityService.update(ENTITY_NAMES.project, id, { status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    }
  };

  // Ingest runs per source and no longer advances the project, so wait for
  // every source to finish (bounded by a timeout) before starting generation.
  const beginPipeline = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setPreparing(true);
    try {
      await startPipeline(id, { signal: controller.signal });
      await load();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Couldn't start the pipeline.");
    } finally {
      if (abortRef.current === controller) setPreparing(false);
    }
  };

  // Arriving from the new-project page: start automatically, once. Clearing
  // the router state stops a page refresh from re-triggering it.
  useEffect(() => {
    const autoStart = (location.state as { autoStart?: boolean } | null)?.autoStart;
    if (!autoStart || autoStarted.current || project?.status !== "draft") return;
    autoStarted.current = true;
    navigate(location.pathname, { replace: true, state: null });
    beginPipeline();
  }, [project?.status]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!project) return <p className="text-muted">{error || "Loading…"}</p>;

  return (
    <div>
      <div className="mb-3 flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <h1 className="font-display text-2xl font-semibold">{project.name}</h1>
        <div className="flex items-center gap-2">
          <StatusChip status={project.status} />
          {project.status === "draft" && (
            <Button onClick={beginPipeline} disabled={preparing}>
              <Play className="h-4 w-4" />
              {preparing ? "Preparing…" : "Start pipeline"}
            </Button>
          )}
          {project.status === "ready_to_render" && (
            <Button onClick={() => setStatus("rendering")}>
              <Play className="h-4 w-4" />
              Render now
            </Button>
          )}
          {project.status === "failed" && (
            <Button variant="destructive" onClick={() => setStatus("draft")}>
              <RotateCcw className="h-4 w-4" />
              Retry from start
            </Button>
          )}
          {project.status !== "draft" && (
            <Button variant="outline" onClick={() => navigate(`/projects/${id}/storyboard`)}>
              <Clapperboard className="h-4 w-4" />
              Storyboard editor
            </Button>
          )}
        </div>
      </div>

      <PipelineTimeline status={project.status} />

      {preparing && project.status === "draft" && (
        <div className="mt-3 flex items-center gap-2">
          <Spinner />
          <p className="text-sm text-muted">Reading your sources…</p>
        </div>
      )}

      {project.status === "rendering" && (
        <div className="mt-3">
          <RenderProgress projectId={id} onFinished={load} />
        </div>
      )}

      {project.status !== "rendering" && STAGE_LOADING_MESSAGES[project.status] && (
        <div className="mt-3 flex items-center gap-2">
          <Spinner />
          <p className="text-sm text-muted">{STAGE_LOADING_MESSAGES[project.status]}</p>
        </div>
      )}

      {videoAsset && videoAsset.cdn_url && (
        <Alert severity="success" className="mt-4">
          Final video ready —{" "}
          <a className="text-primary-text underline" href={videoAsset.cdn_url} target="_blank" rel="noreferrer">
            open video
          </a>
        </Alert>
      )}
      {error && (
        <Alert severity="error" className="mt-4">
          {error}
        </Alert>
      )}

      <Card className="mt-6">
        <Tabs defaultValue="slides">
          <TabsList>
            <TabsTrigger value="slides">Slides</TabsTrigger>
            <TabsTrigger value="voiceover">Voiceover</TabsTrigger>
            <TabsTrigger value="video">Final Video</TabsTrigger>
          </TabsList>
          <TabsContent value="slides">
            <ChildTable
              entity={ENTITY_NAMES.generatedHtml}
              projectId={id}
              columns={[
                { key: "sort_order", label: "#" },
                { key: "created_at", label: "Created" },
                { key: "duration", label: "Duration (s)" },
                { key: "transition", label: "Transition" },
                { key: "narration_text", label: "Narration (preview)" }
              ]}
            />
          </TabsContent>
          <TabsContent value="voiceover">
            <ChildTable
              entity={ENTITY_NAMES.voiceover}
              projectId={id}
              columns={[
                { key: "created_at", label: "Created" },
                { key: "slide_id", label: "Slide" },
                { key: "voice_style", label: "Voice Style" },
                { key: "audio_file", label: "Audio" }
              ]}
            />
          </TabsContent>
          <TabsContent value="video">
            <ChildTable
              entity={ENTITY_NAMES.exportAsset}
              projectId={id}
              columns={[
                { key: "created_at", label: "Created" },
                { key: "asset_type", label: "Type" },
                { key: "status", label: "Status" },
                { key: "cdn_url", label: "URL" }
              ]}
            />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
