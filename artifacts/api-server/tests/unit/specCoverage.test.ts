import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * How much of this service the OpenAPI description actually covers.
 *
 * The spec sat in the repository unserved for as long as the service existed,
 * so nothing ever compared it to the code. When it was finally checked it
 * listed 50 paths, of which 49 correspond to routes that exist — a little
 * under 40% of the service's 127. The fiftieth documents an endpoint the code
 * does not have, which is its own small warning about unchecked specs.
 *
 * This does not demand 100%. It records where the number is and fails if it
 * gets worse, so adding routes without documenting them is a decision someone
 * makes on purpose rather than one that happens quietly. Raise the floor when
 * you raise the coverage.
 */
const DOCUMENTED_FLOOR = 49;

function specPaths(): Set<string> {
  const raw = readFileSync(
    path.resolve(__dirname, "../../../../lib/api-spec/openapi.yaml"),
    "utf8",
  );
  // Deliberately not a YAML parse: js-yaml is not a dependency here, and the
  // paths block is regular enough that a two-space-indented key under `paths:`
  // is unambiguous. A parser would be better if one were already present.
  const out = new Set<string>();
  let inPaths = false;
  for (const line of raw.split("\n")) {
    if (/^paths:\s*$/.test(line)) { inPaths = true; continue; }
    if (inPaths && /^\S/.test(line)) break;
    const m = inPaths && line.match(/^ {2}(\/[^:]*):\s*$/);
    if (m) out.add(m[1]);
  }
  return out;
}

function codeRoutes(): Set<string> {
  const dir = path.resolve(__dirname, "../../src/routes");
  const out = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
    const src = readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/router\.(?:get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
      // Express ":id" is OpenAPI "{id}".
      out.add(m[1].replace(/:(\w+)/g, "{$1}"));
    }
  }
  return out;
}

describe("OpenAPI coverage", () => {
  it("parses a non-trivial set of paths out of the spec", () => {
    // Guards the regex above: if the spec's formatting changes and this drops
    // to zero, the coverage test below would pass vacuously.
    expect(specPaths().size).toBeGreaterThan(40);
  });

  it("finds the service's routes", () => {
    expect(codeRoutes().size).toBeGreaterThan(100);
  });

  it("documents at least as many routes as it did when this was written", () => {
    const documented = [...codeRoutes()].filter((r) => specPaths().has(r)).length;
    expect(documented).toBeGreaterThanOrEqual(DOCUMENTED_FLOOR);
  });
});
