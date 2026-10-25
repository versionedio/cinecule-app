import { ApiError, api } from "./apiClient";
import { ENTITY_NAMES } from "@/config/entities";

export type Access = "approved" | "pending" | "unknown";

// An id that never exists, so the check can never touch a real record.
const PROBE_ID = "zzzaccesscheck0";

/**
 * Asks the backend whether this signed-in user has been approved. New accounts are created read-only, so the door
 * every edit goes through (the secure_write block) is refused until an admin grants them access; approving them is
 * what changes the answer. The check asks that door to delete a film that does not exist: the backend refuses a
 * pending user outright, and answers an approved one with a plain "not found". It changes nothing either way.
 *
 * Asking the backend, instead of reading a label from the login token, means this page can never disagree with
 * what the backend actually enforces. "unknown" (a network problem or a backend fault) is never treated as a lock-out.
 */
export async function checkAccess(): Promise<Access> {
  try {
    await api.post("/logicblocks/secure_write", { ops: [{ entity: ENTITY_NAMES.project, op: "delete", id: PROBE_ID }] });
    return "approved";
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 403) return "pending";
      if (e.status === 401 || e.status >= 500) return "unknown";
      return "approved"; // not found, bad request and the like: the request was allowed through
    }
    return "unknown";
  }
}
