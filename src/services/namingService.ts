import { api } from "./apiClient";

/**
 * Asks the backend to give a film a short display title written from its material (what was typed, pasted, attached
 * or linked). It is a nicety, never a requirement: it runs in the background and a failure just leaves the name
 * the film already has, so nothing here may block or break making the film.
 */
export function nameProject(projectId: string): void {
  void api.post(`/logicblocks/name_project?project_id=${encodeURIComponent(projectId)}`, {}).catch((e) => {
    console.warn("[naming] couldn't title the film; it keeps its current name", e);
  });
}
