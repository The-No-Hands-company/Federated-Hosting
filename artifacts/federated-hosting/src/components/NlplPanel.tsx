import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play, Square, RefreshCw, Terminal, Cpu, AlertTriangle,
  CheckCircle, Clock, Zap, ExternalLink, ChevronDown, ChevronUp,
  Download, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/components/ui/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ProcessStatus {
  status: "running" | "starting" | "crashed" | "stopped";
  siteId: number;
  domain?: string;
  port: number | null;
  pid: number | null;
  runtime: "nlpl" | "node" | "python" | null;
  restartCount: number;
  startedAt: string | null;
  lastCrashAt: string | null;
}

interface RuntimeInfo {
  available: boolean;
  interpreterPath: string;
  interpreterExists: boolean;
  nlplVersion: string | null;
  pythonVersion: string | null;
  portRange: { start: number; end: number };
  installInstructions: string | null;
  staticOnlyMode: boolean;
}

const RUNTIME_META: Record<string, { label: string; entryDefault: string; description: string; icon: string }> = {
  nlpl:    { label: "NLPL",    entryDefault: "server.nlpl", description: "NLPL interpreted application", icon: "⚡" },
  dynamic: { label: "Node.js", entryDefault: "server.js",   description: "Node.js HTTP server",          icon: "🟢" },
  node:    { label: "Node.js", entryDefault: "server.js",   description: "Node.js HTTP server",          icon: "🟢" },
  python:  { label: "Python",  entryDefault: "server.py",   description: "Python HTTP server",           icon: "🐍" },
};
  siteId: number;
  siteDomain: string;
  siteType: string;
}

const STATUS_CONFIG = {
  running:  { label: "Running",  color: "text-status-active",  bg: "bg-status-active/10 border-status-active/30",  dot: "bg-status-active animate-pulse" },
  starting: { label: "Starting", color: "text-amber-400",      bg: "bg-amber-400/10 border-amber-400/30",           dot: "bg-amber-400 animate-pulse" },
  crashed:  { label: "Crashed",  color: "text-red-400",        bg: "bg-red-400/10 border-red-400/30",               dot: "bg-red-400" },
  stopped:  { label: "Stopped",  color: "text-muted-foreground", bg: "bg-muted/20 border-white/5",                  dot: "bg-muted-foreground" },
};

