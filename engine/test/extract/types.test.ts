import { describe, expect, test } from "bun:test";
import { ExtractError } from "../../src/extract/errors";
import { bookSlug } from "../../src/extract/types";
import type {
	CandidateAtom,
	ExtractionResult,
	FrameType,
	ProposedFrameType,
} from "../../src/extract/types";

describe("extract types", () => {
	test("CandidateAtom has all required fields", () => {
		const atom: CandidateAtom = {
			id: "test-ch1-s1-0",
			frame: "definition",
			roles: { term: "system", meaning: "a set of components" },
			conditions: ["in engineering contexts"],
			confidence: 0.85,
			source: {
				title: "Test Book",
				authors: ["Author"],
				chapterId: "ch1",
				sectionId: "s1",
			},
			domain: ["systems-thinking"],
			examples: ["a car engine is a system"],
			flags: [],
		};
		expect(atom.frame).toBe("definition");
		expect(atom.domain).toHaveLength(1);
		expect(atom.examples).toHaveLength(1);
	});

	test("FrameType includes requiredRoles and version", () => {
		const ft: FrameType = {
			name: "causal",
			roles: { cause: "the cause", effect: "the effect" },
			requiredRoles: ["cause", "effect"],
			description: "Simple causation",
			category: "core",
			version: 1,
		};
		expect(ft.requiredRoles).toHaveLength(2);
		expect(ft.version).toBe(1);
	});

	test("ExtractionResult includes callCount in usage", () => {
		const result: ExtractionResult = {
			atoms: [],
			proposedFrameTypes: [],
			usage: { inputTokens: 0, outputTokens: 0, callCount: 5 },
			skippedSections: [],
			flaggedAtoms: [],
		};
		expect(result.usage.callCount).toBe(5);
	});
});

describe("bookSlug", () => {
	test("converts English title to kebab-case", () => {
		expect(bookSlug("Designing Data-Intensive Applications")).toBe(
			"designing-data-intensive-applications",
		);
	});

	test("preserves CJK characters", () => {
		const slug = bookSlug("福格行为模型");
		expect(slug).toContain("福格行为模型");
	});

	test("truncates to 40 chars", () => {
		const long = "A".repeat(60);
		expect(bookSlug(long).length).toBeLessThanOrEqual(40);
	});

	test("strips special characters", () => {
		expect(bookSlug("Hello! World? #1")).toBe("hello-world-1");
	});
});

describe("ExtractError", () => {
	test("has typed error codes", () => {
		const err = new ExtractError("failed", "LLM_CALL_FAILED", "s3");
		expect(err.code).toBe("LLM_CALL_FAILED");
		expect(err.sectionId).toBe("s3");
		expect(err.name).toBe("ExtractError");
	});
});
