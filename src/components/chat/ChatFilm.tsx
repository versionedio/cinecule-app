import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clapperboard, ExternalLink, Play, RotateCcw } from "lucide-react";
import { entityService } from "@/services/entityService";
import { startPipeline } from "@/services/pipelineService";
import { ENTITY_NAMES, ExportAsset, GeneratedHtml, Project, ProjectStatus } from "@/config/entities";
import RenderProgress from "@/components/common/RenderProgress";
import { AssistantBubble, Typed, TypingDots } from "@/components/chat/Bubbles";
import { Button } from "@/components/ui/button";

const POLL_MS = 2500;
// Where each status sits in the pipeline; "failed" and "archived" sit outside it.
const ORDER: Record<string, number> = {
  draft: 0,
  generating_content: 1,
  generating_voice: 2,
  generating_direction: 3,
  ready_to_render: 4,
  rendering: 5,
  ready: 6
};

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
// A picture scene carries no text; name what it shows instead.
const pictureOf = (html: string) => html.match(/data-art="([^"]+)"/)?.[1]?.split(",").map((n) => n.trim()).join(" and ");

// Cut at a word boundary, never mid-word.
const snippet = (value: unknown, max = 96) => {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
};

/**
 * One film's progress, told as a conversation. Every message is derived from the project's status,
 * so it looks the same whether you watched it happen or reopened the page afterwards.
 */
