import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, LogOut, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import RequestDetailsCard from "@/components/access/RequestDetailsCard";

/**
 * Where a signed-in account lands until an admin approves it. It never polls: it checks when the person clicks
 * "Check now" and whenever they come back to the tab, and an approved answer moves them straight into the app.
 */
export default function AwaitingApprovalPage() {
  const { profile, logout, refreshAccess } = useAuth();
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const inFlight = useRef(false);
  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      await refreshAccess(); // an approved answer switches the whole app over; a pending one leaves this page as is
    } finally {
      setLastChecked(new Date());
      setChecking(false);
      inFlight.current = false;
    }
  }, [refreshAccess]);

  // No timer. Checking again when the person returns to this tab covers "I was approved while I was away".
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [check]);

  const name = [profile?.fn, profile?.ln].filter(Boolean).join(" ");

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-[32rem] w-[32rem] rounded-full bg-primary/30 blur-[120px]" />
        <div className="absolute -right-24 top-1/3 h-[28rem] w-[28rem] rounded-full bg-accent/25 blur-[120px]" />
      </div>

      <main className="chat-in relative z-10 my-8 w-full max-w-lg rounded-3xl border border-white/15 bg-white/[0.07] p-8 text-center shadow-2xl backdrop-blur-2xl sm:p-10">
        <span className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-white/10 text-primary-text">
          <Clock className="h-6 w-6" />
        </span>

        <h1 className="font-display text-3xl font-normal">You're on the list</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted">
          Cinecule is invite-only while it's in early access. Your request is in and your account is waiting for approval
          {name ? `, ${name}` : ""}.
        </p>

        <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left text-sm text-muted">
          <li className="flex gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span>Your account is created{profile?.email ? ` for ${profile.email}` : ""}.</span>
          </li>
          <li className="flex gap-2">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary-text" />
            <span>We review new accounts and approve them in batches, so this can take a little while.</span>
          </li>
          <li className="flex gap-2">
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary-text" />
            <span>Once you're approved, come back to this page. It checks whenever you return to the tab, or you can press Check now.</span>
          </li>
        </ul>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button onClick={check} disabled={checking}>
            {checking ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
            {checking ? "Checking…" : "Check now"}
          </Button>
          <Button variant="outline" onClick={logout}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>

        <p className="mt-5 h-4 text-xs text-muted" role="status">
          {lastChecked ? `Not approved yet. Last checked ${lastChecked.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : ""}
        </p>

        <RequestDetailsCard />
      </main>
    </div>
  );
}
