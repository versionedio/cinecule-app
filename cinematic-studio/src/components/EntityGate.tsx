import { ApiError } from "../services/apiClient";
import { Alert } from "./ui/alert";

/**
 * Friendly notice for entities that haven't been created in nostackai yet.
 * Any 400/404 from an entity endpoint most likely means "not configured".
 */
export function entityMissing(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 400);
}

export default function EntityNotConfigured({ entity }: { entity: string }) {
  return (
    <Alert severity="info" title={`"${entity}" isn't set up yet`} className="my-4">
      Create the <b>{entity}</b> entity in the nostackai console (see entities.json) and this page will start
      working — no code changes needed.
    </Alert>
  );
}
