import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { extractText } from "unpdf";
import type {
	Chapter,
	ContentBlock,
	DocumentMetadata,
	DocumentTree,
	Section,
} from "./types";

/**
 * Parse a PDF file into DocumentTree using unpdf.
 *
 * unpdf handles standard PDFs well (books, reports, simple papers).
 * For complex academic papers (two-column, math, tables), marker-pdf
 * is recommended as an optional upgrade — see pdf-marker-reader.ts.
 */
export async function parsePdf(filePath: string): Promise<DocumentTree> {
	const buffer = readFileSync(filePath);
	const result = await extractText(new Uint8Array(buffer), { mergePages: false });

	const pages: PageText[] = result.text.map((text, i) => ({
		text,
		pageNumber: i + 1,
	}));

	const title = inferTitle(pages, filePath);
	const metadata: DocumentMetadata = {
		title,
		authors: [],
	};

	const chapters = buildChaptersFromPages(pages, title);

	return { metadata, chapters };
}

interface PageText {
	text: string;
	pageNumber: number;
}

function inferTitle(pages: PageText[], filePath: string): string {
	// Try first page — title is usually the first non-empty line
	const firstPage = pages[0]?.text ?? "";
	const lines = firstPage.split("\n").filter((l) => l.trim().length > 0);
	// Use the first substantial line (>5 chars, <100 chars) as title
	const titleLine = lines.find(
		(l) => l.trim().length > 5 && l.trim().length < 100,
	);
	if (titleLine) return titleLine.trim();
	return stemFromPath(filePath);
}

function stemFromPath(filePath: string): string {
	return basename(filePath)
		.replace(/\.pdf$/i, "")
		.replace(/[_-]/g, " ");
}

/**
 * Build chapters from PDF pages.
 *
 * Strategy: detect chapter-like headings in the text. If none found,
 * group pages into chunks as pseudo-chapters.
 */
function buildChaptersFromPages(
	pages: PageText[],
	docTitle: string,
): Chapter[] {
	// Try to detect chapter boundaries
	const chapterBreaks = detectChapterBreaks(pages);

	if (chapterBreaks.length > 0) {
		return buildFromChapterBreaks(pages, chapterBreaks);
	}

	// No chapters detected — group every ~10 pages as a chapter
	return buildFromPageGroups(pages, docTitle);
}

interface ChapterBreak {
	pageIndex: number;
	title: string;
}

function detectChapterBreaks(pages: PageText[]): ChapterBreak[] {
	const breaks: ChapterBreak[] = [];
	const chapterPattern =
		/^(chapter|part|section)\s+(\d+|[ivxlcdm]+)[\s.:—\-|]*(.*)/i;
	const numberedPattern = /^(\d+)\.\s+(.+)/;

	for (let i = 0; i < pages.length; i++) {
		const page = pages[i];
		if (!page) continue;
		const lines = page.text.split("\n").filter((l) => l.trim().length > 0);
		// Check first few lines of each page for chapter headings
		for (const line of lines.slice(0, 5)) {
			const trimmed = line.trim();
			const chapterMatch = chapterPattern.exec(trimmed);
			if (chapterMatch) {
				const suffix = (chapterMatch[3] ?? "").trim();
				const prefix = `${chapterMatch[1]} ${chapterMatch[2]}`;
				breaks.push({
					pageIndex: i,
					title: suffix ? `${prefix}: ${suffix}` : prefix,
				});
				break;
			}
			const numberedMatch = numberedPattern.exec(trimmed);
			if (
				numberedMatch &&
				trimmed.length < 80 &&
				i > 0 // skip first page (likely title page)
			) {
				breaks.push({
					pageIndex: i,
					title: trimmed,
				});
				break;
			}
		}
	}

	return breaks;
}

function buildFromChapterBreaks(
	pages: PageText[],
	breaks: ChapterBreak[],
): Chapter[] {
	const chapters: Chapter[] = [];

	for (let i = 0; i < breaks.length; i++) {
		const current = breaks[i] as ChapterBreak;
		const next = breaks[i + 1];
		const startPage = current.pageIndex;
		const endPage = next?.pageIndex ?? pages.length;

		const chapterPages = pages.slice(startPage, endPage);
		const sections = buildSectionsFromText(
			chapterPages.map((p) => p.text).join("\n\n"),
			`ch-${i}`,
		);

		chapters.push({
			id: `ch-${i}`,
			title: current.title,
			order: i,
			sections,
			content: [],
		});
	}

	// Pages before the first chapter break → intro chapter
	if (breaks.length > 0 && (breaks[0] as ChapterBreak).pageIndex > 0) {
		const introPages = pages.slice(0, (breaks[0] as ChapterBreak).pageIndex);
		if (introPages.some((p) => p.text.trim().length > 100)) {
			const sections = buildSectionsFromText(
				introPages.map((p) => p.text).join("\n\n"),
				"ch-intro",
			);
			chapters.unshift({
				id: "ch-intro",
				title: "Introduction",
				order: -1,
				sections,
				content: [],
			});
			// Fix order
			for (let i = 0; i < chapters.length; i++) {
				chapters[i]!.order = i;
			}
		}
	}

	return chapters;
}

