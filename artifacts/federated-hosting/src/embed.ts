/**
 * Whether this app is being rendered inside the ecosystem shell.
 *
 * The shell at app.tnhc.dev frames each app with `?embed=1`. Nexus-Draw,
 * Nexus-Chat and Nexus-Cloud have honoured this since the shell was built;
 * Hosting never did, so app.tnhc.dev/hosting showed the shell's identity
 * controls *and* Hosting's own "Sign In" button — two sign-in affordances on
 * one screen, one of which is meaningless because the shell already
 * authenticated you.
 *
 * A query parameter rather than postMessage or a header: it works identically
 * from any language and any framework, and an app that ignores it still
 * functions — just with its own chrome as well as the shell's. Degrading to
 * "slightly wrong" beats degrading to "blank".
 *
 * Only auth controls are hidden when embedded. Hosting's own page navigation
 * stays, because the shell's sidebar lists *apps* and has nothing to say about
 * my-sites, deploy or federation — hiding those would strand a user inside the
 * frame with no way to move.
 */
export function isEmbedded(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get("embed") === "1";
}
