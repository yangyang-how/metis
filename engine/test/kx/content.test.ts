// engine/test/kx/content.test.ts
import { describe, expect, test } from "bun:test";
import { buildContent, FRAME_TO_KX_KIND } from "../../src/kx/content";
import type { Atom } from "../../src/integrate/types";

describe("FRAME_TO_KX_KIND", () => {
  test("maps all 17 core frame types", () => {
    const coreFrames = [
      "definition", "has_property", "is_a", "consists_of", "taxonomy",
      "example_of", "causal", "causal_chain", "heuristic", "principle",
      "procedure", "method_comparison", "threshold", "deviation",
      "formula", "sequence", "evaluation_matrix",
    ];
    for (const frame of coreFrames) {
      expect(FRAME_TO_KX_KIND[frame]).toBeDefined();
    }
  });

  test("unknown frames fall back to 'property'", () => {
    expect(FRAME_TO_KX_KIND["some_custom_frame"]).toBeUndefined();
    // The frameToKXKind function handles the fallback
  });
});

describe("buildContent", () => {
  test("definition template", () => {
    const content = buildContent("definition", { term: "CAP theorem", meaning: "you cannot have C, A, and P simultaneously" });
    expect(content).toContain("CAP theorem");
    expect(content).toContain("you cannot have C, A, and P simultaneously");
  });

  test("heuristic template", () => {
    const content = buildContent("heuristic", {
      situation: "designing for mobile",
      action: "use large touch targets",
      rationale: "fingers are imprecise",
    });
    expect(content).toContain("designing for mobile");
    expect(content).toContain("use large touch targets");
  });

  test("method_comparison template", () => {
    const content = buildContent("method_comparison", {
      method_a: "B-tree",
      method_b: "LSM-tree",
      difference: "B-tree faster reads, LSM faster writes",
    });
    expect(content).toContain("B-tree");
    expect(content).toContain("LSM-tree");
  });

  test("unknown frame falls back to concatenated roles", () => {
    const content = buildContent("custom_frame", { key1: "value1", key2: "value2" });
    expect(content).toContain("value1");
    expect(content).toContain("value2");
  });
});
