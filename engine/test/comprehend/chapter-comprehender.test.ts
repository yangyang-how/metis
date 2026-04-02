import { describe, expect, test } from "bun:test";
import { comprehendChapter } from "../../src/comprehend/chapter-comprehender";
import {
	createFailingProvider,
	createMockProvider,
} from "./fixtures/mock-provider";
import {
	sampleChapter,
	sampleComprehensionMap,
	sampleMetadata,
} from "./fixtures/sample-chapter";

describe("comprehendChapter — happy path", () => {
	test("returns parsed ComprehensionMap from LLM response", async () => {
		const { provider, calls } = createMockProvider([
			JSON.stringify(sampleComprehensionMap),
		]);

		const result = await comprehendChapter(
			sampleChapter,
			sampleMetadata,
			provider,
		);

		expect(result.map.chapterId).toBe("ch1");
		expect(result.map.chapterType).toBe("framework");
		expect(result.map.structures).toHaveLength(1);
		expect(result.map.sectionAnalyses).toHaveLength(3);
		expect(calls).toHaveLength(1);
	});

	test("returns usage stats", async () => {
		const { provider } = createMockProvider([
			JSON.stringify(sampleComprehensionMap),
		]);

		const result = await comprehendChapter(
			sampleChapter,
			sampleMetadata,
			provider,
		);

		expect(result.usage.inputTokens).toBeGreaterThan(0);
		expect(result.usage.outputTokens).toBeGreaterThan(0);
	});
});

describe("comprehendChapter — error handling", () => {
	test("returns minimal map when LLM returns invalid JSON", async () => {
		const { provider } = createMockProvider([
			"This is not JSON at all",
			"Still not JSON",
			"Nope",
		]);

		const result = await comprehendChapter(
			sampleChapter,
			sampleMetadata,
			provider,
		);

		expect(result.map.chapterType).toBe("unknown");
		expect(result.map.structures).toHaveLength(0);
		// Should still have section analyses with IDs/titles
		expect(result.map.sectionAnalyses.length).toBeGreaterThan(0);
		expect(result.map.sectionAnalyses[0]?.sectionId).toBe("s1");
	});

	test("returns minimal map when LLM call throws", async () => {
		const { provider } = createFailingProvider(new Error("Network error"));

		const result = await comprehendChapter(
			sampleChapter,
			sampleMetadata,
			provider,
		);

		expect(result.map.chapterType).toBe("unknown");
		expect(result.failed).toBe(true);
	});

	test("retries on invalid JSON before falling back", async () => {
		const { provider, calls } = createMockProvider([
			"not json",
			JSON.stringify(sampleComprehensionMap), // succeeds on second try
		]);

		const result = await comprehendChapter(
			sampleChapter,
			sampleMetadata,
			provider,
		);

		expect(result.map.chapterType).toBe("framework");
		expect(calls).toHaveLength(2); // first call failed, second succeeded
	});
});

describe("comprehendChapter — prompt construction", () => {
	test("sends system and user messages to provider", async () => {
		const { provider, calls } = createMockProvider([
			JSON.stringify(sampleComprehensionMap),
		]);

		await comprehendChapter(sampleChapter, sampleMetadata, provider);

		const request = calls[0];
		expect(request?.messages).toHaveLength(2);
		expect(request?.messages[0]?.role).toBe("system");
		expect(request?.messages[1]?.role).toBe("user");
	});

	test("includes chapter content in user message", async () => {
		const { provider, calls } = createMockProvider([
			JSON.stringify(sampleComprehensionMap),
		]);

		await comprehendChapter(sampleChapter, sampleMetadata, provider);

		const userContent = calls[0]?.messages[1]?.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");
		expect(userContent).toContain("interconnected components");
	});
});
