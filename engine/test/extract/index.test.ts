import { describe, expect, test } from "bun:test";
import type {
	ComprehensionMap,
	NormalizedChapter,
} from "../../src/comprehend/types";
import { createRegistry } from "../../src/extract/frame-registry";
import { extract } from "../../src/extract/index";
import { createMockProvider } from "../comprehend/fixtures/mock-provider";
import { sampleExtractionResponse } from "./fixtures/sample-section";

const bookMetadata = { title: "Test Book", authors: ["Author"] };

const sampleChapter: NormalizedChapter = {
	id: "ch1",
	title: "Chapter 1",
	order: 0,
	sections: [
		{
			id: "s1",
			title: "Short Intro",
			level: 1,
			content: [{ type: "paragraph", text: "Just one paragraph." }],
			sections: [],
		},
		{
			id: "s2",
			title: "Main Content",
			level: 1,
			content: [
				{ type: "paragraph", text: "First real paragraph." },
				{ type: "paragraph", text: "Second paragraph." },
				{ type: "paragraph", text: "Third paragraph." },
			],
			sections: [],
		},
		{
			id: "s3",
			title: "Another Section",
			level: 1,
			content: [
				{ type: "paragraph", text: "More content here." },
				{ type: "paragraph", text: "And more." },
				{ type: "paragraph", text: "Enough blocks." },
			],
			sections: [],
		},
	],
	metadata: { totalBlockCount: 7, hasImages: false, estimatedTokens: 300 },
};

const sampleMap: ComprehensionMap = {
	chapterId: "ch1",
	chapterType: "framework",
	summary: "Test chapter",
	structures: [],
	sectionAnalyses: [
		{
			sectionId: "s1",
			title: "Short Intro",
			purpose: "Brief intro",
			knowledgeTypes: [],
			conceptsIntroduced: [],
			conceptsReferenced: [],
			buildsOn: [],
			significance: "Minimal",
		},
		{
			sectionId: "s2",
			title: "Main Content",
			purpose: "Core definitions",
			knowledgeTypes: ["definition", "taxonomy"],
			conceptsIntroduced: ["system"],
			conceptsReferenced: [],
			buildsOn: [],
			significance: "Key section",
		},
		{
			sectionId: "s3",
			title: "Another Section",
			purpose: "More knowledge",
			knowledgeTypes: ["causal"],
			conceptsIntroduced: [],
			conceptsReferenced: ["system"],
			buildsOn: ["s2"],
			significance: "Builds on prior",
		},
	],
};

describe("extract — full pipeline", () => {
	test("extracts atoms from qualifying sections", async () => {
		// s1 has 1 block (skip), s2 has 3 blocks (extract), s3 has 3 blocks (extract)
		const { provider } = createMockProvider([
			sampleExtractionResponse,
			sampleExtractionResponse,
		]);
		const registry = createRegistry();

		const result = await extract({
			chapter: sampleChapter,
			comprehensionMap: sampleMap,
			bookMetadata,
			registry,
			provider,
		});

		expect(result.atoms.length).toBeGreaterThan(0);
		expect(result.usage.callCount).toBe(2); // s2 and s3
	});

	test("skips trivial sections (<3 blocks)", async () => {
		const { provider } = createMockProvider([
			sampleExtractionResponse,
			sampleExtractionResponse,
		]);
		const registry = createRegistry();

		const result = await extract({
			chapter: sampleChapter,
			comprehensionMap: sampleMap,
			bookMetadata,
			registry,
			provider,
		});

		expect(result.skippedSections).toContain("s1");
	});

	test("accumulates usage across sections", async () => {
		const { provider } = createMockProvider([
			sampleExtractionResponse,
			sampleExtractionResponse,
		]);
		const registry = createRegistry();

		const result = await extract({
			chapter: sampleChapter,
			comprehensionMap: sampleMap,
			bookMetadata,
			registry,
			provider,
		});

		expect(result.usage.inputTokens).toBeGreaterThan(0);
		expect(result.usage.callCount).toBe(2);
	});

	test("failed section doesn't halt pipeline", async () => {
		const { provider } = createMockProvider([
			"invalid json",
			"still invalid",
			"nope",
			sampleExtractionResponse, // s3 succeeds
		]);
		const registry = createRegistry();

		const result = await extract({
			chapter: sampleChapter,
			comprehensionMap: sampleMap,
			bookMetadata,
			registry,
			provider,
		});

		// s2 failed (3 retries), s3 succeeded
		expect(result.atoms.length).toBeGreaterThan(0);
	});

	test("fills chapterId in atom source", async () => {
		const { provider } = createMockProvider([
			sampleExtractionResponse,
			sampleExtractionResponse,
		]);
		const registry = createRegistry();

		const result = await extract({
			chapter: sampleChapter,
			comprehensionMap: sampleMap,
			bookMetadata,
			registry,
			provider,
		});

		for (const atom of result.atoms) {
			expect(atom.source.chapterId).toBe("ch1");
		}
	});

	test("registers proposed domain types in registry", async () => {
		const responseWithProposal = JSON.stringify({
			atoms: [
				{
					frame: "new_domain_type",
					roles: { a: "first", b: "second" },
					conditions: [],
					confidence: 0.8,
					domain: [],
					examples: [],
				},
			],
			proposedFrameTypes: [
				{
					name: "new_domain_type",
					roles: { a: "first role", b: "second role" },
					description: "A new domain type",
				},
			],
		});

		const { provider } = createMockProvider([
			responseWithProposal,
			sampleExtractionResponse,
		]);
		const registry = createRegistry();

		await extract({
			chapter: sampleChapter,
			comprehensionMap: sampleMap,
			bookMetadata,
			registry,
			provider,
		});

		expect(registry.has("new_domain_type")).toBe(true);
	});
});
