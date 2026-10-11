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
 * `contentType` defaults to the file's real MIME type, which is what "file"
 * columns validate against an allow-list ("application/octet-stream" is
 * rejected). Some s3-typed fields are instead pinned to a single fixed content
 * type; callers targeting one of those must pass that exact value here.
 * contentLength is required by the backend and is taken from file.size.
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
    )}&fileExtension=${encodeURIComponent(ext)}&contentLength=${file.size}`
  );
  const put = await fetch(info.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": resolvedContentType },
    body: file
  });
  if (!put.ok) throw new Error(`S3 upload failed (${put.status})`);
  return { s3Key: info.s3Key, cdnUrl: info.cdnUrl };
}
