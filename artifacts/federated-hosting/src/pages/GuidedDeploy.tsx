import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  Upload, Globe, CheckCircle2, ChevronRight,
  Loader2, FolderOpen, Code2, Rocket,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type GuidedStep = "choose" | "name" | "upload" | "done";

const TEMPLATE_EXAMPLES = [
  { id: "html", label: "Plain HTML", icon: "📄", desc: "index.html + CSS + JS — no build step" },
  { id: "react", label: "React / Vite", icon: "⚛️", desc: "Connect a GitHub repo, nh build auto-runs" },
  { id: "blank", label: "Blank site", icon: "✦", desc: "Just reserve a domain, upload files later" },
];

function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-2 mb-10">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 text-xs font-semibold transition-colors ${
            i < current ? "text-green-400" :
            i === current ? "text-primary" : "text-muted-foreground/50"
          }`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs border ${
              i < current ? "bg-green-500/15 border-green-500/30" :
              i === current ? "bg-primary/15 border-primary/30" :
              "bg-muted/10 border-white/8"
            }`}>
              {i < current ? "✓" : i + 1}
            </div>
            <span className="hidden sm:block">{label}</span>
          </div>
          {i < steps.length - 1 && <div className="w-8 h-px bg-white/10" />}
        </div>
      ))}
    </div>
  );
}

