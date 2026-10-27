import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clapperboard, ExternalLink, Play, RotateCcw } from "lucide-react";
import { entityService } from "@/services/entityService";
import { startPipeline } from "@/services/pipelineService";
import { ENTITY_NAMES, ExportAsset, GeneratedHtml, Project, ProjectStatus } from "@/config/entities";
import RenderProgress from "@/components/common/RenderProgress";
import { AssistantBubble, Typed, TypingDots, UserBubble } from "@/components/chat/Bubbles";
import DesignChoicesCard from "@/components/chat/DesignChoicesCard";
import { DesignChoices, chosenFormats, designChoicesSummary, designChoicesText, formatOf, renderRatiosText } from "@/render/theme";
import { voiceById } from "@/config/voices";
import { Button } from "@/components/ui/button";
import { updateRecord } from "@/services/secureWriteService";
import { latestRenders, shapeName } from "@/services/renderService";

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
  // The finished videos of the latest render: one per shape chosen (a single one for most films).
  const [videos, setVideos] = useState<{ id: string; url: string; ratio?: string }[]>([]);
  // Shapes of the latest render that did not finish. The film's status only says how the LAST video ended, so
  // it can't be trusted to tell "all done" from "one done, one failed".
  const [failedShapes, setFailedShapes] = useState<string[]>([]);
  const [brokenVideos, setBrokenVideos] = useState<string[]>([]);
  const [error, setError] = useState("");
  // A film made in this conversation starts by itself; an older draft only starts when asked.
  const [kicked, setKicked] = useState(false);
  // A film made in this conversation first asks how it should look; answering (or skipping) starts it.
  const [designDone, setDesignDone] = useState(false);
  const [savingDesign, setSavingDesign] = useState(false);
  // What was picked, shown back as the person's own message. It is read-only, and kept in this browser so it is
  // still there if the page is reloaded while the film is made.
  const [picked, setPicked] = useState<string>(() => {
    try {
      return localStorage.getItem(`cinecule.design.${projectId}`) ?? "";
    } catch {
      return "";
    }
  });
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
    if (status !== "draft" || started.current || !((autoStart && designDone) || kicked)) return;
    started.current = true;
    begin();
  }, [status, autoStart, kicked, designDone]);

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
    if (status !== "ready" && status !== "failed") return;
    entityService
      .list<ExportAsset>(ENTITY_NAMES.exportAsset, { project_id: projectId, asset_type: "video", pagesize: 20 })
      .then((r) => {
        const batch = latestRenders(r.data ?? []);
        setVideos(
          batch
            .filter((a) => a.status === "ready" && a.cdn_url)
            .map((a) => ({ id: a.id, url: a.cdn_url as string, ratio: a.aspect_ratio }))
        );
        setFailedShapes(batch.filter((a) => a.status === "failed").map((a) => shapeName(a.aspect_ratio) || "video"));
      })
      .catch(() => undefined);
  }, [projectId, status]);

  const setStatus = async (next: ProjectStatus) => {
    setError("");
    try {
      await updateRecord(ENTITY_NAMES.project, projectId, { status: next });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    }
  };

  // The choices travel to the storyboard step as text on the project (its existing article field).
  const submitDesign = async (choices: DesignChoices | null) => {
    setSavingDesign(true);
    const text = choices ? designChoicesText(choices) : "";
    try {
      // The shape of the picture is a field on the project, so the renderer and the storyboard step both see it.
      const patch: Record<string, unknown> = {};
      if (text) patch.article_content = text;
      if (choices) patch.canvas_aspect_ratio = formatOf(choices.format).ratio;
      // More than one shape chosen: the backend makes one video per shape in this list (empty means just the one above).
      if (choices && chosenFormats(choices).length > 1) patch.render_aspect_ratios = renderRatiosText(choices);
      // The chosen narrator is saved on the film; no choice leaves it blank, which means the standard voice.
      if (choices && choices.voice !== "decide") patch.voice_id = choices.voice;
      if (Object.keys(patch).length) await updateRecord(ENTITY_NAMES.project, projectId, patch);
    } catch (e) {
      console.warn("[chat] couldn't save the design choices; the film will be styled automatically", e);
    }
    const summary = choices ? designChoicesSummary(choices, voiceById(choices.voice)?.name) : "Skip, you decide";
    setPicked(summary);
    try {
      localStorage.setItem(`cinecule.design.${projectId}`, summary);
    } catch {
      // Remembering it is a convenience; the chat still shows it for this visit.
    }
    setSavingDesign(false);
    setDesignDone(true);
  };

  const asking = autoStart && status === "draft" && !designDone && !kicked;

  const retry = async () => {
    started.current = false; // let the draft status start the pipeline again
    setKicked(true);
    await setStatus("draft");
  };

  // Some videos finished and some did not: show the ones that did, and say plainly which did not.
  const partial = videos.length > 0 && failedShapes.length > 0;
  const showFilm = stage === 6 || (failed && videos.length > 0);

  const totalSeconds = slides.reduce((t, s) => t + (Number(s.duration) || 0), 0);

  return (
    <>
      {/* 1. Sources */}
      <AssistantBubble>
        {asking ? (
          <>
            <p>
              <Typed key="design" text="Got it. Before I start, how should it look? Pick what you like, or skip and I'll decide." />
            </p>
            <DesignChoicesCard onSubmit={submitDesign} onSkip={() => submitDesign(null)} busy={savingDesign} />
          </>
        ) : status === "draft" && !autoStart && !kicked ? (
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

      {/* The choices, as the person's own message */}
      {picked && !asking && <UserBubble text={picked} />}

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
      {showFilm && (
        <AssistantBubble>
          <p className="mb-3">
            <Typed
              key={partial ? "partial" : "ready"}
              text={partial ? `${videos.length === 1 ? "One video is ready" : "Some videos are ready"}, but the ${failedShapes.join(" and ")} video didn't finish.` : "Your film is ready."}
            />
          </p>
          {videos.map((v) => (
            <div key={v.id} className="mb-3">
              {videos.length > 1 && shapeName(v.ratio) && <p className="mb-1.5 text-xs uppercase tracking-widest text-muted">{shapeName(v.ratio)}</p>}
              {!brokenVideos.includes(v.id) && (
                <video
                  className="chat-in w-full rounded-xl border border-white/15 bg-black"
                  style={{ maxHeight: v.ratio === "9:16" ? "70vh" : undefined }}
                  src={v.url}
                  controls
                  preload="metadata"
                  onError={() => setBrokenVideos((b) => [...b, v.id])}
                />
              )}
              <a href={v.url} target="_blank" rel="noreferrer" className="mt-2 inline-block">
                <Button variant="outline" size="sm" tabIndex={-1}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  {videos.length > 1 && shapeName(v.ratio) ? `Open ${shapeName(v.ratio)}` : "Open video"}
                </Button>
              </a>
            </div>
          ))}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}/storyboard`)}>
              <Clapperboard className="h-3.5 w-3.5" />
              Storyboard editor
            </Button>
          </div>
          {partial ? (
            <p className="mt-3 text-sm text-muted">You can render the missing video again from the storyboard editor.</p>
          ) : (
            <p className="mt-3 text-sm text-muted">Describe another film below to start the next one.</p>
          )}
        </AssistantBubble>
      )}

      {/* Problems */}
      {(failed || error) && !(failed && !error && partial) && (
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
