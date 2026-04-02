import { describe, expect, test } from "bun:test";
import type {
	Chapter,
	ChapterSkeleton,
	ContentBlock,
	DocumentTree,
	ListItem,
	ParseInput,
	Section,
} from "../../src/parse/types";

describe("parse types", () => {
	test("ContentBlock discriminated union accepts all block types", () => {
		const blocks: ContentBlock[] = [
			{ type: "paragraph", text: "hello" },
			{ type: "heading", text: "Title", level: 1 },
			{
				type: "table",
				rows: [
					["a", "b"],
					["c", "d"],
				],
			},
			{
				type: "image",
				originalPath: "img/fig1.png",
				data: new Uint8Array([1, 2, 3]),
				alt: "A figure",
			},
			{ type: "footnote", id: "fn1", text: "See appendix." },
			{ type: "blockquote", text: "To be or not to be." },
			{ type: "list", ordered: true, items: [{ text: "first" }] },
			{ type: "code", text: "const x = 1;" },
		];
		expect(blocks).toHaveLength(8);
	});

	test("ListItem supports nesting", () => {
		const item: ListItem = {
			text: "parent",
			children: [{ text: "child", children: [{ text: "grandchild" }] }],
		};
		expect(item.children?.[0]?.children?.[0]?.text).toBe("grandchild");
	});

	test("Section supports recursive nesting", () => {
		const section: Section = {
			id: "s1",
			title: "Outer",
			level: 1,
			content: [],
			sections: [
				{ id: "s1-1", title: "Inner", level: 2, content: [], sections: [] },
			],
		};
		expect(section.sections[0]?.title).toBe("Inner");
	});
});
