// engine/test/apply/types.test.ts
import { describe, expect, test } from "bun:test";
import type {
  QueryInput,
  QueryPlan,
  GraphInventory,
  TraversalResult,
  TraversalPath,
  TraversalOptions,
  Gap,
  GapType,
  GapSeverity,
  ContextPackage,
  ContextSection,
  Contradiction,
  ContradictionSide,
  SourceSummary,
  ApplyStats,
  GroupingStrategy,
} from "../../src/apply/types";
import type { Atom } from "../../src/integrate/types";

describe("Apply types", () => {
  test("QueryPlan has all required fields", () => {
    const plan: QueryPlan = {
      intent: "evaluate usability",
      analysisType: "heuristic evaluation",
      targetDomains: ["usability"],
      targetFrameTypes: ["heuristic", "principle"],
      targetEntities: ["affordance"],
      weights: { domainMatch: 0.8, frameTypeMatch: 0.6, entityMatch: 0.4 },
      groupingStrategy: "entity",
    };
    expect(plan.intent).toBe("evaluate usability");
    expect(plan.weights.domainMatch).toBe(0.8);
    expect(plan.groupingStrategy).toBe("entity");
  });

  test("Gap type union covers all cases", () => {
    const types: GapType[] = [
      "missing_domain",
      "missing_frame_type",
      "missing_entity",
      "thin_coverage",
      "unresolved_contradiction",
    ];
    expect(types).toHaveLength(5);
  });

  test("GapSeverity union covers all levels", () => {
    const levels: GapSeverity[] = ["critical", "notable", "minor"];
    expect(levels).toHaveLength(3);
  });

  test("GroupingStrategy union covers all strategies", () => {
    const strategies: GroupingStrategy[] = ["entity", "domain", "frame-type"];
    expect(strategies).toHaveLength(3);
  });

  test("TraversalPath reachedVia discriminates correctly", () => {
    const direct: TraversalPath = {
      atomId: "a1",
      reachedVia: "direct_retrieval",
      depth: 0,
      score: 1.0,
    };
    const traversed: TraversalPath = {
      atomId: "a2",
      reachedVia: "graph_traversal",
      depth: 1,
      edgeType: "reinforces",
      score: 0.8,
    };
    expect(direct.edgeType).toBeUndefined();
    expect(traversed.edgeType).toBe("reinforces");
  });
});
