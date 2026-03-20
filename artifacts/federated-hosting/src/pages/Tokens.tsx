import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { LoadingState } from "@/components/shared";
import { Key, Plus, Trash2, Copy, Check, LogIn, AlertTriangle, Terminal } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/components/ui/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ApiToken {
  id: number;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface CreatedToken extends ApiToken {
  token: string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `HTTP ${r.status}`);
  }
  if (r.status === 204) return undefined as T;
  return r.json();
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-muted-foreground hover:text-white transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-4 h-4 text-status-active" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

export default function TokensPage() {
  const { isAuthenticated, login } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null);

  const { data: tokens = [], isLoading } = useQuery<ApiToken[]>({
    queryKey: ["tokens"],
    queryFn: () => apiFetch<ApiToken[]>("/tokens"),
    enabled: isAuthenticated,
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; expiresInDays?: number }) =>
      apiFetch<CreatedToken>("/tokens", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["tokens"] });
      setCreatedToken(data);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => apiFetch<void>(`/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tokens"] });
      toast({ title: "t("tokens.revoked")", description: "The token is no longer valid." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
          <Key className="w-8 h-8 text-primary" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">{t("tokens.title")}</h2>
          <p className="text-muted-foreground">Sign in to create and manage API tokens.</p>
        </div>
        <Button onClick={login} className="bg-primary text-black hover:bg-primary/90 font-semibold">
          <LogIn className="w-4 h-4 mr-2" /> Sign In
        </Button>
      </div>
    );
  }

  function handleCreate() {
    if (!newName.trim()) return;
    createMutation.mutate({
      name: newName.trim(),
      ...(newExpiry ? { expiresInDays: parseInt(newExpiry, 10) } : {}),
    });
  }

  function handleCreateClose() {
    setCreateOpen(false);
    setCreatedToken(null);
    setNewName("");
    setNewExpiry("");
  }

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-500 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">{t("tokens.title")}</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">
            {t("tokens.subtitle")}
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={(o) => { if (!o) handleCreateClose(); else setCreateOpen(true); }}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-black hover:bg-primary/90 font-semibold shadow-lg shadow-primary/20">
              <Plus className="w-4 h-4 mr-2" /> New Token
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-white/10">
            <DialogHeader>
              <DialogTitle className="text-white">
                {createdToken ? {t("tokens.created.title")} : {t("tokens.create.title")}}
              </DialogTitle>
              <DialogDescription>
                {createdToken
                  ? "Copy your token now — it won't be shown again."
                  : "Name your token and optionally set an expiry."}
              </DialogDescription>
            </DialogHeader>

            {createdToken ? (
              <div className="space-y-4">
                <div className="bg-muted/30 border border-white/10 rounded-xl p-4 flex items-center gap-3">
                  <code className="font-mono text-sm text-primary flex-1 break-all">{createdToken.token}</code>
                  <CopyButton text={createdToken.token} />
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex gap-2 text-sm text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>This is the only time this token will be shown. Store it securely.</p>
                </div>
                <div className="bg-muted/20 border border-white/5 rounded-xl p-4">
                  <p className="text-muted-foreground text-sm font-mono mb-2">Use with the CLI:</p>
                  <code className="font-mono text-xs text-white break-all">
                    fh login --token {createdToken.token}
                  </code>
                </div>
                <Button onClick={handleCreateClose} className="w-full">{t("common.done")}</Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Token name</label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                    placeholder="e.g. laptop-cli"
                    className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">
                    Expires in (days) <span className="text-muted-foreground/60">— leave blank for no expiry</span>
                  </label>
                  <input
                    type="number"
                    value={newExpiry}
                    onChange={(e) => setNewExpiry(e.target.value)}
                    placeholder="e.g. 365"
                    min={1}
                    max={365}
                    className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" onClick={handleCreateClose} className="flex-1 border-white/10">Cancel</Button>
                  <Button
                    onClick={handleCreate}
                    disabled={!newName.trim() || createMutation.isPending}
                    className="flex-1 bg-primary text-black hover:bg-primary/90 font-semibold"
                  >
                    {createMutation.isPending ? "Creating…" : "Create Token"}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* CLI quickstart */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-5 flex items-start gap-4">
          <div className="w-9 h-9 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
            <Terminal className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm mb-1">FedHost CLI</p>
            <p className="text-muted-foreground text-xs mb-3">
              Create a token above, then authenticate the CLI in one command.
            </p>
            <div className="bg-black/40 rounded-lg px-3 py-2 font-mono text-xs text-primary flex items-center justify-between gap-2">
              <span>fh login --node https://your-node.example.com --token fh_your_token</span>
              <CopyButton text="fh login --node https://your-node.example.com --token fh_your_token" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Token list */}
      {isLoading ? (
        <LoadingState />
      ) : tokens.length === 0 ? (
        <Card className="border-white/5 border-dashed">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <Key className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">{t("tokens.noTokens")}</p>
            <p className="text-muted-foreground/60 text-sm">{t("tokens.noTokensHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {tokens.map((token, i) => (
              <motion.div
                key={token.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className="border-white/5 hover:border-white/10 transition-colors">
                  <CardContent className="p-5 flex items-center gap-4">
                    <div className="w-9 h-9 rounded-xl bg-muted/40 border border-white/5 flex items-center justify-center shrink-0">
                      <Key className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-white font-medium">{token.name}</p>
                        <Badge variant="outline" className="font-mono text-xs text-muted-foreground border-white/10">
                          {token.tokenPrefix}…
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-xs mt-0.5">
                        Created {formatDistanceToNow(new Date(token.createdAt), { addSuffix: true })}
                        {token.lastUsedAt && (
                          <> · Last used {formatDistanceToNow(new Date(token.lastUsedAt), { addSuffix: true })}</>
                        )}
                        {token.expiresAt && (
                          <> · Expires {formatDistanceToNow(new Date(token.expiresAt), { addSuffix: true })}</>
                        )}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-red-400 hover:bg-red-400/10 shrink-0"
                      onClick={() => revokeMutation.mutate(token.id)}
                      disabled={revokeMutation.isPending}
                      title="{t("tokens.revoke")}"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
