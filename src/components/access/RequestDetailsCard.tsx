import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileText, Paperclip, Send } from "lucide-react";
import { ApiError } from "@/services/apiClient";
import { AccessRequest, loadMyAccessRequest, resumeProblem, sendAccessRequest } from "@/services/accessRequestService";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * An optional extra for people waiting for approval: a short note about what they want to make and a resume.
 * Nothing here is required, and nothing here affects whether the account is approved by the page itself.
 */
export default function RequestDetailsCard() {
  const [existing, setExisting] = useState<AccessRequest | null>(null);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { profile } = useAuth();
  const email = profile?.email;
  const name = [profile?.fn, profile?.ln].filter(Boolean).join(" ");

  // Show what was sent before, if anything (the person may be coming back to this page). This also makes sure their
  // request exists with their email and name on it, so an admin can see who is waiting even if they write nothing.
  useEffect(() => {
    let cancelled = false;
    loadMyAccessRequest({ email, name })
      .then((r) => {
        if (cancelled) return;
        setExisting(r);
        setMessage(r.message ?? "");
      })
      .catch(() => undefined); // not being able to load an earlier request must never get in the way
    return () => {
      cancelled = true;
    };
  }, [email, name]);

  const pick = (list: FileList | null) => {
    const chosen = list?.[0] ?? null; // copy now: the picker's list is emptied when the input is reset
    if (!chosen) return;
    const problem = resumeProblem(chosen);
    setError(problem ?? "");
    setSent(false);
    setFile(problem ? null : chosen);
  };

  const changed = Boolean(file) || message.trim() !== (existing?.message ?? "").trim();

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const saved = await sendAccessRequest(existing, { message, resume: file, who: { email, name } });
      setExisting((prev) => ({ ...prev, ...saved, resume_name: file?.name ?? saved.resume_name ?? prev?.resume_name }));
      setFile(null);
      setSent(true);
    } catch (e) {
      // A refusal here is not a problem with the account: say so plainly and leave the person on the list.
      setError(
        e instanceof ApiError && e.status === 403
          ? "We can't take this just yet. You're still on the list, and you can try again later."
          : "Couldn't send that. Please try again."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8 border-t border-white/10 pt-6 text-left">
      <h2 className="font-display text-lg">Want to tell us more? <span className="text-sm text-muted">(optional)</span></h2>
      <p className="mt-1 text-sm text-muted">A line about what you'd like to make, and a resume if you'd like to share one. Neither is needed to be approved.</p>

      <label className="mt-4 block text-xs uppercase tracking-widest text-muted" htmlFor="request-note">
        What would you like to make?
      </label>
      <textarea
        id="request-note"
        value={message}
        onChange={(e) => {
          setMessage(e.target.value);
          setSent(false);
        }}
        rows={3}
        maxLength={1000}
        placeholder="For example: short explainer videos from my team's reports"
        className="mt-1.5 w-full resize-none rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-primary/50 focus:outline-none"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          accept=".pdf,application/pdf"
          hidden
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
        <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={busy}>
          <Paperclip className="h-3.5 w-3.5" />
          {existing?.resume_name || file ? "Replace resume" : "Add a resume (PDF)"}
        </Button>
        {file ? (
          <span className="inline-flex items-center gap-1.5 text-sm">
            <FileText className="h-4 w-4 text-primary-text" />
            <span className="max-w-[220px] truncate">{file.name}</span>
          </span>
        ) : existing?.resume_name ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span className="max-w-[220px] truncate">{existing.resume_name}</span>
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" onClick={submit} disabled={busy || !changed}>
          {busy ? <Spinner /> : <Send className="h-3.5 w-3.5" />}
          {busy ? "Sending…" : existing?.message || existing?.resume_name ? "Update" : "Send"}
        </Button>
        {sent && (
          <span className="inline-flex items-center gap-1.5 text-sm text-success" role="status">
            <CheckCircle2 className="h-4 w-4" />
            Got it, thank you.
          </span>
        )}
      </div>
      {error && (
        <p className="mt-3 text-sm text-destructive-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
