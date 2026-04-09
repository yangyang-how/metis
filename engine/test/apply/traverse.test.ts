// engine/test/apply/traverse.test.ts
import { describe, expect, test } from "bun:test";
import { traverse } from "../../src/apply/traverse";
import type { TraversalOptions } from "../../src/apply/types";
import type { Atom } from "../../src/integrate/types";
import {
  allAtoms,
  atomBTree,
  atomConsensus,
  atomDistributedTx,
  atomEventualOk,
  atomLeaderFollower,
  atomPaxos,
  atomRaft,
  atomReplication,
  atomReplicationAlt,
  atomReplicationLag,
  atomCAPTheorem,
  graphIndex,
} from "./fixtures/sample-graph";

// Helper: build atomMap from allAtoms
const atomMap = new Map(allAtoms.map((a) => [a.id, a]));

describe("traverse", () => {
  test("returns seed atoms as depth-0 direct_retrieval paths", () => {
    const seeds: Atom[] = [atomReplication];
    const result = traverse(seeds, graphIndex, atomMap);
    const seedPath = result.paths.find((p) => p.atomId === "ds-replication-def");
    expect(seedPath).toBeDefined();
    expect(seedPath!.depth).toBe(0);
    expect(seedPath!.reachedVia).toBe("direct_retrieval");
  });

  test("follows reinforces edges at depth 1", () => {
    const seeds: Atom[] = [atomReplication];
    const result = traverse(seeds, graphIndex, atomMap);
    const altPath = result.paths.find((p) => p.atomId === "alt-replication");
    expect(altPath).toBeDefined();
    expect(altPath!.reachedVia).toBe("graph_traversal");
    expect(altPath!.edgeType).toBe("reinforces");
  });

  test("follows contradicts edges and surfaces contradictions", () => {
    const seeds: Atom[] = [atomReplicationLag];
    const result = traverse(seeds, graphIndex, atomMap);
    // Should follow the contradicts edge to ds-eventual-ok
    const eventualPath = result.paths.find((p) => p.atomId === "ds-eventual-ok");
    expect(eventualPath).toBeDefined();
    expect(eventualPath!.edgeType).toBe("contradicts");
    // Should surface the contradiction
    expect(result.contradictions.length).toBeGreaterThanOrEqual(1);
    const c = result.contradictions.find(
      (c) => c.atomA === "ds-replication-lag" || c.atomB === "ds-replication-lag",
    );
    expect(c).toBeDefined();
  });

  test("follows extends edges at depth 1 only", () => {
    const seeds: Atom[] = [atomConsensus];
    const result = traverse(seeds, graphIndex, atomMap, { maxDepth: 2 });
    // Depth 1: consensus → paxos (extends), consensus → raft (extends)
    const paxosPath = result.paths.find((p) => p.atomId === "ds-paxos");
    expect(paxosPath).toBeDefined();
    expect(paxosPath!.depth).toBe(1);
    // Paxos → raft is "reinforces" not "extends", so it should follow at depth 2
    // But raft was already added at depth 1 (from consensus), so it's deduped
    const raftPath = result.paths.find((p) => p.atomId === "ds-raft");
    expect(raftPath).toBeDefined();
    expect(raftPath!.depth).toBe(1); // reached directly from consensus, not via paxos
  });

  test("skips entity_link edges without matching target entities in plan", () => {
    const seeds: Atom[] = [atomConsensus];
    const result = traverse(seeds, graphIndex, atomMap, {
      maxDepth: 1,
      // No plan → entity_link edges skipped
    });
    const distTxPath = result.paths.find((p) => p.atomId === "cross-dist-tx");
    expect(distTxPath).toBeUndefined();
  });

  test("follows entity_link edges when plan targets matching entity", () => {
    const seeds: Atom[] = [atomConsensus];
    const result = traverse(seeds, graphIndex, atomMap, {
      maxDepth: 1,
      plan: {
        intent: "understand consensus",
        analysisType: "exploration",
        targetDomains: ["distributed-systems"],
        targetFrameTypes: ["definition"],
        targetEntities: ["entity-transactions"], // cross-dist-tx has this entity
        weights: { domainMatch: 0.5, frameTypeMatch: 0.5, entityMatch: 0.5 },
        groupingStrategy: "entity",
      },
    });
    const distTxPath = result.paths.find((p) => p.atomId === "cross-dist-tx");
    expect(distTxPath).toBeDefined();
  });

  test("respects confidence threshold per hop", () => {
    const seeds: Atom[] = [atomReplication];
    // Very high threshold — should filter out most edges
    const result = traverse(seeds, graphIndex, atomMap, {
      maxDepth: 1,
      minConfidence: [0.95], // only edges >= 0.95
    });
    // No edges from ds-replication-def have confidence >= 0.95
    // (reinforces=0.9, extends=0.85, extends=0.8)
    const nonSeedPaths = result.paths.filter((p) => p.depth > 0);
    expect(nonSeedPaths).toHaveLength(0);
  });

  test("respects maxExpanded cap", () => {
    const seeds: Atom[] = [atomReplication, atomConsensus, atomBTree];
    const result = traverse(seeds, graphIndex, atomMap, {
      maxDepth: 2,
      maxExpanded: 5, // only 5 total including seeds
    });
    expect(result.atoms.length).toBeLessThanOrEqual(5);
  });

  test("deduplicates atoms reached via multiple paths", () => {
    const seeds: Atom[] = [atomReplication];
    const result = traverse(seeds, graphIndex, atomMap);
    const atomIds = result.atoms.map((a) => a.id);
    const unique = new Set(atomIds);
    expect(atomIds.length).toBe(unique.size);
  });

  test("score decays with depth", () => {
    const seeds: Atom[] = [atomReplication];
    const result = traverse(seeds, graphIndex, atomMap, { maxDepth: 2 });
    const depth1 = result.paths.filter((p) => p.depth === 1);
    const depth2 = result.paths.filter((p) => p.depth === 2);
    if (depth1.length > 0 && depth2.length > 0) {
      const maxDepth1Score = Math.max(...depth1.map((p) => p.score));
      const maxDepth2Score = Math.max(...depth2.map((p) => p.score));
      expect(maxDepth1Score).toBeGreaterThan(maxDepth2Score);
    }
  });
});
