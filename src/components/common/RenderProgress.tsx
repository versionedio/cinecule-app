import { useEffect, useRef, useState } from "react";
import { entityService } from "@/services/entityService";
import { RotateCw } from "lucide-react";
import { latestRenders, retryRender, shapeName } from "@/services/renderService";
import { Button } from "@/components/ui/button";
import { ENTITY_NAMES, ExportAsset, GeneratedHtml } from "@/config/entities";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const POLL_MS = 3000;
const STALL_AFTER_MS = 120_000;
// A queued render normally starts within a minute or two (the platform starts the render workflow
// as soon as it is queued). If it still hasn't STARTED after this long, the request probably never reached
// a worker, so the person gets a Retry button. (This is about starting, not finishing: a render that is
// under way can take as long as it needs.)
const SLOW_START_MS = 5 * 60_000;

// Record ids are <3-letter prefix><base36 ms timestamp><1 char>, so an id tells us when the asset was queued.
function queuedAtMs(id: string | undefined): number {
  const ms = id ? parseInt(id.slice(3, -1), 36) : NaN;
  return ms > 1.5e12 && ms < 4e12 ? ms : NaN;
}

/** "about 2 min 10 s", "less than a minute", "a few seconds". */
export function formatEta(seconds: number): string {
  if (seconds <= 5) return "a few seconds";
  if (seconds < 60) return "less than a minute";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `about ${m} min${s >= 5 ? ` ${s} s` : ""}`;
}

// Measured on real GitHub runs (keep in step with scripts/render/render.mjs): a 1080p, 30 fps frame takes
// about 0.07 s to draw and capture, so a film takes roughly twice its own length to render, plus the
// worker starting up (checkout, install, browser, build), pictures when it has picture scenes, and finishing.
const SETUP_SEC = 150;
const PER_FRAME_SEC = 0.07;
const PICTURES_SEC = 60;
const FINISH_SEC = 60;

function estimateRenderSeconds(videoSeconds: number, opts: { fps?: number; resolution?: string; hasPictures?: boolean } = {}): number {
  const [w, h] = String(opts.resolution ?? "1920x1080").split("x").map(Number);
  const scale = w > 0 && h > 0 ? (w * h) / (1920 * 1080) : 1;
  const frames = videoSeconds * (opts.fps || 30);
  return Math.round(SETUP_SEC + (opts.hasPictures ? PICTURES_SEC : 0) + frames * PER_FRAME_SEC * scale + FINISH_SEC);
}

/** "about 6 to 9 minutes": an honest range around the estimate, since runner speed varies. */
function formatRange(seconds: number): string {
  const lo = Math.max(1, Math.round((seconds * 0.85) / 60));
  const hi = Math.max(lo + 1, Math.round((seconds * 1.3) / 60));
  return `about ${lo} to ${hi} minutes`;
}

interface Snapshot {
  /** The render being shown: the one under way, else the next in line, else the newest. */
  asset: ExportAsset | null;
  /** How many videos this render makes (one per chosen shape), and which of them `asset` is, counting from 1. */
  total: number;
  position: number;
  receivedAt: number;
  // When progress last moved, to tell a slow render from a stuck one.
  changedAt: number;
}

