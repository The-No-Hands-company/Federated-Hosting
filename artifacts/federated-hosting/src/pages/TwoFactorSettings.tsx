import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@workspace/auth-web";
import { Shield, ShieldCheck, ShieldOff, Copy, RefreshCw, Smartphone, Key, AlertTriangle } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function TwoFactorSettings() {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [step, setStep]         = useState<"idle" | "setup" | "confirm" | "backup">("idle");
  const [secret, setSecret]     = useState("");
  const [qrCode, setQrCode]     = useState("");
  const [code, setCode]         = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  const { data: status, isLoading } = useQuery<{ enabled: boolean; enabledAt: string | null }>({
    queryKey: ["2fa-status"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/auth/2fa/status`, { credentials: "include" });
      return r.json();
    },
    enabled: isAuthenticated,
  });

  const setupMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/auth/2fa/setup`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error((await r.json() as any).message);
      return r.json() as Promise<{ secret: string; qrCode: string }>;
    },
    onSuccess: (d) => {
      setSecret(d.secret); setQrCode(d.qrCode); setStep("setup");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/auth/2fa/verify`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, secret }),
      });
      if (!r.ok) throw new Error((await r.json() as any).message);
      return r.json() as Promise<{ backupCodes: string[] }>;
    },
    onSuccess: (d) => {
      setBackupCodes(d.backupCodes); setStep("backup");
      qc.invalidateQueries({ queryKey: ["2fa-status"] });
    },
    onError: (e: Error) => toast({ title: "Wrong code", description: e.message, variant: "destructive" }),
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/auth/2fa/disable`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!r.ok) throw new Error((await r.json() as any).message);
    },
    onSuccess: () => {
      toast({ title: "2FA disabled" }); setCode(""); setStep("idle");
      qc.invalidateQueries({ queryKey: ["2fa-status"] });
    },
    onError: (e: Error) => toast({ title: "Wrong code", description: e.message, variant: "destructive" }),
  });

  const regenMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/auth/2fa/backup`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!r.ok) throw new Error((await r.json() as any).message);
      return r.json() as Promise<{ backupCodes: string[] }>;
    },
    onSuccess: (d) => { setBackupCodes(d.backupCodes); setStep("backup"); setCode(""); },
    onError: (e: Error) => toast({ title: "Wrong code", description: e.message, variant: "destructive" }),
  });

  if (!isAuthenticated) return <div className="p-8 text-muted-foreground">Sign in to manage 2FA.</div>;

  return (
    <div className="space-y-6 pb-12 max-w-xl animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-bold text-white">Two-Factor Authentication</h1>
        <p className="text-muted-foreground text-sm mt-1">Add a second layer of security to your account.</p>
      </div>

      {/* Status card */}
      <Card className={status?.enabled ? "border-green-500/20 bg-green-500/5" : "border-white/5"}>
        <CardContent className="flex items-center gap-4 p-5">
          {status?.enabled
            ? <ShieldCheck className="w-8 h-8 text-green-400 shrink-0" />
            : <ShieldOff className="w-8 h-8 text-muted-foreground shrink-0" />}
          <div className="flex-1">
            <p className="font-semibold text-white">{status?.enabled ? "2FA is enabled" : "2FA is disabled"}</p>
            <p className="text-muted-foreground text-sm">
              {status?.enabled
                ? `Enabled ${status.enabledAt ? new Date(status.enabledAt).toLocaleDateString() : ""}`
                : "Your account uses only your OIDC provider for authentication."}
            </p>
          </div>
          {status?.enabled
            ? <Badge variant="outline" className="border-green-500/30 text-green-400">Active</Badge>
            : null}
        </CardContent>
      </Card>

      {/* Setup flow */}
      {!status?.enabled && step === "idle" && (
        <Card className="border-white/5">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center gap-2"><Smartphone className="w-4 h-4" />Set up authenticator app</CardTitle>
            <CardDescription>Works with Google Authenticator, Authy, 1Password, Bitwarden, and any TOTP-compatible app.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending} className="gap-2">
              <Shield className="w-4 h-4" />
              {setupMutation.isPending ? "Generating…" : "Enable 2FA"}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === "setup" && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-white text-base">Scan QR Code</CardTitle>
            <CardDescription>Open your authenticator app and scan this code.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-center p-4 bg-white rounded-xl w-fit mx-auto">
              <img src={qrCode} alt="2FA QR code" className="w-48 h-48" />
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Or enter this code manually:</p>
              <code className="text-xs bg-muted/20 px-3 py-1.5 rounded-lg font-mono text-primary tracking-widest">{secret}</code>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Enter the 6-digit code from your app to confirm:</p>
              <div className="flex gap-2">
                <Input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000" maxLength={6}
                  className="bg-muted/20 border-white/8 font-mono text-lg tracking-widest text-center w-36" />
                <Button onClick={() => verifyMutation.mutate()} disabled={code.length < 6 || verifyMutation.isPending}>
                  {verifyMutation.isPending ? "Verifying…" : "Confirm"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Backup codes */}
      {step === "backup" && backupCodes.length > 0 && (
        <Card className="border-amber-400/20 bg-amber-400/5">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center gap-2"><Key className="w-4 h-4 text-amber-400" />Save your backup codes</CardTitle>
            <CardDescription className="text-amber-400/80">These codes will not be shown again. Store them somewhere safe.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {backupCodes.map((c, i) => (
                <code key={i} className="text-xs font-mono bg-muted/20 px-3 py-2 rounded-lg text-white tracking-widest text-center">{c}</code>
              ))}
            </div>
            <Button variant="outline" className="gap-2 border-white/10" onClick={() => {
              navigator.clipboard.writeText(backupCodes.join("\n"));
              toast({ title: "Copied to clipboard" });
            }}>
              <Copy className="w-4 h-4" />Copy all
            </Button>
            <Button className="w-full" onClick={() => { setStep("idle"); setBackupCodes([]); }}>Done</Button>
          </CardContent>
        </Card>
      )}

      {/* Disable / regenerate (when enabled) */}
      {status?.enabled && step === "idle" && (
        <div className="space-y-4">
          <Card className="border-white/5">
            <CardHeader>
              <CardTitle className="text-white text-base flex items-center gap-2"><RefreshCw className="w-4 h-4" />Regenerate backup codes</CardTitle>
              <CardDescription>Invalidates existing backup codes and generates 10 new ones.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="TOTP code" maxLength={6}
                  className="bg-muted/20 border-white/8 font-mono w-36" />
                <Button variant="outline" onClick={() => regenMutation.mutate()} disabled={code.length < 6 || regenMutation.isPending} className="border-white/10">
                  Regenerate
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-red-500/20 bg-red-500/5">
            <CardHeader>
              <CardTitle className="text-red-400 text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Disable 2FA</CardTitle>
              <CardDescription>Enter your current TOTP code to disable two-factor authentication.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="TOTP code" maxLength={6}
                  className="bg-muted/20 border-white/8 font-mono w-36" />
                <Button variant="destructive" onClick={() => {
                  if (confirm("Disable 2FA? Your account will be less secure.")) disableMutation.mutate();
                }} disabled={code.length < 6 || disableMutation.isPending}>
                  {disableMutation.isPending ? "Disabling…" : "Disable 2FA"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
