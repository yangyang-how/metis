/**
 * Content parser — converts HTML into ContentBlock[].
 *
 * This is the workhorse of Pass 2. Each HTML element type maps to exactly
 * one ContentBlock variant. The mapping is complete and bijective — no
 * ambiguity about what any element becomes.
 *
 * Inline formatting (bold, italic, links) is stripped to plain text.
 * The Comprehend stage reasons about argument structure, not typography.
 */
import { type HTMLElement, parse as parseHTML } from "node-html-parser";
import type { ContentBlock, ListItem } from "./types";

export interface ContentParserOptions {
	readBinary?: (href: string) => Uint8Array;
	extractImages?: boolean;
}

export function parseContent(
	html: string,
	options?: ContentParserOptions,
): ContentBlock[] {
	const root = parseHTML(html);
	const body = root.querySelector("body") ?? root;

	// First pass: collect footnotes defined as <aside epub:type="footnote">
	const footnoteMap = collectFootnotes(body);

	// Second pass: convert elements to blocks
	const blocks: ContentBlock[] = [];
	convertChildren(body, blocks, options, footnoteMap);

	return blocks;
}

/**
 * Pre-scan for EPUB3 footnotes: <aside epub:type="footnote" id="...">
 * Returns a map of id -> footnote text content.
 */
function collectFootnotes(root: HTMLElement): Map<string, string> {
	const map = new Map<string, string>();
	const asides = root.querySelectorAll("aside");
	for (const aside of asides) {
		const epubType =
			aside.getAttribute("epub:type") ?? aside.getAttribute("type") ?? "";
		if (epubType.includes("footnote")) {
			const id = aside.getAttribute("id");
			if (id) {
				map.set(id, aside.textContent.trim());
			}
		}
	}
	return map;
}

function convertChildren(
	parent: HTMLElement,
	blocks: ContentBlock[],
	options: ContentParserOptions | undefined,
	footnoteMap: Map<string, string>,
): void {
	for (const child of parent.childNodes) {
		// Text nodes at block level — skip whitespace-only
		if (child.nodeType === 3) {
			const text = child.textContent.trim();
			if (text) {
				blocks.push({ type: "paragraph", text });
			}
			continue;
		}

		if (child.nodeType !== 1) continue; // Skip comments, etc.

		const el = child as unknown as HTMLElement;
		const tag = el.tagName?.toLowerCase();

		if (!tag) continue;

		convertElement(tag, el, blocks, options, footnoteMap);
	}
}

function convertElement(
	tag: string,
	el: HTMLElement,
	blocks: ContentBlock[],
	options: ContentParserOptions | undefined,
	footnoteMap: Map<string, string>,
): void {
	// Footnote asides — already collected, emit as footnote blocks
	if (tag === "aside") {
		const epubType =
			el.getAttribute("epub:type") ?? el.getAttribute("type") ?? "";
		if (epubType.includes("footnote")) {
			const id = el.getAttribute("id");
			if (id) {
				blocks.push({
					type: "footnote",
					id,
					text: el.textContent.trim(),
				});
			}
			return;
		}
	}

	switch (tag) {
		case "p": {
			const text = extractTextWithFootnoteRefs(el, footnoteMap);
			if (text) blocks.push({ type: "paragraph", text });
			break;
		}

		case "h1":
		case "h2":
		case "h3":
		case "h4":
		case "h5":
		case "h6": {
			const text = el.textContent.trim();
			const level = Number.parseInt(tag[1] ?? "1", 10);
			if (text) blocks.push({ type: "heading", text, level });
			break;
		}

		case "table":
			blocks.push(convertTable(el));
			break;

		case "ul":
		case "ol":
			blocks.push(convertList(el, tag === "ol"));
			break;

		case "pre":
			blocks.push(convertCode(el));
			break;

		case "blockquote": {
			const text = el.textContent.trim();
			if (text) blocks.push({ type: "blockquote", text });
			break;
		}

		case "img": {
			const block = convertImage(el, options);
			if (block) blocks.push(block);
			break;
		}

		// Wrapper elements — recurse into children
		case "div":
		case "section":
		case "article":
		case "main":
		case "header":
		case "footer":
		case "figure":
		case "span":
			convertChildren(el, blocks, options, footnoteMap);
			break;

		// Unknown block elements → paragraph with text content
		default: {
			const text = el.textContent.trim();
			if (text) blocks.push({ type: "paragraph", text });
		}
	}
}

/**
 * Extract text from a paragraph element, replacing footnote reference
 * links with [footnote:ID] markers.
 *
 * EPUB3 footnotes use: <a epub:type="noteref" href="#fn1"><sup>1</sup></a>
 * We replace these with [footnote:fn1] in the text.
 */
