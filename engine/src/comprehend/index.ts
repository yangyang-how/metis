/**
 * Comprehend stage — public entry point.
 *
 * Facade pattern: hides the three-phase architecture behind a single
 * function call. Downstream stages call comprehend() and get a
 * ComprehensionResult. They never know about structure inference,
 * prompt templates, or retry logic.
 *
 * Usage:
 *   import { comprehend } from "metis-engine/comprehend";
 *   const result = await comprehend({ documentTree, provider });
 */
import type { LLMProvider } from "../llm/types";
import type { DocumentTree } from "../parse/types";
import { synthesizeBook } from "./book-synthesizer";
import { comprehendChapter } from "./chapter-comprehender";
import { filterChapters } from "./content-filter";
import { normalizeChapters } from "./structure-inference";
import type {
	BookSynthesis,
	ComprehensionMap,
	ComprehensionResult,
} from "./types";

export { ComprehendError } from "./errors";
export { filterChapters, isSkippableChapter } from "./content-filter";
export { serializeBlocks, serializeSection } from "./serialize";
export type { SerializeOptions } from "./serialize";
export { normalizeChapters } from "./structure-inference";
export type {
	BookSynthesis,
	ChapterMetadata,
	ChapterType,
	ComprehendInput,
	ComprehensionMap,
	ComprehensionResult,
	KnowledgeStructure,
	NormalizedChapter,
	NormalizedSection,
	SectionAnalysis,
	Theme,
} from "./types";

interface ComprehendOptions {
	documentTree: DocumentTree;
	provider: LLMProvider;
}

export async function comprehend(
	options: ComprehendOptions,
): Promise<ComprehensionResult> {
	const { documentTree, provider } = options;

	// === Phase 1: Structure inference (rule-based, no LLM) ===
	const allChapters = normalizeChapters(documentTree);

	// === Phase 1.5: Filter front/back matter (saves LLM calls) ===
	const { content: contentChapters, skipped } = filterChapters(allChapters);
	if (skipped.length > 0) {
		console.error(
			`[comprehend] Skipping ${skipped.length} front/back matter chapters: ${skipped.map((c) => c.title.slice(0, 20)).join(", ")}`,
		);
	}

	// === Phase 2: Chapter comprehension (one LLM call per chapter) ===
	const chapterMaps: ComprehensionMap[] = [];
	const failedChapters: string[] = [];
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let callCount = 0;

	for (let i = 0; i < contentChapters.length; i++) {
		const chapter = contentChapters[i];
		if (!chapter) continue;
		console.error(
			`[comprehend] Chapter ${i + 1}/${contentChapters.length}: ${chapter.title.slice(0, 50)}...`,
		);
		const result = await comprehendChapter(
			chapter,
			documentTree.metadata,
			provider,
		);

		chapterMaps.push(result.map);
		totalInputTokens += result.usage.inputTokens;
		totalOutputTokens += result.usage.outputTokens;
		callCount++;

		if (result.failed) {
			failedChapters.push(chapter.id);
		}
	}

	// === Phase 3: Book synthesis (one LLM call for the whole book) ===
	const synthResult = await synthesizeBook(
		chapterMaps,
		documentTree.metadata,
		provider,
	);

	const bookSynthesis = synthResult.synthesis;
	totalInputTokens += synthResult.usage.inputTokens;
	totalOutputTokens += synthResult.usage.outputTokens;
	callCount++;

	return {
		bookSynthesis,
		chapterMaps,
		usage: {
			totalInputTokens,
			totalOutputTokens,
			callCount,
			failedChapters,
		},
	};
}
