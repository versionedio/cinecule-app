// Finds queued renders and claims one (created -> processing).
//   node scripts/render/claim.mjs       cheap poll step for the workflow: reports has_work / asset_id
//   import { claimNext }                used by worker.mjs to keep going until the queue is empty
//
// Only one worker runs at a time (the workflow's concurrency group), so claiming by status is race-free.
import { pathToFileURL } from "node:url";
import { client, login, setOutput } from "./lib.mjs";

// A render that was claimed but never finished (runner killed, job timed out) would stay
// "processing" forever; give up on it so the user sees a failure instead of an endless spinner.
const STALE_AFTER_MS = 5 * 60 * 60 * 1000;

// List responses don't always include created_at. Record ids are <3-letter prefix><base36 ms timestamp><1 char>,
// so fall back to decoding the id; NaN means "unknown", which must never count as old.
const createdMs = (a) => {
  const fromField = Date.parse(a.created_at);
  if (!Number.isNaN(fromField)) return fromField;
  const decoded = parseInt(String(a.id).slice(3, -1), 36);
  return decoded > 1.5e12 && decoded < 4e12 ? decoded : NaN;
};

export async function failStaleRenders(api) {
  const stuck = await api.list("exportasset", { status: "processing", asset_type: "video" });
  for (const a of stuck) {
    const age = Date.now() - createdMs(a);
    if (Number.isNaN(age) || age < STALE_AFTER_MS) continue;
    console.log(`Export asset ${a.id} has been processing for over 5h; marking it failed.`);
    await api.post("/logicblocks/render_complete", { exportasset_id: a.id, success: false, error_message: "Render timed out before finishing." });
  }
}

/** Oldest queued render, claimed as "processing"; null when the queue is empty. */
export async function claimNext(api) {
  const queued = await api.list("exportasset", { status: "created", asset_type: "video" });
  if (queued.length === 0) return null;
  queued.sort((a, b) => (createdMs(a) || 0) - (createdMs(b) || 0));
  const asset = queued[0];
  // No time estimate yet: the worker does not know the film's length at this point, and a made-up number
  // would be wrong. The render step reports a real one as soon as it has loaded the film.
  await api.put(`/update/exportasset/${asset.id}`, { status: "processing", stage: "Starting", progress_pct: 1 });
  console.log(`Claimed export asset ${asset.id} for project ${asset.project_id} (${asset.resolution} @ ${asset.frame_rate} fps).`);
  return asset;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const api = client(await login());
  await failStaleRenders(api);
  const asset = await claimNext(api);
  if (!asset) {
    console.log("No queued renders.");
    setOutput("has_work", "false");
  } else {
    setOutput("has_work", "true");
    setOutput("asset_id", asset.id);
  }
}
