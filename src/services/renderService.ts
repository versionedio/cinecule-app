import { api } from "./apiClient";
import type { ExportAsset } from "@/config/entities";

/**
 * Asks the render worker to start again for a film whose render has been waiting. The backend only does it for the
 * film's owner and only while a render is genuinely queued (it never creates a second video). Resolves to whether
 * the request was sent: false means there was nothing to retry (it has started since, or it isn't theirs).
 */
export async function retryRender(projectId: string): Promise<boolean> {
  const res = await api.post<{ result?: { ok?: string } }>(`/logicblocks/retry_render?project_id=${encodeURIComponent(projectId)}`, {});
  return res?.result?.ok === "ok";
}

// Record ids are <3-letter prefix><base36 ms timestamp><1 char>, so an id tells us when the record was made.
function createdMs(id: string | undefined): number {
  const ms = id ? parseInt(id.slice(3, -1), 36) : NaN;
  return ms > 1.5e12 && ms < 4e12 ? ms : NaN;
}

// One press of "Render" queues every chosen shape within moments of each other; a later render is minutes apart.
const SAME_BATCH_MS = 60_000;

/**
 * The renders made by the film's latest "Render" press, oldest first (the order the worker takes them). A film
 * rendered in two shapes has two; a film with one, or one rendered before shapes existed, has one.
 */
export function latestRenders(assets: ExportAsset[]): ExportAsset[] {
  const byId = assets.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const newest = byId[byId.length - 1];
  if (!newest) return [];
  const at = createdMs(newest.id);
  if (Number.isNaN(at)) return [newest];
  const batch = byId.filter((a) => at - createdMs(a.id) < SAME_BATCH_MS);
  // One video per shape. If the same shape was queued twice in a batch, only one is kept: the finished one if there
  // is one, otherwise the later one.
  const perShape = new Map<string, ExportAsset>();
  for (const a of batch) {
    const key = a.aspect_ratio ?? "";
    const kept = perShape.get(key);
    if (!kept || a.status === "ready" || kept.status !== "ready") perShape.set(key, a);
  }
  return batch.filter((a) => perShape.get(a.aspect_ratio ?? "") === a);
}

/** "16:9" -> "Wide 16:9" etc., for naming a video. Empty for a render in the film's own shape. */
export function shapeName(ratio: string | undefined): string {
  return ratio === "16:9" ? "Wide 16:9" : ratio === "9:16" ? "Vertical 9:16" : ratio === "1:1" ? "Square 1:1" : "";
}
