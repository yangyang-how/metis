import { beforeAll, describe, expect, test } from "bun:test";
import { readEpub } from "../../src/parse/epub-reader";
import { buildFixtures } from "./fixtures/build-fixtures";

beforeAll(() => {
	buildFixtures();
});

const fixture = (name: string) =>
	new URL(`./fixtures/${name}.epub`, import.meta.url).pathname;

describe("readEpub — metadata", () => {
	test("extracts title and authors from OPF", async () => {
		const epub = await readEpub(fixture("minimal"));
		expect(epub.metadata.title).toBe("Minimal Test Book");
		expect(epub.metadata.authors).toEqual(["Test Author"]);
	});

	test("extracts language", async () => {
		const epub = await readEpub(fixture("minimal"));
		expect(epub.metadata.language).toBe("en");
	});
});

describe("readEpub — spine", () => {
	test("returns spine items in reading order", async () => {
		const epub = await readEpub(fixture("minimal"));
		expect(epub.spine).toHaveLength(2);
		expect(epub.spine[0]?.href).toContain("chapter1.xhtml");
		expect(epub.spine[1]?.href).toContain("chapter2.xhtml");
	});
});

describe("readEpub — navigation detection", () => {
	test("identifies EPUB3 nav document", async () => {
		const epub = await readEpub(fixture("minimal"));
		expect(epub.navPath).toContain("nav.xhtml");
		expect(epub.navType).toBe("epub3");
	});

	test("identifies EPUB2 NCX document", async () => {
		const epub = await readEpub(fixture("epub2"));
		expect(epub.navPath).toContain("toc.ncx");
		expect(epub.navType).toBe("epub2");
	});

	test("sets navPath to null when no nav document exists", async () => {
		const epub = await readEpub(fixture("no-nav"));
		expect(epub.navPath).toBeNull();
	});
});

describe("readEpub — file reading", () => {
	test("reads content files from the archive", async () => {
		const epub = await readEpub(fixture("minimal"));
		const firstSpineItem = epub.spine[0];
		expect(firstSpineItem).toBeDefined();
		const content = epub.readFile(firstSpineItem?.href ?? "");
		expect(content).toContain("first paragraph");
	});

	test("reads binary files from the archive", async () => {
		const epub = await readEpub(fixture("minimal"));
		expect(epub.navPath).not.toBeNull();
		const data = epub.readBinary(epub.navPath ?? "");
		expect(data).toBeInstanceOf(Uint8Array);
		expect(data.length).toBeGreaterThan(0);
	});
});

describe("readEpub — error handling", () => {
	test("throws ParseError for non-existent file", async () => {
		try {
			await readEpub("/does/not/exist.epub");
			expect.unreachable("should have thrown");
		} catch (e: unknown) {
			expect((e as { code: string }).code).toBe("INVALID_EPUB");
		}
	});

	test("throws ParseError for DRM-protected EPUBs", async () => {
		try {
			await readEpub(fixture("drm"));
			expect.unreachable("should have thrown");
		} catch (e: unknown) {
			expect((e as { code: string }).code).toBe("DRM_PROTECTED");
		}
	});
});
