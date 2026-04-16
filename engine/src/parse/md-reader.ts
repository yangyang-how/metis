import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type {
	Chapter,
	ContentBlock,
	DocumentMetadata,
	DocumentTree,
	Section,
} from "./types";

interface MdFrontmatter {
	title?: string;
	authors?: string[];
	language?: string;
}

/**
 * Parse a markdown file into the same DocumentTree shape as epub-reader.
 *
 * Heading hierarchy: H1 = chapter, H2 = section, H3+ inlined into nearest section.
 * Frontmatter (YAML between --- fences) is optional and overrides inferred metadata.
 */
export function parseMarkdown(filePath: string): DocumentTree {
	const raw = readFileSync(filePath, "utf-8");
	const { frontmatter, body } = extractFrontmatter(raw);
	const lines = body.split("\n");

	const title =
		frontmatter.title ?? inferTitle(lines) ?? stemFromPath(filePath);
	const metadata: DocumentMetadata = {
		title,
		authors: frontmatter.authors ?? [],
		language: frontmatter.language,
	};

	const chapters = buildChapters(lines, title);

	return { metadata, chapters };
}

function extractFrontmatter(raw: string): {
	frontmatter: MdFrontmatter;
	body: string;
} {
	const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
	const match = fmRegex.exec(raw);
	if (!match) return { frontmatter: {}, body: raw };

	const fmBlock = match[1] ?? "";
	const body = raw.slice(match[0].length);
	const fm: MdFrontmatter = {};

	for (const line of fmBlock.split("\n")) {
		const kv = line.match(/^(\w+):\s*(.+)$/);
		if (!kv) continue;
		const key = kv[1];
		const val = (kv[2] ?? "").trim();
		if (key === "title") fm.title = val;
		if (key === "language") fm.language = val;
		if (key === "authors") {
			const arr = val.match(/^\[(.+)\]$/);
			fm.authors = arr
				? (arr[1] ?? "").split(",").map((a) => a.trim())
				: [val];
		}
	}

	return { frontmatter: fm, body };
}