/** Parse SSE log stream from the server — falls back to polling if SSE unavailable */
function useProcessLogs(siteId: number, isRunning: boolean) {
  const [logs, setLogs] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    if (!isRunning) return;
    setStreaming(true);

    // Poll the log endpoint every 3 seconds (SSE would be ideal but requires server support)
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/api/sites/${siteId}/nlpl/logs?tail=50`, { credentials: "include" });
        if (!r.ok) return;
        const { lines } = await r.json() as { lines: string[] };
        if (lines?.length) setLogs(lines);
      } catch { /* ignore */ }
    }, 3_000);

    return () => {
      clearInterval(poll);
      setStreaming(false);
    };
  }, [siteId, isRunning]);

  const clear = useCallback(() => setLogs([]), []);
  return { logs, streaming, clear };
}

export function NlplPanel({ siteId, siteDomain, siteType }: NlplPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [logsOpen, setLogsOpen] = useState(false);
  const [entryFile, setEntryFile] = useState(meta.entryDefault);
  const logEndRef = useRef<HTMLDivElement>(null);

  // ── Status polling ─────────────────────────────────────────────────────────
  const { data: status, isLoading: statusLoading } = useQuery<ProcessStatus>({
    queryKey: ["nlpl-status", siteId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${siteId}/nlpl/status`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch status");
      return r.json();
    },
    refetchInterval: 5_000,
    staleTime: 4_000,
  });

  // ── Runtime info ───────────────────────────────────────────────────────────
  const { data: runtimeInfo } = useQuery<RuntimeInfo>({
    queryKey: ["nlpl-runtime-info"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/nlpl/runtime-info`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 60_000,
  });

  const isRunning = status?.status === "running" || status?.status === "starting";
  const { logs, streaming, clear: clearLogs } = useProcessLogs(siteId, isRunning && logsOpen);

  // Auto-scroll logs
  useEffect(() => {
    if (logsOpen) logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, logsOpen]);

  // ── Start mutation ─────────────────────────────────────────────────────────
  const startMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${siteId}/nlpl/start`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryFile }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `HTTP ${r.status}`);
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nlpl-status", siteId] });
      toast({ title: "Process started", description: `${meta.label} server is starting up.` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start", description: err.message, variant: "destructive" });
    },
  });

  // ── Stop mutation ──────────────────────────────────────────────────────────
  const stopMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${siteId}/nlpl/stop`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nlpl-status", siteId] });
      clearLogs();
      toast({ title: "Process stopped" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to stop", description: err.message, variant: "destructive" });
    },
  });

  const cfg = STATUS_CONFIG[status?.status ?? "stopped"];
  const meta = RUNTIME_META[siteType] ?? RUNTIME_META.nlpl;

  return (
    <Card className="border-white/8">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className={cn("w-8 h-8 rounded-lg border flex items-center justify-center", cfg.bg)}>
              <Zap className={cn("w-4 h-4", cfg.color)} />
            </div>
            <div>
              <CardTitle className="text-white text-sm">
                {meta.icon} {meta.label} Server
              </CardTitle>
              <CardDescription className="text-xs">{meta.description} — handles HTTP requests</CardDescription>
            </div>
          </div>

          {/* Status badge */}
          {!statusLoading && (
            <Badge variant="outline" className={cn("text-xs gap-1.5 shrink-0", cfg.bg, cfg.color)}>
              <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
              {cfg.label}
              {status?.restartCount ? ` (${status.restartCount} restart${status.restartCount !== 1 ? "s" : ""})` : ""}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Static-only node warning */}
        {runtimeInfo?.staticOnlyMode && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2.5 bg-amber-400/10 border border-amber-400/20 rounded-xl p-3"
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="text-amber-400 font-semibold mb-0.5">Static-only node</p>
              <p className="text-muted-foreground">
                This node has dynamic hosting disabled (<code className="text-amber-300">NEXUS_STATIC_ONLY=true</code>).
                To run {meta.label} apps, use a node with dynamic hosting enabled.
              </p>
            </div>
          </motion.div>
        )}

        {/* NLPL interpreter availability warning */}
        {runtimeInfo && !runtimeInfo.available && !runtimeInfo.staticOnlyMode && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2.5 bg-amber-400/10 border border-amber-400/20 rounded-xl p-3"
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="text-amber-400 font-semibold mb-1">NLPL interpreter not found</p>
              <p className="text-muted-foreground mb-1.5">
                The NLPL interpreter is not installed at <code className="text-amber-300">{runtimeInfo.interpreterPath}</code>.
              </p>
              <code className="block bg-black/40 rounded px-2 py-1 text-amber-300 font-mono text-xs">
                {runtimeInfo.installInstructions}
              </code>
            </div>
          </motion.div>
        )}
        )}

        {/* Process details when running */}
        <AnimatePresence>
          {status && (status.status === "running" || status.status === "starting") && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="grid grid-cols-2 gap-2 text-xs"
            >
              {[
                { icon: Cpu, label: "PID",     value: status.pid ?? "—" },
                { icon: Zap, label: "Port",    value: status.port ?? "—" },
                { icon: Clock, label: "Started", value: status.startedAt ? formatDistanceToNow(new Date(status.startedAt), { addSuffix: true }) : "—" },
                { icon: RefreshCw, label: "Restarts", value: status.restartCount },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="bg-muted/20 rounded-lg px-3 py-2 border border-white/5">
                  <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
                    <Icon className="w-3 h-3" />
                    <span>{label}</span>
                  </div>
                  <p className="text-white font-mono font-semibold">{String(value)}</p>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Crashed state */}
        {status?.status === "crashed" && (
          <div className="flex items-center gap-2 bg-red-400/10 border border-red-400/20 rounded-xl p-3 text-xs">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <div>
              <p className="text-red-400 font-semibold">Process crashed</p>
              {status.lastCrashAt && (
                <p className="text-muted-foreground">
                  Last crash {formatDistanceToNow(new Date(status.lastCrashAt), { addSuffix: true })}
                  {status.restartCount > 0 && ` · ${status.restartCount} automatic restart${status.restartCount !== 1 ? "s" : ""}`}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Entry file input (only when stopped) */}
        {(!status || status.status === "stopped" || status.status === "crashed") && (
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground block mb-1">Entry file</label>
              <input
                type="text"
                value={entryFile}
                onChange={(e) => setEntryFile(e.target.value)}
                placeholder="server.nlpl"
                className="w-full bg-muted/20 border border-white/8 rounded-lg px-3 py-2 text-white text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
              />
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          {(!status || status.status === "stopped" || status.status === "crashed") ? (
            <Button
              className="flex-1 bg-status-active/20 border border-status-active/30 text-status-active hover:bg-status-active/30"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending || (runtimeInfo ? !runtimeInfo.available : false)}
            >
              {startMutation.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Starting…</>
              ) : (
                <><Play className="w-4 h-4 mr-2" />Start Process</>
              )}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className="flex-1 border-red-400/30 text-red-400 hover:bg-red-400/10"
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending}
              >
                {stopMutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Stopping…</>
                ) : (
                  <><Square className="w-4 h-4 mr-2" />Stop</>
                )}
              </Button>
              <Button
                variant="outline"
                className="border-amber-400/30 text-amber-400 hover:bg-amber-400/10"
                title="Restart"
                onClick={() => { stopMutation.mutate(); setTimeout(() => startMutation.mutate(), 1500); }}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </>
          )}

          {status?.status === "running" && status.port && (
            <a href={`https://${siteDomain}`} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="icon" className="border-white/10 text-muted-foreground hover:text-white" title="Open site">
                <ExternalLink className="w-4 h-4" />
              </Button>
            </a>
          )}
        </div>

        {/* Process logs */}
        <div className="border-t border-white/5 pt-3">
          <button
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-white transition-colors w-full"
            onClick={() => setLogsOpen((o) => !o)}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Process Logs</span>
            {streaming && <span className="w-1.5 h-1.5 rounded-full bg-status-active animate-pulse" />}
            {logsOpen ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
          </button>

          <AnimatePresence>
            {logsOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 bg-black/60 border border-white/5 rounded-xl p-3 max-h-64 overflow-y-auto font-mono text-xs leading-relaxed">
                  {logs.length === 0 ? (
                    <p className="text-muted-foreground">
                      {isRunning ? "No log output yet…" : "Start the process to see logs."}
                    </p>
                  ) : (
                    logs.map((line, i) => (
                      <div key={i} className={cn(
                        "whitespace-pre-wrap break-all",
                        line.toLowerCase().includes("error") || line.toLowerCase().includes("err") ? "text-red-400" :
                        line.toLowerCase().includes("warn") ? "text-amber-400" :
                        "text-green-300/80",
                      )}>
                        {line}
                      </div>
                    ))
                  )}
                  <div ref={logEndRef} />
                </div>
                {logs.length > 0 && (
                  <button onClick={clearLogs} className="text-xs text-muted-foreground hover:text-white mt-1.5 flex items-center gap-1">
                    <Download className="w-3 h-3" />Clear
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Runtime info footer */}
        {runtimeInfo?.available && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground border-t border-white/5 pt-2.5">
            <Info className="w-3 h-3" />
            <span>
              {runtimeInfo.nlplVersion ? `NLPL ${runtimeInfo.nlplVersion}` : "NLPL"} ·{" "}
              {runtimeInfo.pythonVersion} · ports {runtimeInfo.portRange.start}–{runtimeInfo.portRange.end}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
