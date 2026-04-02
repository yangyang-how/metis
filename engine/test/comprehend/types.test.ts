import { describe, expect, test } from "bun:test";
import { ComprehendError } from "../../src/comprehend/errors";
import type {
	BookSynthesis,
	ChapterType,
	ComprehendInput,
	ComprehensionMap,
	ComprehensionResult,
	KnowledgeStructure,
	NormalizedChapter,
	NormalizedSection,
	SectionAnalysis,
} from "../../src/comprehend/types";

describe("comprehend types", () => {
	test("ComprehensionMap accepts all chapter types", () => {
		const types: ChapterType[] = [
			"framework",
			"survey",
			"argumentative",
			"narrative",
			"practical",
			"unknown",
		];
		expect(types).toHaveLength(6);
	});

	test("KnowledgeStructure accepts all structure types", () => {
		const structure: KnowledgeStructure = {
			name: "Fogg Behavior Model",
			type: "model",
			components: ["Motivation", "Ability", "Prompt"],
			sectionIds: ["s1", "s2"],
		};
		expect(structure.components).toHaveLength(3);
	});

	test("NormalizedSection supports recursive nesting", () => {
		const section: NormalizedSection = {
			id: "s1",
			title: "Outer",
			level: 1,
			content: [{ type: "paragraph", text: "hello" }],
			sections: [
				{
					id: "s1-1",
					title: "Inner",
					level: 2,
					content: [],
					sections: [],
				},
			],
		};
		expect(section.sections[0]?.title).toBe("Inner");
	});

	test("NormalizedChapter has metadata", () => {
		const chapter: NormalizedChapter = {
			id: "ch1",
			title: "Introduction",
			order: 0,
			sections: [],
			metadata: {
				totalBlockCount: 50,
				hasImages: false,
				estimatedTokens: 2000,
			},
		};
		expect(chapter.metadata.totalBlockCount).toBe(50);
	});
});

describe("ComprehendError", () => {
	test("has typed error codes", () => {
		const err = new ComprehendError(
			"LLM call failed",
			"LLM_CALL_FAILED",
			"ch3",
		);
		expect(err.code).toBe("LLM_CALL_FAILED");
		expect(err.chapterId).toBe("ch3");
		expect(err.name).toBe("ComprehendError");
	});
});
