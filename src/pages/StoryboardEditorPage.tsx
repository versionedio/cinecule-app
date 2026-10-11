import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { entityService } from "@/services/entityService";
import {
  CameraShot, CanvasAspectRatio, CursorSpeed, CursorTimelinePoint,
  ENTITY_NAMES, GeneratedHtml, Interaction, Project, VideoEffectCue, interactionSelector
} from "@/config/entities";
import { CanvasFrame } from "@/components/storyboard/CanvasFrame";
import { SlidePreview } from "@/components/storyboard/SlidePreview";
import { SlideList } from "@/components/storyboard/SlideList";
import { InteractionInspector } from "@/components/storyboard/InteractionInspector";
import { CameraShotPanel } from "@/components/storyboard/CameraShotPanel";
import { EffectCuePanel } from "@/components/storyboard/EffectCuePanel";
import { CursorTimelinePanel } from "@/components/storyboard/CursorTimelinePanel";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, MousePointerClick } from "lucide-react";

const selectCls =
  "h-10 rounded-[4px] border border-border bg-transparent px-3 text-sm text-foreground focus-visible:outline-none focus-visible:border-primary";

export default function StoryboardEditorPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [slides, setSlides] = useState<GeneratedHtml[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [cameraShots, setCameraShots] = useState<CameraShot[]>([]);
  const [effectCues, setEffectCues] = useState<VideoEffectCue[]>([]);
  const [cursorPoints, setCursorPoints] = useState<CursorTimelinePoint[]>([]);
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null);
  const [focusedSelector, setFocusedSelector] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      entityService.get<Project>(ENTITY_NAMES.project, id),
      entityService.list<GeneratedHtml>(ENTITY_NAMES.generatedHtml, { project_id: id, pagesize: 200 }, controller.signal),
      entityService.list<Interaction>(ENTITY_NAMES.interaction, { project_id: id, pagesize: 500 }, controller.signal),
      entityService.list<CameraShot>(ENTITY_NAMES.cameraShot, { project_id: id, pagesize: 500 }, controller.signal),
      entityService.list<VideoEffectCue>(ENTITY_NAMES.videoEffectCue, { project_id: id, pagesize: 500 }, controller.signal),
      entityService.list<CursorTimelinePoint>(ENTITY_NAMES.cursorTimelinePoint, { project_id: id, pagesize: 500 }, controller.signal)
    ])
      .then(([proj, slideRes, interRes, shotRes, cueRes, pointRes]) => {
        setProject(proj);
        const sorted = (slideRes.data ?? []).sort((a, b) => a.sort_order - b.sort_order);
        setSlides(sorted);
        setActiveSlideId(sorted[0]?.id ?? null);
        setInteractions(interRes.data ?? []);
        setCameraShots(shotRes.data ?? []);
        setEffectCues(cueRes.data ?? []);
        setCursorPoints(pointRes.data ?? []);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Couldn't load the storyboard.");
      });
    return () => controller.abort();
  }, [id]);

  const activeSlide = slides.find((s) => s.id === activeSlideId) ?? null;
  const activeSlideStart = useMemo(() => {
    let t = 0;
    for (const s of slides) {
      if (s.id === activeSlideId) return t;
      t += s.duration ?? 6;
    }
    return 0;
  }, [slides, activeSlideId]);

  const slideInteractions = interactions.filter((i) => i.slide_id === activeSlideId);
  const slideCameraShots = cameraShots.filter((s) => s.slide_id === activeSlideId);
  const slideEffectCues = effectCues.filter((c) => c.slide_id === activeSlideId);
  const focusedInteraction = slideInteractions.find((i) => interactionSelector(i) === focusedSelector) ?? null;

  const updateProjectField = async (patch: Partial<Project>) => {
    if (!project) return;
    setProject({ ...project, ...patch });
    await entityService.update(ENTITY_NAMES.project, id, patch).catch((e) => setError(e instanceof Error ? e.message : "Save failed."));
  };

  // --- Slides ---
  const addSlide = async () => {
    const maxOrder = slides.reduce((m, s) => Math.max(m, s.sort_order), -1);
    const created = await entityService.create<GeneratedHtml>(ENTITY_NAMES.generatedHtml, {
      project_id: id,
      name: `Slide ${slides.length + 1}`,
      html_content: '<div class="flex h-full items-center justify-center p-16"><h1 class="text-4xl font-semibold">New slide</h1></div>',
      sort_order: maxOrder + 1,
      duration: 6,
      transition: "fade",
      transition_duration: 0.6
    });
    setSlides((prev) => [...prev, created]);
    setActiveSlideId(created.id);
  };

  const deleteSlide = async (slideId: string) => {
    await entityService.remove(ENTITY_NAMES.generatedHtml, slideId);
    setSlides((prev) => prev.filter((s) => s.id !== slideId));
    if (activeSlideId === slideId) setActiveSlideId(slides.find((s) => s.id !== slideId)?.id ?? null);
  };

  const reorderSlide = async (slideId: string, direction: "up" | "down") => {
    const idx = slides.findIndex((s) => s.id === slideId);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= slides.length) return;
    const a = slides[idx];
    const b = slides[swapIdx];
    const next = [...slides];
    next[idx] = { ...b, sort_order: a.sort_order };
    next[swapIdx] = { ...a, sort_order: b.sort_order };
    next.sort((x, y) => x.sort_order - y.sort_order);
    setSlides(next);
    await Promise.all([
      entityService.update(ENTITY_NAMES.generatedHtml, a.id, { sort_order: b.sort_order }),
      entityService.update(ENTITY_NAMES.generatedHtml, b.id, { sort_order: a.sort_order })
    ]).catch((e) => setError(e instanceof Error ? e.message : "Reorder failed."));
  };

  // --- Interactions ---
  const saveInteraction = async (data: Partial<Interaction>) => {
    if (!activeSlideId) return;
    if (data.id) {
      const updated = await entityService.update<Interaction>(ENTITY_NAMES.interaction, data.id, data);
      setInteractions((prev) => prev.map((i) => (i.id === data.id ? { ...i, ...updated } : i)));
    } else {
      const created = await entityService.create<Interaction>(ENTITY_NAMES.interaction, {
        ...data, project_id: id, slide_id: activeSlideId
      });
      setInteractions((prev) => [...prev, created]);
      setFocusedSelector(interactionSelector(created));
    }
  };

  const deleteInteraction = async (interactionId: string) => {
    await entityService.remove(ENTITY_NAMES.interaction, interactionId);
    setInteractions((prev) => prev.filter((i) => i.id !== interactionId));
    setFocusedSelector(null);
  };

  // --- Camera shots ---
  const createCameraShot = async (draft: Omit<CameraShot, "id" | "project_id" | "slide_id">) => {
    if (!activeSlideId) return;
    const created = await entityService.create<CameraShot>(ENTITY_NAMES.cameraShot, { ...draft, project_id: id, slide_id: activeSlideId });
    setCameraShots((prev) => [...prev, created]);
  };
  const updateCameraShot = async (shotId: string, patch: Partial<CameraShot>) => {
    setCameraShots((prev) => prev.map((s) => (s.id === shotId ? { ...s, ...patch } : s)));
    await entityService.update(ENTITY_NAMES.cameraShot, shotId, patch).catch(() => undefined);
  };
  const deleteCameraShot = async (shotId: string) => {
    await entityService.remove(ENTITY_NAMES.cameraShot, shotId);
    setCameraShots((prev) => prev.filter((s) => s.id !== shotId));
  };

  // --- Effect cues ---
  const createEffectCue = async (draft: Omit<VideoEffectCue, "id" | "project_id" | "slide_id">) => {
    if (!activeSlideId) return;
    const created = await entityService.create<VideoEffectCue>(ENTITY_NAMES.videoEffectCue, { ...draft, project_id: id, slide_id: activeSlideId });
    setEffectCues((prev) => [...prev, created]);
  };
  const updateEffectCue = async (cueId: string, patch: Partial<VideoEffectCue>) => {
    setEffectCues((prev) => prev.map((c) => (c.id === cueId ? { ...c, ...patch } : c)));
    await entityService.update(ENTITY_NAMES.videoEffectCue, cueId, patch).catch(() => undefined);
  };
  const deleteEffectCue = async (cueId: string) => {
    await entityService.remove(ENTITY_NAMES.videoEffectCue, cueId);
    setEffectCues((prev) => prev.filter((c) => c.id !== cueId));
  };

  // --- Cursor timeline ---
  const createCursorPoint = async () => {
    if (!activeSlideId) return;
    const created = await entityService.create<CursorTimelinePoint>(ENTITY_NAMES.cursorTimelinePoint, {
      project_id: id, slide_id: activeSlideId, time: activeSlideStart, x_percent: 50, y_percent: 50,
      duration_ms: 800, source: "manual"
    });
    setCursorPoints((prev) => [...prev, created]);
  };
  const updateCursorPoint = async (pointId: string, patch: Partial<CursorTimelinePoint>) => {
    setCursorPoints((prev) => prev.map((p) => (p.id === pointId ? { ...p, ...patch } : p)));
    await entityService.update(ENTITY_NAMES.cursorTimelinePoint, pointId, patch).catch(() => undefined);
  };
  const deleteCursorPoint = async (pointId: string) => {
    await entityService.remove(ENTITY_NAMES.cursorTimelinePoint, pointId);
    setCursorPoints((prev) => prev.filter((p) => p.id !== pointId));
  };

  if (!project) return <p className="text-muted">{error || "Loading…"}</p>;

  return (
    <div className="grid h-[calc(100vh-64px-2rem)] grid-cols-[240px_1fr_320px] gap-3">
      <div className="rounded-[4px] border border-border">
        <SlideList
          slides={slides}
          activeSlideId={activeSlideId}
          onSelect={(sid) => { setActiveSlideId(sid); setFocusedSelector(null); }}
          onReorder={reorderSlide}
          onAdd={addSlide}
          onDelete={deleteSlide}
        />
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${id}`)}>
            <ArrowLeft className="h-4 w-4" />
            Back to project
          </Button>
          <div className="flex items-center gap-2">
            <Field label="Aspect">
              <select
                className={selectCls}
                value={project.canvas_aspect_ratio}
                onChange={(e) => updateProjectField({ canvas_aspect_ratio: e.target.value as CanvasAspectRatio })}
              >
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
                <option value="custom">Custom</option>
              </select>
            </Field>
            <Field label="Cursor speed">
              <select
                className={selectCls}
                value={project.cursor_speed ?? "average"}
                onChange={(e) => updateProjectField({ cursor_speed: e.target.value as CursorSpeed })}
              >
                <option value="slow">Slow</option>
                <option value="average">Average</option>
                <option value="fast">Fast</option>
              </select>
            </Field>
            <Button
              size="sm"
              variant={selectionMode ? "default" : "outline"}
              onClick={() => setSelectionMode((v) => !v)}
            >
              <MousePointerClick className="h-4 w-4" />
              {selectionMode ? "Selecting…" : "Select element"}
            </Button>
          </div>
        </div>

        {activeSlide ? (
          <CanvasFrame
            aspectRatio={project.canvas_aspect_ratio}
            customWidth={project.custom_canvas_width}
            customHeight={project.custom_canvas_height}
          >
            <SlidePreview
              slide={activeSlide}
              interactions={slideInteractions}
              activeInteractionIds={slideInteractions.map((i) => i.id)}
              focusedSelector={focusedSelector}
              selectionMode={selectionMode}
              onElementSelected={({ selector }) => { setFocusedSelector(selector); setSelectionMode(false); }}
            />
          </CanvasFrame>
        ) : (
          <p className="text-muted">Add a slide to start editing.</p>
        )}

        {activeSlide && (
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Field label="Duration (s)">
              <Input
                type="number" step={0.1} value={activeSlide.duration}
                onChange={(e) => {
                  const duration = Number(e.target.value);
                  setSlides((prev) => prev.map((s) => (s.id === activeSlide.id ? { ...s, duration } : s)));
                }}
                onBlur={(e) => entityService.update(ENTITY_NAMES.generatedHtml, activeSlide.id, { duration: Number(e.target.value) })}
              />
            </Field>
            <Field label="Transition">
              <select
                className={selectCls}
                value={activeSlide.transition}
                onChange={(e) => {
                  const transition = e.target.value as GeneratedHtml["transition"];
                  setSlides((prev) => prev.map((s) => (s.id === activeSlide.id ? { ...s, transition } : s)));
                  entityService.update(ENTITY_NAMES.generatedHtml, activeSlide.id, { transition });
                }}
              >
                {["fade", "slide-left", "slide-right", "zoom-in", "zoom-out", "flip", "none"].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Transition length (s)">
              <Input
                type="number" step={0.1} value={activeSlide.transition_duration}
                onChange={(e) => {
                  const transition_duration = Number(e.target.value);
                  setSlides((prev) => prev.map((s) => (s.id === activeSlide.id ? { ...s, transition_duration } : s)));
                }}
                onBlur={(e) => entityService.update(ENTITY_NAMES.generatedHtml, activeSlide.id, { transition_duration: Number(e.target.value) })}
              />
            </Field>
          </div>
        )}

        {error && <p className="text-sm text-destructive-text">{error}</p>}

        {activeSlide && (
          <Tabs defaultValue="shots">
            <TabsList>
              <TabsTrigger value="shots">Camera shots</TabsTrigger>
              <TabsTrigger value="effects">Effect cues</TabsTrigger>
              <TabsTrigger value="cursor">Cursor timeline</TabsTrigger>
            </TabsList>
            <TabsContent value="shots">
              <CameraShotPanel shots={slideCameraShots} onCreate={createCameraShot} onUpdate={updateCameraShot} onDelete={deleteCameraShot} />
            </TabsContent>
            <TabsContent value="effects">
              <EffectCuePanel cues={slideEffectCues} onCreate={createEffectCue} onUpdate={updateEffectCue} onDelete={deleteEffectCue} />
            </TabsContent>
            <TabsContent value="cursor">
              <CursorTimelinePanel points={cursorPoints} activeSlideId={activeSlideId} onCreate={createCursorPoint} onUpdate={updateCursorPoint} onDelete={deleteCursorPoint} />
            </TabsContent>
          </Tabs>
        )}
      </div>

      <div className="rounded-[4px] border border-border">
        <InteractionInspector
          focusedSelector={focusedSelector}
          interaction={focusedInteraction}
          onSave={saveInteraction}
          onDelete={deleteInteraction}
          onFocus={setFocusedSelector}
          slideInteractions={slideInteractions}
        />
      </div>
    </div>
  );
}
