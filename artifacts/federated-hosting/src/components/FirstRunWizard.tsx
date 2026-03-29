import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  CheckCircle2, Circle, ChevronRight, Loader2,
  Server, Shield, Database, KeyRound, ExternalLink,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SetupStep {
  id: string; title: string; description: string;
  complete: boolean; docsUrl?: string;
}
interface SetupStatus { needsSetup: boolean; steps: SetupStep[] }

const STEP_ICONS: Record<string, React.ReactNode> = {
  node_identity:  <Server   className="w-5 h-5" />,
  admin_user:     <Shield   className="w-5 h-5" />,
  object_storage: <Database className="w-5 h-5" />,
  auth:           <KeyRound className="w-5 h-5" />,
};

// ── Node identity form ────────────────────────────────────────────────────────
function NodeIdentityStep({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "", domain: "", region: "us-east-1",
    operatorName: "", operatorEmail: "", storageCapacityGb: 100,
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: k === "storageCapacityGb" ? Number(e.target.value) : e.target.value }));

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/setup/node-identity`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      return r.json();
    },
    onSuccess: () => { toast({ title: "Node identity saved ✓" }); onDone(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const regions = [
    "us-east-1","us-west-2","eu-west-1","eu-central-1",
    "ap-southeast-1","ap-southeast-3","ap-northeast-1","sa-east-1",
  ];

  return (
    <form onSubmit={e => { e.preventDefault(); mutation.mutate(); }} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Give your node an identity. This is how other nodes in the federation will recognise you.
      </p>
      {[
        { label: "Node name", key: "name" as const, placeholder: "My Nexus Node", required: true },
        { label: "Public domain", key: "domain" as const, placeholder: "nexus.yourdomain.com", required: true,
          hint: "The domain where this node is publicly accessible" },
        { label: "Operator name", key: "operatorName" as const, placeholder: "Your name or org" },
        { label: "Operator email", key: "operatorEmail" as const, placeholder: "you@example.com" },
      ].map(({ label, key, placeholder, required, hint }) => (
        <div key={key} className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {label}{required && " *"}
          </label>
          <input
            value={form[key] as string} onChange={set(key)} placeholder={placeholder}
            required={required}
            className="w-full bg-muted/20 border border-white/8 rounded-xl px-4 py-2.5 text-white text-sm
                       placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40"
          />
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      ))}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Region</label>
          <select value={form.region} onChange={set("region")}
            className="w-full bg-muted/20 border border-white/8 rounded-xl px-4 py-2.5 text-white text-sm
                       focus:outline-none focus:border-primary/40 cursor-pointer">
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Storage (GB)</label>
          <input type="number" min={1} value={form.storageCapacityGb} onChange={set("storageCapacityGb")}
            className="w-full bg-muted/20 border border-white/8 rounded-xl px-4 py-2.5 text-white text-sm
                       focus:outline-none focus:border-primary/40" />
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={!form.name || !form.domain || mutation.isPending}>
        {mutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : "Save node identity →"}
      </Button>
    </form>
  );
}

// ── Generic doc-link step ─────────────────────────────────────────────────────
function DocStep({ step, onDone }: { step: SetupStep; onDone: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{step.description}</p>
      {step.docsUrl && (
        <a href={step.docsUrl} target="_blank" rel="noopener"
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <ExternalLink className="w-3.5 h-3.5" />
          View setup guide
        </a>
      )}
      <div className="bg-muted/10 border border-white/5 rounded-xl p-4 space-y-2">
        {step.id === "admin_user" && (
          <>
            <p className="text-xs font-mono text-muted-foreground"># Option 1 — env var (recommended)</p>
            <p className="text-xs font-mono text-primary">ADMIN_USER_IDS=user-id-here</p>
            <p className="text-xs font-mono text-muted-foreground mt-3"># Option 2 — SQL</p>
            <p className="text-xs font-mono text-primary">UPDATE users SET is_admin=1 WHERE email='you@example.com';</p>
          </>
        )}
        {step.id === "object_storage" && (
          <>
            <p className="text-xs font-mono text-muted-foreground"># MinIO is bundled — just set these:</p>
            <p className="text-xs font-mono text-primary">OBJECT_STORAGE_ENDPOINT=http://minio:9000</p>
            <p className="text-xs font-mono text-primary">OBJECT_STORAGE_ACCESS_KEY=nexus</p>
            <p className="text-xs font-mono text-primary">OBJECT_STORAGE_SECRET_KEY=your-password</p>
          </>
        )}
        {step.id === "auth" && (
          <>
            <p className="text-xs font-mono text-muted-foreground"># Local auth (simplest — no external service)</p>
            <p className="text-xs font-mono text-primary">LOCAL_AUTH_ENABLED=true  # default</p>
            <p className="text-xs font-mono text-muted-foreground mt-3"># Or OIDC (Authentik/Keycloak/Auth0)</p>
            <p className="text-xs font-mono text-primary">ISSUER_URL=https://auth.yourdomain.com/app/o/nexus/</p>
            <p className="text-xs font-mono text-primary">OIDC_CLIENT_ID=your-client-id</p>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        After updating your <code className="text-primary">.env</code>, restart the server and click below.
      </p>
      <Button onClick={onDone} variant="outline" className="w-full border-white/10">
        I've done this — check again →
      </Button>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────
export function FirstRunWizard() {
  const qc = useQueryClient();
  const [activeStep, setActiveStep] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<SetupStatus>({
    queryKey: ["setup-status"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/setup/status`, { credentials: "include" });
      return r.json();
    },
    refetchInterval: false,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  if (!data?.needsSetup) return null;

  const steps = data.steps;
  const currentStep = activeStep
    ? steps.find(s => s.id === activeStep)
    : steps.find(s => !s.complete);

  const handleStepDone = async () => {
    await refetch();
    await qc.invalidateQueries({ queryKey: ["setup-status"] });
    // Move to next incomplete step
    const next = steps.find(s => !s.complete && s.id !== currentStep?.id);
    setActiveStep(next?.id ?? null);
  };

  const allDone = steps.every(s => s.complete);

  return (
    <div className="min-h-screen flex items-start justify-center bg-background pt-16 px-4 pb-16">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <svg className="w-8 h-8 text-primary" viewBox="0 0 32 32" fill="none">
              <polygon points="16,2 30,9 30,23 16,30 2,23 2,9" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              <polygon points="16,8 24,12 24,20 16,24 8,20 8,12" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5"/>
              <circle cx="16" cy="16" r="2.5" fill="currentColor"/>
            </svg>
            <h1 className="text-2xl font-bold text-white">Welcome to Nexus Hosting</h1>
          </div>
          <p className="text-muted-foreground">
            {allDone
              ? "Your node is ready. Head to the dashboard to deploy your first site."
              : "Let's get your node configured. Complete each step to start hosting."}
          </p>
        </div>

        {/* Step list */}
        <div className="space-y-3 mb-8">
          {steps.map((step, i) => {
            const isActive = currentStep?.id === step.id;
            const icon = STEP_ICONS[step.id] ?? <Circle className="w-5 h-5" />;

            return (
              <div key={step.id}>
                <button
                  onClick={() => setActiveStep(isActive ? null : step.id)}
                  className={`w-full text-left border rounded-xl transition-colors
                    ${isActive
                      ? "border-primary/40 bg-primary/5"
                      : step.complete
                        ? "border-green-500/20 bg-green-500/5 opacity-70"
                        : "border-white/8 bg-muted/10 hover:border-white/15"
                    }`}
                >
                  <div className="flex items-center gap-4 px-5 py-4">
                    <div className={`flex-shrink-0 ${step.complete ? "text-green-400" : isActive ? "text-primary" : "text-muted-foreground"}`}>
                      {step.complete ? <CheckCircle2 className="w-5 h-5" /> : icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold ${step.complete ? "text-green-400" : "text-white"}`}>
                          {i + 1}. {step.title}
                        </span>
                        {step.complete && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
                            Done
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{step.description}</p>
                    </div>
                    <ChevronRight className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${isActive ? "rotate-90" : ""}`} />
                  </div>
                </button>

                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="border border-t-0 border-primary/20 rounded-b-xl bg-card/50 px-5 py-5">
                        {step.id === "node_identity"
                          ? <NodeIdentityStep onDone={handleStepDone} />
                          : <DocStep step={step} onDone={handleStepDone} />
                        }
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {allDone && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 text-green-400 font-semibold">
              <CheckCircle2 className="w-5 h-5" />
              All steps complete!
            </div>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => window.location.href = "/dashboard"}>
                Go to dashboard →
              </Button>
              <Button variant="outline" className="border-white/10"
                onClick={() => window.location.href = "/dashboard?onboarding=deploy"}>
                Deploy my first site →
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