function inferTitle(lines: string[]): string | undefined {
	for (const line of lines) {
		const m = line.match(/^#\s+(.+)$/);
		if (m) return m[1];
	}
	return undefined;
}

function stemFromPath(filePath: string): string {
	return basename(filePath).replace(/\.md$/i, "");
}

interface HeadingLine {
	level: number;
	text: string;
	lineIndex: number;
}

function buildChapters(lines: string[], docTitle: string): Chapter[] {
	const headings = findHeadings(lines);
	const h1s = headings.filter((h) => h.level === 1);

	if (h1s.length === 0) {
		return [singleChapter(lines, docTitle)];
	}

	const chapters: Chapter[] = [];
	for (let i = 0; i < h1s.length; i++) {
		const start = h1s[i] as HeadingLine;
		const end = h1s[i + 1];
		const chapterLines = lines.slice(
			start.lineIndex + 1,
			end?.lineIndex ?? lines.length,
		);
		const subHeadings = headings.filter(
			(h) =>
				h.level >= 2 &&
				h.lineIndex > start.lineIndex &&
				h.lineIndex < (end?.lineIndex ?? lines.length),
		);
		chapters.push(
			buildChapter(start.text, i, chapterLines, subHeadings, lines),
		);
	}
	return chapters;
}

function singleChapter(lines: string[], title: string): Chapter {
	const headings = findHeadings(lines).filter((h) => h.level >= 2);
	return buildChapter(title, 0, lines, headings, lines);
}

function buildChapter(
	title: string,
	order: number,
	chapterLines: string[],
	h2Headings: HeadingLine[],
	allLines: string[],
): Chapter {
	const id = `ch-${order}`;
	const h2s = h2Headings.filter((h) => h.level === 2);

	if (h2s.length === 0) {
		return {
			id,
			title,
			order,
			sections: [
				{
					id: `${id}-s0`,
					title: "Body",
					level: 1,
					content: parseBlocks(chapterLines),
					sections: [],
				},
			],
			content: [],
		};
	}

	const contentBeforeFirstH2 = collectLinesBefore(
		chapterLines,
		h2s[0] as HeadingLine,
		allLines,
	);
	const sections: Section[] = [];

	for (let i = 0; i < h2s.length; i++) {
		const start = h2s[i] as HeadingLine;
		const end = h2s[i + 1];
		const sectionLines = allLines.slice(
			start.lineIndex + 1,
			end?.lineIndex ?? allLines.length,
		);
		sections.push({
			id: `${id}-s${i}`,
			title: start.text,
			level: 1,
			content: parseBlocks(sectionLines),
			sections: [],
		});
	}

	return {
		id,
		title,
		order,
		sections,
		content: parseBlocks(contentBeforeFirstH2),
	};
}

function collectLinesBefore(
	_chapterLines: string[],
	firstH2: HeadingLine,
	allLines: string[],
): string[] {
	const result: string[] = [];
	for (
		let i = firstH2.lineIndex - 1;
		i >= 0 && !(allLines[i] ?? "").match(/^#\s/);
		i--
	) {
		result.unshift(allLines[i] ?? "");
	}
	return result;
}

function findHeadings(lines: string[]): HeadingLine[] {
	const result: HeadingLine[] = [];
	let inCodeBlock = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (line.startsWith("```")) {
			inCodeBlock = !inCodeBlock;
			continue;
		}
		if (inCodeBlock) continue;
		const match = line.match(/^(#{1,6})\s+(.+)$/);
		if (match) {
			result.push({
				level: (match[1] ?? "").length,
				text: (match[2] ?? "").trim(),
				lineIndex: i,
			});
		}
	}
	return result;
}

function parseBlocks(lines: string[]): ContentBlock[] {
	const blocks: ContentBlock[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i] ?? "";

		if (line.trim() === "") {
			i++;
			continue;
		}

		if (line.startsWith("```")) {
			const lang = line.slice(3).trim() || undefined;
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
				codeLines.push(lines[i] ?? "");
				i++;
			}
			i++;
			blocks.push({ type: "code", text: codeLines.join("\n"), language: lang });
			continue;
		}

		if (line.startsWith(">")) {
			const quoteLines: string[] = [];
			while (i < lines.length && (lines[i] ?? "").startsWith(">")) {
				quoteLines.push((lines[i] ?? "").replace(/^>\s?/, ""));
				i++;
			}
			blocks.push({ type: "blockquote", text: quoteLines.join("\n") });
			continue;
		}

		if (line.match(/^(\d+\.|[-*+])\s/)) {
			const ordered = /^\d+\./.test(line);
			const items: { text: string }[] = [];
			while (i < lines.length && (lines[i] ?? "").match(/^(\d+\.|[-*+])\s/)) {
				items.push({
					text: (lines[i] ?? "").replace(/^(\d+\.|[-*+])\s+/, ""),
				});
				i++;
			}
			blocks.push({
				type: "list",
				ordered,
				items,
			});
			continue;
		}

		if (line.match(/^\|.*\|/)) {
			const rows: string[][] = [];
			while (i < lines.length && (lines[i] ?? "").match(/^\|.*\|/)) {
				const row = (lines[i] ?? "")
					.split("|")
					.slice(1, -1)
					.map((c) => c.trim());
				if (!row.every((c) => /^[-:]+$/.test(c))) {
					rows.push(row);
				}
				i++;
			}
			blocks.push({ type: "table", rows });
			continue;
		}

		const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			blocks.push({
				type: "heading",
				text: (headingMatch[2] ?? "").trim(),
				level: (headingMatch[1] ?? "").length,
			});
			i++;
			continue;
		}

		blocks.push({ type: "paragraph", text: line });
		i++;
	}

	return blocks;
}
