// engine/test/kx/export.test.ts
import { describe, expect, test } from "bun:test";
import { exportToKX } from "../../src/kx/export";
import type { ContextPackage } from "../../src/apply/types";
import {
  atomReplication,
  atomLeaderFollower,
  atomReplicationLag,
  atomEventualOk,
  atomReplicationAlt,
  graphIndex,
} from "../apply/fixtures/sample-graph";

function makePackage(overrides?: Partial<ContextPackage>): ContextPackage {
  return {
    query: "How does replication work?",
    plan: {
      intent: "understand replication",
      analysisType: "exploration",
      targetDomains: ["distributed-systems"],
      targetFrameTypes: ["definition"],
      targetEntities: ["entity-replication"],
      weights: { domainMatch: 0.5, frameTypeMatch: 0.5, entityMatch: 0.5 },
      groupingStrategy: "entity",
    },
    sections: [
      {
        topic: "replication",
        atoms: [atomReplication, atomLeaderFollower, atomReplicationAlt],
      },
    ],
    contradictions: [],
    gaps: [],
    sources: [
      {
        title: "DDIA",
        authors: ["Martin Kleppmann"],
        atomsUsed: 3,
        chaptersReferenced: ["ch5"],
      },
    ],
    stats: {
      totalAtomsRetrieved: 3,
      totalAtomsAfterTraversal: 3,
      contradictionsFound: 0,
      gapsFound: 0,
    },
    ...overrides,
  };
}

describe("exportToKX", () => {
  test("produces valid KXDocument structure", () => {
    const pkg = makePackage();
    const doc = exportToKX(pkg, graphIndex);
    expect(doc.version).toBe("kx/1.0");
    expect(doc.profile).toBe("casual");
    expect(doc.contentId).toMatch(/^sha256:/);
    expect(doc.docId).toMatch(/^sha256:/);
    expect(doc.meta.generatedBy).toBe("metis/0.2");
    expect(doc.meta.generatedAt).toBeDefined();
    expect(doc.meta.domains).toContain("distributed-systems");
  });

  test("maps atoms to KXUnits with correct kind", () => {
    const pkg = makePackage();
    const doc = exportToKX(pkg, graphIndex);
    const defUnit = doc.units.find((u) => u.id === "ds-replication-def");
    expect(defUnit).toBeDefined();
    expect(defUnit!.kind).toBe("definition");
    expect(defUnit!.content).toContain("replication");

    const procUnit = doc.units.find((u) => u.id === "ds-leader-follower");
    expect(procUnit).toBeDefined();
    expect(procUnit!.kind).toBe("procedure");
  });

  test("includes roles from atoms", () => {
    const pkg = makePackage();
    const doc = exportToKX(pkg, graphIndex);
    const unit = doc.units.find((u) => u.id === "ds-replication-def");
    expect(unit!.roles).toBeDefined();
    expect(unit!.roles!.term).toBe("replication");
  });

  test("maps semantic relations, skips structural ones", () => {
    const pkg = makePackage({
      sections: [
        {
          topic: "replication",
          atoms: [atomReplication, atomReplicationAlt],
        },
      ],
    });
    const doc = exportToKX(pkg, graphIndex);
    // ds-replication-def → alt-replication is "reinforces" → should be mapped
    const reinforces = doc.relations.find(
      (r) => r.type === "reinforces" && r.from === "ds-replication-def",
    );
    expect(reinforces).toBeDefined();
  });

  test("skips entity_link and cross_domain relations", () => {
    const pkg = makePackage();
    const doc = exportToKX(pkg, graphIndex);
    const structural = doc.relations.filter(
      (r) => r.type === ("entity_link" as string) || r.type === ("cross_domain" as string),
    );
    expect(structural).toHaveLength(0);
  });

  test("deduplicates sources", () => {
    const pkg = makePackage();
    const doc = exportToKX(pkg, graphIndex);
    const sourceIds = doc.meta.sources.map((s) => s.id);
    expect(new Set(sourceIds).size).toBe(sourceIds.length);
  });
});
