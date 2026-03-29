import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Eye, EyeOff, Loader2, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function ResetPasswordPage() {
  const search = useSearch();
  const token  = new URLSearchParams(search).get("token") ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [password, setPassword]   = useState("");
  const [confirm,  setConfirm]    = useState("");
  const [showPwd,  setShowPwd]    = useState(false);
  const [done,     setDone]       = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      if (password !== confirm) throw new Error("Passwords don't match");
      const r = await fetch(`${BASE}/api/auth/local/reset`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await r.json() as { ok?: boolean; message?: string };
      if (!r.ok) throw new Error(data.message ?? "Reset failed");
      return data;
    },
    onSuccess: () => setDone(true),
    onError: (e: Error) => toast({ title: "Reset failed", description: e.message, variant: "destructive" }),
  });

  const strength = password.length === 0 ? null : password.length < 8 ? "weak" : password.length < 12 ? "ok" : "strong";
  const strengthColor = { weak: "text-red-400", ok: "text-amber-400", strong: "text-green-400" };

  if (!token) return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center space-y-3">
        <p className="text-muted-foreground">Invalid reset link.</p>
        <Button variant="outline" onClick={() => navigate("/login")}>Back to login</Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <a href="/" className="inline-flex items-center gap-2.5 text-lg font-bold text-white">
            <svg className="w-8 h-8 text-primary" viewBox="0 0 32 32" fill="none">
              <polygon points="16,2 30,9 30,23 16,30 2,23 2,9" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              <polygon points="16,8 24,12 24,20 16,24 8,20 8,12" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5"/>
              <circle cx="16" cy="16" r="2.5" fill="currentColor"/>
            </svg>
            Nexus Hosting
          </a>
        </div>

        <motion.div
          className="bg-card border border-white/5 rounded-2xl p-8 shadow-2xl"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {done ? (
            <div className="text-center space-y-4 py-4">
              <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
              <h2 className="text-xl font-bold text-white">Password updated</h2>
              <p className="text-sm text-muted-foreground">You can now sign in with your new password.</p>
              <Button className="w-full" onClick={() => navigate("/login")}>Sign in</Button>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h1 className="text-xl font-bold text-white mb-1">Set new password</h1>
                <p className="text-sm text-muted-foreground">Choose a strong password for your account.</p>
              </div>

              <form onSubmit={e => { e.preventDefault(); mutation.mutate(); }} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    New password
                  </label>
                  <div className="relative">
                    <input
                      type={showPwd ? "text" : "password"}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Min. 8 characters"
                      autoComplete="new-password"
                      className="w-full bg-muted/20 border border-white/8 rounded-xl px-4 py-3 text-white text-sm
                                 placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40 pr-10"
                    />
                    <button type="button" onClick={() => setShowPwd(s => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white">
                      {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {strength && (
                    <p className={`text-xs ${strengthColor[strength]}`}>
                      {strength === "weak" ? "Too short" : strength === "ok" ? "OK — longer is better" : "Strong ✓"}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Confirm password
                  </label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Repeat password"
                    autoComplete="new-password"
                    className="w-full bg-muted/20 border border-white/8 rounded-xl px-4 py-3 text-white text-sm
                               placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40"
                  />
                  {confirm && password !== confirm && (
                    <p className="text-xs text-red-400">Passwords don't match</p>
                  )}
                </div>

                <Button type="submit" className="w-full"
                  disabled={!password || password !== confirm || mutation.isPending}>
                  {mutation.isPending
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Updating…</>
                    : "Update password"}
                </Button>
              </form>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
