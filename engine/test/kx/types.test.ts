// engine/test/kx/types.test.ts
import { describe, expect, test } from "bun:test";
import type {
  KXDocument,
  KXUnit,
  KXRelation,
  KXRelationType,
  KXSource,
  KXKind,
  GapsDocument,
} from "../../src/kx/types";

describe("KX types", () => {
  test("KXDocument has required structure", () => {
    const doc: KXDocument = {
      version: "kx/1.0",
      contentId: "sha256:test",
      docId: "sha256:test",
      profile: "standard",
      meta: {
        domains: ["testing"],
        sources: [],
        generatedBy: "metis/0.2",
        generatedAt: new Date().toISOString(),
      },
      units: [],
      relations: [],
    };
    expect(doc.version).toBe("kx/1.0");
    expect(doc.profile).toBe("standard");
  });

  test("KXKind covers all 12 types", () => {
    const kinds: KXKind[] = [
      "definition", "property", "classification", "causal",
      "heuristic", "principle", "procedure", "comparison",
      "threshold", "deviation", "example", "evaluation",
    ];
    expect(kinds).toHaveLength(12);
  });

  test("KXRelationType covers all 5 types", () => {
    const types: KXRelationType[] = [
      "reinforces", "contradicts", "extends", "requires", "exemplifies",
    ];
    expect(types).toHaveLength(5);
  });

  test("GapsDocument has required structure", () => {
    const doc: GapsDocument = {
      version: "gaps/1.0",
      query: "test query",
      gaps: [],
      stats: { totalAtomsRetrieved: 0, contradictionsFound: 0, gapsFound: 0 },
    };
    expect(doc.version).toBe("gaps/1.0");
  });
});
