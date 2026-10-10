import { api } from "./apiClient";

export interface ListResponse<T> {
  data: T[];
  nexttoken: string | null;
  count: number;
  totalcount: number;
  facets?: Record<string, { value: string; count: number }[]>;
}

/**
 * Generic CRUD against nostackai's auto-generated entity endpoints.
 * Confirmed live path shape (differs from the starter doc's assumed
 * /{entity}, /{entity}/{id}, /{entity}/list/{name} pattern):
 *   create: POST /create/{entity}
 *   get:    GET  /item/{entity}/{id}
 *   update: PUT  /update/{entity}/{id}
 *   delete: DELETE /delete/{entity}/{id}
 *   list:   GET  /list/{entity}            -> caller's own records (owner-scoped entities)
 *           GET  /list/{entity}?by=...     -> all records (needs broad ACL)
 *           GET  /list/{entity}?field=val  -> filtered by field
 */
export const entityService = {
  create: <T>(entity: string, body: Record<string, unknown>) =>
    api.post<T>(`/create/${entity}`, body),

  update: <T>(entity: string, id: string, body: Record<string, unknown>) =>
    api.put<T>(`/update/${entity}/${id}`, body),

  get: <T>(entity: string, id: string, view?: string) =>
    api.get<T>(`/item/${entity}/${id}${view ? `?view=${view}` : ""}`),

  remove: (entity: string, id: string) => api.del(`/delete/${entity}/${id}`),

  list: <T>(
    entity: string,
    params: Record<string, string | number | boolean | undefined> = {},
    signal?: AbortSignal
  ) => {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    return api.get<ListResponse<T>>(`/list/${entity}${qs ? `?${qs}` : ""}`, undefined, signal);
  }
};
