/**
 * Content filter — skip front/back matter chapters that have no
 * extractable knowledge. Saves LLM calls and cleans up output.
 *
 * Uses title pattern matching + block count heuristic.
 */
import type { NormalizedChapter } from "./types";

const SKIP_PATTERNS_ZH = [
	/^版权/,
	/^目[录次]$/,
	/^目\s*录/,
	/^目\s*次/,
	/^图版目次/,
	/^索引/,
	/^参考书目/,
	/^参考文献/,
	/^致谢/,
	/^鸣谢/,
	/^作者简介/,
	/^【作者简介】/,
	/^书名页/,
	/^封面/,
	/^封底/,
	/^内容提要$/,
	/^版权信息/,
	/^版权声明/,
	/^赞誉$/,
];

const SKIP_PATTERNS_EN = [
	/^copyright/i,
	/^table of contents/i,
	/^contents$/i,
	/^index$/i,
	/^bibliography/i,
	/^annotated bibliography/i,
	/^references$/i,
	/^acknowledgm?ents/i,
	/^about the author/i,
	/^cover page/i,
	/^title page/i,
	/^titlepage/i,
	/^colophon/i,
	/^glossary$/i,
	/^dedication/i,
];

const ALL_PATTERNS = [...SKIP_PATTERNS_ZH, ...SKIP_PATTERNS_EN];

// Chapters with fewer blocks than this are likely not real content
const MIN_BLOCKS_FOR_CONTENT = 5;

export function isSkippableChapter(chapter: NormalizedChapter): boolean {
	// Check title patterns
	const title = chapter.title.trim();
	for (const pattern of ALL_PATTERNS) {
		if (pattern.test(title)) return true;
	}

	// Very small chapters with generic names
	if (
		chapter.metadata.totalBlockCount < MIN_BLOCKS_FOR_CONTENT &&
		chapter.sections.length <= 1
	) {
		return true;
	}

	return false;
}

export function filterChapters(chapters: NormalizedChapter[]): {
	content: NormalizedChapter[];
	skipped: NormalizedChapter[];
} {
	const content: NormalizedChapter[] = [];
	const skipped: NormalizedChapter[] = [];

	for (const ch of chapters) {
		if (isSkippableChapter(ch)) {
			skipped.push(ch);
		} else {
			content.push(ch);
		}
	}

	return { content, skipped };
}
