import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@workspace/auth-web";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingState, ErrorState } from "@/components/shared";
import { ArrowLeft, TrendingUp, Globe, HardDrive, Eye, ExternalLink, Download, Radio } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { format, parseISO } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Period = "24h" | "7d" | "30d";

interface HourlyRow {
  id: number;
  siteId: number;
  hour: string;
  hits: number;
  bytesServed: number;
  uniqueIps: number;
  topReferrers: string;
  topPaths: string;
}

interface AnalyticsResponse {
  period: string;
  totals: { hits: number; bytesServed: number; uniqueIps: number };
  hourly: HourlyRow[];
  topReferrers: Array<{ referrer: string; count: number }>;
  topPaths: Array<{ path: string; count: number }>;
}

interface SiteInfo {
  id: number;
  name: string;
  domain: string;
  hitCount: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatHour(iso: string, period: Period): string {
  try {
    const d = parseISO(iso);
    if (period === "24h") return format(d, "HH:mm");
    if (period === "7d")  return format(d, "EEE HH:mm");
    return format(d, "MMM d");
  } catch {
    return iso;
  }
}

const PERIOD_OPTIONS: { label: string; value: Period }[] = [
  { label: "t("analytics.periods.24h")", value: "24h" },
  { label: "t("analytics.periods.7d")",   value: "7d"  },
  { label: "t("analytics.periods.30d")",  value: "30d" },
];

const CHART_COLOR = "#00e5ff";
const BAR_COLORS = ["#00e5ff", "#00b4d8", "#0096c7", "#0077b6", "#023e8a", "#03045e", "#7b2d8b", "#9d4edd", "#c77dff", "#e0aaff"];

export default function SiteAnalytics() {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated } = useAuth();
  const [period, setPeriod] = useState<Period>("24h");
  const { t } = useTranslation();

