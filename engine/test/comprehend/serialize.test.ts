import { describe, expect, test } from "bun:test";
import {
	serializeBlocks,
	serializeSection,
} from "../../src/comprehend/serialize";
import type { NormalizedSection } from "../../src/comprehend/types";
import type { ContentBlock } from "../../src/parse/types";

describe("serializeBlocks — text content", () => {
	test("paragraph → text as-is", () => {
		const blocks: ContentBlock[] = [
			{ type: "paragraph", text: "Hello world." },
		];
		const parts = serializeBlocks(blocks);
		expect(parts).toHaveLength(1);
		expect(parts[0]).toMatchObject({ type: "text", text: "Hello world.\n\n" });
	});

	test("heading → markdown heading with # count", () => {
		const blocks: ContentBlock[] = [
			{ type: "heading", text: "Section Title", level: 2 },
		];
		const parts = serializeBlocks(blocks);
		expect(parts[0]).toMatchObject({
			type: "text",
			text: "## Section Title\n\n",
		});
	});

	test("heading level 3 → ### prefix", () => {
		const blocks: ContentBlock[] = [
			{ type: "heading", text: "Subsection", level: 3 },
		];
		const parts = serializeBlocks(blocks);
		expect(parts[0]?.type === "text" && parts[0].text.startsWith("### ")).toBe(
			true,
		);
	});

	test("table → markdown table format", () => {
		const blocks: ContentBlock[] = [
			{
				type: "table",
				rows: [
					["Name", "Value"],
					["Foo", "42"],
				],
			},
		];
		const parts = serializeBlocks(blocks);
		const text = (parts[0] as { text: string }).text;
		expect(text).toContain("| Name | Value |");
		expect(text).toContain("| --- | --- |");
		expect(text).toContain("| Foo | 42 |");
	});

	test("table with caption includes it", () => {
		const blocks: ContentBlock[] = [
			{
				type: "table",
				rows: [["A"]],
				caption: "Table 1: Results",
			},
		];
		const parts = serializeBlocks(blocks);
		const text = (parts[0] as { text: string }).text;
		expect(text).toContain("Table 1: Results");
	});

	test("unordered list → markdown list", () => {
		const blocks: ContentBlock[] = [
			{
				type: "list",
				ordered: false,
				items: [{ text: "One" }, { text: "Two" }],
			},
		];
		const parts = serializeBlocks(blocks);
		const text = (parts[0] as { text: string }).text;
		expect(text).toContain("- One");
		expect(text).toContain("- Two");
	});

	test("ordered list → numbered markdown list", () => {
		const blocks: ContentBlock[] = [
			{
				type: "list",
				ordered: true,
				items: [{ text: "First" }, { text: "Second" }],
			},
		];
		const parts = serializeBlocks(blocks);
		const text = (parts[0] as { text: string }).text;
		expect(text).toContain("1. First");
		expect(text).toContain("2. Second");
	});

	test("nested list → indented items", () => {
		const blocks: ContentBlock[] = [
			{
				type: "list",
				ordered: false,
				items: [
					{
						text: "Parent",
						children: [{ text: "Child" }],
					},
				],
			},
		];
		const parts = serializeBlocks(blocks);
		const text = (parts[0] as { text: string }).text;
		expect(text).toContain("- Parent");
		expect(text).toContain("  - Child");
	});

	test("code → fenced code block", () => {
		const blocks: ContentBlock[] = [
			{ type: "code", text: "const x = 1;", language: "typescript" },
		];
		const parts = serializeBlocks(blocks);
		const text = (parts[0] as { text: string }).text;
		expect(text).toContain("```typescript");
		expect(text).toContain("const x = 1;");
		expect(text).toContain("```");
	});

	test("code without language → plain fence", () => {
		const blocks: ContentBlock[] = [{ type: "code", text: "x = 1" }];
		const parts = serializeBlocks(blocks);
		const text = (parts[0] as { text: string }).text;
		expect(text).toContain("```\n");
	});

	test("blockquote → > prefix", () => {
		const blocks: ContentBlock[] = [
			{ type: "blockquote", text: "A wise saying." },
		];
		const parts = serializeBlocks(blocks);
		expect(parts[0]).toMatchObject({
			type: "text",
			text: "> A wise saying.\n\n",
		});
	});

	test("footnote → [Footnote id]: text", () => {
		const blocks: ContentBlock[] = [
			{ type: "footnote", id: "fn1", text: "See appendix." },
		];
		const parts = serializeBlocks(blocks);
		const text = (parts[0] as { text: string }).text;
		expect(text).toContain("[Footnote fn1]: See appendix.");
	});
});

describe("serializeBlocks — images", () => {
	test("image without vision → placeholder text", () => {
		const blocks: ContentBlock[] = [
			{
				type: "image",
				originalPath: "fig1.png",
				alt: "Figure 1",
				data: new Uint8Array([1, 2, 3]),
			},
		];
		const parts = serializeBlocks(blocks, { vision: false });
		expect(parts).toHaveLength(1);
		expect(parts[0]).toMatchObject({
			type: "text",
			text: "[Image: Figure 1]\n\n",
		});
	});

	test("image with vision → separate image content part", () => {
		const imgData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
		const blocks: ContentBlock[] = [
			{
				type: "image",
				originalPath: "fig1.png",
				alt: "Figure 1",
				data: imgData,
			},
		];
		const parts = serializeBlocks(blocks, { vision: true });
		const imagePart = parts.find((p) => p.type === "image");
		expect(imagePart).toBeDefined();
	});

	test("image without alt falls back to path", () => {
		const blocks: ContentBlock[] = [
			{
				type: "image",
				originalPath: "images/diagram.png",
				data: new Uint8Array(),
			},
		];
		const parts = serializeBlocks(blocks, { vision: false });
		const text = (parts[0] as { text: string }).text;
		expect(text).toContain("[Image: images/diagram.png]");
	});
});

describe("serializeSection", () => {
	test("wraps content in section delimiter", () => {
		const section: NormalizedSection = {
			id: "s1",
			title: "Introduction",
			level: 1,
			content: [{ type: "paragraph", text: "Hello." }],
			sections: [],
		};
		const parts = serializeSection(section);
		const fullText = parts
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map((p) => p.text)
			.join("");
		expect(fullText).toContain("=== Section: Introduction (id: s1) ===");
		expect(fullText).toContain("Hello.");
	});

	test("includes sub-sections recursively", () => {
		const section: NormalizedSection = {
			id: "s1",
			title: "Outer",
			level: 1,
			content: [{ type: "paragraph", text: "Outer content." }],
			sections: [
				{
					id: "s1-1",
					title: "Inner",
					level: 2,
					content: [{ type: "paragraph", text: "Inner content." }],
					sections: [],
				},
			],
		};
		const parts = serializeSection(section);
		const fullText = parts
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map((p) => p.text)
			.join("");
		expect(fullText).toContain("=== Section: Outer (id: s1) ===");
		expect(fullText).toContain("=== Section: Inner (id: s1-1) ===");
		expect(fullText).toContain("Outer content.");
		expect(fullText).toContain("Inner content.");
	});
});
