/**
 * Structure inference — normalizes flat/broken parse trees.
 *
 * Half the real EPUBs we tested had no section structure in the nav.
 * This module ensures every chapter has sections, regardless of EPUB
 * quality. It's rule-based (no LLM) because structure inference from
 * headings is mechanical work — save the expensive model for reasoning.
 */
import type {
	Chapter,
	ContentBlock,
	DocumentTree,
	Section,
} from "../parse/types";
import { estimateTokens } from "./token-estimator";
import type {
	ChapterMetadata,
	NormalizedChapter,
	NormalizedSection,
} from "./types";

const CHUNK_THRESHOLD = 100;
const CHUNK_SIZE = 50;

export function normalizeChapters(tree: DocumentTree): NormalizedChapter[] {
	return tree.chapters.map((chapter) => normalizeChapter(chapter));
}

function normalizeChapter(chapter: Chapter): NormalizedChapter {
	let sections: NormalizedSection[];

	if (chapter.sections.length > 0) {
		// Chapter already has sections — convert and prepend intro content
		sections = chapter.sections.map((s) => convertSection(s));
		if (chapter.content.length > 0 && sections[0]) {
			sections[0] = {
				...sections[0],
				content: [...chapter.content, ...sections[0].content],
			};
		}
	} else {
		// Flat chapter — infer structure from headings or chunk
		const allBlocks = chapter.content;
		const headings = allBlocks.filter(
			(b): b is ContentBlock & { type: "heading" } => b.type === "heading",
		);

		if (headings.length > 0) {
			sections = splitAtHeadings(allBlocks, chapter.title);
		} else if (allBlocks.length > CHUNK_THRESHOLD) {
			sections = chunkBlocks(allBlocks, chapter.title);
		} else {
			// Small flat chapter — single section
			sections = [
				{
					id: toInferredId(chapter.title, 0),
					title: chapter.title,
					level: 1,
					content: allBlocks,
					sections: [],
				},
			];
		}
	}

	const metadata = computeMetadata(sections);

	return {
		id: chapter.id,
		title: chapter.title,
		order: chapter.order,
		sections,
		metadata,
	};
}

/**
 * Split content at heading boundaries. H2 headings create top-level
 * sections, H3+ create sub-sections under the most recent H2.
 */
function splitAtHeadings(
	blocks: ContentBlock[],
	chapterTitle: string,
): NormalizedSection[] {
	const topSections: NormalizedSection[] = [];
	let currentSection: NormalizedSection | null = null;
	let preHeadingBlocks: ContentBlock[] = [];
	let sectionIndex = 0;

	for (const block of blocks) {
		if (
			block.type === "heading" &&
			block.level <= 3 // H1, H2, H3 start new sections
		) {
			if (currentSection) {
				topSections.push(currentSection);
			} else if (preHeadingBlocks.length > 0) {
				// Content before the first heading → intro section
				topSections.push({
					id: toInferredId(chapterTitle, sectionIndex++),
					title: chapterTitle,
					level: 1,
					content: preHeadingBlocks,
					sections: [],
				});
				preHeadingBlocks = [];
			}

			currentSection = {
				id: toInferredId(block.text, sectionIndex++),
				title: block.text,
				level: block.level,
				content: [],
				sections: [],
			};
		} else if (currentSection) {
			currentSection.content.push(block);
		} else {
			preHeadingBlocks.push(block);
		}
	}

	// Push last section
	if (currentSection) {
		topSections.push(currentSection);
	} else if (preHeadingBlocks.length > 0) {
		topSections.push({
			id: toInferredId(chapterTitle, sectionIndex),
			title: chapterTitle,
			level: 1,
			content: preHeadingBlocks,
			sections: [],
		});
	}

	return topSections;
}

/**
 * Chunk large flat content into ~50-block segments.
 * Split at paragraph boundaries to avoid cutting mid-thought.
 */
function chunkBlocks(
	blocks: ContentBlock[],
	chapterTitle: string,
): NormalizedSection[] {
	const sections: NormalizedSection[] = [];
	let currentChunk: ContentBlock[] = [];
	let chunkIndex = 0;

	for (const block of blocks) {
		currentChunk.push(block);
		if (currentChunk.length >= CHUNK_SIZE && block.type === "paragraph") {
			sections.push({
				id: toInferredId(`${chapterTitle}-part`, chunkIndex),
				title: `Part ${chunkIndex + 1}`,
				level: 1,
				content: currentChunk,
				sections: [],
			});
			currentChunk = [];
			chunkIndex++;
		}
	}

	if (currentChunk.length > 0) {
		sections.push({
			id: toInferredId(`${chapterTitle}-part`, chunkIndex),
			title: `Part ${chunkIndex + 1}`,
			level: 1,
			content: currentChunk,
			sections: [],
		});
	}

	return sections;
}

function convertSection(section: Section): NormalizedSection {
	return {
		id: section.id,
		title: section.title,
		level: section.level,
		content: section.content,
		sections: section.sections.map((s) => convertSection(s)),
	};
}

function computeMetadata(sections: NormalizedSection[]): ChapterMetadata {
	let totalBlockCount = 0;
	let hasImages = false;
	let allText = "";

	function walk(secs: NormalizedSection[]): void {
		for (const s of secs) {
			totalBlockCount += s.content.length;
			for (const block of s.content) {
				if (block.type === "image") hasImages = true;
				if ("text" in block && typeof block.text === "string") {
					allText += block.text;
				}
			}
			walk(s.sections);
		}
	}

	walk(sections);

	return {
		totalBlockCount,
		hasImages,
		estimatedTokens: estimateTokens(allText),
	};
}

function toInferredId(text: string, index: number): string {
	const slug = text
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `inferred-${slug || "section"}-${index}`;
}