export default function ChatFilm({ projectId, autoStart = false, onStatus }: { projectId: string; autoStart?: boolean; onStatus?: (projectId: string, status: ProjectStatus) => void }) {
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [slides, setSlides] = useState<GeneratedHtml[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoBroken, setVideoBroken] = useState(false);
  const [error, setError] = useState("");
  // A film made in this conversation starts by itself; an older draft only starts when asked.
  const [kicked, setKicked] = useState(false);
  const started = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = () =>
    entityService
      .get<Project>(ENTITY_NAMES.project, projectId)
      .then(setProject)
      .catch(() => undefined); // a missed poll just means the next one catches up

  useEffect(() => {
    load();
  }, [projectId]);

  const status = project?.status;
  const stage = status ? (ORDER[status] ?? -1) : -1;
  const failed = status === "failed";

  // Keep checking until the film is finished (or has failed).
  useEffect(() => {
    if (status === "ready" || status === "failed") return;
    const t = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(t);
  }, [projectId, status]);

  useEffect(() => {
    if (status) onStatus?.(projectId, status);
  }, [projectId, status, onStatus]);

  // Ingest runs per source and doesn't advance the project, so wait for every source before generating.
  const begin = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    try {
      await startPipeline(projectId, { signal: controller.signal });
      await load();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Couldn't start the pipeline.");
    }
  };

  useEffect(() => {
    if (status !== "draft" || started.current || !(autoStart || kicked)) return;
    started.current = true;
    begin();
  }, [status, autoStart, kicked]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // The scenes, once the storyboard exists (refreshed as the pipeline moves, since durations settle after the voiceover).
  useEffect(() => {
    if (stage < 2) return;
    entityService
      .listAll<GeneratedHtml>(ENTITY_NAMES.generatedHtml, { project_id: projectId })
      .then((rows) => setSlides(rows.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))))
      .catch(() => undefined);
  }, [projectId, stage]);

  useEffect(() => {
    if (status !== "ready") return;
    entityService
      .list<ExportAsset>(ENTITY_NAMES.exportAsset, { project_id: projectId, asset_type: "video", pagesize: 20 })
      .then((r) => {
        const ready = (r.data ?? []).filter((a) => a.cdn_url).sort((a, b) => (a.id < b.id ? 1 : -1));
        setVideoUrl(ready[0]?.cdn_url ?? "");
      })
      .catch(() => undefined);
  }, [projectId, status]);

  const setStatus = async (next: ProjectStatus) => {
    setError("");
    try {
      await entityService.update(ENTITY_NAMES.project, projectId, { status: next });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    }
  };

  const retry = async () => {
    started.current = false; // let the draft status start the pipeline again
    setKicked(true);
    await setStatus("draft");
  };

  const totalSeconds = slides.reduce((t, s) => t + (Number(s.duration) || 0), 0);

  return (
    <>
      {/* 1. Sources */}
      <AssistantBubble>
        {status === "draft" && !autoStart && !kicked ? (
          <>
            <p>
              <Typed key="idle" text="This film hasn't been started yet. Shall I begin?" />
            </p>
            <div className="mt-3">
              <Button onClick={() => setKicked(true)}>
                <Play className="h-4 w-4" />
                Start the film
              </Button>
            </div>
          </>
        ) : stage > 0 ? (
          <Typed key="sources-done" text="Got it. I've read everything you gave me." />
        ) : (
          <span className="flex items-center gap-2">
            <Typed key="sources" text="On it. Reading what you sent…" /> {!error && <TypingDots />}
          </span>
        )}
      </AssistantBubble>

      {/* 2. Storyboard */}
      {stage >= 1 && (
        <AssistantBubble>
          {stage === 1 ? (
            <span className="flex items-center gap-2">
              <Typed key="story" text="Writing the storyboard…" /> <TypingDots />
            </span>
          ) : (
            <>
              <p>
                <Typed key="story-done" text={slides.length ? `The storyboard is written: ${slides.length} scenes.` : "The storyboard is written."} />
              </p>
              {slides.length > 0 && (
                <ol className="mt-2 space-y-1.5 text-sm text-muted">
                  {slides.slice(0, 4).map((s, i) => (
                    <li key={s.id} className="chat-in flex gap-2" style={{ animationDelay: `${120 + i * 110}ms` }}>
                      <span className="tabular-nums text-primary-text">{i + 1}</span>
                      {String(s.narration_text ?? "").trim() ? (
                        <span>{snippet(s.narration_text)}</span>
                      ) : (
                        <span className="italic">{pictureOf(String(s.html_content ?? "")) ? `Picture of ${pictureOf(String(s.html_content ?? ""))}` : "A scene without narration"}</span>
                      )}
                    </li>
                  ))}
                  {slides.length > 4 && <li className="pl-5 text-xs">and {slides.length - 4} more…</li>}
                </ol>
              )}
            </>
          )}
        </AssistantBubble>
      )}

      {/* 3. Voice */}
      {stage >= 2 && (
        <AssistantBubble>
          {stage === 2 ? (
            <span className="flex items-center gap-2">
              <Typed key="voice" text="Recording the narration…" /> <TypingDots />
            </span>
          ) : (
            <Typed key="voice-done" text={totalSeconds > 0 ? `The narration is recorded. The film runs about ${clock(totalSeconds)}.` : "The narration is recorded."} />
          )}
        </AssistantBubble>
      )}

      {/* 4. Direction */}
      {stage >= 3 && (
        <AssistantBubble>
          {stage === 3 ? (
            <span className="flex items-center gap-2">
              <Typed key="dir" text="Planning the camera moves and effects…" /> <TypingDots />
            </span>
          ) : (
            <Typed key="dir-done" text="The camera moves and effects are planned." />
          )}
        </AssistantBubble>
      )}

      {/* 5. Review */}
      {stage >= 4 && (
        <AssistantBubble>
          <p>
            <Typed key="review" text={stage === 4 ? "Everything is in place. Shall I render your film?" : "Everything is in place. Rendering your film now."} />
          </p>
          {stage === 4 && (
            <div className="chat-in mt-3 flex flex-wrap gap-2" style={{ animationDelay: "700ms" }}>
              <Button onClick={() => setStatus("rendering")}>
                <Play className="h-4 w-4" />
                Render film
              </Button>
              <Button variant="outline" onClick={() => navigate(`/projects/${projectId}/storyboard`)}>
                <Clapperboard className="h-4 w-4" />
                Edit storyboard first
              </Button>
            </div>
          )}
        </AssistantBubble>
      )}

      {/* 6. Render progress */}
      {stage === 5 && (
        <AssistantBubble>
          <p className="mb-3">
            <Typed key="render" text="This takes a few minutes. You can leave this open and watch it come together." />
          </p>
          <RenderProgress projectId={projectId} onFinished={load} />
        </AssistantBubble>
      )}

      {/* 7. The film */}
      {stage === 6 && (
        <AssistantBubble>
          <p className="mb-3">
            <Typed key="ready" text="Your film is ready." />
          </p>
          {videoUrl && !videoBroken ? (
            <video className="chat-in w-full rounded-xl border border-white/15 bg-black" src={videoUrl} controls preload="metadata" onError={() => setVideoBroken(true)} />
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {videoUrl && (
              <a href={videoUrl} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm" tabIndex={-1}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open video
                </Button>
              </a>
            )}
            <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}/storyboard`)}>
              <Clapperboard className="h-3.5 w-3.5" />
              Storyboard editor
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted">Describe another film below to start the next one.</p>
        </AssistantBubble>
      )}

      {/* Problems */}
      {(failed || error) && (
        <AssistantBubble tone="error">
          <p>{error || "Something went wrong while making this film."}</p>
          <Button variant="destructive" size="sm" className="mt-3" onClick={retry}>
            <RotateCcw className="h-3.5 w-3.5" />
            Try again
          </Button>
        </AssistantBubble>
      )}
    </>
  );
}