export default function RenderProgress({
  projectId,
  compact = false,
  onFinished
}: {
  projectId: string;
  compact?: boolean;
  /** Called once when the render reaches "ready" or "failed", so the page can refresh the project. */
  onFinished?: () => void;
}) {
  const [snap, setSnap] = useState<Snapshot>(() => ({ asset: null, total: 0, position: 0, receivedAt: Date.now(), changedAt: Date.now() }));
  const [now, setNow] = useState(() => Date.now());
  const [videoSeconds, setVideoSeconds] = useState(0);
  const [hasPictures, setHasPictures] = useState(false);
  // Retrying a render that never started: when it was last asked, so the 5 minutes begin again after each try.
  const [lastTry, setLastTry] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryNote, setRetryNote] = useState("");
  const finished = useRef(false);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  // Poll the newest video asset for this project.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const res = await entityService.list<ExportAsset>(
          ENTITY_NAMES.exportAsset,
          { project_id: projectId, asset_type: "video", pagesize: 20 },
          controller.signal
        );
        if (cancelled) return;
        // A film rendered in more than one shape has one render per shape, taken one after the other.
        const batch = latestRenders(res.data ?? []);
        const running = batch.find((a) => a.status === "processing");
        const waiting = batch.filter((a) => a.status === "created");
        const finishedOnes = batch.filter((a) => a.status === "ready" || a.status === "failed");
        // Between two videos the next one is queued for a moment. That is progress, not a stuck queue, so it is
        // shown as a render that is starting rather than as one waiting for a worker.
        const latest: ExportAsset | null =
          running ?? (waiting.length && finishedOnes.length ? { ...waiting[0], status: "processing", stage: "Getting the next video ready", progress_pct: 0, eta_sec: undefined } : waiting[0] ?? batch[batch.length - 1] ?? null);
        const total = batch.length;
        const position = latest ? batch.findIndex((a) => a.id === latest.id) + 1 : 0;
        setSnap((prev) => {
          const moved = !prev.asset || prev.asset.id !== latest?.id || prev.asset.progress_pct !== latest?.progress_pct || prev.asset.stage !== latest?.stage || prev.asset.status !== latest?.status;
          // The countdown runs from when the estimate last CHANGED. Resetting it on every poll would snap it
          // back up every few seconds while the estimate is unchanged.
          const sameEstimate = prev.asset?.id === latest?.id && prev.asset?.eta_sec === latest?.eta_sec && prev.asset?.stage === latest?.stage;
          return { asset: latest, total, position, receivedAt: sameEstimate ? prev.receivedAt : Date.now(), changedAt: moved ? Date.now() : prev.changedAt };
        });
        // Done only when every video in the batch has finished.
        if (total > 0 && finishedOnes.length === total && !finished.current) {
          finished.current = true;
          onFinishedRef.current?.();
        }
      } catch {
        /* a missed poll just means the next one catches up */
      }
    };
    poll();
    const t = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(t);
    };
  }, [projectId]);

  // One-second tick so the countdown moves between polls.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Video length, for the pre-start estimate (full view only).
  useEffect(() => {
    if (compact) return;
    entityService
      .listAll<GeneratedHtml>(ENTITY_NAMES.generatedHtml, { project_id: projectId })
      .then((slides) => {
        setVideoSeconds(slides.reduce((t, s) => t + (Number(s.duration) || 0), 0));
        setHasPictures(slides.some((s) => /data-(?:art|image-source)\s*=\s*["']/.test(String(s.html_content ?? ""))));
      })
      .catch(() => undefined);
  }, [projectId, compact]);

  const asset = snap.asset;
  const queued = !asset || asset.status === "created";
  const pct = Math.max(0, Math.min(100, Number(asset?.progress_pct) || 0));
  // "Starting" is the moment the worker claims the render, before it has even looked at the film. Any time written then
  // is a guess (older workers wrote a flat 150 s), so no countdown is shown until the render reports a real one.
  const etaLeft =
    asset?.eta_sec != null && asset.stage !== "Starting" ? Math.max(0, Number(asset.eta_sec) - (now - snap.receivedAt) / 1000) : null;
  const stalled = !queued && asset?.status === "processing" && now - snap.changedAt > STALL_AFTER_MS;

  if (queued) {
    // After a retry the wait starts over, so the button only comes back if that try didn't get it started either.
    const waitedMs = asset ? now - Math.max(queuedAtMs(asset.id), lastTry ?? 0) : 0;
    const slowStart = Number.isFinite(waitedMs) && waitedMs > SLOW_START_MS;
    const retry = async () => {
      setRetrying(true);
      setRetryNote("");
      try {
        const sent = await retryRender(projectId);
        setLastTry(Date.now());
        setRetryNote(sent ? "Asked the render worker to start again. Give it a minute or two." : "Nothing to retry: it may have just started.");
      } catch {
        setRetryNote("Couldn't send that. Please try again in a minute.");
      } finally {
        setRetrying(false);
      }
    };
    const estimate =
      videoSeconds > 0
        ? ` In total, a ${Math.round(videoSeconds)}-second film usually takes ${formatRange(estimateRenderSeconds(videoSeconds, { fps: Number(asset?.frame_rate) || 30, resolution: asset?.resolution, hasPictures }))}.`
        : "";
    return compact ? (
      <p className="flex items-center gap-2 text-xs text-muted">
        <Spinner /> {slowStart ? "Still waiting for a render worker" : "Starting the render"}
        {slowStart && (
          <button type="button" onClick={retry} disabled={retrying} className="text-primary-text underline underline-offset-2 disabled:opacity-50">
            {retrying ? "Retrying…" : "Retry"}
          </button>
        )}
        {retryNote && !slowStart && <span role="status">{retryNote}</span>}
      </p>
    ) : (
      <div role="status" className="rounded-[4px] border border-border bg-surface-raised p-4">
        <p className="flex items-center gap-2 font-medium"><Spinner /> {slowStart ? "Still waiting for a render worker" : "Starting the render"}</p>
        <p className="mt-1 text-sm text-muted">
          {slowStart
            ? "This is taking longer than usual to start. It may not have been picked up. Press Retry to ask again."
            : "Your video is queued and should start within a minute or two."}
          {estimate}
        </p>
        {(slowStart || retryNote) && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {slowStart && (
              <Button size="sm" variant="outline" onClick={retry} disabled={retrying}>
                {retrying ? <Spinner /> : <RotateCw className="h-3.5 w-3.5" />}
                {retrying ? "Retrying…" : "Retry"}
              </Button>
            )}
            {retryNote && <span className="text-sm text-muted" role="status">{retryNote}</span>}
          </div>
        )}
      </div>
    );
  }

  // With several videos, say which one this is: "Rendering" -> "Rendering · Vertical 9:16 (2 of 2)".
  const which = snap.total > 1 ? ` · ${shapeName(asset?.aspect_ratio) || "Video"} (${snap.position} of ${snap.total})` : "";
  const stage = `${asset?.stage || "Rendering"}${which}`;
  const remaining = etaLeft == null ? "" : etaLeft < 2 ? "finishing up" : `${formatEta(etaLeft)} left`;

  const bar = (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label="Render progress"
      className={cn("w-full overflow-hidden rounded-full bg-surface-raised", compact ? "h-1.5" : "h-2.5")}
    >
      <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
    </div>
  );

  if (compact) {
    return (
      <div className="mt-2">
        {bar}
        <p className="mt-1 flex justify-between text-xs text-muted">
          <span>{stage} · {Math.round(pct)}%</span>
          <span>{remaining}</span>
        </p>
      </div>
    );
  }

  return (
    <div role="status" className="rounded-[4px] border border-border bg-surface-raised p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="font-medium">{stage}</p>
        <p className="tabular-nums text-sm text-muted">{Math.round(pct)}%</p>
      </div>
      {bar}
      <p className="mt-2 text-sm text-muted">
        {remaining || "Estimating time left…"}
        {asset?.resolution ? ` · ${asset.resolution}${asset.frame_rate ? ` @ ${asset.frame_rate} fps` : ""}` : ""}
      </p>
      {stalled && (
        <p className="mt-2 text-sm text-destructive-text">
          This is taking longer than usual. It may have stalled; if it doesn't move soon, try again.
        </p>
      )}
    </div>
  );
}
