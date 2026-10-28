import { ContentSource, ENTITY_NAMES, ProjectStatus } from "@/config/entities";
import { entityService } from "./entityService";
import { deleteRecords, updateRecord } from "@/services/secureWriteService";
import { nameProject } from "@/services/namingService";

// URL fetch (20s cap) plus an AI research pass for query sources fits well inside this.
export const INGEST_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });

/**
 * Resolves once every content source on the project is "processed". Ingest
 * runs per source via an event and no longer advances the project, so this
 * is what decides when generation can start. Gives up (throws) on a failed
 * source or after the timeout so the UI can never wait forever.
 */
export async function waitForSourcesProcessed(projectId: string, opts: WaitOptions = {}): Promise<ContentSource[]> {
  const { timeoutMs = INGEST_TIMEOUT_MS, intervalMs = POLL_INTERVAL_MS, signal } = opts;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const { data } = await entityService.list<ContentSource>(
      ENTITY_NAMES.contentSource,
      { project_id: projectId, pagesize: 100 },
      signal
    );
    const sources = data ?? [];

    if (sources.some((s) => s.status === "failed")) {
      throw new Error("One of your sources couldn't be processed. Check the link or file and try again.");
    }
    if (sources.length > 0 && sources.every((s) => s.status === "processed")) return sources;
    if (Date.now() >= deadline) {
      throw new Error(
        sources.length === 0
          ? "No sources were found for this project."
          : "Your sources are taking too long to process. Try again in a moment."
      );
    }
    await sleep(intervalMs, signal);
  }
}

// What the pipeline makes from the sources. A second run (the "Try again" button) must start from none of it:
// the storyboard is added to whatever is already there, so leftovers would play as repeated scenes.
// Sources and finished renders are kept. "audio" holds the narration clips and their word timings.
const GENERATED = [
  ENTITY_NAMES.generatedHtml,
  ENTITY_NAMES.interaction,
  ENTITY_NAMES.voiceover,
  "audio",
  ENTITY_NAMES.cameraShot,
  ENTITY_NAMES.videoEffectCue,
  ENTITY_NAMES.cursorTimelinePoint
];

async function clearGenerated(projectId: string) {
  for (const entity of GENERATED) {
    const rows = await entityService.listAll<{ id: string }>(entity, { project_id: projectId });
    const notRemoved = await deleteRecords(entity, rows.map((r) => r.id));
    if (notRemoved > 0) throw new Error("Couldn't clear the earlier attempt. Try again in a moment.");
  }
}

/** Waits for ingestion, clears any earlier attempt, then moves the project into the generation pipeline exactly once. */
export async function startPipeline(projectId: string, opts: WaitOptions = {}) {
  await waitForSourcesProcessed(projectId, opts);
  // Now that links and files have been read, the title can be written from what they actually say.
  nameProject(projectId);
  await clearGenerated(projectId);
  const next: ProjectStatus = "generating_content";
  await updateRecord(ENTITY_NAMES.project, projectId, { status: next });
}
