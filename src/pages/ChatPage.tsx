import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUp, File as FileIcon, Image as ImageIcon, Link2, LogOut, Paperclip, Trash2, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { createProjectFromInput, deleteProject, detectSourceType } from "@/services/projectService";
import { entityService } from "@/services/entityService";
import { ContentSource, ENTITY_NAMES, Project, ProjectStatus } from "@/config/entities";
import ChatBoundary from "@/components/chat/ChatBoundary";
import ChatFilm from "@/components/chat/ChatFilm";
import { AssistantBubble, AttachedFile, Typed, TypingDots, UserBubble } from "@/components/chat/Bubbles";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ACCEPT = ".pdf,application/pdf,image/*,.txt,.md,.csv,text/plain";

type Item =
  | { id: number; kind: "user"; text: string; files: AttachedFile[] }
  | { id: number; kind: "working" }
  | { id: number; kind: "note"; text: string; tone?: "error" }
  | { id: number; kind: "film"; projectId: string; fresh?: boolean };

// Omit applied to each member of the union, so every kind keeps its own fields.
type Draft<T> = T extends unknown ? Omit<T, "id"> : never;

const fileIcon = (file: File) => (detectSourceType(file) === "image" ? ImageIcon : FileIcon);

/** What a film was asked for, retold as the message that started it, from the sources saved on the project. */
function requestFromSources(sources: ContentSource[], fallback: string): { text: string; files: AttachedFile[] } {
  const lines: string[] = [];
  const files: AttachedFile[] = [];
  for (const s of sources) {
    if (s.source_type === "query" && s.raw_text) lines.push(s.raw_text);
    else if (s.source_type === "url" && s.url) lines.push(s.url);
    else if (s.source_type === "pdf" || s.source_type === "image" || s.source_type === "text") files.push({ name: s.title || s.source_type, image: s.source_type === "image" });
  }
  return { text: lines.join("\n") || (files.length ? "" : fallback), files };
}

/**
 * The whole conversation lives here: what you send becomes a bubble, and the film's progress
 * answers in the same thread, from the first message through to the finished video.
 */
