import { api } from "./apiClient";

/**
 * Asks the render worker to start again for a film whose render has been waiting. The backend only does it for the
 * film's owner and only while a render is genuinely queued (it never creates a second video). Resolves to whether
 * the request was sent: false means there was nothing to retry (it has started since, or it isn't theirs).
 */
export async function retryRender(projectId: string): Promise<boolean> {
  const res = await api.post<{ result?: { ok?: string } }>(`/logicblocks/retry_render?project_id=${encodeURIComponent(projectId)}`, {});
  return res?.result?.ok === "ok";
}
