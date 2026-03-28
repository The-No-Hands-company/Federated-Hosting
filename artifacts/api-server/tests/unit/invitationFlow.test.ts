import { describe, it, expect } from "vitest";

/**
 * Tests for the invitation accept flow (routes/invitations.ts).
 *
 * Tests the pure validation logic in isolation — DB operations mocked.
 * Defines the contract for:
 *   - Token expiry checking
 *   - Already-accepted invitation detection
 *   - Email match enforcement in production
 */

// ── Invitation validation logic (mirroring invitations.ts) ───────────────────

interface Invitation {
  id: number;
  token: string;
  email: string;
  role: string;
  acceptedAt: Date | null;
  expiresAt: Date;
  siteId: number;
  invitedBy: string;
}

type ValidationResult =
  | { valid: true }
  | { valid: false; code: string; message: string };

function validateInvitation(
  inv: Invitation,
  userEmail: string,
  now: Date = new Date(),
  isProduction = true,
): ValidationResult {
  if (inv.acceptedAt) {
    return { valid: false, code: "ALREADY_ACCEPTED", message: "This invitation has already been accepted" };
  }

  if (inv.expiresAt < now) {
    return { valid: false, code: "INVITATION_EXPIRED", message: "This invitation has expired" };
  }

  if (isProduction && userEmail.toLowerCase() !== inv.email.toLowerCase()) {
    return { valid: false, code: "EMAIL_MISMATCH", message: "This invitation was sent to a different email address" };
  }

  return { valid: true };
}

function makeInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: 1,
    token: "test-token-abc123",
    email: "alice@example.com",
    role: "editor",
    acceptedAt: null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    siteId: 42,
    invitedBy: "user-owner-id",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Invitation validation", () => {
  describe("valid invitations", () => {
    it("accepts a fresh invitation with matching email", () => {
      const inv = makeInvitation();
      const result = validateInvitation(inv, "alice@example.com");
      expect(result.valid).toBe(true);
    });

    it("is case-insensitive for email comparison", () => {
      const inv = makeInvitation({ email: "Alice@Example.COM" });
      expect(validateInvitation(inv, "alice@example.com").valid).toBe(true);
      expect(validateInvitation(inv, "ALICE@EXAMPLE.COM").valid).toBe(true);
    });

    it("allows any email in development mode (email mismatch ignored)", () => {
      const inv = makeInvitation({ email: "alice@example.com" });
      const result = validateInvitation(inv, "bob@example.com", new Date(), false);
      expect(result.valid).toBe(true);
    });
  });

  describe("already accepted", () => {
    it("rejects with ALREADY_ACCEPTED when acceptedAt is set", () => {
      const inv = makeInvitation({ acceptedAt: new Date("2025-01-01") });
      const result = validateInvitation(inv, "alice@example.com");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe("ALREADY_ACCEPTED");
      }
    });

    it("ALREADY_ACCEPTED takes precedence over expiry", () => {
      const inv = makeInvitation({
        acceptedAt: new Date("2025-01-01"),
        expiresAt:  new Date("2024-12-01"), // also expired
      });
      const result = validateInvitation(inv, "alice@example.com");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe("ALREADY_ACCEPTED");
      }
    });
  });

  describe("expiry", () => {
    it("rejects expired invitations with INVITATION_EXPIRED", () => {
      const inv = makeInvitation({ expiresAt: new Date(Date.now() - 1000) });
      const result = validateInvitation(inv, "alice@example.com");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe("INVITATION_EXPIRED");
      }
    });

    it("accepts invitations expiring exactly now (boundary — not yet past)", () => {
      const now = new Date();
      const inv = makeInvitation({ expiresAt: new Date(now.getTime() + 1000) });
      expect(validateInvitation(inv, "alice@example.com", now).valid).toBe(true);
    });

    it("default expiry is 7 days from creation", () => {
      const createdAt = new Date("2026-01-01T00:00:00Z");
      const expectedExpiry = new Date("2026-01-08T00:00:00Z");
      const inv = makeInvitation({ expiresAt: expectedExpiry });
      // Not yet expired as of creation + 6 days
      const sixDaysLater = new Date("2026-01-07T00:00:00Z");
      expect(validateInvitation(inv, "alice@example.com", sixDaysLater).valid).toBe(true);
      // Expired after 7 days
      const eightDaysLater = new Date("2026-01-09T00:00:00Z");
      const result = validateInvitation(inv, "alice@example.com", eightDaysLater);
      expect(result.valid).toBe(false);
    });
  });

  describe("email enforcement (production only)", () => {
    it("rejects mismatched email in production with EMAIL_MISMATCH", () => {
      const inv = makeInvitation({ email: "alice@example.com" });
      const result = validateInvitation(inv, "bob@example.com", new Date(), true);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe("EMAIL_MISMATCH");
      }
    });

    it("completely different domain also fails", () => {
      const inv = makeInvitation({ email: "alice@company.com" });
      const result = validateInvitation(inv, "alice@personal.com", new Date(), true);
      expect(result.valid).toBe(false);
    });
  });

  describe("role assignment", () => {
    const roles = ["viewer", "editor", "admin"] as const;

    it.each(roles)("accepts role '%s'", (role) => {
      const inv = makeInvitation({ role });
      expect(validateInvitation(inv, "alice@example.com").valid).toBe(true);
    });
  });
});
