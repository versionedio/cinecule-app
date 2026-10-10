import { api } from "./apiClient";

interface UploadUrlResponse {
  uploadUrl: string;
  s3Key: string;
  cdnUrl: string;
  expires: number;
}

/**
 * Upload a file for an entity field via presigned URL:
 *  1. GET /uploadurl/{entity}/{field} -> presigned PUT url + s3Key + cdnUrl
 *  2. PUT the raw bytes straight to S3 (no auth header — the URL is self-authenticating)
 * Returns { s3Key, cdnUrl }: save the s3Key on the record, use cdnUrl for display.
 *
 * `contentType` defaults to the file's real MIME type, but some s3 fields are
 * configured in the console with a single FIXED content type (e.g.
 * contentsource.file_key is pinned to "application/octet-stream" — confirmed
 * via describe_entity) rather than accepting whatever the upload declares.
 * The backend validates the declared contentType against that fixed value
 * and rejects a mismatch, so callers targeting a fixed-content-type field
 * must pass that exact value here instead of relying on file.type.
 */
export async function uploadEntityFile(
  entity: string,
  field: string,
  file: File,
  contentType?: string
): Promise<{ s3Key: string; cdnUrl: string }> {
  const ext = file.name.split(".").pop() || "bin";
  const resolvedContentType = contentType ?? file.type ?? "application/octet-stream";
  const info = await api.get<UploadUrlResponse>(
    `/uploadurl/${entity}/${field}?contentType=${encodeURIComponent(
      resolvedContentType
    )}&fileExtension=${encodeURIComponent(ext)}`
  );
  const put = await fetch(info.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": resolvedContentType },
    body: file
  });
  if (!put.ok) throw new Error(`S3 upload failed (${put.status})`);
  return { s3Key: info.s3Key, cdnUrl: info.cdnUrl };
}
