// engine/test/apply/compose.test.ts
import { describe, expect, test } from "bun:test";
import {
	compose,
	generateSummaries,
	groupAtoms,
} from "../../src/apply/compose";
import type { QueryPlan, TraversalResult } from "../../src/apply/types";
import type { Atom } from "../../src/integrate/types";
import { mockSummaryProvider } from "./fixtures/mock-provider";
import {
	allAtoms,
	atomACID,
	atomBTree,
	atomBTreeVsLSM,
	atomConsensus,
	atomEventualOk,
	atomLSMTree,
	atomLeaderFollower,
	atomReplication,
	atomReplicationAlt,
	atomReplicationLag,
	entities,
	graphIndex,
} from "./fixtures/sample-graph";

const basePlan: QueryPlan = {
	intent: "understand replication",
	analysisType: "exploration",
	targetDomains: ["distributed-systems"],
	targetFrameTypes: ["definition"],
	targetEntities: ["entity-replication"],
	weights: { domainMatch: 0.5, frameTypeMatch: 0.5, entityMatch: 0.5 },
	groupingStrategy: "entity",
};

describe("groupAtoms", () => {
	const atoms: Atom[] = [
		atomReplication,
		atomLeaderFollower,
		atomBTree,
		atomLSMTree,
	];

	test("entity grouping groups by primary entityRef", () => {
		const sections = groupAtoms(atoms, "entity", entities);
		// entity-replication: atomReplication, atomLeaderFollower
		// entity-btree: atomBTree
		// entity-lsm: atomLSMTree
		expect(sections.length).toBeGreaterThanOrEqual(3);
		const replicationSection = sections.find((s) => s.topic === "replication");
		expect(replicationSection).toBeDefined();
		expect(replicationSection?.atoms.length).toBe(2);
	});

	test("domain grouping groups by first domain", () => {
		const sections = groupAtoms(atoms, "domain", entities);
		const dsSec = sections.find((s) => s.topic === "distributed-systems");
		expect(dsSec).toBeDefined();
		expect(dsSec?.atoms.length).toBe(2);
		const dbSec = sections.find((s) => s.topic === "databases");
		expect(dbSec).toBeDefined();
		expect(dbSec?.atoms.length).toBe(2);
	});

	test("frame-type grouping groups by frame", () => {
		const sections = groupAtoms(atoms, "frame-type", entities);
		const defSec = sections.find((s) => s.topic === "definition");
		expect(defSec).toBeDefined();
		// atomReplication, atomBTree, atomLSMTree are all definitions
		expect(defSec?.atoms.length).toBe(3);
	});

	test("sections sorted by atom count descending", () => {
		const sections = groupAtoms(atoms, "domain", entities);
		for (let i = 1; i < sections.length; i++) {
			const curr = sections[i];
			const prev = sections[i - 1];
			if (curr && prev) {
				expect(curr.atoms.length).toBeLessThanOrEqual(prev.atoms.length);
			}
		}
	});
});

describe("compose", () => {
	test("assembles full ContextPackage", () => {
		const atoms: Atom[] = [
			atomReplication,
			atomLeaderFollower,
			atomReplicationAlt,
		];
		const traversalResult: TraversalResult = {
			atoms,
			paths: atoms.map((a, i) => ({
				atomId: a.id,
				reachedVia:
					i === 0
						? ("direct_retrieval" as const)
						: ("graph_traversal" as const),
				depth: i === 0 ? 0 : 1,
				score: 1 - i * 0.1,
			})),
			contradictions: [],
		};

		const pkg = compose({
			query: "How does replication work?",
			plan: basePlan,
			traversalResult,
			gaps: [],
			entities,
			retrieveCount: 1,
		});

		expect(pkg.query).toBe("How does replication work?");
		expect(pkg.sections.length).toBeGreaterThan(0);
		expect(pkg.stats.totalAtomsRetrieved).toBe(1);
		expect(pkg.stats.totalAtomsAfterTraversal).toBe(3);
		expect(pkg.sources.length).toBeGreaterThan(0);
	});

	test("builds source summaries with chapter references", () => {
		const atoms: Atom[] = [atomReplication, atomLeaderFollower];
		const traversalResult: TraversalResult = {
			atoms,
			paths: [],
			contradictions: [],
		};

		const pkg = compose({
			query: "test",
			plan: basePlan,
			traversalResult,
			gaps: [],
			entities,
			retrieveCount: 2,
		});

		const ddiaSrc = pkg.sources.find((s) => s.title === "DDIA");
		expect(ddiaSrc).toBeDefined();
		expect(ddiaSrc?.atomsUsed).toBe(2);
		expect(ddiaSrc?.chaptersReferenced).toContain("ch5");
	});

	test("includes contradictions from traversal", () => {
		const atoms: Atom[] = [atomReplicationLag, atomEventualOk];
		const traversalResult: TraversalResult = {
			atoms,
			paths: [],
			contradictions: [
				{
					atomA: "ds-replication-lag",
					atomB: "ds-eventual-ok",
					topic: "entity-consistency",
				},
			],
		};

		const pkg = compose({
			query: "test",
			plan: basePlan,
			traversalResult,
			gaps: [],
			entities,
			retrieveCount: 2,
		});

		expect(pkg.contradictions.length).toBe(1);
		expect(pkg.contradictions[0]?.topic).toBe("entity-consistency");
		expect(pkg.stats.contradictionsFound).toBe(1);
	});
});

describe("generateSummaries", () => {
	test("adds summary to each section", async () => {
		const atoms: Atom[] = [atomReplication, atomLeaderFollower];
		const traversalResult: TraversalResult = {
			atoms,
			paths: [],
			contradictions: [],
		};
		const pkg = compose({
			query: "How does replication work?",
			plan: basePlan,
			traversalResult,
			gaps: [],
			entities,
			retrieveCount: 2,
		});
		expect(pkg.sections[0]?.summary).toBeUndefined();

		await generateSummaries(pkg, mockSummaryProvider);
		for (const section of pkg.sections) {
			expect(section.summary).toBeDefined();
			expect(section.summary?.length).toBeGreaterThan(0);
		}
	});
});
