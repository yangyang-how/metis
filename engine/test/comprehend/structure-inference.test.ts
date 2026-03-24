import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeChapters } from "../../src/comprehend/structure-inference";
import { parse } from "../../src/parse/index";
import type {
	Chapter,
	ContentBlock,
	DocumentTree,
	Section,
} from "../../src/parse/types";
import { buildFixtures } from "../parse/fixtures/build-fixtures";

// Helper to build a minimal DocumentTree for testing
function makeTree(chapters: Chapter[]): DocumentTree {
	return {
		metadata: { title: "Test", authors: ["Author"] },
		chapters,
	};
}

function makeChapter(
	overrides: Partial<Chapter> & { id: string; title: string },
): Chapter {
	return {
		order: 0,
		sections: [],
		content: [],
		...overrides,
	};
}

describe("normalizeChapters — chapters with existing sections", () => {
	test("passes through chapters that already have sections", () => {
		const tree = makeTree([
			makeChapter({
				id: "ch1",
				title: "Chapter 1",
				sections: [
					{
						id: "s1",
						title: "Section 1",
						level: 1,
						content: [{ type: "paragraph", text: "Hello" }],
						sections: [],
					},
				],
			}),
		]);
		const result = normalizeChapters(tree);
		expect(result).toHaveLength(1);
		expect(result[0]?.sections).toHaveLength(1);
		expect(result[0]?.sections[0]?.title).toBe("Section 1");
	});

	test("prepends chapter.content to first section", () => {
		const tree = makeTree([
			makeChapter({
				id: "ch1",
				title: "Chapter 1",
				content: [{ type: "paragraph", text: "Intro paragraph" }],
				sections: [
					{
						id: "s1",
						title: "Section 1",
						level: 1,
						content: [{ type: "paragraph", text: "Section content" }],
						sections: [],
					},
				],
			}),
		]);
		const result = normalizeChapters(tree);
		const firstSection = result[0]?.sections[0];
		expect(firstSection?.content.length).toBeGreaterThanOrEqual(2);
		const texts = firstSection?.content
			.filter(
				(b): b is { type: "paragraph"; text: string } => b.type === "paragraph",
			)
			.map((b) => b.text);
		expect(texts).toContain("Intro paragraph");
	});
});

describe("normalizeChapters — flat chapters with headings", () => {
	test("splits at H2 boundaries", () => {
		const tree = makeTree([
			makeChapter({
				id: "ch1",
				title: "Part 1",
				content: [
					{ type: "heading", text: "Chapter A", level: 2 },
					{ type: "paragraph", text: "Content A" },
					{ type: "heading", text: "Chapter B", level: 2 },
					{ type: "paragraph", text: "Content B" },
				],
			}),
		]);
		const result = normalizeChapters(tree);
		expect(result[0]?.sections.length).toBeGreaterThanOrEqual(2);
		expect(result[0]?.sections[0]?.title).toBe("Chapter A");
		expect(result[0]?.sections[1]?.title).toBe("Chapter B");
	});

	test("generates deterministic IDs", () => {
		const tree = makeTree([
			makeChapter({
				id: "ch1",
				title: "Part 1",
				content: [
					{ type: "heading", text: "My Section", level: 2 },
					{ type: "paragraph", text: "Content" },
				],
			}),
		]);
		const result1 = normalizeChapters(tree);
		const result2 = normalizeChapters(tree);
		expect(result1[0]?.sections[0]?.id).toBe(result2[0]?.sections[0]?.id);
		expect(result1[0]?.sections[0]?.id).toContain("inferred-");
	});

	test("handles mixed H2 and H3 headings", () => {
		const tree = makeTree([
			makeChapter({
				id: "ch1",
				title: "Big Chapter",
				content: [
					{ type: "heading", text: "Section 1", level: 2 },
					{ type: "paragraph", text: "S1 content" },
					{ type: "heading", text: "Sub 1.1", level: 3 },
					{ type: "paragraph", text: "Sub content" },
					{ type: "heading", text: "Section 2", level: 2 },
					{ type: "paragraph", text: "S2 content" },
				],
			}),
		]);
		const result = normalizeChapters(tree);
		// Should have 2 top-level sections (from H2s)
		expect(result[0]?.sections.length).toBeGreaterThanOrEqual(2);
	});
});

describe("normalizeChapters — flat chapters without headings", () => {
	test("large flat chapter (>100 blocks) gets chunked", () => {
		const blocks: ContentBlock[] = [];
		for (let i = 0; i < 120; i++) {
			blocks.push({ type: "paragraph", text: `Paragraph ${i}` });
		}
		const tree = makeTree([
			makeChapter({ id: "ch1", title: "Giant Chapter", content: blocks }),
		]);
		const result = normalizeChapters(tree);
		expect(result[0]?.sections.length).toBeGreaterThan(1);
	});

	test("small flat chapter becomes single section", () => {
		const tree = makeTree([
			makeChapter({
				id: "ch1",
				title: "Short Essay",
				content: [
					{ type: "paragraph", text: "Just a few" },
					{ type: "paragraph", text: "short paragraphs." },
				],
			}),
		]);
		const result = normalizeChapters(tree);
		expect(result[0]?.sections).toHaveLength(1);
		expect(result[0]?.sections[0]?.title).toBe("Short Essay");
	});
});

describe("normalizeChapters — metadata", () => {
	test("computes totalBlockCount", () => {
		const tree = makeTree([
			makeChapter({
				id: "ch1",
				title: "Test",
				content: [
					{ type: "paragraph", text: "A" },
					{ type: "paragraph", text: "B" },
					{ type: "paragraph", text: "C" },
				],
			}),
		]);
		const result = normalizeChapters(tree);
		expect(result[0]?.metadata.totalBlockCount).toBe(3);
	});

	test("detects images", () => {
		const tree = makeTree([
			makeChapter({
				id: "ch1",
				title: "Test",
				content: [
					{ type: "paragraph", text: "Text" },
					{
						type: "image",
						originalPath: "fig.png",
						data: new Uint8Array(),
					},
				],
			}),
		]);
		const result = normalizeChapters(tree);
		expect(result[0]?.metadata.hasImages).toBe(true);
	});

	test("estimates tokens", () => {
		const tree = makeTree([
			makeChapter({
				id: "ch1",
				title: "Test",
				content: [{ type: "paragraph", text: "Hello world test sentence" }],
			}),
		]);
		const result = normalizeChapters(tree);
		expect(result[0]?.metadata.estimatedTokens).toBeGreaterThan(0);
	});
});

describe("normalizeChapters — real EPUBs", () => {
	beforeAll(() => {
		buildFixtures();
	});

	test("normalizes no-nav fixture", async () => {
		const fixturePath = new URL(
			"../parse/fixtures/no-nav.epub",
			import.meta.url,
		).pathname;
		const tree = await parse({ filePath: fixturePath });
		const normalized = normalizeChapters(tree);
		for (const ch of normalized) {
			expect(ch.sections.length).toBeGreaterThan(0);
		}
	});
});
