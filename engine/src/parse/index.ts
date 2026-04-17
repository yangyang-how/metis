/**
 * Parse stage — public entry point.
 *
 * Facade pattern: this is the only thing downstream stages see.
 * Hides the two-pass architecture, EPUB version detection, spine
 * mapping, and content parsing behind a single function call.
 *
 * Usage:
 *   import { parse } from "metis-engine/parse";
 *   const tree = await parse({ filePath: "book.epub" });
 */
import { parseContent } from "./content-parser";
import { readEpub } from "./epub-reader";
import { ParseError } from "./errors";
import { parseMarkdown } from "./md-reader";
import { parsePdf } from "./pdf-reader";
import { parseToc } from "./toc-parser";
import type {
	Chapter,
	ChapterSkeleton,
	ContentBlock,
	DocumentTree,
	ParseInput,
	Section,
	SpineMapping,
} from "./types";

export { ParseError } from "./errors";
export { parseMarkdown } from "./md-reader";
export { parsePdf } from "./pdf-reader";
export type {
	Chapter,
	ContentBlock,
	DocumentTree,
	ListItem,
	ParseInput,
	Section,
} from "./types";

/**
 * Dispatch to the right parser by file extension.
 * Returns a DocumentTree regardless of source format.
 */
export async function parseFile(filePath: string): Promise<DocumentTree> {
	if (filePath.endsWith(".md") || filePath.endsWith(".markdown")) {
		return parseMarkdown(filePath);
	}
	if (filePath.endsWith(".epub")) {
		return parse({ filePath });
	}
	if (filePath.endsWith(".pdf")) {
		return parsePdf(filePath);
	}
	throw new ParseError(
		`Unsupported file format: ${filePath}`,
		"UNSUPPORTED_FORMAT",
		filePath,
	);
}

export async function parse(input: ParseInput): Promise<DocumentTree> {
	const extractImages = input.options?.extractImages !== false;

	// === Pass 1: Build the skeleton ===
	const epub = await readEpub(input.filePath);
	const skeletons = parseToc(epub);

	// Convert skeletons to Chapter/Section tree and build spine mapping
	const chapters: Chapter[] = [];
	const spineMap = new Map<string, SpineMapping[]>();

	for (const skeleton of skeletons) {
		const chapter = skeletonToChapter(skeleton, 0);
		chapters.push(chapter);
		buildSpineMapping(skeleton, chapter, spineMap);
	}

	// === Pass 2: Fill in content ===
	let lastChapter: Chapter | null = chapters[0] ?? null;

	for (const spineItem of epub.spine) {
		const html = epub.readFile(spineItem.href);
		if (!html) continue;

		const allBlocks = parseContent(html, {
			readBinary: (href) => {
				// Resolve relative image paths against the spine file's directory
				const dir = spineItem.href.replace(/\/[^/]*$/, "");
				const resolved = dir ? `${dir}/${href}` : href;
				return epub.readBinary(resolved);
			},
			extractImages,
		});

		const mappings = spineMap.get(spineItem.href);

		if (mappings && mappings.length > 0) {
			// This spine file has explicit mappings to tree nodes
			assignBlocksToMappings(allBlocks, mappings, html);
			// Track the last chapter for unmapped files
			for (const m of mappings) {
				if ("order" in m.node) {
					lastChapter = m.node as Chapter;
				}
			}
		} else if (lastChapter) {
			// No mapping — append content to the most recent chapter
			// This handles the "one chapter spanning multiple files" case
			lastChapter.content.push(...allBlocks);
		}
	}

	// === Validation ===
	if (chapters.length === 0) {
		throw new ParseError(
			"No chapters found in EPUB",
			"NO_CHAPTERS",
			input.filePath,
		);
	}

	for (const ch of chapters) {
		const totalBlocks = countBlocks(ch);
		if (totalBlocks === 0) {
			console.warn(`Warning: Chapter "${ch.title}" has no content blocks`);
		}
	}

	return {
		metadata: epub.metadata,
		chapters,
	};
}

