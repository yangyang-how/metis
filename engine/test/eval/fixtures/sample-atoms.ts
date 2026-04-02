/**
 * Test fixtures for eval checks.
 *
 * Each atom is designed to trigger (or pass) a specific check.
 * Named by what they test: passing_*, failing_*.
 */
import type { CandidateAtom } from "../../../src/extract/types";

function makeAtom(overrides: Partial<CandidateAtom>): CandidateAtom {
	return {
		id: "eval-test-0",
		frame: "definition",
		roles: {
			term: "replication lag",
			meaning: "the delay between leader write and follower reflection",
		},
		conditions: ["in distributed databases"],
		confidence: 0.85,
		source: {
			title: "Test Book",
			authors: ["Author"],
			chapterId: "ch1",
			sectionId: "s1",
		},
		domain: ["distributed systems"],
		examples: [],
		flags: [],
		...overrides,
	};
}

// --- Structural checks ---

/** Should pass all structural checks */
export const passingAtom = makeAtom({ id: "pass-01" });

/** Missing frame → structural:missing-frame */
export const missingFrame = makeAtom({ id: "fail-struct-01", frame: "" });

/** Empty roles → structural:empty-roles */
export const emptyRoles = makeAtom({ id: "fail-struct-02", roles: {} });

/** Unregistered frame type → structural:unregistered-frame */
export const unregisteredFrame = makeAtom({
	id: "fail-struct-03",
	frame: "nonexistent_frame_type",
});

// --- Schema checks ---

/** Missing required role "meaning" for definition frame → schema:missing-required-role */
export const missingRequiredRole = makeAtom({
	id: "fail-schema-01",
	frame: "definition",
	roles: { term: "something" },
	// "meaning" is required for definition but missing
});

/** Missing optional role "detail" for example_of → schema:missing-optional-role */
export const missingOptionalRole = makeAtom({
	id: "fail-schema-02",
	frame: "example_of",
	roles: { instance: "Toyota", concept: "lean manufacturing" },
	// "detail" is optional but missing
});

/** All roles filled → passes schema checks */
export const allRolesFilled = makeAtom({
	id: "pass-schema-01",
	frame: "example_of",
	roles: {
		instance: "Toyota Production System",
		concept: "lean manufacturing",
		detail: "eliminates waste through just-in-time production",
	},
});

// --- Semantic checks ---

/** Compound role value (3+ sentences) → semantic:compound-role */
export const compoundRole = makeAtom({
	id: "fail-semantic-01",
	roles: {
		term: "replication",
		meaning:
			"Replication is the process of copying data. It ensures high availability. It can be synchronous or asynchronous. There are trade-offs between consistency and latency.",
	},
});

/** Vague/generic content → semantic:vague-content */
export const vagueContent = makeAtom({
	id: "fail-semantic-02",
	roles: {
		term: "concept",
		meaning: "important",
	},
});

/** Another vague pattern */
export const vagueContentPattern = makeAtom({
	id: "fail-semantic-03",
	roles: {
		term: "factors",
		meaning: "various factors affect the outcome",
	},
});

/** Confidence outlier — way below frame-type mean */
export const confidenceOutlier = makeAtom({
	id: "fail-semantic-04",
	confidence: 0.3,
	// Other definition atoms average ~0.9, so 0.3 is a clear outlier
});

/** Empty conditions → semantic:empty-conditions */
export const emptyConditions = makeAtom({
	id: "fail-semantic-05",
	conditions: [],
});

/** Short but specific content → passes semantic checks */
export const specificContent = makeAtom({
	id: "pass-semantic-01",
	roles: {
		term: "replication lag",
		meaning:
			"the delay between a write on the leader and its reflection on a follower replica",
	},
	conditions: ["in distributed databases with asynchronous replication"],
	confidence: 0.85,
});

// --- Mixed: atoms for aggregate testing ---

export const batchAtoms: CandidateAtom[] = [
	passingAtom,
	specificContent,
	allRolesFilled,
	emptyConditions,
	compoundRole,
	vagueContent,
	missingRequiredRole,
];
