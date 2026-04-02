import { describe, expect, test } from "bun:test";
import type { SectionAnalysis } from "../../src/comprehend/types";
import { validateAtoms } from "../../src/extract/atom-validator";
import { createRegistry } from "../../src/extract/frame-registry";
import type { CandidateAtom } from "../../src/extract/types";

function makeAtom(overrides: Partial<CandidateAtom> = {}): CandidateAtom {
	return {
		id: "test-ch1-s1-0",
		frame: "definition",
		roles: { term: "system", meaning: "a set of components" },
		conditions: ["in engineering"],
		confidence: 0.8,
		source: {
			title: "Book",
			authors: ["Author"],
			chapterId: "ch1",
			sectionId: "s1",
		},
		domain: [],
		examples: [],
		flags: [],
		...overrides,
	};
}

const sampleAnalysis: SectionAnalysis = {
	sectionId: "s1",
	title: "Intro",
	purpose: "Define terms",
	knowledgeTypes: ["definition", "has_property"],
	conceptsIntroduced: [],
	conceptsReferenced: [],
	buildsOn: [],
	significance: "Foundational",
};

describe("validateAtoms — acceptance", () => {
	test("clean atom passes with no flags", () => {
		const registry = createRegistry();
		const atom = makeAtom();
		const { valid, rejected } = validateAtoms([atom], registry, sampleAnalysis);

		expect(valid).toHaveLength(1);
		expect(rejected).toHaveLength(0);
		expect(valid[0]?.flags).toHaveLength(0);
	});

	test("atom missing optional role gets flagged but accepted", () => {
		const registry = createRegistry();
		// example_of has requiredRoles: ["instance", "concept"], "detail" is optional
		const atom = makeAtom({
			frame: "example_of",
			roles: { instance: "a car", concept: "system" },
		});
		const { valid } = validateAtoms([atom], registry, sampleAnalysis);

		expect(valid).toHaveLength(1);
		expect(valid[0]?.flags).toContain("missing_role:detail");
	});

	test("atom missing required role gets flagged with confidence penalty", () => {
		const registry = createRegistry();
		const atom = makeAtom({
			frame: "causal",
			roles: { cause: "heat" }, // missing "effect" which is required
			confidence: 0.8,
		});
		const { valid } = validateAtoms([atom], registry, sampleAnalysis);

		expect(valid).toHaveLength(1);
		expect(valid[0]?.flags).toContain("missing_required_role:effect");
		expect(valid[0]?.confidence).toBeLessThan(0.8);
	});

	test("atom with empty conditions gets no_conditions flag", () => {
		const registry = createRegistry();
		const atom = makeAtom({ conditions: [] });
		const { valid } = validateAtoms([atom], registry, sampleAnalysis);

		expect(valid).toHaveLength(1);
		expect(valid[0]?.flags).toContain("no_conditions");
	});

	test("atom with unexpected frame type gets flagged", () => {
		const registry = createRegistry();
		// SectionAnalysis predicts "definition" and "has_property"
		// But atom is "procedure" — unexpected
		const atom = makeAtom({
			frame: "procedure",
			roles: { goal: "learn", steps: "1,2,3" },
		});
		const { valid } = validateAtoms([atom], registry, sampleAnalysis);

		expect(valid).toHaveLength(1);
		expect(valid[0]?.flags).toContain("unexpected_frame_type");
	});
});

describe("validateAtoms — rejection", () => {
	test("atom with no frame type is rejected", () => {
		const registry = createRegistry();
		const atom = makeAtom({ frame: "" });
		const { valid, rejected } = validateAtoms([atom], registry);

		expect(valid).toHaveLength(0);
		expect(rejected).toHaveLength(1);
	});

	test("atom with zero roles is rejected", () => {
		const registry = createRegistry();
		const atom = makeAtom({ roles: {} });
		const { valid, rejected } = validateAtoms([atom], registry);

		expect(valid).toHaveLength(0);
		expect(rejected).toHaveLength(1);
	});

	test("atom with unknown frame type is rejected", () => {
		const registry = createRegistry();
		const atom = makeAtom({ frame: "totally_made_up" });
		const { valid, rejected } = validateAtoms([atom], registry);

		expect(valid).toHaveLength(0);
		expect(rejected).toHaveLength(1);
	});
});

describe("validateAtoms — confidence adjustments", () => {
	test("+0.05 for all roles filled", () => {
		const registry = createRegistry();
		const atom = makeAtom({ confidence: 0.7, conditions: [] });
		const { valid } = validateAtoms([atom], registry, sampleAnalysis);

		// All definition roles filled (+0.05), matches prediction (+0.05),
		// no_conditions flag → flags.length > 0 → -0.1
		// Net: 0.7 + 0.05 + 0.05 - 0.1 = 0.7
		expect(valid[0]?.confidence).toBeCloseTo(0.7, 1);
	});

	test("+0.05 for has conditions", () => {
		const registry = createRegistry();
		const atom = makeAtom({ confidence: 0.7, conditions: ["always"] });
		const { valid } = validateAtoms([atom], registry, sampleAnalysis);

		// All roles (+0.05), has conditions (+0.05), matches prediction (+0.05)
		// No flags, so no -0.1 penalty
		// Net: 0.7 + 0.05 + 0.05 + 0.05 = 0.85
		expect(valid[0]?.confidence).toBeCloseTo(0.85, 1);
	});

	test("confidence clamped to [0.0, 1.0]", () => {
		const registry = createRegistry();
		const highAtom = makeAtom({ confidence: 0.98, conditions: ["yes"] });
		const { valid: highResult } = validateAtoms(
			[highAtom],
			registry,
			sampleAnalysis,
		);
		expect(highResult[0]?.confidence).toBeLessThanOrEqual(1.0);

		const lowAtom = makeAtom({
			confidence: 0.05,
			frame: "causal",
			roles: { cause: "x" }, // missing effect
			conditions: [],
		});
		const { valid: lowResult } = validateAtoms(
			[lowAtom],
			registry,
			sampleAnalysis,
		);
		expect(lowResult[0]?.confidence).toBeGreaterThanOrEqual(0.0);
	});
});
