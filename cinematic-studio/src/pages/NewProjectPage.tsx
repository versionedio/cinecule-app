import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowUp, File as FileIcon, Image as ImageIcon, Link2, Paperclip, X } from "lucide-react";
import { entityService } from "../services/entityService";
import { uploadEntityFile } from "../services/uploadService";
import { ContentSourceType, ENTITY_NAMES, Project } from "../config/entities";
import { cn } from "@/lib/utils";

const ACCEPT = ".pdf,application/pdf,image/*,.txt,.md,.csv,text/plain";
// Finds a URL anywhere in the message, not just when the whole message is
// nothing but a URL — a bare "https://site.com" and "https://site.com make
// it feel like a lobby ad" both need the link recognized. Ingest's url
// branch actually fetches the page; its query/text branch just summarizes
// whatever raw_text it's given verbatim, with no fetch at all — so failing
// to extract the URL here means the AI never sees the real page, only the
// literal typed string, and produces vague, ungrounded guesses instead.
const URL_RE = /https?:\/\/\S+/i;

function detectSourceType(file: File): ContentSourceType {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  if (file.type.startsWith("image/")) return "image";
  return "text";
}

function fileIcon(file: File) {
  const type = detectSourceType(file);
  if (type === "pdf") return FileIcon;
  if (type === "image") return ImageIcon;
  return FileIcon;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export default function NewProjectPage() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const canSubmit = (text.trim().length > 0 || files.length > 0) && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const trimmed = text.trim();
      const urlMatch = trimmed.match(URL_RE);
      const extractedUrl = urlMatch?.[0];
      // Whatever's left after pulling the URL out — the actual instructions,
      // e.g. "make it feel like a lobby ad" — kept as its own query source
      // rather than dropped or left glued to the URL.
      const instructionText = extractedUrl ? trimmed.replace(extractedUrl, "").trim() : trimmed;
      const name = trimmed
        ? trimmed.slice(0, 60)
        : (files[0]?.name.replace(/\.[^.]+$/, "") ?? "Untitled project");

      const project = await entityService.create<Project>(ENTITY_NAMES.project, {
        name,
        video_type: "marketing",
        canvas_aspect_ratio: "16:9",
        status: "draft"
      });

      for (const file of files) {
        const sourceType = detectSourceType(file);
        if (sourceType === "pdf" || sourceType === "image") {
          // contentsource.file_key is configured in the console with a fixed
          // S3 content type (application/octet-stream) rather than accepting
          // the upload's real MIME type — must match exactly or the backend
          // rejects it with a "contentType mismatch" error.
          const { s3Key, cdnUrl } = await uploadEntityFile(
            ENTITY_NAMES.contentSource,
            "file_key",
            file,
            "application/octet-stream"
          );
          await entityService.create(ENTITY_NAMES.contentSource, {
            project_id: project.id,
            source_type: sourceType,
            title: file.name,
            file_key: s3Key,
            // file_url must exist on the contentsource entity in the console
            // first (see the field's comment in config/entities.ts) — ingest
            // needs a real fetchable URL for the image ai_call, not the bare
            // S3 key file_key holds.
            file_url: cdnUrl,
            status: "draft"
          });
        } else {
          const raw = await readFileAsText(file);
          await entityService.create(ENTITY_NAMES.contentSource, {
            project_id: project.id,
            source_type: "text",
            title: file.name,
            raw_text: raw,
            status: "draft"
          });
        }
      }

      if (extractedUrl) {
        await entityService.create(ENTITY_NAMES.contentSource, {
          project_id: project.id,
          source_type: "url",
          url: extractedUrl,
          status: "draft"
        });
      }
      if (instructionText) {
        await entityService.create(ENTITY_NAMES.contentSource, {
          project_id: project.id,
          source_type: "query",
          raw_text: instructionText,
          status: "draft"
        });
      }

      navigate(`/projects/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the project.");
      setBusy(false);
    }
  };

  return (
    <div className="relative h-screen overflow-hidden bg-background">
      {/* Ambient blurred color field — the glass panels below have nothing to
          refract without this; static, no motion per the app's decorative-
          animation rule. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-[32rem] w-[32rem] rounded-full bg-primary/30 blur-[120px]" />
        <div className="absolute -right-24 top-1/3 h-[28rem] w-[28rem] rounded-full bg-accent/25 blur-[120px]" />
        <div className="absolute bottom-[-10rem] left-1/3 h-[24rem] w-[24rem] rounded-full bg-success/15 blur-[120px]" />
      </div>

      <button
        onClick={() => navigate("/projects")}
        className="absolute left-6 top-6 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-foreground/80 backdrop-blur-xl transition-colors hover:bg-white/20 hover:text-foreground"
        aria-label="Back"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>

      <div className="absolute left-1/2 top-3/4 z-10 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 px-4">
        <h1 className="mb-6 text-center font-display text-3xl font-normal drop-shadow-sm">
          What film do you want to make?
        </h1>

        {files.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {files.map((file, i) => {
              const Icon = fileIcon(file);
              return (
                <span
                  key={`${file.name}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-xs backdrop-blur-xl"
                >
                  <Icon className="h-3.5 w-3.5 text-primary-text" />
                  <span className="max-w-[160px] truncate">{file.name}</span>
                  <button onClick={() => removeFile(i)} className="text-muted hover:text-destructive-text" aria-label="Remove file">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-3xl border border-white/20 bg-white/10 p-3 shadow-2xl backdrop-blur-2xl transition-colors focus-within:border-primary/50">
          <button
            onClick={() => fileInput.current?.click()}
            className="shrink-0 rounded-full p-2 text-muted hover:bg-white/15 hover:text-foreground"
            aria-label="Attach files"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Paste a URL, describe what you want, or attach a PDF/image below…"
            rows={1}
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent py-2 text-[15px] text-foreground placeholder:text-muted focus:outline-none"
          />
          <button
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              "shrink-0 rounded-full p-2 transition-colors",
              canSubmit ? "bg-primary/20 text-primary-text hover:bg-primary/30" : "text-muted opacity-40"
            )}
            aria-label="Create project"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex items-center justify-center gap-4 text-[11px] uppercase tracking-widest text-muted">
          <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" /> URL</span>
          <span className="inline-flex items-center gap-1"><FileIcon className="h-3 w-3" /> PDF</span>
          <span className="inline-flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Image</span>
          <span>Text</span>
        </div>

        {error && <p className="mt-4 text-center text-sm text-destructive-text">{error}</p>}
        {busy && <p className="mt-4 text-center text-sm text-muted">Creating project…</p>}
      </div>
    </div>
  );
}
