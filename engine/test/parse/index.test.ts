import { beforeAll, describe, expect, test } from "bun:test";
import { parse } from "../../src/parse/index";
import { buildFixtures } from "./fixtures/build-fixtures";

beforeAll(() => {
	buildFixtures();
});

const fixture = (name: string) =>
	new URL(`./fixtures/${name}.epub`, import.meta.url).pathname;

describe("parse — EPUB3 integration", () => {
	test("returns a DocumentTree with metadata", async () => {
		const tree = await parse({ filePath: fixture("minimal") });

		expect(tree.metadata.title).toBe("Minimal Test Book");
		expect(tree.metadata.authors).toEqual(["Test Author"]);
	});

	test("returns chapters with content", async () => {
		const tree = await parse({ filePath: fixture("minimal") });

		expect(tree.chapters).toHaveLength(2);
		expect(tree.chapters[0]?.title).toBe("Chapter 1: Introduction");
		expect(tree.chapters[0]?.content.length).toBeGreaterThan(0);
	});

	test("chapter content contains paragraphs", async () => {
		const tree = await parse({ filePath: fixture("minimal") });

		const firstChapter = tree.chapters[0];
		expect(firstChapter).toBeDefined();
		const paragraphs =
			firstChapter?.content.filter((b) => b.type === "paragraph") ?? [];
		expect(paragraphs.length).toBeGreaterThan(0);
	});

	test("chapters have deterministic IDs", async () => {
		const tree1 = await parse({ filePath: fixture("minimal") });
		const tree2 = await parse({ filePath: fixture("minimal") });

		expect(tree1.chapters[0]?.id).toBe(tree2.chapters[0]?.id);
	});
});

describe("parse — EPUB2 integration", () => {
	test("parses EPUB2 with NCX navigation", async () => {
		const tree = await parse({ filePath: fixture("epub2") });

		expect(tree.chapters).toHaveLength(2);
		expect(tree.chapters[1]?.sections).toHaveLength(1);
		expect(tree.chapters[1]?.sections[0]?.title).toBe("Section 2.1: Data");
	});

	test("places pre-section content in chapter content array", async () => {
		const tree = await parse({ filePath: fixture("epub2") });

		// Chapter 2 has content before Section 2.1
		const ch2 = tree.chapters[1];
		expect(ch2).toBeDefined();
		expect(ch2?.sections.length).toBeGreaterThan(0);
		// The chapter's own content array should have the intro paragraph
		const chapterParas =
			ch2?.content.filter((b) => b.type === "paragraph") ?? [];
		expect(chapterParas.length).toBeGreaterThan(0);
	});
});

describe("parse — no-nav fallback", () => {
	test("parses EPUB without navigation document", async () => {
		const tree = await parse({ filePath: fixture("no-nav") });

		expect(tree.chapters.length).toBeGreaterThan(0);
		// Each spine file becomes a chapter
		expect(tree.chapters).toHaveLength(2);
	});
});

describe("parse — validation", () => {
	test("throws ParseError for invalid file", async () => {
		await expect(
			parse({ filePath: "/not/a/real/file.epub" }),
		).rejects.toThrow();
	});

	test("throws for DRM-protected files", async () => {
		try {
			await parse({ filePath: fixture("drm") });
			expect.unreachable("should have thrown");
		} catch (e: unknown) {
			expect((e as { code: string }).code).toBe("DRM_PROTECTED");
		}
	});
});
