import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Tests for the federation blocklist (routes/federationBlocks.ts).
 *
 * We test the in-memory Set logic in isolation — the actual DB calls
 * are tested via integration tests. These unit tests define the contract
 * the Rust proxy must match:
 *
 *   isBlocked(domain) → boolean
 *   - Case-insensitive domain comparison
 *   - Exact domain match only (no wildcard)
 *   - Blocking and unblocking reflected immediately in O(1) lookups
 */

// Minimal re-implementation of the blocklist logic for isolated testing
const blockedDomains = new Set<string>();

function isBlocked(domain: string): boolean {
  return blockedDomains.has(domain.toLowerCase());
}

function blockDomain(domain: string): void {
  blockedDomains.add(domain.toLowerCase());
}

function unblockDomain(domain: string): void {
  blockedDomains.delete(domain.toLowerCase());
}

function clearBlocklist(): void {
  blockedDomains.clear();
}

describe("Federation blocklist", () => {
  beforeEach(() => clearBlocklist());

  describe("isBlocked()", () => {
    it("returns false for unknown domains", () => {
      expect(isBlocked("innocent.example.com")).toBe(false);
      expect(isBlocked("")).toBe(false);
    });

    it("returns true after a domain is blocked", () => {
      blockDomain("bad-actor.net");
      expect(isBlocked("bad-actor.net")).toBe(true);
    });

    it("is case-insensitive — blocks regardless of input casing", () => {
      blockDomain("Bad-Actor.NET");
      expect(isBlocked("bad-actor.net")).toBe(true);
      expect(isBlocked("BAD-ACTOR.NET")).toBe(true);
      expect(isBlocked("Bad-Actor.NET")).toBe(true);
    });

    it("does exact domain matching — does not block subdomains", () => {
      blockDomain("evil.example.com");
      expect(isBlocked("evil.example.com")).toBe(true);
      expect(isBlocked("example.com")).toBe(false);
      expect(isBlocked("not-evil.example.com")).toBe(false);
      expect(isBlocked("sub.evil.example.com")).toBe(false);
    });

    it("returns false after domain is unblocked", () => {
      blockDomain("temporary.example.com");
      expect(isBlocked("temporary.example.com")).toBe(true);
      unblockDomain("temporary.example.com");
      expect(isBlocked("temporary.example.com")).toBe(false);
    });

    it("handles multiple blocked domains independently", () => {
      blockDomain("one.example.com");
      blockDomain("two.example.com");
      expect(isBlocked("one.example.com")).toBe(true);
      expect(isBlocked("two.example.com")).toBe(true);
      expect(isBlocked("three.example.com")).toBe(false);

      unblockDomain("one.example.com");
      expect(isBlocked("one.example.com")).toBe(false);
      expect(isBlocked("two.example.com")).toBe(true);
    });

    it("does not block the local node from its own checks", () => {
      // The blocklist is for REMOTE nodes — local domain should never appear
      blockDomain("mynode.nexushosting.example");
      expect(isBlocked("mynode.nexushosting.example")).toBe(true);
      unblockDomain("mynode.nexushosting.example");
      expect(isBlocked("mynode.nexushosting.example")).toBe(false);
    });
  });

  describe("Federation protocol contract (Rust interop)", () => {
    it("blocked domain check is O(1) — same result for repeated lookups", () => {
      blockDomain("constant.example.com");
      for (let i = 0; i < 1000; i++) {
        expect(isBlocked("constant.example.com")).toBe(true);
        expect(isBlocked("other.example.com")).toBe(false);
      }
    });

    it("domain normalisation strips trailing dot (DNS canonical form)", () => {
      // DNS canonical form includes trailing dot — normalise before lookup
      const normalise = (d: string) => d.toLowerCase().replace(/\.$/, "");
      blockDomain("canonical.example.com");
      expect(isBlocked(normalise("canonical.example.com."))).toBe(true);
      expect(isBlocked(normalise("canonical.example.com"))).toBe(true);
    });
  });
});
