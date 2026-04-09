// engine/test/kx/gaps-export.test.ts
import { describe, expect, test } from "bun:test";
import { exportGaps } from "../../src/kx/gaps-export";
import type { ContextPackage, Gap } from "../../src/apply/types";

describe("exportGaps", () => {
  test("produces valid GapsDocument", () => {
    const gaps: Gap[] = [
      { type: "missing_domain", severity: "critical", description: "No networking atoms." },
    ];
    const doc = exportGaps("test query", gaps, {
      totalAtomsRetrieved: 10,
      totalAtomsAfterTraversal: 15,
      contradictionsFound: 1,
      gapsFound: 1,
    });
    expect(doc.version).toBe("gaps/1.0");
    expect(doc.query).toBe("test query");
    expect(doc.gaps).toHaveLength(1);
    expect(doc.stats.gapsFound).toBe(1);
  });

  test("handles empty gaps", () => {
    const doc = exportGaps("clean query", [], {
      totalAtomsRetrieved: 5,
      totalAtomsAfterTraversal: 8,
      contradictionsFound: 0,
      gapsFound: 0,
    });
    expect(doc.gaps).toHaveLength(0);
  });
});