export default function GuidedDeployPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState<GuidedStep>("choose");
  const [template, setTemplate] = useState("html");
  const [siteName, setSiteName] = useState("");
  const [domain, setDomain] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [deployedSite, setDeployedSite] = useState<{ id: number; domain: string } | null>(null);

  const publicDomain = window.location.hostname;

  // Auto-generate domain from site name
  const suggestDomain = (name: string) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    setDomain(`${slug}.${publicDomain}`);
  };

  const createSite = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/sites`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: siteName,
          domain,
          siteType: template === "react" ? "static" : "static",
          visibility: "public",
          spaRouting: template === "react" ? 1 : 0,
        }),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.message ?? "Failed to create site");
      }
      return r.json() as Promise<{ id: number; domain: string }>;
    },
  });

  const uploadAndDeploy = useMutation({
    mutationFn: async (siteId: number) => {
      if (!files?.length) return;

      // Upload each file
      for (const file of Array.from(files)) {
        const upload = await fetch(`${BASE}/api/sites/${siteId}/upload`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            fileSize: file.size,
            contentType: file.type || "application/octet-stream",
          }),
        });
        if (!upload.ok) continue;
        const { uploadUrl } = await upload.json() as { uploadUrl: string };

        await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
      }

      // Deploy
      const deploy = await fetch(`${BASE}/api/sites/${siteId}/deploy`, {
        method: "POST", credentials: "include",
      });
      if (!deploy.ok) throw new Error("Deployment failed");
      return deploy.json();
    },
  });

  const handleCreate = async () => {
    try {
      const site = await createSite.mutateAsync();
      if (template === "blank" || !files?.length) {
        setDeployedSite(site);
        setStep("done");
        return;
      }
      await uploadAndDeploy.mutateAsync(site.id);
      setDeployedSite(site);
      setStep("done");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const STEPS = ["Choose", "Name it", "Upload", "Done"];
  const STEP_IDX: Record<GuidedStep, number> = { choose: 0, name: 1, upload: 2, done: 3 };
  const isLoading = createSite.isPending || uploadAndDeploy.isPending;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-xl">

        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 text-primary mb-4">
            <Rocket className="w-5 h-5" />
            <span className="text-sm font-semibold font-mono uppercase tracking-widest">First deployment</span>
          </div>
          <h1 className="text-3xl font-bold text-white">Deploy your first site</h1>
          <p className="text-muted-foreground mt-2">
            Three steps. Under two minutes.
          </p>
        </div>

        <StepIndicator steps={STEPS} current={STEP_IDX[step]} />

        <AnimatePresence mode="wait">

          {/* Step 1 — Choose template */}
          {step === "choose" && (
            <motion.div key="choose"
              initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
              className="space-y-3">
              <h2 className="text-lg font-semibold text-white mb-4">What kind of site?</h2>
              {TEMPLATE_EXAMPLES.map(t => (
                <button key={t.id} onClick={() => setTemplate(t.id)}
                  className={`w-full text-left flex items-center gap-4 p-4 rounded-xl border transition-all ${
                    template === t.id
                      ? "border-primary/40 bg-primary/5"
                      : "border-white/8 bg-muted/10 hover:border-white/15"
                  }`}>
                  <span className="text-2xl">{t.icon}</span>
                  <div className="flex-1">
                    <p className="text-white font-semibold text-sm">{t.label}</p>
                    <p className="text-muted-foreground text-xs mt-0.5">{t.desc}</p>
                  </div>
                  {template === t.id && <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />}
                </button>
              ))}
              <Button className="w-full mt-2" onClick={() => setStep("name")}>
                Continue <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </motion.div>
          )}

          {/* Step 2 — Name + domain */}
          {step === "name" && (
            <motion.div key="name"
              initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
              className="space-y-4">
              <h2 className="text-lg font-semibold text-white mb-4">Name your site</h2>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Site name</label>
                <input
                  value={siteName}
                  onChange={e => { setSiteName(e.target.value); suggestDomain(e.target.value); }}
                  placeholder="My awesome site"
                  className="w-full bg-muted/20 border border-white/8 rounded-xl px-4 py-3 text-white text-sm
                             placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Domain
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={domain}
                    onChange={e => setDomain(e.target.value)}
                    placeholder={`mysite.${publicDomain}`}
                    className="w-full bg-muted/20 border border-white/8 rounded-xl pl-9 pr-4 py-3 text-white text-sm
                               placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  You can add a custom domain later in site settings.
                </p>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="border-white/10" onClick={() => setStep("choose")}>Back</Button>
                <Button className="flex-1"
                  disabled={!siteName.trim() || !domain.trim()}
                  onClick={() => setStep(template === "blank" ? "upload" : "upload")}>
                  Continue <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step 3 — Upload */}
          {step === "upload" && (
            <motion.div key="upload"
              initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
              className="space-y-4">
              <h2 className="text-lg font-semibold text-white mb-4">
                {template === "blank" ? "Create site (no upload)" : "Upload your files"}
              </h2>

              {template !== "blank" ? (
                <>
                  <label
                    className={`block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                      files ? "border-primary/40 bg-primary/5" : "border-white/10 hover:border-white/20"
                    }`}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); setFiles(e.dataTransfer.files); }}
                  >
                    <input type="file" multiple className="hidden"
                      onChange={e => setFiles(e.target.files)} />
                    {files ? (
                      <div className="space-y-1">
                        <CheckCircle2 className="w-8 h-8 text-primary mx-auto" />
                        <p className="text-white font-semibold">{files.length} file{files.length > 1 ? "s" : ""} selected</p>
                        <p className="text-muted-foreground text-xs">Click to change</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Upload className="w-8 h-8 text-muted-foreground mx-auto" />
                        <p className="text-white font-medium">Drag files here or click to browse</p>
                        <p className="text-muted-foreground text-xs">HTML, CSS, JS, images — everything in your site folder</p>
                      </div>
                    )}
                  </label>

                  <div className="flex items-start gap-3 p-3 bg-muted/10 border border-white/5 rounded-xl text-xs text-muted-foreground">
                    <Code2 className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                    <span>Or skip this and deploy from the CLI: <code className="text-primary">nh deploy ./dist --site {siteName || "your-site"}</code></span>
                  </div>
                </>
              ) : (
                <div className="p-4 bg-muted/10 border border-white/5 rounded-xl text-sm text-muted-foreground">
                  <FolderOpen className="w-6 h-6 text-primary mb-2" />
                  <p>A blank site will be created. Upload files any time from the dashboard or using:</p>
                  <code className="text-primary text-xs block mt-2">nh deploy ./your-folder --site {siteName || "your-site"}</code>
                </div>
              )}

              <div className="flex gap-3">
                <Button variant="outline" className="border-white/10" onClick={() => setStep("name")}>Back</Button>
                <Button className="flex-1" disabled={isLoading} onClick={handleCreate}>
                  {isLoading
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Deploying…</>
                    : <><Rocket className="w-4 h-4 mr-2" />Deploy site</>}
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step 4 — Done */}
          {step === "done" && deployedSite && (
            <motion.div key="done"
              initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-6">
              <div className="space-y-3">
                <div className="w-16 h-16 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8 text-green-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">Site deployed!</h2>
                <p className="text-muted-foreground">
                  Your site is live at:
                </p>
                <a href={`https://${deployedSite.domain}`} target="_blank" rel="noopener"
                  className="inline-flex items-center gap-2 text-primary font-mono text-sm hover:underline">
                  <Globe className="w-4 h-4" />
                  {deployedSite.domain}
                </a>
              </div>

              <div className="bg-muted/10 border border-white/5 rounded-xl p-4 text-left space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">What's next</p>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <span className="text-primary">→</span>
                    <span>Add a <strong className="text-white">custom domain</strong> in Site Settings</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-primary">→</span>
                    <span>Connect a <strong className="text-white">GitHub repo</strong> for push-to-deploy</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-primary">→</span>
                    <span>Invite <strong className="text-white">teammates</strong> via Site Settings → Team</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={() => navigate(`/my-sites`)}>
                  Go to my sites →
                </Button>
                <Button variant="outline" className="border-white/10"
                  onClick={() => window.open(`https://${deployedSite.domain}`, "_blank")}>
                  View live site ↗
                </Button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
