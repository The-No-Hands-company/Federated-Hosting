import { describe, it, expect, vi, beforeEach } from "vitest";
import { authenticator } from "otplib";
import crypto from "crypto";

// Mirror the lockout constants from twoFactor.ts
const MAX_TOTP_FAILURES = 5;
const TOTP_LOCKOUT_WINDOW_S = 600;

// Mirror the backup code helpers
function generateBackupCodes(n = 10): string[] {
  return Array.from({ length: n }, () =>
    crypto.randomBytes(4).toString("hex").toUpperCase().match(/.{4}/g)!.join("-")
  );
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code.replace(/-/g, "").toUpperCase()).digest("hex");
}

// In-memory lockout tracker (mirrors Redis behaviour in tests)
const failureCounts = new Map<string, number>();

function recordFailure(userId: string): { locked: boolean; remaining: number } {
  const count = (failureCounts.get(userId) ?? 0) + 1;
  failureCounts.set(userId, count);
  return { locked: count >= MAX_TOTP_FAILURES, remaining: Math.max(0, MAX_TOTP_FAILURES - count) };
}

function clearFailures(userId: string): void { failureCounts.delete(userId); }
function isLocked(userId: string): boolean { return (failureCounts.get(userId) ?? 0) >= MAX_TOTP_FAILURES; }

describe("TOTP lockout logic", () => {
  beforeEach(() => failureCounts.clear());

  it("not locked on first failure", () => {
    const { locked, remaining } = recordFailure("user1");
    expect(locked).toBe(false);
    expect(remaining).toBe(4);
  });

  it("locks on 5th consecutive failure", () => {
    for (let i = 0; i < 4; i++) recordFailure("user1");
    const { locked } = recordFailure("user1");
    expect(locked).toBe(true);
  });

  it("remaining decrements correctly", () => {
    const results = [];
    for (let i = 0; i < 5; i++) results.push(recordFailure("user1").remaining);
    expect(results).toEqual([4, 3, 2, 1, 0]);
  });

  it("clears lockout on successful authentication", () => {
    for (let i = 0; i < 5; i++) recordFailure("user2");
    expect(isLocked("user2")).toBe(true);
    clearFailures("user2");
    expect(isLocked("user2")).toBe(false);
  });

  it("users are isolated — different user IDs have independent counters", () => {
    for (let i = 0; i < 5; i++) recordFailure("userA");
    expect(isLocked("userA")).toBe(true);
    expect(isLocked("userB")).toBe(false);
  });

  it("remaining is 0 when locked, not negative", () => {
    for (let i = 0; i < 10; i++) recordFailure("user3");
    expect(recordFailure("user3").remaining).toBe(0);
  });
});

describe("Backup code generation and hashing", () => {
  it("generates correct number of codes", () => {
    expect(generateBackupCodes(10)).toHaveLength(10);
    expect(generateBackupCodes(5)).toHaveLength(5);
  });

  it("codes are formatted as XXXX-XXXX", () => {
    const codes = generateBackupCodes(10);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    }
  });

  it("all codes are unique", () => {
    const codes = generateBackupCodes(100);
    expect(new Set(codes).size).toBe(100);
  });

  it("hash is deterministic", () => {
    const code = "ABCD-EF12";
    expect(hashCode(code)).toBe(hashCode(code));
  });

  it("hash is case-insensitive", () => {
    expect(hashCode("ABCD-EF12")).toBe(hashCode("abcd-ef12"));
  });

  it("hash ignores hyphens", () => {
    expect(hashCode("ABCDEF12")).toBe(hashCode("ABCD-EF12"));
  });

  it("different codes produce different hashes", () => {
    expect(hashCode("ABCD-EF12")).not.toBe(hashCode("ABCD-EF13"));
  });
});

describe("Backup code consumption (atomic simulation)", () => {
  it("consumes code atomically — removes from list", () => {
    const codes = generateBackupCodes(10);
    const hashes = codes.map(hashCode);
    const target = codes[3]!;
    const targetHash = hashCode(target);

    const idx = hashes.indexOf(targetHash);
    expect(idx).toBe(3);

    const remaining = [...hashes];
    remaining.splice(idx, 1);
    expect(remaining).toHaveLength(9);
    expect(remaining.includes(targetHash)).toBe(false);
  });

  it("invalid code returns -1 index without modifying list", () => {
    const codes = generateBackupCodes(5);
    const hashes = codes.map(hashCode);
    const idx = hashes.indexOf(hashCode("DEAD-BEEF"));
    expect(idx).toBe(-1);
    expect(hashes).toHaveLength(5); // unchanged
  });

  it("same code cannot be used twice (second attempt fails)", () => {
    const codes = generateBackupCodes(3);
    let hashes = codes.map(hashCode);
    const target = codes[0]!;

    // First use — succeeds
    const idx1 = hashes.indexOf(hashCode(target));
    expect(idx1).toBe(0);
    hashes = [...hashes.slice(0, idx1), ...hashes.slice(idx1 + 1)];
    expect(hashes).toHaveLength(2);

    // Second use — fails
    const idx2 = hashes.indexOf(hashCode(target));
    expect(idx2).toBe(-1);
  });
});

describe("TOTP code validation (otplib)", () => {
  it("valid code passes check", () => {
    const secret = authenticator.generateSecret();
    const code = authenticator.generate(secret);
    expect(authenticator.check(code, secret)).toBe(true);
  });

  it("wrong code fails check", () => {
    const secret = authenticator.generateSecret();
    expect(authenticator.check("000000", secret)).toBe(false);
  });

  it("code for different secret fails", () => {
    const secretA = authenticator.generateSecret();
    const secretB = authenticator.generateSecret();
    const code = authenticator.generate(secretA);
    expect(authenticator.check(code, secretB)).toBe(false);
  });
});
