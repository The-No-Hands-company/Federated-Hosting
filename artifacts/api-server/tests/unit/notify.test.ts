import { describe, it, expect } from "vitest";
import { RETENTION_DAYS, MAX_PER_USER, render } from "../../src/lib/notify";
import type { WebhookPayload } from "../../src/lib/webhooks";

/**
 * The rendering and routing rules, without a database.
 *
 * This file previously asserted only the two constants while its own comment
 * claimed it covered the drop-unknown-events rule. It did not — the rule was
 * described in a comment and never checked, which is the same shape of gap
 * that lets a suite go green over a routine that never worked.
 */

const at = "2026-08-21T20:00:00.000Z";
const ev = (p: Partial<WebhookPayload>) => ({ timestamp: at, ...p }) as WebhookPayload;

describe("notification policy", () => {
  it("keeps notifications for a bounded time", () => {
    // Documented as 90 days in the schema comment and the migration. A silent
    // change here would make both wrong.
    expect(RETENTION_DAYS).toBe(90);
  });

  it("caps how many one user can accumulate", () => {
    // Without a ceiling, one flapping site buries every other notification a
    // user has, which is the failure mode that makes people stop looking.
    expect(MAX_PER_USER).toBe(500);
    expect(MAX_PER_USER).toBeGreaterThan(0);
  });
});

describe("rendering an event for a person", () => {
  it("drops an event nobody has written a sentence for", () => {
    // The rule the old comment claimed and never checked. Returning null is
    // what keeps a raw enum out of somebody's notification list.
    expect(render(ev({ event: "some_future_event" as WebhookPayload["event"] }))).toBeNull();
  });

  it("writes a sentence, not an event name", () => {
    const r = render(ev({ event: "deploy_failed", siteId: 4, siteDomain: "draw.tnhc.dev" }));
    expect(r).not.toBeNull();
    // The defining property: a human reads this, so it must not contain the
    // underscore-separated enum it came from.
    expect(r!.title).not.toMatch(/_/);
    expect(r!.title).toContain("draw.tnhc.dev");
  });

  it("links a site event to that site", () => {
    const r = render(ev({ event: "site_down", siteId: 12, siteDomain: "x.tnhc.dev" }));
    expect(r!.href).toBe("/sites/12");
  });

  it("omits the link rather than inventing one when there is no site", () => {
    // "/sites/undefined" is the failure this guards: a template that always
    // builds an href produces a link to a page that cannot exist.
    const r = render(ev({ event: "site_down" }));
    expect(r!.href).toBeUndefined();
  });

  it("names a site it was given no domain for without printing undefined", () => {
    const r = render(ev({ event: "deploy", siteId: 3 }));
    expect(r!.title).not.toContain("undefined");
  });

  it("sends federation events to the federation page", () => {
    for (const event of ["node_offline", "node_online", "new_peer"] as const) {
      expect(render(ev({ event, nodeDomain: "peer.example" }))!.href).toBe("/federation");
    }
  });

  it("covers every event the webhook emitters can produce", () => {
    // The emitters and this table are two lists that must stay in step. A new
    // event added to webhooks.ts without a sentence here would be silently
    // dropped from everyone's notifications, and nothing else would notice.
    const emitted = [
      "deploy", "deploy_failed", "site_down", "site_recovered",
      "new_peer", "node_online", "node_offline", "form_submission",
    ] as const;
    const missing = emitted.filter((event) => render(ev({ event })) === null);
    expect(missing).toEqual([]);
  });
});
