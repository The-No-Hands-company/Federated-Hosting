import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Shield, KeyRound, AlertTriangle, Loader2, ArrowLeft, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Step = "code" | "backup" | "locked";

export default function TwoFactorChallenge() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Parse the ?next= redirect target, default to /
  const nextUrl = (() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const n = p.get("next") ?? "/";
      // Only allow relative URLs for security
      return n.startsWith("/") ? n : "/";
    } catch {
      return "/";
    }
  })();

  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  async function submit() {
    const trimmed = code.replace(/\s/g, "");
    if (!trimmed || trimmed.length < 6) {
      setError("Enter a 6-digit code from your authenticator app.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${BASE}/api/auth/2fa/complete`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });

      const body = await res.json() as {
        authenticated?: boolean;
        method?: string;
        message?: string;
        code?: string;
        remaining?: number;
      };

      if (res.ok && body.authenticated) {
        // Full session established — redirect to intended destination
        setLocation(nextUrl);
        return;
      }

      if (body.code === "TOTP_LOCKED") {
        setStep("locked");
        return;
      }

      if (typeof body.remaining === "number") {
        setAttemptsLeft(body.remaining);
      }

      setError(body.message ?? "Invalid code. Please try again.");
      setCode("");
      inputRef.current?.focus();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") submit();
  }

  // Format code input: insert space after digit 3 for readability (123 456)
  function handleCodeChange(val: string) {
    const digits = val.replace(/\D/g, "").slice(0, step === "backup" ? 16 : 6);
    setCode(digits);
    setError(null);
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 items-center justify-center mb-4">
            {step === "locked"
              ? <AlertTriangle className="w-7 h-7 text-red-400" />
              : <Shield className="w-7 h-7 text-primary" />}
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            {step === "code" && "Two-factor authentication"}
            {step === "backup" && "Use a backup code"}
            {step === "locked" && "Account temporarily locked"}
          </h1>
          <p className="text-muted-foreground text-sm mt-2">
            {step === "code" && "Enter the 6-digit code from your authenticator app."}
            {step === "backup" && "Enter one of the backup codes you saved when setting up 2FA."}
            {step === "locked" && "Too many failed attempts. Try again in 10 minutes."}
          </p>
        </div>

        {step === "locked" ? (
          <div className="space-y-4">
            <div className="bg-red-400/10 border border-red-400/20 rounded-2xl p-4 text-center">
              <p className="text-red-400 text-sm">
                Your account has been temporarily locked due to repeated failed attempts.
                This protects against brute-force attacks.
              </p>
            </div>
            <Button
              variant="outline"
              className="w-full border-white/10 text-muted-foreground hover:text-white"
              onClick={() => window.location.href = "/api/auth/logout"}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to sign in
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Code input */}
            <div>
              <input
                ref={inputRef}
                type={step === "backup" ? "text" : "number"}
                inputMode="numeric"
                autoComplete={step === "backup" ? "off" : "one-time-code"}
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                onKeyDown={handleKey}
                placeholder={step === "backup" ? "BACKUP-CODE" : "000000"}
                className={cn(
                  "w-full bg-muted/20 border rounded-2xl px-5 py-4 text-white text-2xl font-mono tracking-[0.4em] text-center placeholder:text-muted-foreground/40 placeholder:tracking-normal focus:outline-none transition-colors",
                  error
                    ? "border-red-400/50 focus:border-red-400"
                    : "border-white/10 focus:border-primary/50",
                )}
              />
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-red-400 text-xs mt-2 text-center flex items-center justify-center gap-1.5"
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {error}
                </motion.p>
              )}
              {attemptsLeft !== null && !error && (
                <p className="text-amber-400 text-xs mt-2 text-center">
                  {attemptsLeft} attempt{attemptsLeft !== 1 ? "s" : ""} remaining before lockout.
                </p>
              )}
            </div>

            {/* Submit */}
            <Button
              className="w-full bg-primary text-black hover:bg-primary/90 font-semibold h-12 text-base"
              onClick={submit}
              disabled={loading || code.length < 6}
            >
              {loading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying…</>
                : <><KeyRound className="w-4 h-4 mr-2" />Verify</>}
            </Button>

            {/* Switch between TOTP and backup */}
            <button
              className="w-full text-sm text-muted-foreground hover:text-white transition-colors flex items-center justify-center gap-1.5 py-1"
              onClick={() => { setStep(step === "code" ? "backup" : "code"); setCode(""); setError(null); }}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              {step === "code" ? "Use a backup code instead" : "Use authenticator app instead"}
            </button>

            <button
              className="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              onClick={() => window.location.href = "/api/auth/logout"}
            >
              Sign in with a different account
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
