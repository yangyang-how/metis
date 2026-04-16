import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseMarkdown } from "../../src/parse/md-reader";

const FIXTURES = join(import.meta.dir, "fixtures/md");

describe("parseMarkdown", () => {
	describe("with frontmatter", () => {
		const tree = parseMarkdown(join(FIXTURES, "with-frontmatter.md"));

		test("extracts metadata from frontmatter", () => {
			expect(tree.metadata.title).toBe("Safe Sleep for Infants");
			expect(tree.metadata.authors).toEqual(["Dr. Jane Smith", "Dr. Bob Lee"]);
			expect(tree.metadata.language).toBe("en");
		});

		test("creates chapters from H1s", () => {
			expect(tree.chapters).toHaveLength(2);
			expect(tree.chapters[0]!.title).toBe("Chapter One: Basics");
			expect(tree.chapters[1]!.title).toBe("Chapter Two: Common Myths");
		});

		test("creates sections from H2s", () => {
			expect(tree.chapters[0]!.sections).toHaveLength(2);
			expect(tree.chapters[0]!.sections[0]!.title).toBe("Sleep Position");
			expect(tree.chapters[0]!.sections[1]!.title).toBe("Bedding Guidelines");
		});

		test("sections have content", () => {
			const section = tree.chapters[0]!.sections[0]!;
			expect(section.content.length).toBeGreaterThan(0);
			const para = section.content[0]!;
			expect(para.type).toBe("paragraph");
			if (para.type === "paragraph") {
				expect(para.text).toContain("backs to sleep");
			}
		});

		test("chapter order is sequential", () => {
			expect(tree.chapters[0]!.order).toBe(0);
			expect(tree.chapters[1]!.order).toBe(1);
		});
	});

	describe("without frontmatter", () => {
		const tree = parseMarkdown(join(FIXTURES, "no-frontmatter.md"));

		test("infers title from first H1", () => {
			expect(tree.metadata.title).toBe("Quick Notes on Pricing");
		});

		test("authors default to empty", () => {
			expect(tree.metadata.authors).toEqual([]);
		});

		test("creates chapter and sections", () => {
			expect(tree.chapters).toHaveLength(1);
			expect(tree.chapters[0]!.sections).toHaveLength(2);
		});
	});

	describe("no H1", () => {
		const tree = parseMarkdown(join(FIXTURES, "no-h1.md"));

		test("creates single chapter from filename", () => {
			expect(tree.chapters).toHaveLength(1);
			expect(tree.chapters[0]!.title).toBe("no-h1");
		});

		test("creates sections from H2s", () => {
			expect(tree.chapters[0]!.sections).toHaveLength(2);
			expect(tree.chapters[0]!.sections[0]!.title).toBe("First Section");
		});

		test("parses blockquotes", () => {
			const section = tree.chapters[0]!.sections[1]!;
			const blockquote = section.content.find((b) => b.type === "blockquote");
			expect(blockquote).toBeDefined();
		});

		test("parses code blocks", () => {
			const section = tree.chapters[0]!.sections[1]!;
			const code = section.content.find((b) => b.type === "code");
			expect(code).toBeDefined();
			if (code?.type === "code") {
				expect(code.language).toBe("python");
				expect(code.text).toContain("hello");
			}
		});
	});

	describe("deep nesting", () => {
		const tree = parseMarkdown(join(FIXTURES, "deep-nesting.md"));

		test("H3+ content is inlined into H2 section", () => {
			const sectionA = tree.chapters[0]!.sections[0]!;
			const allText = sectionA.content
				.filter((b): b is { type: "paragraph"; text: string } => b.type === "paragraph")
				.map((b) => b.text)
				.join(" ");
			expect(allText).toContain("subsection A.1 content");
			expect(allText).toContain("subsection A.2 content");
		});

		test("has two sections", () => {
			expect(tree.chapters[0]!.sections).toHaveLength(2);
			expect(tree.chapters[0]!.sections[0]!.title).toBe("Section A");
			expect(tree.chapters[0]!.sections[1]!.title).toBe("Section B");
		});
	});
});