function extractTextWithFootnoteRefs(
	el: HTMLElement,
	footnoteMap: Map<string, string>,
): string {
	let result = "";

	for (const child of el.childNodes) {
		if (child.nodeType === 3) {
			// Text node
			result += child.textContent;
			continue;
		}

		if (child.nodeType !== 1) continue;

		const childEl = child as unknown as HTMLElement;
		const tag = childEl.tagName?.toLowerCase();

		// Check if this is a footnote reference link
		if (tag === "a") {
			const epubType =
				childEl.getAttribute("epub:type") ?? childEl.getAttribute("type") ?? "";
			const href = childEl.getAttribute("href") ?? "";

			if (epubType.includes("noteref") && href.startsWith("#")) {
				const fnId = href.slice(1);
				result += ` [footnote:${fnId}]`;
				continue;
			}
		}

		// For all other inline elements, just take their text content
		result += extractTextWithFootnoteRefs(childEl, footnoteMap);
	}

	return result.trim();
}

function convertTable(el: HTMLElement): ContentBlock {
	const rows: string[][] = [];
	let caption: string | undefined;

	const captionEl = el.querySelector("caption");
	if (captionEl) {
		caption = captionEl.textContent.trim() || undefined;
	}

	const trs = el.querySelectorAll("tr");
	for (const tr of trs) {
		const cells = tr.querySelectorAll("td, th");
		const row: string[] = [];
		for (const cell of cells) {
			row.push(cell.textContent.trim());
		}
		if (row.length > 0) {
			rows.push(row);
		}
	}

	return caption ? { type: "table", rows, caption } : { type: "table", rows };
}

function convertList(el: HTMLElement, ordered: boolean): ContentBlock {
	const items = parseListItems(el);
	return { type: "list", ordered, items };
}

function parseListItems(listEl: HTMLElement): ListItem[] {
	const items: ListItem[] = [];

	for (const child of listEl.childNodes) {
		if (child.nodeType !== 1) continue;
		const li = child as unknown as HTMLElement;
		if (li.tagName?.toLowerCase() !== "li") continue;

		// Get the direct text (not including nested list text)
		let text = "";
		const childrenLists: HTMLElement[] = [];

		for (const liChild of li.childNodes) {
			if (liChild.nodeType === 3) {
				text += liChild.textContent;
			} else if (liChild.nodeType === 1) {
				const childEl = liChild as unknown as HTMLElement;
				const childTag = childEl.tagName?.toLowerCase();
				if (childTag === "ul" || childTag === "ol") {
					childrenLists.push(childEl);
				} else {
					text += childEl.textContent;
				}
			}
		}

		text = text.trim();
		if (!text && childrenLists.length === 0) continue;

		const item: ListItem = { text };

		// Parse nested lists
		if (childrenLists.length > 0) {
			const children: ListItem[] = [];
			for (const nested of childrenLists) {
				children.push(...parseListItems(nested));
			}
			if (children.length > 0) {
				item.children = children;
			}
		}

		items.push(item);
	}

	return items;
}

function convertCode(el: HTMLElement): ContentBlock {
	// node-html-parser treats <pre> content as raw text, so child
	// elements like <code> are NOT parsed. We extract language and
	// text content from the raw innerHTML.
	const raw = el.innerHTML;
	let language: string | undefined;
	let text = raw;

	// Check for <code class="language-X">...</code> wrapper in the raw text
	const codeMatch = raw.match(
		/<code(?:\s+class="language-(\w+)")?[^>]*>([\s\S]*?)<\/code>/,
	);
	if (codeMatch) {
		if (codeMatch[1]) language = codeMatch[1];
		text = codeMatch[2] ?? raw;
	}

	return language ? { type: "code", text, language } : { type: "code", text };
}

function convertImage(
	el: HTMLElement,
	options: ContentParserOptions | undefined,
): ContentBlock | null {
	if (options?.extractImages === false) return null;

	const src = el.getAttribute("src") ?? "";
	if (!src) return null;

	const alt = el.getAttribute("alt") ?? undefined;

	// Try to get figure caption from parent <figure><figcaption>
	let caption: string | undefined;
	const parent = el.parentNode as unknown as HTMLElement | null;
	if (parent?.tagName?.toLowerCase() === "figure") {
		const figcaption = parent.querySelector("figcaption");
		if (figcaption) {
			caption = figcaption.textContent.trim() || undefined;
		}
	}

	let data: Uint8Array<ArrayBuffer> = new Uint8Array();
	if (options?.readBinary) {
		try {
			const raw = options.readBinary(src);
			data = new Uint8Array(raw);
		} catch {
			// Image not found in archive — log but don't fail
		}
	}

	return {
		type: "image" as const,
		originalPath: src,
		data,
		...(alt ? { alt } : {}),
		...(caption ? { caption } : {}),
	};
}