export default function ChatPage() {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ProjectStatus>>({});
  const [sending, setSending] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState("");
  // Opening an existing film: its conversation is rebuilt from what was saved.
  const [loading, setLoading] = useState(id !== "new");
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const stick = useRef(true);

  const started = items.length > 0;
  const canSubmit = (text.trim().length > 0 || files.length > 0) && !sending;

  const onStatus = useCallback((projectId: string, status: ProjectStatus) => {
    setStatuses((prev) => (prev[projectId] === status ? prev : { ...prev, [projectId]: status }));
  }, []);

  // Follow the conversation down as it grows, unless the reader has scrolled up to look back.
  useEffect(() => {
    const box = scroller.current;
    const content = thread.current;
    if (!box || !content) return;
    const follow = () => {
      if (stick.current) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
    };
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    return () => observer.disconnect();
  }, [started]);

  const onScroll = () => {
    const box = scroller.current;
    if (box) stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  };

  useEffect(() => {
    if (id === "new") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      // The film itself and its sources are fetched separately: if the sources can't be read, the
      // conversation still opens (with the film's name as the request) instead of losing everything.
      const [projectResult, sourcesResult] = await Promise.allSettled([
        entityService.get<Project>(ENTITY_NAMES.project, id),
        entityService.list<ContentSource>(ENTITY_NAMES.contentSource, { project_id: id, pagesize: 100 })
      ]);
      if (cancelled) return;
      if (projectResult.status === "rejected") {
        console.error("[chat] couldn't open film", id, projectResult.reason);
        setItems((prev) => (prev.length ? prev : [{ id: nextId.current++, kind: "note", text: "I couldn't open that film. It may have been deleted.", tone: "error" }]));
      } else {
        if (sourcesResult.status === "rejected") console.error("[chat] couldn't read the film's sources", id, sourcesResult.reason);
        const sources = sourcesResult.status === "fulfilled" ? (sourcesResult.value.data ?? []) : [];
        const request = requestFromSources(sources, String(projectResult.value?.name ?? ""));
        setItems((prev) =>
          prev.some((i) => i.kind === "film" && i.projectId === id)
            ? prev
            : [
                { id: nextId.current++, kind: "user", ...request },
                { id: nextId.current++, kind: "film", projectId: id }
              ]
        );
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const push = (item: Draft<Item>): number => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { ...item, id } as Item]);
    return id;
  };

  // A film still being made blocks the next one; a finished or failed film does not.
  const activeFilm = () => {
    const films = items.filter((i): i is Extract<Item, { kind: "film" }> => i.kind === "film");
    const last = films[films.length - 1];
    if (!last) return false;
    const status = statuses[last.projectId];
    return status !== "ready" && status !== "failed";
  };

  const films = items.filter((i): i is Extract<Item, { kind: "film" }> => i.kind === "film");
  const stillWorking = films.some((f) => {
    const status = statuses[f.projectId];
    return status !== undefined && status !== "ready" && status !== "failed" && status !== "ready_to_render" && status !== "draft";
  });

  // Clearing the chat deletes the film(s) in it and starts over with a blank chat.
  const clearChat = async () => {
    setClearing(true);
    setClearError("");
    try {
      for (const film of films) await deleteProject(film.projectId);
      setItems([]);
      setStatuses({});
      setText("");
      setFiles([]);
      setConfirmClear(false);
      navigate("/projects/new", { replace: true });
    } catch (e) {
      setClearError(e instanceof Error ? e.message : "Couldn't delete this film.");
    } finally {
      setClearing(false);
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    const message = text.trim();
    const attached = files;
    setText("");
    setFiles([]);
    stick.current = true;
    push({ kind: "user", text: message, files: attached.map((f) => ({ name: f.name, image: detectSourceType(f) === "image" })) });

    if (activeFilm()) {
      push({ kind: "note", text: "One film at a time. Once this one finishes, tell me what to make next." });
      return;
    }

    setSending(true);
    const workingId = push({ kind: "working" });
    try {
      const project = await createProjectFromInput(message, attached);
      setItems((prev) => prev.map((i) => (i.id === workingId ? ({ id: workingId, kind: "film", projectId: project.id, fresh: true } as Item) : i)));
      // The address follows the film, so this conversation can be reopened (or refreshed) at its own link.
      navigate(`/projects/${project.id}`, { replace: true });
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Couldn't create the project.";
      setItems((prev) => prev.map((i) => (i.id === workingId ? ({ id: workingId, kind: "note", text: reason, tone: "error" } as Item) : i)));
    } finally {
      setSending(false);
    }
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    // Copy now: the picker's list is live and is emptied as soon as the input is reset, which can
    // happen before React runs the state update below.
    const picked = Array.from(list);
    if (picked.length > 0) setFiles((prev) => [...prev, ...picked]);
  };

  const composer = (
    <>
      {files.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {files.map((file, i) => {
            const Icon = fileIcon(file);
            return (
              <span key={`${file.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-xs backdrop-blur-xl">
                <Icon className="h-3.5 w-3.5 text-primary-text" />
                <span className="max-w-[160px] truncate">{file.name}</span>
                <button onClick={() => setFiles((prev) => prev.filter((_, n) => n !== i))} className="text-muted hover:text-destructive-text" aria-label="Remove file">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-3xl border border-white/20 bg-white/10 p-3 shadow-2xl backdrop-blur-2xl transition-colors focus-within:border-primary/50">
        <button onClick={() => fileInput.current?.click()} className="shrink-0 rounded-full p-2 text-muted hover:bg-white/15 hover:text-foreground" aria-label="Attach files">
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
          placeholder={started ? "Describe another film…" : "Paste a URL, describe what you want, or attach a PDF/image below…"}
          rows={1}
          className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent py-2 text-[15px] text-foreground placeholder:text-muted focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={!canSubmit}
          className={cn("shrink-0 rounded-full p-2 transition-colors", canSubmit ? "bg-primary/20 text-primary-text hover:bg-primary/30" : "text-muted opacity-40")}
          aria-label="Send"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      </div>
    </>
  );

  const render = (item: Item): ReactNode => {
    switch (item.kind) {
      case "user":
        return <UserBubble key={item.id} text={item.text} files={item.files} />;
      case "working":
        return (
          <AssistantBubble key={item.id}>
            <span className="flex items-center gap-2">
              <Typed text="Setting things up…" /> <TypingDots />
            </span>
          </AssistantBubble>
        );
      case "note":
        return (
          <AssistantBubble key={item.id} tone={item.tone}>
            <Typed text={item.text} />
          </AssistantBubble>
        );
      case "film":
        return (
          <ChatBoundary key={item.id}>
            <ChatFilm projectId={item.projectId} autoStart={item.fresh} onStatus={onStatus} />
          </ChatBoundary>
        );
    }
  };

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background">
      {/* Ambient blurred color field — the glass panels have nothing to refract without this; static, no motion. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-[32rem] w-[32rem] rounded-full bg-primary/30 blur-[120px]" />
        <div className="absolute -right-24 top-1/3 h-[28rem] w-[28rem] rounded-full bg-accent/25 blur-[120px]" />
        <div className="absolute bottom-[-10rem] left-1/3 h-[24rem] w-[24rem] rounded-full bg-success/15 blur-[120px]" />
      </div>

      <button
        onClick={() => navigate("/projects")}
        className="absolute left-6 top-6 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-foreground/80 backdrop-blur-xl transition-colors hover:bg-white/20 hover:text-foreground"
        aria-label="Back"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>

      <div className="absolute right-6 top-6 z-20 flex items-center gap-2">
        {films.length > 0 && (
          <button
            onClick={() => {
              setClearError("");
              setConfirmClear(true);
            }}
            className="flex h-10 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 text-sm text-foreground/80 backdrop-blur-xl transition-colors hover:bg-white/20 hover:text-foreground"
          >
            <Trash2 className="h-4 w-4" />
            Clear chat
          </button>
        )}
        <button
          onClick={logout}
          className="flex h-10 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 text-sm text-foreground/80 backdrop-blur-xl transition-colors hover:bg-white/20 hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>

      <Dialog open={confirmClear} onOpenChange={(open) => !clearing && setConfirmClear(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear this chat?</DialogTitle>
            <p className="text-sm text-muted">
              This permanently deletes {films.length === 1 ? "this film" : `these ${films.length} films`}: the storyboard, narration, and any finished video. It can't be undone.
            </p>
            {stillWorking && (
              <p className="mt-1 text-sm text-destructive-text">
                A film is still being made. It can't be stopped from here, so unfinished steps may leave stray pieces behind.
              </p>
            )}
            {clearError && <p className="mt-1 text-sm text-destructive-text">{clearError}</p>}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)} disabled={clearing}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={clearChat} disabled={clearing}>
              {clearing ? <Spinner /> : <Trash2 className="h-4 w-4" />}
              {clearing ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {loading ? (
        <div className="relative z-10 flex flex-1 items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      ) : started ? (
        <>
          <div ref={scroller} onScroll={onScroll} className="relative z-10 flex-1 overflow-y-auto px-4 pb-6 pt-20">
            <div ref={thread} className="mx-auto flex w-full max-w-2xl flex-col gap-5">
              {items.map(render)}
            </div>
          </div>
          <div className="relative z-10 shrink-0 px-4 pb-6 pt-2">
            <div className="mx-auto w-full max-w-2xl">{composer}</div>
          </div>
        </>
      ) : (
        <div className="absolute left-1/2 top-3/4 z-10 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 px-4">
          <h1 className="mb-6 text-center font-display text-3xl font-normal drop-shadow-sm">What film do you want to make?</h1>
          {composer}
          <div className="mt-4 flex items-center justify-center gap-4 text-[11px] uppercase tracking-widest text-muted">
            <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" /> URL</span>
            <span className="inline-flex items-center gap-1"><FileIcon className="h-3 w-3" /> PDF</span>
            <span className="inline-flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Image</span>
            <span>Text</span>
          </div>
        </div>
      )}
    </div>
  );
}
