import { useGetFederationStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Server, Globe, Activity, HardDrive, ArrowUpRight, Loader2, Rocket, ChevronRight, BookOpen, BarChart2, GitBranch, Settings, Zap } from "lucide-react";
import { LoadingState, ErrorState, StatusBadge } from "@/components/shared";
import { formatGb, formatPercent } from "@/lib/utils";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useAuth } from "@workspace/auth-web";
import { useQuery } from "@tanstack/react-query";
import { useStatsHourly, useNodes } from "@/lib/apiHooks";
import { useState } from "react";
import { OnboardingBanner, OnboardingModal, useOnboarding } from "@/components/Onboarding";
import { useTranslation } from "react-i18next";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface MySite {
  id: number; name: string; domain: string; status: string;
  hitCount: number; storageUsedMb: number; siteType: string;
}

interface Deployment {
  id: number; version: number; status: string; fileCount: number;
  totalSizeMb: number; deployedAt: string; environment: string;
  site?: { name: string; domain: string };
}

function RecentActivityFeed() {
  const { data: deployments } = useQuery<{ data: Array<{ id: number; version: number; status: string; environment: string; deployedAt: string; siteId: number; site?: { name: string; domain: string } }> }>({
    queryKey: ["dashboard-recent-deploys"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/sites?limit=5`, { credentials: "include" });
      if (!r.ok) return { data: [] };
      const sites = (await r.json() as { data: Array<{ id: number }> }).data ?? [];
      const deps = await Promise.all(
        sites.slice(0, 3).map(s =>
          fetch(`${BASE}/api/sites/${s.id}/deployments?limit=2`, { credentials: "include" })
            .then(r => r.ok ? r.json() : { data: [] })
            .then((d: any) => (d.data ?? []).map((dep: any) => ({ ...dep, siteId: s.id })))
        )
      );
      return { data: deps.flat().sort((a: any, b: any) => new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime()).slice(0, 6) };
    },
    staleTime: 60_000,
  });

  const items = deployments?.data ?? [];
  if (items.length === 0) return null;

  const STATUS_COLOR: Record<string, string> = {
    active: "text-green-400", failed: "text-red-400", pending: "text-amber-400",
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Recent Deployments</h3>
      <div className="space-y-1.5">
        {items.map((d: any) => (
          <Link key={`${d.siteId}-${d.id}`} href={`/deploy/${d.siteId}`}>
            <div className="flex items-center gap-3 p-2.5 rounded-lg border border-white/5 hover:border-white/10 bg-muted/5 transition-all cursor-pointer text-sm">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${d.status === "active" ? "bg-green-400" : d.status === "failed" ? "bg-red-400" : "bg-amber-400"}`} />
              <span className="text-white flex-1 truncate font-mono text-xs">
                site-{d.siteId} <span className="text-muted-foreground">v{d.version}</span>
                {d.environment !== "production" && <span className="text-amber-400 ml-1">[{d.environment}]</span>}
              </span>
              <span className="text-muted-foreground text-xs shrink-0">
                {formatDistanceToNow(new Date(d.deployedAt), { addSuffix: true })}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function PersonalDashboard() {
  const { user } = useAuth();

  const { data: mySites } = useQuery<{ data: MySite[] }>({
    queryKey: ["dashboard-my-sites"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/sites?ownerId=${(user as any)?.id}&limit=5`, { credentials: "include" });
      return r.ok ? r.json() : { data: [] };
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const sites = mySites?.data ?? [];
  if (sites.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
      className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Your Sites</h2>
        <Link href="/my-sites">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-white gap-1">
            View all <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sites.map(site => (
          <Card key={site.id} className="border-white/5 hover:border-white/10 transition-colors group">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0">
                  <p className="text-white font-semibold text-sm truncate">{site.name}</p>
                  <p className="text-primary text-xs font-mono truncate">{site.domain}</p>
                </div>
                <StatusBadge status={site.status} />
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3" />{site.hitCount.toLocaleString()} hits
                </span>
                <span className="flex items-center gap-1">
                  <HardDrive className="w-3 h-3" />{site.storageUsedMb.toFixed(1)} MB
                </span>
              </div>
              <div className="flex gap-1.5">
                <Link href={`/deploy/${site.id}`} className="flex-1">
                  <Button size="sm" variant="outline" className="w-full border-white/8 text-xs h-7 text-muted-foreground hover:text-white gap-1">
                    <Rocket className="w-3 h-3" />Deploy
                  </Button>
                </Link>
                <Link href={`/analytics/${site.id}`}>
                  <Button size="sm" variant="outline" className="border-white/8 h-7 px-2 text-muted-foreground hover:text-white">
                    <BarChart2 className="w-3 h-3" />
                  </Button>
                </Link>
                <Link href={`/sites/${site.id}/builds`}>
                  <Button size="sm" variant="outline" className="border-white/8 h-7 px-2 text-muted-foreground hover:text-white">
                    <GitBranch className="w-3 h-3" />
                  </Button>
                </Link>
                <Link href={`/sites/${site.id}/settings`}>
                  <Button size="sm" variant="outline" className="border-white/8 h-7 px-2 text-muted-foreground hover:text-white">
                    <Settings className="w-3 h-3" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <RecentActivityFeed />
    </motion.div>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading, error: statsError } = useGetFederationStats();
  const { data: nodes, isLoading: nodesLoading } = useNodes();
  const { data: hourly, isLoading: hourlyLoading } = useStatsHourly();
  const { isAuthenticated, login } = useAuth();
  const { shouldShow } = useOnboarding();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const { t } = useTranslation();

  if (statsLoading) return <LoadingState />;
  if (statsError || !stats) return <ErrorState message="Failed to load federation statistics." />;

  const statCards = [
    { title: t("dashboard.stats.activeNodes"),     value: `${stats.activeNodes} / ${stats.totalNodes}`,   icon: Server,      color: "text-primary" },
    { title: t("dashboard.stats.hostedSites"),     value: `${stats.activeSites} / ${stats.totalSites}`,   icon: Globe,       color: "text-secondary" },
    { title: t("dashboard.stats.networkUptime"),   value: formatPercent(stats.uptimePercent),              icon: Activity,    color: "text-status-active" },
    { title: t("dashboard.stats.totalBandwidth"),  value: formatGb(stats.totalBandwidthGb),                icon: ArrowUpRight,color: "text-status-migrating" },
    { title: t("dashboard.stats.storageAllocated"),value: formatGb(stats.totalStorageGb),                  icon: HardDrive,   color: "text-amber-400" },
  ];

  const chartData = hourly?.hours ?? [];
  const hasActivity = chartData.some(h => h.total > 0);

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-2">{t("dashboard.title")}</h1>
        <p className="text-muted-foreground font-mono">{t("dashboard.subtitle")}</p>
      </div>

      {/* Onboarding banner for guests */}
      {!isAuthenticated && shouldShow && (
        <OnboardingBanner onOpen={() => setOnboardingOpen(true)} />
      )}
      {!isAuthenticated && !shouldShow && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="border-primary/30 bg-primary/5 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-transparent pointer-events-none" />
            <CardContent className="flex flex-col sm:flex-row items-start sm:items-center gap-4 py-5 px-6">
              <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
                <Rocket className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm">{t("dashboard.welcome")}</p>
                <p className="text-muted-foreground text-xs mt-0.5">{t("dashboard.welcomeSubtitle")}</p>
              </div>
              <div className="flex gap-2 shrink-0 flex-wrap">
                <Button size="sm" className="bg-primary text-black hover:bg-primary/90 font-semibold" onClick={login}>
                  Get Started <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
                <a href="https://github.com/The-No-Hands-company/Federated-Hosting" target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="border-white/10 text-muted-foreground hover:text-white">
                    <BookOpen className="w-3.5 h-3.5 mr-1.5" />Learn More
                  </Button>
                </a>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
      <OnboardingModal open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />

      {/* Hero Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
            >
              <Card className="glass-panel overflow-hidden relative group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Icon className={`w-16 h-16 ${stat.color}`} />
                </div>
                <CardHeader className="pb-2">
                  <CardDescription className="font-mono text-xs uppercase tracking-wider">{stat.title}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-display font-bold ${stat.color}`}>{stat.value}</div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Federation Activity Chart */}
        <Card className="glass-panel lg:col-span-2 flex flex-col">
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-white">
                <Activity className="w-5 h-5 text-primary" />
                {t("dashboard.chart.title")}
              </CardTitle>
              <CardDescription className="mt-1 text-xs font-mono">
                {t("dashboard.chart.subtitle")}
              </CardDescription>
            </div>
            {hourlyLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mt-1" />}
          </CardHeader>
          <CardContent className="flex-1 min-h-[280px]">
            {!hasActivity && !hourlyLoading ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
                <Activity className="w-10 h-10 text-muted-foreground/40" />
                <p className="text-muted-foreground text-sm font-mono">{t("dashboard.chart.noActivity")}</p>
                <p className="text-muted-foreground/60 text-xs">{t("dashboard.chart.noActivityHint")}</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorDeploy" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorEvent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--secondary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--secondary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="label" stroke="rgba(255,255,255,0.3)" fontSize={11} tickLine={false} axisLine={false} interval={3} />
                  <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
                    labelStyle={{ color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingTop: '8px' }}
                    iconType="circle"
                    iconSize={8}
                  />
                  <Area type="monotone" dataKey="deployments" name="Deployments" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#colorDeploy)" />
                  <Area type="monotone" dataKey="events" name="Federation Events" stroke="hsl(var(--secondary))" strokeWidth={2} fillOpacity={1} fill="url(#colorEvent)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Node Health Grid */}
        <Card className="glass-panel flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-secondary" />
              {t("dashboard.consensus.title")}
            </CardTitle>
            <Link href="/nodes">
              <span className="text-xs text-primary hover:underline cursor-pointer font-mono">View All</span>
            </Link>
          </CardHeader>
          <CardContent className="flex-1">
            {nodesLoading ? (
              <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-2">
                {nodes?.slice(0, 6).map(node => (
                  <Link key={node.id} href={`/nodes/${node.id}`}>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 transition-colors cursor-pointer group">
                      <div className="flex flex-col overflow-hidden pr-4">
                        <span className="font-medium text-sm text-white truncate group-hover:text-primary transition-colors">{node.name}</span>
                        <span className="text-xs text-muted-foreground font-mono truncate">{node.domain}</span>
                      </div>
                      <StatusBadge status={node.status} className="shrink-0" />
                    </div>
                  </Link>
                ))}
                {nodes && nodes.length === 0 && (
                  <div className="text-center p-6 text-muted-foreground text-sm font-mono border border-dashed border-white/10 rounded-xl">
                    No nodes connected to federation.
                  </div>
                )}
                {nodes && nodes.length > 0 && (
                  <Link href="/directory">
                    <div className="flex items-center justify-center p-2.5 rounded-lg border border-dashed border-white/10 hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer mt-1 group">
                      <Globe className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary mr-2 transition-colors" />
                      <span className="text-xs text-muted-foreground group-hover:text-primary font-mono transition-colors">Browse Hosted Sites</span>
                    </div>
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Personal section: only shown when authenticated ── */}
      {isAuthenticated && <PersonalDashboard />}
    </div>
  );
}
