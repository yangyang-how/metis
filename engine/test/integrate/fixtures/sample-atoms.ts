/**
 * Test fixtures: CandidateAtom[] simulating extraction from 3 books.
 *
 * Book A: "Distributed Systems" (English) — domain: distributed systems
 * Book B: "System Design Guide" (English) — domain: distributed systems
 * Book C: "行为设计模型" (Chinese) — domain: behavioral science
 *
 * Designed overlaps:
 * - "replication lag" appears in Book A and Book B (reinforcement candidate)
 * - "feedback loop" appears in Book A (distributed) and Book C (behavioral) (cross-domain link)
 * - Book A says "replication lag causes stale reads", Book B says "replication lag causes inconsistency" (extension)
 * - Book A says "strong consistency requires synchronous replication",
 *   Book B says "strong consistency does not require synchronous replication" (contradiction candidate)
 */
import type { CandidateAtom } from "../../../src/extract/types";

export function makeAtom(
	overrides: Partial<CandidateAtom> = {},
): CandidateAtom {
	return {
		id: "test-ch1-s1-0",
		frame: "definition",
		roles: { term: "test concept", meaning: "a test definition" },
		conditions: [],
		confidence: 0.8,
		source: {
			title: "Test Book",
			authors: ["Author"],
			chapterId: "ch1",
			sectionId: "s1",
		},
		domain: ["testing"],
		examples: [],
		flags: [],
		...overrides,
	};
}

// --- Book A: Distributed Systems ---

export const bookAAtoms: CandidateAtom[] = [
	makeAtom({
		id: "dist-sys-ch1-s1-0",
		frame: "definition",
		roles: {
			term: "replication lag",
			meaning:
				"the delay between a write on the leader and its reflection on a follower",
		},
		domain: ["distributed systems", "replication"],
		source: {
			title: "Distributed Systems",
			authors: ["Author A"],
			chapterId: "ch1",
			sectionId: "s1",
		},
	}),
	makeAtom({
		id: "dist-sys-ch1-s1-1",
		frame: "causal",
		roles: {
			cause: "replication lag",
			effect: "stale reads from followers",
		},
		domain: ["distributed systems", "replication"],
		source: {
			title: "Distributed Systems",
			authors: ["Author A"],
			chapterId: "ch1",
			sectionId: "s1",
		},
	}),
	makeAtom({
		id: "dist-sys-ch2-s1-0",
		frame: "principle",
		roles: {
			statement: "strong consistency requires synchronous replication",
			scope: "distributed databases",
			implication: "higher latency for writes",
		},
		domain: ["distributed systems", "consistency"],
		source: {
			title: "Distributed Systems",
			authors: ["Author A"],
			chapterId: "ch2",
			sectionId: "s1",
		},
	}),
	makeAtom({
		id: "dist-sys-ch3-s1-0",
		frame: "causal",
		roles: {
			cause: "feedback loop in retry logic",
			effect: "cascading failures across services",
		},
		domain: ["distributed systems", "fault tolerance"],
		source: {
			title: "Distributed Systems",
			authors: ["Author A"],
			chapterId: "ch3",
			sectionId: "s1",
		},
	}),
	makeAtom({
		id: "dist-sys-ch1-s2-0",
		frame: "has_property",
		roles: {
			entity: "replication lag",
			property: "increases during peak load",
		},
		domain: ["distributed systems", "replication"],
		source: {
			title: "Distributed Systems",
			authors: ["Author A"],
			chapterId: "ch1",
			sectionId: "s2",
		},
	}),
];

// --- Book B: System Design Guide ---

export const bookBAtoms: CandidateAtom[] = [
	makeAtom({
		id: "sys-design-ch1-s1-0",
		frame: "definition",
		roles: {
			term: "replication delay",
			meaning:
				"time for a write to propagate from primary to replica",
		},
		domain: ["distributed systems", "databases"],
		source: {
			title: "System Design Guide",
			authors: ["Author B"],
			chapterId: "ch1",
			sectionId: "s1",
		},
	}),
	makeAtom({
		id: "sys-design-ch1-s1-1",
		frame: "causal",
		roles: {
			cause: "replication delay",
			effect: "read inconsistency in distributed databases",
		},
		domain: ["distributed systems", "databases"],
		source: {
			title: "System Design Guide",
			authors: ["Author B"],
			chapterId: "ch1",
			sectionId: "s1",
		},
	}),
	makeAtom({
		id: "sys-design-ch2-s1-0",
		frame: "principle",
		roles: {
			statement:
				"strong consistency does not require synchronous replication",
			scope: "modern distributed databases",
			implication:
				"consensus protocols can achieve consistency without sync replication",
		},
		domain: ["distributed systems", "consistency"],
		source: {
			title: "System Design Guide",
			authors: ["Author B"],
			chapterId: "ch2",
			sectionId: "s1",
		},
	}),
];

// --- Book C: 行为设计模型 (Behavioral Design) ---

export const bookCAtoms: CandidateAtom[] = [
	makeAtom({
		id: "behavior-ch1-s1-0",
		frame: "definition",
		roles: {
			term: "反馈循环",
			meaning: "行为产生的结果反过来影响后续行为的循环过程",
		},
		domain: ["behavioral science", "行为设计"],
		source: {
			title: "行为设计模型",
			authors: ["Author C"],
			chapterId: "ch1",
			sectionId: "s1",
		},
	}),
	makeAtom({
		id: "behavior-ch1-s1-1",
		frame: "heuristic",
		roles: {
			situation: "when building a new habit",
			action: "create a positive feedback loop by celebrating small wins",
			rationale:
				"positive emotions reinforce the neural pathway for the behavior",
		},
		domain: ["behavioral science", "习惯养成"],
		source: {
			title: "行为设计模型",
			authors: ["Author C"],
			chapterId: "ch1",
			sectionId: "s1",
		},
	}),
	makeAtom({
		id: "behavior-ch2-s1-0",
		frame: "causal",
		roles: {
			cause: "feedback loop in habit formation",
			effect: "exponential behavior change over time",
		},
		domain: ["behavioral science", "习惯养成"],
		source: {
			title: "行为设计模型",
			authors: ["Author C"],
			chapterId: "ch2",
			sectionId: "s1",
		},
	}),
];

export const allFixtureAtoms: CandidateAtom[] = [
	...bookAAtoms,
	...bookBAtoms,
	...bookCAtoms,
];
