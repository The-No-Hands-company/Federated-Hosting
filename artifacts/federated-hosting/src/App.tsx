import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, MutationCache, QueryCache } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout/Layout";
import { lazy, Suspense } from "react";
import { LoadingState } from "@/components/shared";

// Lazy-load all pages so each route is a separate chunk.
// Initial bundle only ships the shell (Layout, QueryClient, Router).
const Dashboard      = lazy(() => import("@/pages/Dashboard"));
const NodeList       = lazy(() => import("@/pages/nodes/NodeList"));
const NodeDetail     = lazy(() => import("@/pages/nodes/NodeDetail"));
const SiteList       = lazy(() => import("@/pages/sites/SiteList"));
const SiteDetail     = lazy(() => import("@/pages/sites/SiteDetail"));
const MySites        = lazy(() => import("@/pages/MySites"));
const DeploySite     = lazy(() => import("@/pages/DeploySite"));
const Federation     = lazy(() => import("@/pages/Federation"));
const Directory      = lazy(() => import("@/pages/Directory"));
const SiteAnalytics  = lazy(() => import("@/pages/SiteAnalytics"));
const TokensPage     = lazy(() => import("@/pages/Tokens"));
const AdminPage      = lazy(() => import("@/pages/Admin"));
const Marketplace    = lazy(() => import("@/pages/Marketplace"));
const ApiDocs        = lazy(() => import("@/pages/ApiDocs"));
const SiteSettings   = lazy(() => import("@/pages/SiteSettings"));
const UsageDashboard      = lazy(() => import("@/pages/UsageDashboard"));
const TwoFactorSettings   = lazy(() => import("@/pages/TwoFactorSettings"));
const AcceptInvitation    = lazy(() => import("@/pages/AcceptInvitation"));
const AccountSettings     = lazy(() => import("@/pages/AccountSettings"));
const FormInbox           = lazy(() => import("@/pages/FormInbox"));
const BuildHistory        = lazy(() => import("@/pages/BuildHistory"));
const WebhookManager      = lazy(() => import("@/pages/WebhookManager"));

function onQueryError(error: unknown) {
  const err = error as { status?: number; message?: string };
  if (err?.status === 401) {
    window.location.href = "/api/login";
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onQueryError }),
  mutationCache: new MutationCache({ onError: onQueryError }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        const err = error as { status?: number };
        if (err?.status && err.status >= 400 && err.status < 500) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

function Router() {
  return (
    <Layout>
      <ErrorBoundary>
        <Suspense fallback={<LoadingState />}>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/nodes" component={NodeList} />
            <Route path="/nodes/:id" component={NodeDetail} />
            <Route path="/sites" component={SiteList} />
            <Route path="/sites/:id" component={SiteDetail} />
            <Route path="/my-sites" component={MySites} />
            <Route path="/deploy/:id" component={DeploySite} />
            <Route path="/directory" component={Directory} />
            <Route path="/federation" component={Federation} />
            <Route path="/analytics/:id" component={SiteAnalytics} />
            <Route path="/tokens" component={TokensPage} />
            <Route path="/admin" component={AdminPage} />
            <Route path="/network" component={Marketplace} />
            <Route path="/api-docs" component={ApiDocs} />
            <Route path="/sites/:id/settings" component={SiteSettings} />
            <Route path="/usage" component={UsageDashboard} />
            <Route path="/settings/2fa" component={TwoFactorSettings} />
            <Route path="/accept-invitation" component={AcceptInvitation} />
            <Route path="/settings/account" component={AccountSettings} />
            <Route path="/sites/:id/forms" component={FormInbox} />
            <Route path="/sites/:id/builds" component={BuildHistory} />
            <Route path="/sites/:id/webhooks" component={WebhookManager} />
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
