import { describe, it, expect } from "vitest";
import { isEmbedded } from "./embed";

describe("isEmbedded", () => {
  it("detects the shell's parameter", () => {
    expect(isEmbedded("?embed=1")).toBe(true);
  });

  it("is false when absent", () => {
    expect(isEmbedded("")).toBe(false);
    expect(isEmbedded("?foo=bar")).toBe(false);
  });

  it("ignores other values, so ?embed=0 does not embed", () => {
    // Exact match, not truthiness: "0" is a string and would otherwise pass.
    expect(isEmbedded("?embed=0")).toBe(false);
    expect(isEmbedded("?embed=true")).toBe(false);
  });

  it("finds it alongside other parameters", () => {
    expect(isEmbedded("?site=7&embed=1")).toBe(true);
  });
});
