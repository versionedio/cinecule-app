import { getMyProfile } from "./authService";
import { entityService } from "./entityService";
import { uploadEntityFile } from "./uploadService";

/** What someone waiting for approval can tell us: an optional note and an optional resume (PDF). */
export interface AccessRequest {
  id: string;
  user_id?: string;
  message?: string;
  resume_key?: string;
  resume_name?: string;
  /** Saved so an admin can tell who is asking: the platform's user list is not readable from the app. */
  email?: string;
  full_name?: string;
}

/** Who is asking, taken from the signed-in profile. */
export interface Requester {
  email?: string;
  name?: string;
}

const ENTITY = "accessrequest";
export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

/** This person's request, if they have sent one (records are owner-scoped, so a list only returns their own). */
export async function getMyAccessRequest(): Promise<AccessRequest | null> {
  const res = await entityService.list<AccessRequest>(ENTITY, { pagesize: 1 });
  return res.data?.[0] ?? null;
}

// One lookup per signed-in person per page load, so two parts of the page asking at once cannot both create a record.
const loaded = new Map<string, Promise<AccessRequest>>();

/**
 * This person's request, created on first use. Even if they never write a note, the record carries their email and
 * name, which is how an admin sees who is waiting.
 */
export function loadMyAccessRequest(who: Requester): Promise<AccessRequest> {
  const key = who.email ?? "";
  let pending = loaded.get(key);
  if (!pending) {
    pending = fetchOrCreate(who).catch((e) => {
      loaded.delete(key); // let a later try start fresh
      throw e;
    });
    loaded.set(key, pending);
  }
  return pending;
}

async function fetchOrCreate(who: Requester): Promise<AccessRequest> {
  let email = who.email?.trim() || undefined;
  let full_name = who.name?.trim() || undefined;
  if (!email) {
    // Straight after sign-in the profile in memory has no email yet; the profile endpoint always does.
    try {
      const me = await getMyProfile();
      email = me.email?.trim() || undefined;
      full_name ||= [me.fn, me.ln].filter(Boolean).join(" ").trim() || undefined;
    } catch {
      /* a record without an email is still better than none */
    }
  }
  const existing = await getMyAccessRequest();
  if (existing) {
    const stale = (email && existing.email !== email) || (full_name && existing.full_name !== full_name);
    if (!stale) return existing;
    await entityService.update(ENTITY, existing.id, { email, full_name });
    return { ...existing, email, full_name };
  }
  const created = await entityService.create<{ id: string }>(ENTITY, { email, full_name, message: "", active: true });
  return { id: created.id, message: "", email, full_name };
}

export function resumeProblem(file: File): string | null {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return "Please choose a PDF.";
  if (file.size > MAX_RESUME_BYTES) return "That file is over 10 MB. Please choose a smaller PDF.";
  return null;
}

/**
 * Saves the note and, if one was chosen, the resume. Updates the person's earlier request when there is one, so
 * sending again replaces it instead of piling up duplicates.
 */
export async function sendAccessRequest(
  existing: AccessRequest | null,
  input: { message: string; resume: File | null; who?: Requester }
): Promise<AccessRequest> {
  const fields: Record<string, unknown> = { message: input.message.trim() };
  if (input.who?.email) fields.email = input.who.email.trim();
  if (input.who?.name) fields.full_name = input.who.name.trim();
  if (input.resume) {
    const { s3Key } = await uploadEntityFile(ENTITY, "resume_key", input.resume);
    fields.resume_key = s3Key;
    fields.resume_name = input.resume.name;
  }
  if (existing) return entityService.update<AccessRequest>(ENTITY, existing.id, fields);
  return entityService.create<AccessRequest>(ENTITY, { ...fields, active: true });
}
