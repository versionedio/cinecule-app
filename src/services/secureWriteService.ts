import { ApiError, api } from "./apiClient";
import { ENTITY_NAMES } from "@/config/entities";

/**
 * Every change a person makes to a film goes through one backend door (the secure_write logic block). The backend
 * checks that the film is theirs and applies only the fields listed here, so nobody can edit or delete someone else's
 * work, and a partial edit never blanks the fields it didn't mention. The lists below are what the backend accepts;
 * anything else is dropped here instead of failing the whole save.
 */
const COMMON = ["name", "active"];
const EDITABLE: Record<string, string[]> = {
  [ENTITY_NAMES.project]: COMMON.concat([
    "article_content", "video_type", "status", "canvas_aspect_ratio", "custom_canvas_width", "custom_canvas_height",
    "director_camera_intensity", "director_auto_generate_effects", "director_zoom_hold_after_effect_sec",
    "director_camera_move_duration_sec", "cursor_speed", "render_resolution", "render_fps", "error_message", "voice_id"
  ]),
  [ENTITY_NAMES.generatedHtml]: COMMON.concat(["html_content", "sort_order", "duration", "transition", "transition_duration", "narration_text"]),
  [ENTITY_NAMES.interaction]: COMMON.concat(["slide_id", "target_text", "target_selector", "action", "trigger", "time_offset", "duration", "label", "sort_order"]),
  [ENTITY_NAMES.cameraShot]: COMMON.concat(["slide_id", "label", "start_time", "end_time", "target_selector", "x_percent", "y_percent", "zoom", "transition_duration", "easing", "shot_type"]),
  [ENTITY_NAMES.videoEffectCue]: COMMON.concat(["slide_id", "interaction_id", "label", "start_time", "duration", "target_selector", "effect"]),
  [ENTITY_NAMES.cursorTimelinePoint]: COMMON.concat(["slide_id", "interaction_id", "time", "x_percent", "y_percent", "duration_ms", "click", "label", "source", "selector", "point_role", "sequence_index"]),
  [ENTITY_NAMES.contentSource]: COMMON.concat(["source_type", "title", "url", "raw_text", "file_key", "file_url"])
};

export interface WriteOp {
  entity: string;
  op: "create" | "update" | "delete";
  id?: string;
  project_id?: string;
  fields?: Record<string, unknown>;
}

interface WriteResult {
  ok: boolean;
  record?: Record<string, unknown>;
  id?: string;
}

interface WriteResponse {
  result?: { ok: boolean; error?: string; results?: WriteResult[] };
}

const MAX_PER_CALL = 25;

function editable(entity: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  const allowed = EDITABLE[entity] ?? [];
  return Object.fromEntries(Object.entries(fields).filter(([k, v]) => allowed.includes(k) && v !== undefined));
}

/** Sends the changes in order and stops at the first one the backend refuses. */
export async function secureWrite(ops: WriteOp[]): Promise<WriteResult[]> {
  const all: WriteResult[] = [];
  for (let i = 0; i < ops.length; i += MAX_PER_CALL) {
    const body = await api.post<WriteResponse>("/logicblocks/secure_write", { ops: ops.slice(i, i + MAX_PER_CALL) });
    const result = body?.result;
    if (!result?.ok) throw new ApiError(403, result?.error || "That change couldn't be saved.");
    all.push(...(result.results ?? []));
  }
  return all;
}

/** Makes a record. A child record names its film with `project_id` in the fields, as before. */
export async function createRecord<T>(entity: string, fields: Record<string, unknown>): Promise<T> {
  const { project_id, ...rest } = fields;
  const [made] = await secureWrite([
    { entity, op: "create", project_id: typeof project_id === "string" ? project_id : undefined, fields: editable(entity, rest) }
  ]);
  return { ...(project_id ? { project_id } : {}), ...made.record } as T;
}

/** Changes only the fields given; every other field keeps its value. */
export async function updateRecord<T>(entity: string, id: string, patch: Record<string, unknown>): Promise<T> {
  const [done] = await secureWrite([{ entity, op: "update", id, fields: editable(entity, patch) }]);
  return (done.record ?? { id }) as T;
}

export async function deleteRecord(entity: string, id: string): Promise<void> {
  await secureWrite([{ entity, op: "delete", id }]);
}

/** Deletes several records of one kind (a film's pieces), a batch per call. Resolves to how many were not removed. */
export async function deleteRecords(entity: string, ids: string[]): Promise<number> {
  let failed = 0;
  for (let i = 0; i < ids.length; i += MAX_PER_CALL) {
    const batch = ids.slice(i, i + MAX_PER_CALL);
    try {
      await secureWrite(batch.map((id) => ({ entity, op: "delete" as const, id })));
    } catch {
      // One stubborn record stops its batch; retry one by one so it can't hold back the rest.
      for (const id of batch) {
        try {
          await secureWrite([{ entity, op: "delete", id }]);
        } catch (e) {
          // "Not found" here means the first attempt already removed it.
          if (!(e instanceof ApiError && /not found/i.test(e.message))) failed += 1;
        }
      }
    }
  }
  return failed;
}