  // Real-time hit counter via SSE
  const [liveHits, setLiveHits] = useState(0);
  const [isLive, setIsLive] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!id || !isAuthenticated) return;
    const es = new EventSource(`${BASE}/api/sites/${id}/analytics/stream`, { withCredentials: true });
    sseRef.current = es;
    es.onopen = () => setIsLive(true);
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.path) setLiveHits(n => n + 1);
      } catch {}
    };
    es.onerror = () => setIsLive(false);
    return () => { es.close(); setIsLive(false); };
  }, [id, isAuthenticated]);

  const { data: site, isLoading: siteLoading } = useQuery<SiteInfo>({
    queryKey: ["site", id],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${id}`);
      if (!r.ok) throw new Error("Site not found");
      return r.json();
    },
    enabled: Boolean(id),
  });

  const { data, isLoading, error } = useQuery<AnalyticsResponse>({
    queryKey: ["analytics", id, period],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${id}/analytics?period=${period}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load analytics");
      return r.json();
    },
    enabled: Boolean(id),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: referrers } = useQuery<{ referrers: Array<{ referrer: string; hits: number }> }>({
    queryKey: ["analytics-referrers", id, period],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${id}/analytics/referrers?period=${period}`, { credentials: "include" });
      return r.ok ? r.json() : { referrers: [] };
    },
    enabled: Boolean(id),
    staleTime: 300_000,
  });

  const exportCSV = async () => {
    const r = await fetch(`${BASE}/api/sites/${id}/analytics/export?period=${period}`, { credentials: "include" });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `analytics-${site?.domain ?? id}-${period}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (siteLoading || isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Failed to load analytics data." />;

  const chartData = (data?.hourly ?? []).map((row) => ({
    label: formatHour(row.hour, period),
    hits: Number(row.hits),
    bytes: Number(row.bytesServed),
  }));

  const totals = data?.totals ?? { hits: 0, bytesServed: 0, uniqueIps: 0 };
  const topReferrers = data?.topReferrers ?? [];
  const topPaths = data?.topPaths ?? [];

  const statCards = [
    {
      title: "{t("analytics.stats.totalHits")}",
      value: totals.hits.toLocaleString(),
      icon: Eye,
      color: "text-primary",
      bg: "bg-primary/10 border-primary/20",
    },
    {
      title: "{t("analytics.stats.uniqueVisitors")}",
      value: totals.uniqueIps.toLocaleString(),
      icon: Globe,
      color: "text-secondary",
      bg: "bg-secondary/10 border-secondary/20",
    },
    {
      title: "{t("analytics.stats.bandwidth")}",
      value: formatBytes(totals.bytesServed),
      icon: HardDrive,
      color: "text-amber-400",
      bg: "bg-amber-400/10 border-amber-400/20",
    },
    {
      title: "{t("analytics.stats.allTimeHits")}",
      value: (site?.hitCount ?? 0).toLocaleString(),
      icon: TrendingUp,
      color: "text-status-active",
      bg: "bg-status-active/10 border-status-active/20",
    },
  ];

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Link href="/my-sites">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-white w-fit">
            <ArrowLeft className="w-4 h-4 mr-2" />
            My Sites
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-white tracking-tight">
            Analytics
            {site && <span className="text-muted-foreground font-normal text-xl ml-3">— {site.name}</span>}
          </h1>
          {site && (
            <a
              href={`https://${site.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-mono text-sm hover:underline flex items-center gap-1 w-fit mt-1"
            >
              {site.domain}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        {/* Live hit counter */}
        <div className="flex items-center gap-3">
          {isLive && (
            <div className="flex items-center gap-1.5 text-xs text-green-400 bg-green-400/10 px-3 py-1.5 rounded-full border border-green-400/20">
              <Radio className="w-3 h-3 animate-pulse" />
              <span className="font-mono font-semibold">{liveHits}</span>
              <span>live hits</span>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5 border-white/10 text-muted-foreground hover:text-white">
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
        </div>
        {/* Period selector */}
        <div className="flex gap-1 bg-muted/30 p-1 rounded-xl border border-white/5">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                period === opt.value
                  ? "bg-primary text-black shadow"
                  : "text-muted-foreground hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
            >
              <Card className={`border ${card.bg}`}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-8 h-8 rounded-lg ${card.bg} flex items-center justify-center`}>
                      <Icon className={`w-4 h-4 ${card.color}`} />
                    </div>
                    <span className="text-muted-foreground text-sm">{card.title}</span>
                  </div>
                  <p className={`text-2xl font-bold font-mono ${card.color}`}>{card.value}</p>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* Hits over time chart */}
      <Card className="border-white/5">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t("analytics.hitsOverTime")}</CardTitle>
          <CardDescription>{t("analytics.hitsSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              {t("analytics.noData")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="hitsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLOR} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="label" tick={{ fill: "#666", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#666", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "#12121a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8 }}
                  labelStyle={{ color: "#fff" }}
                  itemStyle={{ color: CHART_COLOR }}
                />
                <Area type="monotone" dataKey="hits" stroke={CHART_COLOR} strokeWidth={2}
                  fill="url(#hitsGrad)" dot={false} activeDot={{ r: 4, fill: CHART_COLOR }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Top paths + referrers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top paths */}
        <Card className="border-white/5">
          <CardHeader>
            <CardTitle className="text-white text-lg">{t("analytics.topPages")}</CardTitle>
            <CardDescription>{t("analytics.topPagesSubtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            {topPaths.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("analytics.noPathData")}</p>
            ) : (
              <div className="space-y-3">
                {topPaths.slice(0, 8).map((p, i) => {
                  const max = topPaths[0]?.count ?? 1;
                  const pct = Math.round((p.count / max) * 100);
                  return (
                    <div key={p.path} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-mono text-muted-foreground truncate max-w-[200px]">
                          {p.path || "/"}
                        </span>
                        <span className="text-white font-medium tabular-nums">{p.count.toLocaleString()}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: BAR_COLORS[i % BAR_COLORS.length] }}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.6, delay: i * 0.04 }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top referrers */}
        <Card className="border-white/5">
          <CardHeader>
            <CardTitle className="text-white text-lg">{t("analytics.topReferrers")}</CardTitle>
            <CardDescription>{t("analytics.topReferrersSubtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            {(() => {
              const list = (referrers?.referrers?.length ?? 0) > 0
                ? referrers!.referrers.map(r => ({ referrer: r.referrer, count: r.hits }))
                : topReferrers;
              if (list.length === 0) return <p className="text-muted-foreground text-sm">{t("analytics.noReferrerData")}</p>;
              return (
                <div className="space-y-3">
                  {list.slice(0, 12).map((r, i) => {
                    const max = list[0]?.count ?? 1;
                    const pct = Math.round((r.count / max) * 100);
                    const label = r.referrer || "(direct)";
                    return (
                      <div key={r.referrer || i} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground truncate max-w-[200px]">{label}</span>
                          <span className="text-white font-medium tabular-nums">{r.count.toLocaleString()}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ background: BAR_COLORS[(i + 5) % BAR_COLORS.length] }}
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.6, delay: i * 0.04 }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
