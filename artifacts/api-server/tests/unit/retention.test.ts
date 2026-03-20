import { describe, it, expect } from "vitest";

// ── Retention window calculations ─────────────────────────────────────────────

function daysAgo(n: number, from = new Date()): Date {
  return new Date(from.getTime() - n * 86_400_000);
}

function isExpired(createdAt: Date, retentionDays: number, now = new Date()): boolean {
  return createdAt < daysAgo(retentionDays, now);
}

describe("Retention window logic", () => {
  const now = new Date("2025-06-01T00:00:00Z");

  it("89-day-old record is kept under 90-day retention", () => {
    expect(isExpired(daysAgo(89, now), 90, now)).toBe(false);
  });

  it("91-day-old record is pruned under 90-day retention", () => {
    expect(isExpired(daysAgo(91, now), 90, now)).toBe(true);
  });

  it("exactly 90 days old is not pruned (boundary)", () => {
    expect(isExpired(daysAgo(90, now), 90, now)).toBe(false);
  });

  it("1-day-old record is kept under any reasonable retention", () => {
    for (const days of [30, 90, 180, 365]) {
      expect(isExpired(daysAgo(1, now), days, now)).toBe(false);
    }
  });

  it("366-day-old record is pruned under 365-day retention", () => {
    expect(isExpired(daysAgo(366, now), 365, now)).toBe(true);
  });
});

// ── Form spam scoring ─────────────────────────────────────────────────────────

function scoreSpam(data: Record<string, string>): number {
  let score = 0;
  const values = Object.values(data).join(" ").toLowerCase();

  if (data["_gotcha"] || data["website"] || data["url"]) score += 1.0;
  if (/https?:\/\//gi.test(values) && (values.match(/https?:\/\//g) ?? []).length > 2) score += 0.5;
  if (/\b(viagra|casino|crypto|bitcoin|forex|loan|prize|winner)\b/gi.test(values)) score += 0.6;
  if (data["email"] && !/^[^@]+@[^@]+\.[^@]+$/.test(data["email"])) score += 0.4;

  return Math.min(score, 1.0);
}

describe("Form spam scoring", () => {
  it("clean submission scores 0", () => {
    expect(scoreSpam({ name: "Alice", message: "Hello!" })).toBe(0);
  });

  it("honeypot filled triggers maximum score", () => {
    expect(scoreSpam({ _gotcha: "bot", name: "Bot" })).toBe(1.0);
  });

  it("website field filled triggers maximum score", () => {
    expect(scoreSpam({ website: "http://spam.com", name: "Spammer" })).toBe(1.0);
  });

  it("3+ URLs in content raises score", () => {
    const score = scoreSpam({
      message: "Visit https://a.com and https://b.com and https://c.com for deals",
    });
    expect(score).toBeGreaterThan(0);
  });

  it("spam keywords raise score over 0.5 threshold", () => {
    const score = scoreSpam({ message: "Win the casino bitcoin crypto prize today!" });
    expect(score).toBeGreaterThanOrEqual(0.6);
  });

  it("invalid email format raises score", () => {
    const score = scoreSpam({ email: "not-an-email", name: "Test" });
    expect(score).toBeGreaterThan(0);
  });

  it("valid email does not raise score", () => {
    expect(scoreSpam({ email: "alice@example.com", name: "Alice" })).toBe(0);
  });

  it("score never exceeds 1.0", () => {
    const score = scoreSpam({
      _gotcha: "yes",
      website: "http://spam.com",
      message: "casino bitcoin https://a.com https://b.com https://c.com prize winner",
    });
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it("score >= 0.5 is considered spam (flagged)", () => {
    const data = { message: "Win casino bitcoin prize" };
    expect(scoreSpam(data) >= 0.5).toBe(true);
  });

  it("normal contact message is not flagged", () => {
    const data = { name: "Bob Smith", email: "bob@example.com", message: "I need help with my order." };
    expect(scoreSpam(data) >= 0.5).toBe(false);
  });
});

// ── Env var key validation ─────────────────────────────────────────────────────

const KEY_RE = /^[A-Z_][A-Z0-9_]{0,99}$/;

describe("Environment variable key validation", () => {
  it("accepts valid uppercase keys", () => {
    for (const key of ["VITE_API_URL", "NODE_ENV", "DATABASE_URL", "MY_SECRET_123"]) {
      expect(KEY_RE.test(key)).toBe(true);
    }
  });

  it("rejects lowercase keys", () => {
    expect(KEY_RE.test("vite_api_url")).toBe(false);
    expect(KEY_RE.test("node_env")).toBe(false);
  });

  it("rejects keys starting with a digit", () => {
    expect(KEY_RE.test("1_KEY")).toBe(false);
    expect(KEY_RE.test("123")).toBe(false);
  });

  it("rejects keys with hyphens", () => {
    expect(KEY_RE.test("MY-KEY")).toBe(false);
  });

  it("rejects empty key", () => {
    expect(KEY_RE.test("")).toBe(false);
  });

  it("accepts single-character key", () => {
    expect(KEY_RE.test("X")).toBe(true);
    expect(KEY_RE.test("_")).toBe(true);
  });

  it("rejects keys over 100 characters", () => {
    expect(KEY_RE.test("A".repeat(101))).toBe(false);
    expect(KEY_RE.test("A".repeat(100))).toBe(true);
  });
});
