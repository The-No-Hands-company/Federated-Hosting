import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  LogIn, Globe, Upload, Rocket, CheckCircle,
  ChevronRight, ChevronLeft, X, Terminal, ExternalLink,
} from "lucide-react";
import { useAuth } from "@workspace/auth-web";
import { cn } from "@/lib/utils";

interface OnboardingStep {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  color: string;
  bg: string;
  detail: React.ReactNode;
}

const STEPS: OnboardingStep[] = [
  {
    id: "signin",
    icon: LogIn,
    title: "Sign in",
    description: "Create your account with one click.",
    color: "text-primary",
    bg: "bg-primary/10 border-primary/20",
    detail: (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>
          Nexus Hosting uses OpenID Connect for authentication — no separate
          account needed. Click <strong className="text-white">Get Started</strong> or the sign-in button
          in the top-right corner.
        </p>
        <p>
          Your identity is tied to your account on the OIDC provider. Your sites,
          deployments, and API tokens are all linked to your user ID.
        </p>
      </div>
    ),
  },
  {
    id: "register",
    icon: Globe,
    title: "Register a site",
    description: "Give your site a name and a domain.",
    color: "text-secondary",
    bg: "bg-secondary/10 border-secondary/20",
    detail: (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>
          Go to <strong className="text-white">My Sites</strong> and click{" "}
          <strong className="text-white">+ New Site</strong>. Choose a subdomain — this
          is the address where your site will be reachable.
        </p>
        <div className="bg-muted/20 border border-white/5 rounded-xl p-3 font-mono text-xs text-primary">
          mysite.nexushosting.network
        </div>
        <p>
          You can also attach a custom domain later (e.g.{" "}
          <code className="text-white">www.mycompany.com</code>) once your site is
          live — just add a CNAME record in your DNS.
        </p>
      </div>
    ),
  },
  {
    id: "upload",
    icon: Upload,
    title: "Upload your files",
    description: "Drag & drop HTML, CSS, JS and assets.",
    color: "text-amber-400",
    bg: "bg-amber-400/10 border-amber-400/20",
    detail: (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>
          From My Sites, click <strong className="text-white">Deploy</strong> on your
          site. Drag your built files into the drop zone — or use the{" "}
          <strong className="text-white">fh CLI</strong> to deploy straight from your
          terminal:
        </p>
        <div className="bg-black/40 rounded-xl p-3 font-mono text-xs text-primary space-y-1">
          <p className="text-muted-foreground"># Install the CLI</p>
          <p>npm install -g @nexushosting/cli</p>
          <p className="text-muted-foreground mt-2"># Log in and deploy</p>
          <p>nh login --node https://your-node.example.com</p>
          <p>nh deploy ./dist --site 42</p>
        </div>
        <p>
          Files are uploaded directly to object storage — the API server never
          touches the bytes.
        </p>
      </div>
    ),
  },
  {
    id: "deploy",
    icon: Rocket,
    title: "Deploy",
    description: "Go live and replicate across the network.",
    color: "text-status-active",
    bg: "bg-status-active/10 border-status-active/20",
    detail: (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>
          Click <strong className="text-white">Deploy Site</strong>. Your files are
          committed atomically — either all files go live, or none do. There are no
          partial deployments.
        </p>
        <p>
          Every deploy automatically notifies all active federation peers. Each peer
          downloads your files and hosts them independently — so your site stays
          online even if your origin node goes down.
        </p>
        <p>
          You can roll back to any previous deployment with one click from the Deploy
          page, and view per-page analytics from My Sites.
        </p>
      </div>
    ),
  },
];

const LS_KEY = "nh_onboarding_dismissed";

export function useOnboarding() {
  const dismissed = typeof window !== "undefined"
    ? localStorage.getItem(LS_KEY) === "1"
    : true;
  return { shouldShow: !dismissed };
}

export function OnboardingBanner({ onOpen }: { onOpen: () => void }) {
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-transparent to-secondary/5 p-5"
    >
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-primary/10 blur-2xl" />
        <div className="absolute -bottom-4 left-1/3 w-24 h-24 rounded-full bg-secondary/10 blur-2xl" />
      </div>

      <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
            <Rocket className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-white font-semibold">Welcome to Nexus Hosting</p>
            <p className="text-muted-foreground text-sm">
              Deploy your first site in 4 steps — sign in, register, upload, go live.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            className="bg-primary text-black hover:bg-primary/90 font-semibold"
            onClick={onOpen}
          >
            Get Started
            <ChevronRight className="w-3.5 h-3.5 ml-1" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground hover:text-white w-8 h-8"
            onClick={() => {
              localStorage.setItem(LS_KEY, "1");
              setHidden(true);
            }}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

export function OnboardingModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [, navigate] = useLocation();
  const { isAuthenticated, login } = useAuth();

  const current = STEPS[step]!;
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;

  function handleDone() {
    localStorage.setItem(LS_KEY, "1");
    onClose();
    navigate("/onboarding/deploy");
  }

  function handlePrimaryAction() {
    if (isLast) {
      handleDone();
      return;
    }
    if (step === 0 && !isAuthenticated) {
      login();
      return;
    }
    setStep((s) => s + 1);
  }

  const primaryLabel = isLast
    ? "Go to My Sites"
    : step === 0 && !isAuthenticated
    ? "Sign In"
    : "Next";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card border-white/10 max-w-lg p-0 overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-white/5 w-full">
          <motion.div
            className="h-full bg-primary"
            animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        </div>

        <div className="p-6">
          <DialogHeader className="mb-6">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-white text-lg">
                Getting Started
              </DialogTitle>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </DialogHeader>

          {/* Step indicators */}
          <div className="flex gap-2 mb-6">
            {STEPS.map((s, i) => {
              const StepIcon = s.icon;
              const done = i < step;
              const active = i === step;
              return (
                <button
                  key={s.id}
                  onClick={() => setStep(i)}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all",
                    active ? `${s.bg} border-current` : done
                      ? "border-status-active/20 bg-status-active/5"
                      : "border-white/5 bg-transparent opacity-50",
                  )}
                >
                  {done ? (
                    <CheckCircle className="w-5 h-5 text-status-active" />
                  ) : (
                    <StepIcon className={cn("w-5 h-5", active ? s.color : "text-muted-foreground")} />
                  )}
                  <span className={cn("text-xs font-medium hidden sm:block", active ? "text-white" : "text-muted-foreground")}>
                    {i + 1}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Step content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <div className={cn("w-12 h-12 rounded-2xl border flex items-center justify-center", current.bg)}>
                <Icon className={cn("w-6 h-6", current.color)} />
              </div>

              <div>
                <h3 className="text-xl font-bold text-white mb-1">
                  Step {step + 1}: {current.title}
                </h3>
                <p className="text-muted-foreground text-sm">{current.description}</p>
              </div>

              <div className="bg-muted/20 border border-white/5 rounded-xl p-4">
                {current.detail}
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep((s) => s - 1)}
              disabled={isFirst}
              className="text-muted-foreground hover:text-white disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>

            <span className="text-muted-foreground text-xs">
              {step + 1} / {STEPS.length}
            </span>

            <Button
              onClick={handlePrimaryAction}
              className={cn(
                "font-semibold",
                isLast
                  ? "bg-status-active text-black hover:bg-status-active/90"
                  : "bg-primary text-black hover:bg-primary/90",
              )}
            >
              {primaryLabel}
              {!isLast && <ChevronRight className="w-3.5 h-3.5 ml-1" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
