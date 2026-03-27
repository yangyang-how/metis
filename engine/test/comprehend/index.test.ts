import { beforeAll, describe, expect, test } from "bun:test";
import { comprehend } from "../../src/comprehend/index";
import type { BookSynthesis } from "../../src/comprehend/types";
import type { DocumentTree } from "../../src/parse/types";
import {
	createFailingProvider,
	createMockProvider,
} from "./fixtures/mock-provider";
import { sampleComprehensionMap } from "./fixtures/sample-chapter";

const sampleSynthesis: BookSynthesis = {
	crossCuttingThemes: [
		{
			name: "Systems",
			description: "About systems",
			chapterIds: ["ch1"],
		},
	],
	entityIndex: [],
	bookType: "framework",
};

// A minimal DocumentTree for integration testing
const sampleTree: DocumentTree = {
	metadata: { title: "Test Book", authors: ["Author"] },
	chapters: [
		{
			id: "ch1",
			title: "Chapter 1",
			order: 0,
			sections: [],
			content: [
				{ type: "heading", text: "Section A", level: 2 },
				{ type: "paragraph", text: "Some content here." },
				{ type: "heading", text: "Section B", level: 2 },
				{ type: "paragraph", text: "More content here." },
			],
		},
		{
			id: "ch2",
			title: "Chapter 2: Analysis",
			order: 1,
			sections: [],
			content: [
				{ type: "paragraph", text: "Analysis paragraph one." },
				{ type: "paragraph", text: "Analysis paragraph two." },
				{ type: "paragraph", text: "Analysis paragraph three." },
				{ type: "paragraph", text: "Analysis paragraph four." },
				{ type: "paragraph", text: "Analysis paragraph five." },
				{ type: "paragraph", text: "Analysis paragraph six." },
			],
		},
	],
};

describe("comprehend — full pipeline", () => {
	test("returns ComprehensionResult with chapter maps and synthesis", async () => {
		// Mock: one response per chapter + one for synthesis
		const { provider } = createMockProvider([
			JSON.stringify({ ...sampleComprehensionMap, chapterId: "ch1" }),
			JSON.stringify({ ...sampleComprehensionMap, chapterId: "ch2" }),
			JSON.stringify(sampleSynthesis),
		]);

		const result = await comprehend({
			documentTree: sampleTree,
			provider,
		});

		expect(result.chapterMaps).toHaveLength(2);
		expect(result.chapterMaps[0]?.chapterId).toBe("ch1");
		expect(result.chapterMaps[1]?.chapterId).toBe("ch2");
		expect(result.bookSynthesis.crossCuttingThemes.length).toBeGreaterThan(0);
	});

	test("accumulates usage stats across all calls", async () => {
		const { provider } = createMockProvider([
			JSON.stringify(sampleComprehensionMap),
			JSON.stringify(sampleComprehensionMap),
			JSON.stringify(sampleSynthesis),
		]);

		const result = await comprehend({
			documentTree: sampleTree,
			provider,
		});

		expect(result.usage.callCount).toBe(3); // 2 chapters + 1 synthesis
		expect(result.usage.totalInputTokens).toBeGreaterThan(0);
	});

	test("runs structure inference before LLM calls", async () => {
		const { provider, calls } = createMockProvider([
			JSON.stringify(sampleComprehensionMap),
			JSON.stringify(sampleComprehensionMap),
			JSON.stringify(sampleSynthesis),
		]);

		await comprehend({
			documentTree: sampleTree,
			provider,
		});

		// The flat chapters (no sections, but with H2 headings) should have been
		// normalized — the LLM should receive section-delimited content
		const firstCall = calls[0];
		const userText = firstCall?.messages[1]?.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");
		expect(userText).toContain("=== Section:");
	});
});

describe("comprehend — error handling", () => {
	test("failed chapter produces minimal map, pipeline continues", async () => {
		const { provider } = createMockProvider([
			"invalid json", // ch1 fails
			"still invalid",
			"nope",
			JSON.stringify({ ...sampleComprehensionMap, chapterId: "ch2" }), // ch2 succeeds
			JSON.stringify(sampleSynthesis),
		]);

		const result = await comprehend({
			documentTree: sampleTree,
			provider,
		});

		expect(result.chapterMaps).toHaveLength(2);
		// First chapter should be minimal (failed)
		expect(result.chapterMaps[0]?.chapterType).toBe("unknown");
		// Second chapter should have real data
		expect(result.chapterMaps[1]?.chapterType).not.toBe("unknown");
		expect(result.usage.failedChapters).toContain("ch1");
	});

	test("failed synthesis still returns chapter maps", async () => {
		const { provider } = createMockProvider([
			JSON.stringify(sampleComprehensionMap),
			JSON.stringify(sampleComprehensionMap),
			"synthesis fails", // synthesis returns invalid JSON
		]);

		const result = await comprehend({
			documentTree: sampleTree,
			provider,
		});

		expect(result.chapterMaps).toHaveLength(2);
		// Synthesis should be empty but present
		expect(result.bookSynthesis.crossCuttingThemes).toHaveLength(0);
	});
});
