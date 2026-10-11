import { ContentSource, ENTITY_NAMES, ProjectStatus } from "@/config/entities";
import { entityService } from "./entityService";

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

/** Waits for ingestion, then moves the project into the generation pipeline exactly once. */
export async function startPipeline(projectId: string, opts: WaitOptions = {}) {
  await waitForSourcesProcessed(projectId, opts);
  const next: ProjectStatus = "generating_content";
  await entityService.update(ENTITY_NAMES.project, projectId, { status: next });
}
