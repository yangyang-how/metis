import { describe, expect, test } from "bun:test";
import {
	buildChapterPrompt,
	buildSynthesisPrompt,
	getBookSynthesisSchema,
	getComprehensionMapSchema,
} from "../../src/comprehend/prompts";
import {
	sampleChapter,
	sampleComprehensionMap,
	sampleMetadata,
} from "./fixtures/sample-chapter";

describe("buildChapterPrompt", () => {
	test("returns system and user messages", () => {
		const messages = buildChapterPrompt(sampleChapter, sampleMetadata);
		expect(messages).toHaveLength(2);
		expect(messages[0]?.role).toBe("system");
		expect(messages[1]?.role).toBe("user");
	});

	test("system message contains comprehension instructions", () => {
		const messages = buildChapterPrompt(sampleChapter, sampleMetadata);
		const systemText = messages[0]?.content[0];
		expect(systemText?.type).toBe("text");
		if (systemText?.type === "text") {
			expect(systemText.text).toContain("comprehension map");
			expect(systemText.text).toContain("KNOWLEDGE STRUCTURES");
		}
	});

	test("user message contains book and chapter info", () => {
		const messages = buildChapterPrompt(sampleChapter, sampleMetadata);
		const userContent = messages[1]?.content[0];
		if (userContent?.type === "text") {
			expect(userContent.text).toContain("Test Book");
			expect(userContent.text).toContain("Foundations");
		}
	});

	test("user message contains section content", () => {
		const messages = buildChapterPrompt(sampleChapter, sampleMetadata);
		const allText = messages[1]?.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");
		expect(allText).toContain("What Is a System?");
		expect(allText).toContain("interconnected components");
	});
});

describe("buildSynthesisPrompt", () => {
	test("returns system and user messages", () => {
		const messages = buildSynthesisPrompt(
			[sampleComprehensionMap],
			sampleMetadata,
		);
		expect(messages).toHaveLength(2);
		expect(messages[0]?.role).toBe("system");
		expect(messages[1]?.role).toBe("user");
	});

	test("user message includes chapter map summaries", () => {
		const messages = buildSynthesisPrompt(
			[sampleComprehensionMap],
			sampleMetadata,
		);
		const userText = messages[1]?.content[0];
		if (userText?.type === "text") {
			expect(userText.text).toContain(sampleComprehensionMap.chapterId);
			expect(userText.text).toContain("System type taxonomy");
		}
	});
});

describe("getComprehensionMapSchema", () => {
	test("returns valid JSON schema with required fields", () => {
		const schema = getComprehensionMapSchema();
		expect(schema.type).toBe("object");
		expect(schema.properties).toBeDefined();
		expect(schema.required).toContain("chapterType");
		expect(schema.required).toContain("sectionAnalyses");
	});
});

describe("getBookSynthesisSchema", () => {
	test("returns valid JSON schema with required fields", () => {
		const schema = getBookSynthesisSchema();
		expect(schema.type).toBe("object");
		expect(schema.required).toContain("crossCuttingThemes");
		expect(schema.required).toContain("entityIndex");
	});
});
