import { Link, useLocation } from "wouter";
import { Activity, LayoutDashboard, Server, Globe, Menu, Upload, LogOut, LogIn, Radio, BookMarked, Key, Shield, Wifi, FileCode, BarChart2, User } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@workspace/auth-web";
import { useHealthStatus } from "@/lib/apiHooks";

const NAV_ITEMS = [
  { href: "/",          label: "Dashboard",           icon: LayoutDashboard },
  { href: "/nodes",     label: "Federation Nodes",    icon: Server },
  { href: "/sites",     label: "Hosted Sites",        icon: Globe },
  { href: "/directory", label: "Sites Directory",     icon: BookMarked },
  { href: "/network",   label: "Node Network",        icon: Wifi },
  { href: "/federation",label: "Federation Protocol", icon: Radio },
  { href: "/api-docs",  label: "API Reference",       icon: FileCode },
];

const AUTH_NAV_ITEMS = [
  { href: "/my-sites", label: "My Sites", icon: Upload },
  { href: "/usage",    label: "Usage",     icon: BarChart2 },
  { href: "/tokens",   label: "API Tokens", icon: Key },
  { href: "/settings/account", label: "Account",    icon: User },
  { href: "/admin",              label: "Node Admin", icon: Shield },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, isAuthenticated, login, logout } = useAuth();
  const { data: health } = useHealthStatus();

  const NavLinks = () => (
    <>
      {NAV_ITEMS.map((item) => {
        const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href}>
            <div
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-200 cursor-pointer group",
                isActive 
                  ? "bg-primary/10 text-primary border border-primary/20 shadow-[0_0_15px_rgba(0,229,255,0.1)]" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <Icon className={cn("w-5 h-5 transition-transform group-hover:scale-110", isActive && "drop-shadow-[0_0_8px_rgba(0,229,255,0.8)]")} />
              {item.label}
            </div>
          </Link>
        );
      })}
      {isAuthenticated && AUTH_NAV_ITEMS.map((item) => {
        const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href}>
            <div
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-200 cursor-pointer group",
                isActive 
                  ? "bg-primary/10 text-primary border border-primary/20 shadow-[0_0_15px_rgba(0,229,255,0.1)]" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <Icon className={cn("w-5 h-5 transition-transform group-hover:scale-110", isActive && "drop-shadow-[0_0_8px_rgba(0,229,255,0.8)]")} />
              {item.label}
            </div>
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row font-sans selection:bg-primary/30">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-white/5 bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2 text-primary">
          <Activity className="w-6 h-6" />
          <span className="font-display font-bold text-lg tracking-tight">NexusHosting</span>
        </div>
        <div className="flex items-center gap-2">
          <UserMenu user={user} isAuthenticated={isAuthenticated} login={login} logout={logout} />
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-foreground">
                <Menu className="w-6 h-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px] bg-sidebar border-r border-white/5 p-6 flex flex-col">
              <div className="flex items-center gap-2 text-primary mb-8 mt-2">
                <Activity className="w-8 h-8 drop-shadow-[0_0_8px_rgba(0,229,255,0.5)]" />
                <span className="font-display font-bold text-xl tracking-tight text-white">Federated<span className="text-primary">Hosting</span></span>
              </div>
              <nav className="flex flex-col gap-2 flex-1">
                <NavLinks />
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col fixed inset-y-0 border-r border-white/5 bg-sidebar/80 backdrop-blur-xl z-40">
        <div className="p-6">
          <Link href="/">
            <div className="flex items-center gap-3 cursor-pointer group">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 group-hover:border-primary/50 transition-colors">
                <Activity className="w-6 h-6 text-primary drop-shadow-[0_0_8px_rgba(0,229,255,0.5)]" />
              </div>
              <div className="flex flex-col">
                <span className="font-display font-bold text-lg leading-none tracking-tight text-white">Federated</span>
                <span className="font-display font-bold text-sm text-primary tracking-widest uppercase">Hosting</span>
              </div>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-4 py-6 flex flex-col gap-2">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2 px-4">Network Ops</div>
          <NavLinks />
        </nav>

        <div className="p-4 mt-auto flex flex-col gap-3">
          {/* User Auth Panel */}
          {isAuthenticated ? (
            <div className="bg-card/50 rounded-xl p-3 border border-white/5 flex items-center gap-3">
              <Avatar className="w-8 h-8 border border-primary/20">
                <AvatarImage src={user?.profileImageUrl ?? undefined} />
                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                  {user?.firstName?.[0] ?? user?.email?.[0] ?? "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {user?.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : user?.email ?? "User"}
                </p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
              <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-white" onClick={logout}>
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <Button variant="outline" className="w-full border-primary/20 text-primary hover:bg-primary/10" onClick={login}>
              <LogIn className="w-4 h-4 mr-2" />
              Sign In
            </Button>
          )}

          <div className="bg-card/50 rounded-xl p-4 border border-white/5 flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-muted-foreground">API Status</span>
              {health ? (
                <span className={cn("flex items-center gap-1.5", health.status === "healthy" ? "text-status-active" : "text-status-inactive")}>
                  <span className={cn("w-2 h-2 rounded-full", health.status === "healthy" ? "bg-status-active animate-pulse" : "bg-status-inactive")} />
                  {health.status === "healthy" ? "Online" : "Degraded"}
                </span>
              ) : (
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse" />
                  Checking…
                </span>
              )}
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-muted-foreground">Version</span>
              <span className="text-muted-foreground/80">{health?.version ? `v${health.version}` : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-mono">Language</span>
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 relative min-w-0">
        <div className="absolute inset-0 -z-10 pointer-events-none mix-blend-screen opacity-40" 
             style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/network-bg.png)`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 w-full min-h-[calc(100vh-65px)] md:min-h-screen">
          {children}
        </div>
      </main>
    </div>
  );
}

function UserMenu({ user, isAuthenticated, login, logout }: {
  user: ReturnType<typeof useAuth>["user"];
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
}) {
  if (!isAuthenticated) {
    return (
      <Button variant="ghost" size="sm" onClick={login} className="text-primary">
        <LogIn className="w-4 h-4 mr-1" />
        Sign In
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full">
          <Avatar className="w-8 h-8">
            <AvatarImage src={user?.profileImageUrl ?? undefined} />
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              {user?.firstName?.[0] ?? "U"}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <Link href="/my-sites">
            <div className="flex items-center gap-2 cursor-pointer w-full">
              <Upload className="w-4 h-4" />
              My Sites
            </div>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout} className="text-red-400">
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
