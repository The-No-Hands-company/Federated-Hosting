import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@workspace/auth-web";
import { UserPlus, CheckCircle2, XCircle, LogIn, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface InvitationDetails {
  id: number;
  email: string;
  role: string;
  expiresAt: string;
  siteName: string;
  domain: string;
  inviterEmail: string | null;
  inviterName: string | null;
}

export default function AcceptInvitation() {
  const [, navigate] = useLocation();
  const { isAuthenticated, user } = useAuth();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const { data: invite, isLoading, error } = useQuery<InvitationDetails>({
    queryKey: ["invitation", token],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/invitations/${token}`);
      if (!r.ok) throw new Error((await r.json() as any).message ?? "Invitation not found");
      return r.json();
    },
    enabled: !!token,
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/invitations/${token}/accept`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json() as any).message ?? "Failed to accept");
      return r.json();
    },
    onSuccess: () => {
      setTimeout(() => navigate("/my-sites"), 2000);
    },
  });

  if (!token) return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="border-white/5 max-w-md w-full">
        <CardContent className="p-8 text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-white font-bold text-lg">Invalid link</h2>
          <p className="text-muted-foreground text-sm mt-2">No invitation token found in this URL.</p>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full space-y-4 animate-in fade-in duration-500">

        {/* Logo */}
        <div className="text-center mb-8">
          <span className="text-2xl font-black text-primary tracking-tight">⚡ FedHost</span>
        </div>

        {isLoading && (
          <Card className="border-white/5">
            <CardContent className="p-8 flex items-center justify-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <p className="text-muted-foreground">Loading invitation…</p>
            </CardContent>
          </Card>
        )}

        {error && (
          <Card className="border-red-500/20 bg-red-500/5">
            <CardContent className="p-8 text-center">
              <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <h2 className="text-white font-bold text-lg">Invitation unavailable</h2>
              <p className="text-muted-foreground text-sm mt-2">{(error as Error).message}</p>
              <p className="text-muted-foreground text-xs mt-4">The invitation may have expired or already been accepted.</p>
            </CardContent>
          </Card>
        )}

        {invite && !acceptMutation.isSuccess && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-primary" />
                You've been invited
              </CardTitle>
              <CardDescription>
                {invite.inviterName ?? invite.inviterEmail ?? "Someone"} invited you to collaborate
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="bg-muted/20 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Site</span>
                  <span className="text-white font-semibold">{invite.siteName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Domain</span>
                  <span className="text-primary font-mono">{invite.domain}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Role</span>
                  <span className="text-white capitalize">{invite.role}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Sent to</span>
                  <span className="text-muted-foreground">{invite.email}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Expires</span>
                  <span className="text-muted-foreground">{new Date(invite.expiresAt).toLocaleDateString()}</span>
                </div>
              </div>

              {!isAuthenticated ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground text-center">
                    Sign in to accept this invitation.
                  </p>
                  <Button
                    className="w-full gap-2"
                    onClick={() => {
                      // Preserve the full URL including token so the user is returned here after login
                      const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
                      window.location.href = `${BASE}/api/auth/login?returnTo=${returnTo}`;
                    }}
                  >
                    <LogIn className="w-4 h-4" />
                    Sign in to accept
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {user?.email !== invite.email && (
                    <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg p-3">
                      ⚠️ You're signed in as <strong>{user?.email}</strong> but this invitation was sent to <strong>{invite.email}</strong>.
                    </p>
                  )}
                  {acceptMutation.error && (
                    <p className="text-sm text-red-400">{(acceptMutation.error as Error).message}</p>
                  )}
                  <Button
                    className="w-full gap-2"
                    onClick={() => acceptMutation.mutate()}
                    disabled={acceptMutation.isPending}
                  >
                    {acceptMutation.isPending
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Accepting…</>
                      : <><UserPlus className="w-4 h-4" />Accept invitation</>
                    }
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {acceptMutation.isSuccess && (
          <Card className="border-green-500/20 bg-green-500/5">
            <CardContent className="p-8 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
              <h2 className="text-white font-bold text-lg">Invitation accepted!</h2>
              <p className="text-muted-foreground text-sm mt-2">
                You now have <strong>{invite?.role}</strong> access to <strong>{invite?.siteName}</strong>.
              </p>
              <p className="text-muted-foreground text-xs mt-4">Redirecting to your sites…</p>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}
