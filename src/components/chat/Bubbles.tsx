import { ReactNode, useEffect, useState } from "react";
import { Clapperboard, File as FileIcon, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Text that types itself out like a chatbot reply. Key it by its text so a new sentence retypes. */
export function Typed({ text, speed = 16 }: { text: string; speed?: number }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? text.length : 0));
  useEffect(() => {
    const t = window.setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          window.clearInterval(t);
          return n;
        }
        return n + 1;
      });
    }, speed);
    return () => window.clearInterval(t);
  }, [text, speed]);
  return <>{text.slice(0, shown)}</>;
}

/** Three softly pulsing dots: "the assistant is working". */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} role="status" aria-label="Working">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${i * 180}ms` }} />
      ))}
    </span>
  );
}

export interface AttachedFile {
  name: string;
  image?: boolean;
}

export function UserBubble({ text, files = [] }: { text: string; files?: AttachedFile[] }) {
  return (
    <div className="chat-in flex flex-col items-end gap-1.5">
      {files.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {files.map((file, i) => {
            const Icon = file.image ? ImageIcon : FileIcon;
            return (
              <span key={`${file.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-xs backdrop-blur-xl">
                <Icon className="h-3.5 w-3.5 text-primary-text" />
                <span className="max-w-[180px] truncate">{file.name}</span>
              </span>
            );
          })}
        </div>
      )}
      {text && (
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-primary/30 bg-primary/15 px-4 py-2.5 text-[15px] leading-relaxed">
          {text}
        </div>
      )}
    </div>
  );
}

export function AssistantBubble({ children, tone = "default", className }: { children: ReactNode; tone?: "default" | "error"; className?: string }) {
  return (
    <div className="chat-in flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-primary-text backdrop-blur-xl">
        <Clapperboard className="h-4 w-4" />
      </span>
      <div
        className={cn(
          "min-w-0 max-w-[88%] flex-1 rounded-2xl rounded-tl-md border px-4 py-3 text-[15px] leading-relaxed backdrop-blur-xl",
          tone === "error" ? "border-destructive/40 bg-destructive/10 text-destructive-text" : "border-white/15 bg-white/[0.07]",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
