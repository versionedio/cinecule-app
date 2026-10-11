import { useEffect, useRef, useState } from "react";
import { entityService } from "@/services/entityService";
import { ENTITY_NAMES, ExportAsset, GeneratedHtml } from "@/config/entities";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const POLL_MS = 3000;
const STALL_AFTER_MS = 120_000;
// A queued render normally starts within a minute or two (the platform starts the render workflow
// as soon as it is queued). Past this, dispatch probably missed and the hourly safety check will pick it up.
const SLOW_START_MS = 4 * 60_000;

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

// Rendering takes roughly as long as the video plays, plus startup and encoding.
const estimateRenderSeconds = (videoSeconds: number) => Math.round(videoSeconds * 1.1 + 40);

interface Snapshot {
  asset: ExportAsset | null;
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
  const [snap, setSnap] = useState<Snapshot>({ asset: null, receivedAt: Date.now(), changedAt: Date.now() });
  const [now, setNow] = useState(Date.now());
  const [videoSeconds, setVideoSeconds] = useState(0);
  const finished = useRef(false);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

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
        // Record ids grow with time, so the highest id is the latest render.
        const latest = (res.data ?? []).slice().sort((a, b) => (a.id < b.id ? 1 : -1))[0] ?? null;
        setSnap((prev) => {
          const moved = !prev.asset || prev.asset.id !== latest?.id || prev.asset.progress_pct !== latest?.progress_pct || prev.asset.stage !== latest?.stage || prev.asset.status !== latest?.status;
          return { asset: latest, receivedAt: Date.now(), changedAt: moved ? Date.now() : prev.changedAt };
        });
        if (latest && (latest.status === "ready" || latest.status === "failed") && !finished.current) {
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
      .then((slides) => setVideoSeconds(slides.reduce((t, s) => t + (Number(s.duration) || 0), 0)))
      .catch(() => undefined);
  }, [projectId, compact]);

  const asset = snap.asset;
  const queued = !asset || asset.status === "created";
  const pct = Math.max(0, Math.min(100, Number(asset?.progress_pct) || 0));
  const etaLeft = asset?.eta_sec != null ? Math.max(0, Number(asset.eta_sec) - (now - snap.receivedAt) / 1000) : null;
  const stalled = !queued && asset?.status === "processing" && now - snap.changedAt > STALL_AFTER_MS;

  if (queued) {
    const waitedMs = asset ? now - queuedAtMs(asset.id) : 0;
    const slowStart = Number.isFinite(waitedMs) && waitedMs > SLOW_START_MS;
    const estimate = videoSeconds > 0 ? ` Once it starts, a ${Math.round(videoSeconds)}-second video takes ${formatEta(estimateRenderSeconds(videoSeconds))}.` : "";
    return compact ? (
      <p className="flex items-center gap-2 text-xs text-muted">
        <Spinner /> {slowStart ? "Still waiting for a render worker" : "Starting the render"}
      </p>
    ) : (
      <div role="status" className="rounded-[4px] border border-border bg-surface-raised p-4">
        <p className="flex items-center gap-2 font-medium"><Spinner /> {slowStart ? "Still waiting for a render worker" : "Starting the render"}</p>
        <p className="mt-1 text-sm text-muted">
          {slowStart
            ? "This is taking longer than usual to start. A backup check runs about once an hour and will start it if the worker doesn't."
            : "Your video is queued and should start within a minute or two."}
          {estimate}
        </p>
      </div>
    );
  }

  const stage = asset?.stage || "Rendering";
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
