/**
 * Test fixtures for retrieval tests.
 *
 * 15 atoms across 3 languages/domains with known text content
 * so we can predict BM25 and vector search rankings.
 *
 * Designed retrieval scenarios:
 * - Query "replication lag" should rank dist-sys atoms highest (BM25 exact match)
 * - Query "行业生命周期" should rank industry-lifecycle atoms highest (CJK bigram match)
 * - Query "habit formation feedback" should rank behavioral atoms highest
 * - "penetration rate threshold" should match threshold + heuristic atoms
 */
import type { CandidateAtom } from "../../../src/extract/types";

function makeAtom(overrides: Partial<CandidateAtom>): CandidateAtom {
	return {
		id: "test-0",
		frame: "definition",
		roles: { term: "test", meaning: "test" },
		conditions: [],
		confidence: 0.85,
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

// --- Distributed Systems (English) ---

export const distSysAtoms: CandidateAtom[] = [
	makeAtom({
		id: "dist-01",
		frame: "definition",
		roles: {
			term: "replication lag",
			meaning:
				"the delay between a write on the leader and its reflection on a follower",
		},
		domain: ["distributed systems"],
		source: {
			title: "Distributed Systems",
			authors: ["Author A"],
			chapterId: "ch1",
			sectionId: "s1",
		},
	}),
	makeAtom({
		id: "dist-02",
		frame: "causal",
		roles: {
			cause: "replication lag",
			effect: "stale reads from follower replicas",
		},
		domain: ["distributed systems"],
		source: {
			title: "Distributed Systems",
			authors: ["Author A"],
			chapterId: "ch1",
			sectionId: "s2",
		},
	}),
	makeAtom({
		id: "dist-03",
		frame: "principle",
		roles: {
			statement: "strong consistency requires synchronous replication",
			scope: "distributed databases",
		},
		domain: ["distributed systems"],
		source: {
			title: "Distributed Systems",
			authors: ["Author A"],
			chapterId: "ch2",
			sectionId: "s1",
		},
	}),
	makeAtom({
		id: "dist-04",
		frame: "threshold",
		roles: {
			metric: "replication lag",
			threshold_value: "100ms",
			transition: "acceptable to degraded read consistency",
			direction: "above",
		},
		domain: ["distributed systems"],
		source: {
			title: "Distributed Systems",
			authors: ["Author A"],
			chapterId: "ch1",
			sectionId: "s3",
		},
	}),
	makeAtom({
		id: "dist-05",
		frame: "heuristic",
		roles: {
			situation: "when replication lag exceeds SLA threshold",
			action: "route reads to leader or use read-your-writes consistency",
			rationale: "prevents serving stale data to the writing user",
		},
		domain: ["distributed systems"],
		source: {
			title: "Distributed Systems",
			authors: ["Author A"],
			chapterId: "ch1",
			sectionId: "s4",
		},
	}),
];

// --- Industry Analysis (Chinese) ---

export const industryAtoms: CandidateAtom[] = [
	makeAtom({
		id: "ind-01",
		frame: "taxonomy",
		roles: {
			concept: "行业生命周期",
			categories: "导入期、成长期、成熟期、衰退期",
			basis: "渗透率和市场增速",
		},
		domain: ["行业分析"],
		source: {
			title: "如何快速了解一个行业",
			authors: ["Author B"],
			chapterId: "ch1",
			sectionId: "s1",
		},
	}),
	makeAtom({
		id: "ind-02",
		frame: "threshold",
		roles: {
			metric: "渗透率",
			threshold_value: "10%",
			transition: "导入期向成长期转换",
			direction: "above",
		},
		domain: ["行业分析"],
		source: {
			title: "如何快速了解一个行业",
			authors: ["Author B"],
			chapterId: "ch1",
			sectionId: "s2",
		},
	}),
	makeAtom({
		id: "ind-03",
		frame: "heuristic",
		roles: {
			situation: "判断行业所处阶段时",
			action: "先看渗透率确定大致阶段再看增速验证",
			rationale: "渗透率是最可靠的阶段判断指标",
		},
		domain: ["行业分析"],
		source: {
			title: "如何快速了解一个行业",
			authors: ["Author B"],
			chapterId: "ch1",
			sectionId: "s3",
		},
	}),
	makeAtom({
		id: "ind-04",
		frame: "principle",
		roles: {
			statement:
				"penetration rate is the most reliable indicator of industry lifecycle stage",
			scope: "industry analysis",
			implication:
				"use penetration rate before growth rate when determining stage",
		},
		domain: ["industry analysis"],
		source: {
			title: "如何快速了解一个行业",
			authors: ["Author B"],
			chapterId: "ch1",
			sectionId: "s4",
		},
	}),
];

// --- Behavioral Science (Mixed EN/CJK) ---

export const behaviorAtoms: CandidateAtom[] = [
	makeAtom({
		id: "beh-01",
		frame: "definition",
		roles: {
			term: "feedback loop",
			meaning:
				"a cycle where the output of a behavior influences subsequent behavior",
		},
		domain: ["behavioral science"],
		source: {
			title: "Tiny Habits",
			authors: ["Author C"],
			chapterId: "ch1",
			sectionId: "s1",
		},
	}),
	makeAtom({
		id: "beh-02",
		frame: "causal",
		roles: {
			cause: "positive feedback loop in habit formation",
			effect: "exponential behavior change over time",
		},
		domain: ["behavioral science"],
		source: {
			title: "Tiny Habits",
			authors: ["Author C"],
			chapterId: "ch2",
			sectionId: "s1",
		},
	}),
	makeAtom({
		id: "beh-03",
		frame: "heuristic",
		roles: {
			situation: "when building a new habit",
			action: "celebrate immediately after performing the behavior",
			rationale:
				"celebration creates positive emotions that reinforce the neural pathway",
		},
		domain: ["behavioral science"],
		source: {
			title: "Tiny Habits",
			authors: ["Author C"],
			chapterId: "ch2",
			sectionId: "s2",
		},
	}),
	makeAtom({
		id: "beh-04",
		frame: "procedure",
		roles: {
			goal: "establish a tiny habit",
			steps:
				"1. anchor to existing routine 2. make behavior tiny 3. celebrate immediately",
			context: "habit formation",
		},
		domain: ["behavioral science"],
		source: {
			title: "Tiny Habits",
			authors: ["Author C"],
			chapterId: "ch3",
			sectionId: "s1",
		},
	}),
];

// --- Unrelated atom (noise for retrieval tests) ---

export const noiseAtoms: CandidateAtom[] = [
	makeAtom({
		id: "noise-01",
		frame: "definition",
		roles: {
			term: "photosynthesis",
			meaning:
				"the process by which plants convert sunlight into chemical energy",
		},
		domain: ["biology"],
		source: {
			title: "Biology 101",
			authors: ["Author D"],
			chapterId: "ch1",
			sectionId: "s1",
		},
	}),
	makeAtom({
		id: "noise-02",
		frame: "formula",
		roles: {
			name: "quadratic formula",
			expression: "x = (-b ± √(b²-4ac)) / 2a",
			terms: "a, b, c are coefficients of ax² + bx + c = 0",
		},
		domain: ["mathematics"],
		source: {
			title: "Algebra Fundamentals",
			authors: ["Author E"],
			chapterId: "ch1",
			sectionId: "s1",
		},
	}),
];

export const allFixtureAtoms: CandidateAtom[] = [
	...distSysAtoms,
	...industryAtoms,
	...behaviorAtoms,
	...noiseAtoms,
];
