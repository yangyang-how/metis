import { describe, expect, test } from "bun:test";
import { parseContent } from "../../src/parse/content-parser";
import type { ContentBlock } from "../../src/parse/types";

// --- Paragraphs ---

describe("parseContent — paragraphs", () => {
	test("converts <p> to paragraph blocks", () => {
		const html = "<body><p>Hello world.</p><p>Second paragraph.</p></body>";
		const blocks = parseContent(html);

		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toEqual({ type: "paragraph", text: "Hello world." });
		expect(blocks[1]).toEqual({ type: "paragraph", text: "Second paragraph." });
	});

	test("strips inline formatting from paragraphs", () => {
		const html =
			"<body><p>This is <strong>bold</strong> and <em>italic</em> text.</p></body>";
		const blocks = parseContent(html);

		expect(blocks[0]).toEqual({
			type: "paragraph",
			text: "This is bold and italic text.",
		});
	});

	test("strips links but preserves text", () => {
		const html =
			'<body><p>See <a href="http://example.com">this link</a> for details.</p></body>';
		const blocks = parseContent(html);

		expect(blocks[0]).toEqual({
			type: "paragraph",
			text: "See this link for details.",
		});
	});

	test("skips empty paragraphs", () => {
		const html = "<body><p></p><p>Real content.</p><p>   </p></body>";
		const blocks = parseContent(html);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toEqual({ type: "paragraph", text: "Real content." });
	});
});

// --- Headings ---

describe("parseContent — headings", () => {
	test("converts heading elements to heading blocks", () => {
		const html = "<body><h2>Section Title</h2></body>";
		const blocks = parseContent(html);

		expect(blocks[0]).toEqual({
			type: "heading",
			text: "Section Title",
			level: 2,
		});
	});

	test("handles all heading levels", () => {
		const html = "<body><h1>H1</h1><h3>H3</h3><h6>H6</h6></body>";
		const blocks = parseContent(html);

		expect(blocks).toHaveLength(3);
		expect((blocks[0] as { level: number }).level).toBe(1);
		expect((blocks[1] as { level: number }).level).toBe(3);
		expect((blocks[2] as { level: number }).level).toBe(6);
	});
});

// --- Tables ---

describe("parseContent — tables", () => {
	test("converts <table> to table block with rows", () => {
		const html = `<body><table>
			<tr><td>A</td><td>B</td></tr>
			<tr><td>C</td><td>D</td></tr>
		</table></body>`;
		const blocks = parseContent(html);

		expect(blocks[0]).toEqual({
			type: "table",
			rows: [
				["A", "B"],
				["C", "D"],
			],
		});
	});

	test("includes caption when present", () => {
		const html = `<body><table>
			<caption>Table 1: Results</caption>
			<tr><td>X</td></tr>
		</table></body>`;
		const blocks = parseContent(html);

		expect(blocks[0]).toMatchObject({
			type: "table",
			caption: "Table 1: Results",
		});
	});

	test("handles <th> elements in header rows", () => {
		const html = `<body><table>
			<thead><tr><th>Name</th><th>Value</th></tr></thead>
			<tbody><tr><td>Foo</td><td>42</td></tr></tbody>
		</table></body>`;
		const blocks = parseContent(html);

		const table = blocks[0] as Extract<ContentBlock, { type: "table" }>;
		expect(table.rows).toEqual([
			["Name", "Value"],
			["Foo", "42"],
		]);
	});
});

// --- Lists ---

describe("parseContent — lists", () => {
	test("converts <ul> to unordered list block", () => {
		const html = "<body><ul><li>One</li><li>Two</li></ul></body>";
		const blocks = parseContent(html);

		expect(blocks[0]).toEqual({
			type: "list",
			ordered: false,
			items: [{ text: "One" }, { text: "Two" }],
		});
	});

	test("converts <ol> to ordered list block", () => {
		const html = "<body><ol><li>First</li><li>Second</li></ol></body>";
		const blocks = parseContent(html);

		expect(blocks[0]).toMatchObject({ type: "list", ordered: true });
	});

	test("preserves nested list structure", () => {
		const html = `<body><ul>
			<li>Parent
				<ul>
					<li>Child</li>
				</ul>
			</li>
		</ul></body>`;
		const blocks = parseContent(html);

		const list = blocks[0] as Extract<ContentBlock, { type: "list" }>;
		expect(list.items[0]?.text).toBe("Parent");
		expect(list.items[0]?.children?.[0]?.text).toBe("Child");
	});
});

// --- Code blocks ---

describe("parseContent — code blocks", () => {
	test("converts <pre> to code block", () => {
		const html = "<body><pre>const x = 1;\nconst y = 2;</pre></body>";
		const blocks = parseContent(html);

		expect(blocks[0]).toEqual({
			type: "code",
			text: "const x = 1;\nconst y = 2;",
		});
	});

	test("extracts language from class attribute", () => {
		const html =
			'<body><pre><code class="language-typescript">const x = 1;</code></pre></body>';
		const blocks = parseContent(html);

		expect(blocks[0]).toMatchObject({ type: "code", language: "typescript" });
	});
});

// --- Blockquotes ---

describe("parseContent — blockquotes", () => {
	test("converts <blockquote> to blockquote block", () => {
		const html = "<body><blockquote>A wise saying.</blockquote></body>";
		const blocks = parseContent(html);

		expect(blocks[0]).toEqual({ type: "blockquote", text: "A wise saying." });
	});
});

// --- Unknown elements ---

describe("parseContent — unknown elements", () => {
	test("converts unknown block elements to paragraph", () => {
		const html = "<body><dl><dt>Term</dt><dd>Definition</dd></dl></body>";
		const blocks = parseContent(html);

		expect(blocks[0]).toMatchObject({ type: "paragraph" });
		expect((blocks[0] as { text: string }).text).toContain("Term");
		expect((blocks[0] as { text: string }).text).toContain("Definition");
	});
});

// --- Images ---

describe("parseContent — images", () => {
	test("converts <img> to image block with binary data", () => {
		const fakeImage = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
		const html =
			'<body><p>Before.</p><img src="images/fig1.png" alt="Figure 1"/><p>After.</p></body>';

		const blocks = parseContent(html, {
			readBinary: (href) => {
				expect(href).toBe("images/fig1.png");
				return fakeImage;
			},
			extractImages: true,
		});

		const imageBlock = blocks.find((b) => b.type === "image");
		expect(imageBlock).toMatchObject({
			type: "image",
			originalPath: "images/fig1.png",
			alt: "Figure 1",
		});
	});

	test("skips images when extractImages is false", () => {
		const html = '<body><img src="images/fig1.png" alt="Figure 1"/></body>';
		const blocks = parseContent(html, { extractImages: false });

		expect(blocks.find((b) => b.type === "image")).toBeUndefined();
	});
});

// --- Footnotes ---

describe("parseContent — footnotes (EPUB3)", () => {
	test("replaces EPUB3 footnote links with [footnote:ID] markers", () => {
		const html = `<body>
			<p>Price elasticity<a epub:type="noteref" href="#fn1"><sup>1</sup></a> varies.</p>
			<aside epub:type="footnote" id="fn1"><p>See appendix for methodology.</p></aside>
		</body>`;
		const blocks = parseContent(html);

		const para = blocks.find((b) => b.type === "paragraph");
		expect(para).toMatchObject({
			type: "paragraph",
			text: "Price elasticity [footnote:fn1] varies.",
		});

		const footnote = blocks.find((b) => b.type === "footnote");
		expect(footnote).toEqual({
			type: "footnote",
			id: "fn1",
			text: "See appendix for methodology.",
		});
	});
});