/**
 * Recursively convert a ChapterSkeleton into a Chapter with empty
 * content arrays, ready to be filled by Pass 2.
 */
function skeletonToChapter(skeleton: ChapterSkeleton, level: number): Chapter {
	const sections: Section[] = skeleton.children.map((child) =>
		skeletonToSection(child, level + 1),
	);

	return {
		id: skeleton.id,
		title: skeleton.title,
		order: skeleton.order,
		sections,
		content: [],
	};
}

function skeletonToSection(skeleton: ChapterSkeleton, level: number): Section {
	const sections: Section[] = skeleton.children.map((child) =>
		skeletonToSection(child, level + 1),
	);

	return {
		id: skeleton.id,
		title: skeleton.title,
		level,
		sections,
		content: [],
	};
}

/**
 * Build the spine-to-tree mapping. Each spine file href maps to an
 * array of { node, startFragmentId, endFragmentId } entries.
 *
 * For files with a single chapter: one entry with no fragment IDs.
 * For files with fragment-based splits: multiple entries with start/end IDs.
 */
function buildSpineMapping(
	skeleton: ChapterSkeleton,
	node: Chapter | Section,
	map: Map<string, SpineMapping[]>,
): void {
	const existing = map.get(skeleton.spineFileRef) ?? [];

	existing.push({
		node,
		startFragmentId: skeleton.fragmentId ?? undefined,
	});

	map.set(skeleton.spineFileRef, existing);

	// Process children
	for (let i = 0; i < skeleton.children.length; i++) {
		const child = skeleton.children[i];
		if (!child) continue;
		const section =
			(node as Chapter).sections?.[i] ?? (node as Section).sections?.[i];
		if (section) {
			buildSpineMapping(child, section, map);
		}
	}

	// Compute endFragmentId for each entry in this file:
	// Each entry's end is the next entry's start
	const entries = map.get(skeleton.spineFileRef);
	if (entries && entries.length > 1) {
		for (let i = 0; i < entries.length - 1; i++) {
			const current = entries[i];
			const next = entries[i + 1];
			if (current && next?.startFragmentId) {
				current.endFragmentId = next.startFragmentId;
			}
		}
	}
}

/**
 * Assign content blocks to their mapped tree nodes.
 *
 * Simple case (1 mapping, no fragments): all blocks go to that node.
 * Fragment case (multiple mappings): split blocks at fragment boundaries.
 */
function assignBlocksToMappings(
	blocks: ContentBlock[],
	mappings: SpineMapping[],
	_html: string,
): void {
	if (mappings.length === 1 && !mappings[0]?.startFragmentId) {
		// Simple: all blocks belong to this one node
		const mapping = mappings[0];
		if (mapping) {
			mapping.node.content.push(...blocks);
		}
		return;
	}

	// Fragment-based: we need to assign blocks to the right mapping.
	// Since we don't have DOM position info in ContentBlocks, we use a
	// simpler heuristic: if there are N mappings, try to match headings
	// to mapping titles to find split points.
	//
	// For the common case where the first mapping has no fragment (it's
	// the chapter intro) and subsequent mappings have fragments (sections),
	// blocks before the first section heading go to the chapter, and
	// blocks after each section heading go to that section.

	let currentMapping = mappings[0];
	let currentIndex = 0;

	for (const block of blocks) {
		// Check if this block is a heading that matches a subsequent mapping
		if (block.type === "heading") {
			for (let i = currentIndex + 1; i < mappings.length; i++) {
				const m = mappings[i];
				if (m && block.text === m.node.title) {
					currentMapping = m;
					currentIndex = i;
					break;
				}
			}
		}

		if (currentMapping) {
			currentMapping.node.content.push(block);
		}
	}
}

function countBlocks(chapter: Chapter): number {
	let count = chapter.content.length;
	for (const section of chapter.sections) {
		count += countSectionBlocks(section);
	}
	return count;
}

function countSectionBlocks(section: Section): number {
	let count = section.content.length;
	for (const child of section.sections) {
		count += countSectionBlocks(child);
	}
	return count;
}