function buildFromPageGroups(
	pages: PageText[],
	docTitle: string,
): Chapter[] {
	const PAGES_PER_CHAPTER = 10;
	const chapters: Chapter[] = [];

	for (let i = 0; i < pages.length; i += PAGES_PER_CHAPTER) {
		const group = pages.slice(i, i + PAGES_PER_CHAPTER);
		const chapterIndex = Math.floor(i / PAGES_PER_CHAPTER);
		const text = group.map((p) => p.text).join("\n\n");

		// Skip near-empty groups
		if (text.trim().length < 50) continue;

		const sections = buildSectionsFromText(text, `ch-${chapterIndex}`);

		chapters.push({
			id: `ch-${chapterIndex}`,
			title:
				chapters.length === 0
					? docTitle
					: `Section ${chapterIndex + 1}`,
			order: chapterIndex,
			sections,
			content: [],
		});
	}

	if (chapters.length === 0) {
		const text = pages.map((p) => p.text).join("\n\n");
		chapters.push({
			id: "ch-0",
			title: docTitle,
			order: 0,
			sections: [
				{
					id: "ch-0-s0",
					title: "Body",
					level: 1,
					content: textToBlocks(text),
					sections: [],
				},
			],
			content: [],
		});
	}

	return chapters;
}

/**
 * Split text into sections by detecting heading-like patterns.
 *
 * Conservative: only ALL CAPS lines are treated as section breaks.
 * This avoids over-splitting PDF text where every line starts with
 * a capital letter.
 */
function buildSectionsFromText(text: string, chapterId: string): Section[] {
	const lines = text.split("\n");
	// Only strong signal: ALL CAPS lines (at least 3 words)
	const headingPattern = /^[A-Z][A-Z\s,]{7,}$/;

	const sectionBreaks: Array<{ lineIndex: number; title: string }> = [];

	for (let i = 0; i < lines.length; i++) {
		const line = (lines[i] ?? "").trim();
		if (
			line.length > 7 &&
			line.length < 80 &&
			headingPattern.test(line) &&
			// Must have at least 2 words
			line.split(/\s+/).length >= 2 &&
			// Must be followed by content
			i + 1 < lines.length &&
			(lines[i + 1] ?? "").trim().length > 0
		) {
			sectionBreaks.push({ lineIndex: i, title: line });
		}
	}

	// If too many section breaks relative to content, the detection is
	// too aggressive. Fall back to fewer, larger sections.
	const totalBlocks = textToBlocks(text).length;
	if (sectionBreaks.length > 0 && totalBlocks / sectionBreaks.length < 5) {
		// Would average less than 5 blocks per section — too fragmented.
		// Keep only every Nth break to get ~10-20 blocks per section.
		const keepEvery = Math.max(1, Math.ceil(sectionBreaks.length / Math.max(1, Math.floor(totalBlocks / 10))));
		const filtered = sectionBreaks.filter((_, i) => i % keepEvery === 0);
		sectionBreaks.length = 0;
		sectionBreaks.push(...filtered);
	}

	if (sectionBreaks.length === 0) {
		return [
			{
				id: `${chapterId}-s0`,
				title: "Body",
				level: 1,
				content: textToBlocks(text),
				sections: [],
			},
		];
	}

	const sections: Section[] = [];

	// Content before first heading
	const preContent = lines.slice(0, sectionBreaks[0]!.lineIndex).join("\n");
	if (preContent.trim().length > 50) {
		sections.push({
			id: `${chapterId}-s0`,
			title: "Introduction",
			level: 1,
			content: textToBlocks(preContent),
			sections: [],
		});
	}

	for (let i = 0; i < sectionBreaks.length; i++) {
		const current = sectionBreaks[i]!;
		const next = sectionBreaks[i + 1];
		const sectionText = lines
			.slice(current.lineIndex + 1, next?.lineIndex ?? lines.length)
			.join("\n");

		if (sectionText.trim().length < 20) continue;

		sections.push({
			id: `${chapterId}-s${sections.length}`,
			title: current.title,
			level: 1,
			content: textToBlocks(sectionText),
			sections: [],
		});
	}

	if (sections.length === 0) {
		sections.push({
			id: `${chapterId}-s0`,
			title: "Body",
			level: 1,
			content: textToBlocks(text),
			sections: [],
		});
	}

	return sections;
}

function textToBlocks(text: string): ContentBlock[] {
	const blocks: ContentBlock[] = [];
	const lines = text.split("\n");

	// Merge lines into paragraphs. In PDF text, each line is typically
	// a single line of text. We merge consecutive non-empty lines into
	// paragraphs, splitting only at blank lines or very short lines
	// (likely headings or list items followed by a gap).
	let currentPara: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();

		// Skip page numbers
		if (trimmed.length > 0 && trimmed.length < 5 && /^\d+$/.test(trimmed)) {
			continue;
		}

		if (trimmed.length === 0) {
			if (currentPara.length > 0) {
				blocks.push({
					type: "paragraph",
					text: currentPara.join(" "),
				});
				currentPara = [];
			}
		} else {
			currentPara.push(trimmed);
		}
	}

	if (currentPara.length > 0) {
		blocks.push({ type: "paragraph", text: currentPara.join(" ") });
	}

	return blocks;
}
