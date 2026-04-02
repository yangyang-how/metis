import { beforeAll, describe, expect, test } from "bun:test";
import { readEpub } from "../../src/parse/epub-reader";
import { parseToc } from "../../src/parse/toc-parser";
import { buildFixtures } from "./fixtures/build-fixtures";

beforeAll(() => {
	buildFixtures();
});

const fixture = (name: string) =>
	new URL(`./fixtures/${name}.epub`, import.meta.url).pathname;

describe("parseToc — EPUB3 nav", () => {
	test("parses nav document into ChapterSkeleton array", async () => {
		const epub = await readEpub(fixture("minimal"));
		const chapters = parseToc(epub);

		expect(chapters).toHaveLength(2);
		expect(chapters[0]?.title).toBe("Chapter 1: Introduction");
		expect(chapters[0]?.spineFileRef).toContain("chapter1.xhtml");
		expect(chapters[1]?.title).toBe("Chapter 2: Analysis");
	});

	test("assigns sequential order values", async () => {
		const epub = await readEpub(fixture("minimal"));
		const chapters = parseToc(epub);

		expect(chapters[0]?.order).toBe(0);
		expect(chapters[1]?.order).toBe(1);
	});

	test("generates deterministic IDs", async () => {
		const epub = await readEpub(fixture("minimal"));
		const chapters1 = parseToc(epub);
		const chapters2 = parseToc(epub);

		expect(chapters1[0]?.id).toBe(chapters2[0]?.id);
		expect(chapters1[0]?.id).toBeTruthy();
	});
});

describe("parseToc — EPUB2 NCX", () => {
	test("parses NCX navMap into ChapterSkeleton array", async () => {
		const epub = await readEpub(fixture("epub2"));
		const chapters = parseToc(epub);

		expect(chapters).toHaveLength(2);
		expect(chapters[0]?.title).toBe("Chapter 1: Introduction");
		expect(chapters[1]?.title).toBe("Chapter 2: Analysis");
	});

	test("parses nested navPoints into children", async () => {
		const epub = await readEpub(fixture("epub2"));
		const chapters = parseToc(epub);

		const ch2 = chapters[1];
		expect(ch2?.children).toHaveLength(1);
		expect(ch2?.children[0]?.title).toBe("Section 2.1: Data");
		expect(ch2?.children[0]?.fragmentId).toBe("section-data");
	});
});

describe("parseToc — fallback", () => {
	test("falls back to spine-based chapters when no nav document exists", async () => {
		const epub = await readEpub(fixture("no-nav"));
		const chapters = parseToc(epub);

		expect(chapters.length).toBeGreaterThan(0);
		expect(chapters[0]?.title).toBeTruthy();
		expect(chapters[0]?.spineFileRef).toBeTruthy();
	});

	test("creates one skeleton per spine file in fallback mode", async () => {
		const epub = await readEpub(fixture("no-nav"));
		const chapters = parseToc(epub);

		// no-nav fixture has 2 spine files
		expect(chapters).toHaveLength(2);
	});
});
