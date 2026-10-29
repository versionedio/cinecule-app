import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, FileSearch, RefreshCw, ShieldCheck, UserCheck, UserMinus } from "lucide-react";
import { Person, PeopleSnapshot, approve, loadPeople, loadResumeText, revoke } from "@/services/adminService";
import { ResumeText } from "@/components/access/ResumeText";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

const label = (p: Person) => p.request?.full_name || p.request?.email || `Account ${p.userId.slice(0, 8)}`;

/** Who is waiting, who is in. Approving or removing someone is a single click and takes effect on their next check. */
export default function AdminUsersPage() {
  const [snapshot, setSnapshot] = useState<PeopleSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [resumeBusy, setResumeBusy] = useState<string | null>(null);
  const [resumes, setResumes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Sets state only once the answer is back, so it can run straight from an effect.
  const load = useCallback(async () => {
    try {
      setSnapshot(await loadPeople());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the list.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = () => {
    setLoading(true);
    void load();
  };

  useEffect(() => {
    void load();
  }, [load]);

  const { pending, members } = useMemo(() => {
    const people = snapshot?.people ?? [];
    // People who wrote something come first: they are the ones worth a closer look.
    const detail = (p: Person) => Number(Boolean(p.request?.message)) + Number(Boolean(p.request?.resume_name)) + Number(Boolean(p.request?.email));
    return {
      pending: people.filter((p) => p.role === "pending").sort((a, b) => detail(b) - detail(a)),
      members: people.filter((p) => p.role !== "pending").sort((a, b) => label(a).localeCompare(label(b)))
    };
  }, [snapshot]);

  const act = async (person: Person, run: () => Promise<void>, done: string) => {
    setBusyId(person.userId);
    setError("");
    setNotice("");
    try {
      await run();
      setNotice(done);
      setConfirming(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Nothing was changed.");
    } finally {
      setBusyId(null);
    }
  };

  // The resume file is private, so the backend (admins only) reads it and sends back its text, shown under the request.
  const toggleResume = async (person: Person) => {
    const id = person.request?.id;
    if (!id) return;
    if (resumes[person.userId] !== undefined) {
      setResumes((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== person.userId)));
      return;
    }
    setResumeBusy(person.userId);
    setError("");
    try {
      const text = await loadResumeText(id);
      setResumes((prev) => ({ ...prev, [person.userId]: text }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The resume could not be read.");
    } finally {
      setResumeBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Access</h1>
          <p className="mt-1 text-sm text-muted">
            New accounts wait here until you let them in. Someone you approve gets in the next time they sign in or press
            "Check now" on their waiting page.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading || busyId !== null}>
          {loading ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}

      {loading && !snapshot ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <>
          <section>
            <h2 className="font-display text-lg font-semibold">
              Waiting for approval <span className="text-sm font-normal text-muted">({pending.length})</span>
            </h2>
            {pending.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Nobody is waiting.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {pending.map((p) => (
                  <li key={p.userId}>
                    <Card className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{label(p)}</p>
                          {p.request?.email && p.request.full_name && <p className="truncate text-sm text-muted">{p.request.email}</p>}
                          {!p.request?.email && <p className="text-sm text-muted">No details yet: they haven't opened their waiting page since signing up.</p>}
                        </div>
                        <Button size="sm" onClick={() => void act(p, () => approve(p.userId, snapshot!.memberPolicyId), `${label(p)} is approved.`)} disabled={busyId !== null}>
                          {busyId === p.userId ? <Spinner /> : <UserCheck className="h-3.5 w-3.5" />}
                          Approve
                        </Button>
                      </div>
                      {p.request?.message && <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-surface-raised px-3 py-2 text-sm">{p.request.message}</p>}
                      {p.request?.resume_name && (
                        <div className="mt-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <p className="inline-flex items-center gap-1.5 text-sm text-muted">
                              <FileText className="h-4 w-4 text-primary-text" />
                              Resume: <span className="max-w-[260px] truncate text-foreground">{p.request.resume_name}</span>
                            </p>
                            <Button variant="outline" size="sm" onClick={() => void toggleResume(p)} disabled={busyId !== null || resumeBusy !== null}>
                              {resumeBusy === p.userId ? <Spinner /> : <FileSearch className="h-3.5 w-3.5" />}
                              {resumes[p.userId] !== undefined ? "Hide resume" : "Read resume"}
                            </Button>
                          </div>
                          {resumes[p.userId] !== undefined && (
                            <ResumeText text={resumes[p.userId]} name={p.request.resume_name} />
                          )}
                        </div>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold">
              People with access <span className="text-sm font-normal text-muted">({members.length})</span>
            </h2>
            {members.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Nobody yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border rounded-[7px] border border-border">
                {members.map((p) => (
                  <li key={p.userId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{label(p)}</p>
                      {p.request?.email && p.request.full_name && <p className="truncate text-xs text-muted">{p.request.email}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {p.role === "admin" ? (
                        <Badge className="gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          Admin
                        </Badge>
                      ) : (
                        <>
                          <Badge className="gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Member
                          </Badge>
                          {confirming === p.userId ? (
                            <>
                              <Button variant="destructive" size="sm" onClick={() => void act(p, () => revoke(p), `${label(p)} is back on the waiting list.`)} disabled={busyId !== null}>
                                {busyId === p.userId ? <Spinner /> : <UserMinus className="h-3.5 w-3.5" />}
                                Confirm
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => setConfirming(null)} disabled={busyId !== null}>
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => setConfirming(p.userId)} disabled={busyId !== null}>
                              Remove access
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">Removing access keeps the account and everything it made. It just puts the person back on the waiting list.</p>
          </section>
        </>
      )}
    </div>
  );
}
