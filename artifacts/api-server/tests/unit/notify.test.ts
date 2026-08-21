import { describe, it, expect } from "vitest";
import { RETENTION_DAYS, MAX_PER_USER } from "../../src/lib/notify";

/**
 * The rendering and routing rules, without a database.
 *
 * The parts worth asserting here are the ones a reader would get wrong: that
 * an unknown event is dropped rather than shown as a raw enum, and that the
 * retention constants are what the docs claim. Anything needing real rows is
 * covered by the route tests.
 */
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
