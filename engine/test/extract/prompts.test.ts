import { describe, expect, test } from "bun:test";
import { createRegistry } from "../../src/extract/frame-registry";
import {
	buildExtractionPrompt,
	getExtractionResponseSchema,
} from "../../src/extract/prompts";
import { sampleAnalysis, sampleSection } from "./fixtures/sample-section";

const bookMetadata = { title: "Test Book", authors: ["Author"] };

describe("buildExtractionPrompt", () => {
	test("returns system and user messages", () => {
		const registry = createRegistry();
		const messages = buildExtractionPrompt(
			sampleSection,
			sampleAnalysis,
			registry,
			bookMetadata,
		);
		expect(messages).toHaveLength(2);
		expect(messages[0]?.role).toBe("system");
		expect(messages[1]?.role).toBe("user");
	});

	test("system message contains all 17 core frame type names", () => {
		const registry = createRegistry();
		const messages = buildExtractionPrompt(
			sampleSection,
			sampleAnalysis,
			registry,
			bookMetadata,
		);

		const systemText = messages[0]?.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		expect(systemText).toContain("definition");
		expect(systemText).toContain("causal_chain");
		expect(systemText).toContain("heuristic");
		expect(systemText).toContain("deviation");
		expect(systemText).toContain("evaluation_matrix");
	});

	test("user message contains section content", () => {
		const registry = createRegistry();
		const messages = buildExtractionPrompt(
			sampleSection,
			sampleAnalysis,
			registry,
			bookMetadata,
		);

		const userText = messages[1]?.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		expect(userText).toContain("three main types");
		expect(userText).toContain("simple, complicated, and complex");
	});

	test("user message contains SectionAnalysis context", () => {
		const registry = createRegistry();
		const messages = buildExtractionPrompt(
			sampleSection,
			sampleAnalysis,
			registry,
			bookMetadata,
		);

		const userText = messages[1]?.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		expect(userText).toContain("taxonomy");
		expect(userText).toContain("three-part taxonomy");
	});
});

describe("getExtractionResponseSchema", () => {
	test("returns valid JSON schema", () => {
		const schema = getExtractionResponseSchema();
		expect(schema.type).toBe("object");
		expect(schema.properties).toBeDefined();
		expect(schema.required).toContain("atoms");
	});
});
