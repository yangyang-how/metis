// engine/test/apply/rerank.test.ts
import { describe, expect, test } from "bun:test";
import { rerank } from "../../src/apply/rerank";
import type { QueryPlan } from "../../src/apply/types";
import type { RetrievalResult } from "../../src/retrieve/index";
import {
  atomReplication,
  atomBTree,
  atomACID,
  atomLeaderFollower,
} from "./fixtures/sample-graph";

const plan: QueryPlan = {
  intent: "understand replication",
  analysisType: "exploration",
  targetDomains: ["distributed-systems"],
  targetFrameTypes: ["definition", "procedure"],
  targetEntities: ["entity-replication"],
  weights: { domainMatch: 0.8, frameTypeMatch: 0.6, entityMatch: 0.9 },
  groupingStrategy: "entity",
};

describe("rerank", () => {
  test("boosts atoms matching target domains", () => {
    const results: RetrievalResult[] = [
      { atom: atomBTree, score: 1.0, ranks: { bm25: 1, vector: 1 } },
      { atom: atomReplication, score: 0.9, ranks: { bm25: 2, vector: 2 } },
    ];
    const reranked = rerank({ results, plan });
    // atomReplication matches domain + frameType + entity → heavily boosted
    // atomBTree matches none → no boost
    expect(reranked[0]!.atom.id).toBe("ds-replication-def");
  });

  test("preserves original order when no plan boosts apply", () => {
    const noPlan: QueryPlan = {
      ...plan,
      targetDomains: [],
      targetFrameTypes: [],
      targetEntities: [],
      weights: { domainMatch: 0, frameTypeMatch: 0, entityMatch: 0 },
    };
    const results: RetrievalResult[] = [
      { atom: atomReplication, score: 1.0, ranks: { bm25: 1, vector: 1 } },
      { atom: atomBTree, score: 0.5, ranks: { bm25: 2, vector: 2 } },
    ];
    const reranked = rerank({ results, plan: noPlan });
    expect(reranked[0]!.atom.id).toBe("ds-replication-def");
    expect(reranked[1]!.atom.id).toBe("db-btree-def");
  });

  test("entity match provides largest boost when weight is highest", () => {
    const results: RetrievalResult[] = [
      { atom: atomACID, score: 1.0, ranks: { bm25: 1, vector: 1 } },
      { atom: atomLeaderFollower, score: 0.8, ranks: { bm25: 2, vector: 2 } },
    ];
    const reranked = rerank({ results, plan });
    // atomLeaderFollower: domain match + frameType (procedure) + entity (entity-replication)
    // atomACID: neither domain nor entity match
    expect(reranked[0]!.atom.id).toBe("ds-leader-follower");
  });
});
