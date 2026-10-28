import { entityService } from "@/services/entityService";
import { uploadEntityFile } from "@/services/uploadService";
import { ContentSourceType, ENTITY_NAMES, Project } from "@/config/entities";
import { createRecord, deleteRecord, deleteRecords } from "@/services/secureWriteService";
import { nameProject } from "@/services/namingService";
import { imagePreviewBase64 } from "@/services/imagePreview";

// Finds a URL anywhere in the message, not just when the whole message is
// nothing but a URL — a bare "https://site.com" and "https://site.com make
// it feel like a lobby ad" both need the link recognized. Ingest's url
// branch actually fetches the page; its query/text branch just summarizes
// whatever raw_text it's given verbatim, with no fetch at all — so failing
// to extract the URL here means the AI never sees the real page, only the
// literal typed string, and produces vague, ungrounded guesses instead.
const URL_RE = /https?:\/\/\S+/i;

export function detectSourceType(file: File): ContentSourceType {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  if (file.type.startsWith("image/")) return "image";
  return "text";
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Turns what the user typed and attached into a draft project with its content sources.
 * Files are uploaded and read BEFORE the project is created, so a failed upload can't leave an
 * empty draft behind, and a source that fails to save rolls the whole project back.
 */
export async function createProjectFromInput(text: string, files: File[]): Promise<Project> {
  const trimmed = text.trim();
  const urlMatch = trimmed.match(URL_RE);
  const extractedUrl = urlMatch?.[0];
  // Whatever's left after pulling the URL out — the actual instructions,
  // e.g. "make it feel like a lobby ad" — kept as its own query source
  // rather than dropped or left glued to the URL.
  const instructionText = extractedUrl ? trimmed.replace(extractedUrl, "").trim() : trimmed;
  // A plain placeholder for the moment; the AI writes the real title from the material (see nameProject below).
  // A lone file is named after the file, which is a fair title until then.
  const name = trimmed ? "New film" : (files[0]?.name.replace(/\.[^.]+$/, "") ?? "New film");

  const sourceBodies: Record<string, unknown>[] = [];
  for (const file of files) {
    const sourceType = detectSourceType(file);
    if (sourceType === "pdf" || sourceType === "image") {
      // An image is also read, so the film can use what it says: a small copy goes with the source and the backend has a
      // vision model write down what it shows. Made first, so an image that can't be read stops here, before any upload.
      const imagePreview = sourceType === "image" ? await imagePreviewBase64(file) : undefined;
      // contentsource.file_key is a "file" column: the backend validates the
      // declared contentType against an allow-list, so send the file's real
      // MIME type (application/pdf, image/png, ...), not a generic one.
      const { s3Key, cdnUrl } = await uploadEntityFile(ENTITY_NAMES.contentSource, "file_key", file);
      sourceBodies.push({
        source_type: sourceType,
        title: file.name,
        file_key: s3Key,
        // The full-size picture's address, for showing it in the video.
        file_url: cdnUrl,
        ...(imagePreview ? { image_preview: imagePreview } : {}),
        status: "draft"
      });
    } else {
      sourceBodies.push({ source_type: "text", title: file.name, raw_text: await readFileAsText(file), status: "draft" });
    }
  }
  if (extractedUrl) sourceBodies.push({ source_type: "url", url: extractedUrl, status: "draft" });
  if (instructionText) sourceBodies.push({ source_type: "query", raw_text: instructionText, status: "draft" });

  const project = await createRecord<Project>(ENTITY_NAMES.project, {
    name,
    video_type: "marketing",
    canvas_aspect_ratio: "16:9",
    status: "draft"
  });

  const createdSourceIds: string[] = [];
  try {
    for (const body of sourceBodies) {
      const source = await createRecord<{ id: string }>(ENTITY_NAMES.contentSource, { project_id: project.id, ...body });
      createdSourceIds.push(source.id);
    }
  } catch (e) {
    await Promise.allSettled([
      deleteRecords(ENTITY_NAMES.contentSource, createdSourceIds),
      deleteRecord(ENTITY_NAMES.project, project.id)
    ]);
    throw e;
  }
  // Title it from what was just given. It runs in the background and is done again once the sources have been read.
  nameProject(project.id);
  return project;
}

// Everything that hangs off a project, deleted before the project itself.
// "audio" holds the narration clips and their word timings (it isn't in ENTITY_NAMES).
const PROJECT_CHILDREN = [
  ENTITY_NAMES.generatedHtml,
  ENTITY_NAMES.interaction,
  ENTITY_NAMES.voiceover,
  "audio",
  ENTITY_NAMES.cameraShot,
  ENTITY_NAMES.videoEffectCue,
  ENTITY_NAMES.cursorTimelinePoint,
  ENTITY_NAMES.exportAsset,
  ENTITY_NAMES.contentSource
];

/**
 * Deletes a film and everything made for it. The project itself must delete (that error is thrown);
 * a piece that can't be removed (for example a file the render worker owns) is counted and left,
 * so one stubborn record can't stop the rest from being cleared.
 */
export async function deleteProject(projectId: string): Promise<{ leftBehind: number }> {
  let leftBehind = 0;
  for (const entity of PROJECT_CHILDREN) {
    let rows: { id: string }[] = [];
    try {
      rows = await entityService.listAll<{ id: string }>(entity, { project_id: projectId });
    } catch {
      continue; // an entity this account can't list has nothing it could delete either
    }
    leftBehind += await deleteRecords(entity, rows.map((r) => r.id));
  }
  await deleteRecord(ENTITY_NAMES.project, projectId);
  return { leftBehind };
}
