import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LocalAuthAvailable { enabled: boolean }
interface AuthResult {
  ok: boolean;
  user?: { id: string; email: string; firstName?: string | null };
  message?: string;
}

function InputField({
  label, type = "text", value, onChange, placeholder, autoComplete, hint,
}: {
  label: string; type?: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
  autoComplete?: string; hint?: string;
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </label>
      <div className="relative">
        <input
          type={isPassword && show ? "text" : type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="w-full bg-muted/20 border border-white/8 rounded-xl px-4 py-3 text-white text-sm
                     placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40
                     focus:bg-primary/5 transition-colors pr-10"
        />
        {isPassword && (
          <button type="button" onClick={() => setShow(s => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function LoginForm({ onSuccess, onSwitch }: { onSuccess: () => void; onSwitch: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/auth/local/login`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json() as AuthResult & { code?: string };
      if (!r.ok) throw new Error(data.message ?? data.code ?? "Login failed");
      return data;
    },
    onSuccess: () => onSuccess(),
    onError: (e: Error) => toast({ title: "Login failed", description: e.message, variant: "destructive" }),
  });

  return (
    <form onSubmit={e => { e.preventDefault(); mutation.mutate(); }} className="space-y-4">
      <InputField label="Email" type="email" value={email} onChange={setEmail}
        placeholder="you@example.com" autoComplete="email" />
      <InputField label="Password" type="password" value={password} onChange={setPassword}
        placeholder="••••••••" autoComplete="current-password" />

      <div className="flex justify-end">
        <button type="button" onClick={() => window.location.href = "/forgot-password"}
          className="text-xs text-muted-foreground hover:text-primary transition-colors">
          Forgot password?
        </button>
      </div>

      <Button type="submit" className="w-full" disabled={!email || !password || mutation.isPending}>
        {mutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Signing in…</> : "Sign in"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        No account?{" "}
        <button type="button" onClick={onSwitch} className="text-primary hover:underline">
          Create one
        </button>
      </p>
    </form>
  );
}

function RegisterForm({ onSuccess, onSwitch }: { onSuccess: () => void; onSwitch: () => void }) {
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      if (password !== confirm) throw new Error("Passwords don't match");
      const r = await fetch(`${BASE}/api/auth/local/register`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await r.json() as AuthResult & { code?: string };
      if (!r.ok) throw new Error(data.message ?? data.code ?? "Registration failed");
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "Account created", description: data.message ?? "Welcome to Nexus Hosting!" });
      onSuccess();
    },
    onError: (e: Error) => toast({ title: "Registration failed", description: e.message, variant: "destructive" }),
  });

  const strong = password.length >= 12;
  const ok     = password.length >= 8;

  return (
    <form onSubmit={e => { e.preventDefault(); mutation.mutate(); }} className="space-y-4">
      <InputField label="Your name" value={name} onChange={setName}
        placeholder="Jane Smith" autoComplete="name" />
      <InputField label="Email" type="email" value={email} onChange={setEmail}
        placeholder="you@example.com" autoComplete="email" />
      <InputField label="Password" type="password" value={password} onChange={setPassword}
        placeholder="Min. 8 characters" autoComplete="new-password"
        hint={password.length > 0 ? (strong ? "Strong ✓" : ok ? "OK — longer is better" : "Too short") : undefined} />
      <InputField label="Confirm password" type="password" value={confirm} onChange={setConfirm}
        placeholder="Repeat password" autoComplete="new-password" />

      <Button type="submit" className="w-full"
        disabled={!email || !password || password !== confirm || mutation.isPending}>
        {mutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating account…</> : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <button type="button" onClick={onSwitch} className="text-primary hover:underline">
          Sign in
        </button>
      </p>
    </form>
  );
}

export default function LocalAuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [, navigate] = useLocation();

  // Check if local auth is enabled on this node
  const { data, isLoading } = useQuery<LocalAuthAvailable>({
    queryKey: ["local-auth-available"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/auth/local/available`);
      return r.json();
    },
    staleTime: Infinity,
  });

  const handleSuccess = () => {
    navigate("/dashboard");
    window.location.reload(); // refresh auth state
  };

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
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
          <div className="mb-6">
            <h1 className="text-xl font-bold text-white mb-1">
              {mode === "login" ? "Welcome back" : "Create account"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === "login"
                ? "Sign in to your Nexus Hosting account"
                : "Join this Nexus Hosting node"}
            </p>
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={mode}
              initial={{ opacity: 0, x: mode === "login" ? -8 : 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}>
              {mode === "login"
                ? <LoginForm onSuccess={handleSuccess} onSwitch={() => setMode("register")} />
                : <RegisterForm onSuccess={handleSuccess} onSwitch={() => setMode("login")} />
              }
            </motion.div>
          </AnimatePresence>

          {/* OIDC divider if available */}
          {data?.enabled && (
            <>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/8" />
                </div>
                <div className="relative flex justify-center text-xs text-muted-foreground">
                  <span className="bg-card px-3">or continue with</span>
                </div>
              </div>
              <a href="/api/login"
                className="flex items-center justify-center gap-2 w-full border border-white/10 rounded-xl
                           py-2.5 text-sm font-medium text-muted-foreground hover:text-white hover:border-white/20
                           transition-colors">
                SSO / OIDC provider
              </a>
            </>
          )}
        </motion.div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Nexus Hosting is free and open source.{" "}
          <a href="https://github.com/The-No-Hands-company/Nexus-Hosting" target="_blank" rel="noopener"
            className="text-primary hover:underline">GitHub ↗</a>
        </p>
      </div>
    </div>
  );
}
