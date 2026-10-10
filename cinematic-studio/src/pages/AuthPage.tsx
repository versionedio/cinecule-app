import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Clapperboard } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { register, forgotPassword } from "../services/authService";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

type Mode = "login" | "register" | "forgot";

export default function AuthPage() {
  const { login } = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "register" ? "register" : "login");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [fn, setFn] = useState("");
  const [ln, setLn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "login") {
        await login(email, pwd);
      } else if (mode === "register") {
        await register(email, pwd, fn, ln);
        setNotice("Account created. Check your email for a verification link, then sign in.");
        setMode("login");
      } else {
        await forgotPassword(email);
        setNotice("If that address exists, a reset email is on its way.");
        setMode("login");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="hidden flex-col justify-between overflow-hidden bg-[#191816] p-16 text-[#e8e4dc] md:flex">
        <span className="font-display text-lg tracking-wide">Cinematic Studio</span>
        <div>
          <p className="mb-6 text-[11px] uppercase tracking-widest text-[#c99b4e]">Reel one · sheet one</p>
          <h2 className="mb-4 max-w-[20ch] font-display text-5xl font-normal leading-[1.05] text-[#f2ede4]">
            The camera does the reading so you can do the deciding.
          </h2>
          <p className="max-w-[46ch] text-[15px] leading-relaxed text-[#bdb6a9]">
            Sign in to pick up a project mid-pipeline. Sessions refresh silently in the background, so a long render
            won't sign you out.
          </p>
        </div>
        <div />
      </div>

      <div className="flex items-center justify-center p-4">
        <Card className="motion-safe:animate-scale-in w-full max-w-[400px] border-none p-8 sm:border sm:border-border">
          <Link to="/" className="mb-6 flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <Clapperboard className="h-7 w-7 text-primary" />
            <div>
              <h1 className="font-display text-xl font-semibold">Cinematic Studio</h1>
              <p className="text-[11px] uppercase tracking-widest text-muted">article &rarr; 4K film, automatically</p>
            </div>
          </Link>

          <div className="flex flex-col gap-4">
          {error && <Alert severity="error">{error}</Alert>}
          {notice && <Alert severity="success">{notice}</Alert>}

          {mode === "register" && (
            <div className="flex gap-3">
              <Field label="First name">
                <Input value={fn} onChange={(e) => setFn(e.target.value)} />
              </Field>
              <Field label="Last name">
                <Input value={ln} onChange={(e) => setLn(e.target.value)} />
              </Field>
            </div>
          )}
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {mode !== "forgot" && (
            <Field label="Password">
              <Input
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </Field>
          )}

          <Button size="lg" disabled={busy} onClick={submit}>
            {mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Send reset email"}
          </Button>

          <div className="flex justify-between text-sm">
            {mode !== "login" ? (
              <button className="text-primary-text hover:underline" onClick={() => setMode("login")}>
                Back to sign in
              </button>
            ) : (
              <>
                <button className="text-primary-text hover:underline" onClick={() => setMode("register")}>
                  Create account
                </button>
                <button className="text-primary-text hover:underline" onClick={() => setMode("forgot")}>
                  Forgot password?
                </button>
              </>
            )}
          </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
