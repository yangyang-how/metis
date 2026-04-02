import { describe, expect, test } from "bun:test";
import { synthesizeBook } from "../../src/comprehend/book-synthesizer";
import type { BookSynthesis } from "../../src/comprehend/types";
import {
	createFailingProvider,
	createMockProvider,
} from "./fixtures/mock-provider";
import {
	sampleComprehensionMap,
	sampleMetadata,
} from "./fixtures/sample-chapter";

const sampleSynthesis: BookSynthesis = {
	crossCuttingThemes: [
		{
			name: "Systems thinking",
			description: "Recurring theme across chapters",
			chapterIds: ["ch1"],
		},
	],
	entityIndex: [
		{
			name: "system",
			aliases: ["systems", "system model"],
			chapterIds: ["ch1"],
		},
	],
	bookType: "framework",
};

describe("synthesizeBook — happy path", () => {
	test("returns parsed BookSynthesis from LLM response", async () => {
		const { provider } = createMockProvider([JSON.stringify(sampleSynthesis)]);

		const result = await synthesizeBook(
			[sampleComprehensionMap],
			sampleMetadata,
			provider,
		);

		expect(result.synthesis.crossCuttingThemes).toHaveLength(1);
		expect(result.synthesis.entityIndex).toHaveLength(1);
		expect(result.synthesis.bookType).toBe("framework");
	});

	test("returns usage stats", async () => {
		const { provider } = createMockProvider([JSON.stringify(sampleSynthesis)]);

		const result = await synthesizeBook(
			[sampleComprehensionMap],
			sampleMetadata,
			provider,
		);

		expect(result.usage.inputTokens).toBeGreaterThan(0);
	});
});

describe("synthesizeBook — error handling", () => {
	test("returns empty synthesis on LLM failure (never crashes)", async () => {
		const { provider } = createFailingProvider(new Error("API down"));

		const result = await synthesizeBook(
			[sampleComprehensionMap],
			sampleMetadata,
			provider,
		);

		expect(result.synthesis.crossCuttingThemes).toHaveLength(0);
		expect(result.synthesis.entityIndex).toHaveLength(0);
		expect(result.failed).toBe(true);
	});

	test("returns empty synthesis on invalid JSON response", async () => {
		const { provider } = createMockProvider(["not valid json"]);

		const result = await synthesizeBook(
			[sampleComprehensionMap],
			sampleMetadata,
			provider,
		);

		expect(result.synthesis.crossCuttingThemes).toHaveLength(0);
		expect(result.failed).toBe(true);
	});
});
